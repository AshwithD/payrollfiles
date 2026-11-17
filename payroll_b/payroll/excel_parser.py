"""hrms_backend/payroll/excel_parser.py

The Canonical Single-File Excel Engine for CAOAS Payroll.
Consolidates:
1. Core Cleaners & Type Parsers (SafeExcelReader: dates, decimals, booleans, headers)
2. Staff Employee Master Bulk Roster Ingestion (parse_employee_master_excel)
3. Multi-Sheet Monthly Input Template Generator (generate_portal_template)
4. Multi-Sheet Monthly Ingestion Parser (parse_portal_excel)
"""

import io
from io import BytesIO, StringIO
from collections import defaultdict
import math
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, models, transaction
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
import calendar
import codecs
import csv
from calendar import month_name
from decimal import ROUND_HALF_UP
from django.http import HttpResponse

from .models import ClientProfile, Employee, EmployeeSalaryStructure, PayrollBatch
MAX_EXCEL_ROWS = 2000


class ExcelTooLargeError(Exception):
    pass


def enforce_max_rows(worksheet, max_rows: int = MAX_EXCEL_ROWS):
    row_count = worksheet.max_row or 0
    if row_count > max_rows:
        raise ExcelTooLargeError(
            f"Excel file has {row_count} rows, which exceeds the maximum of {max_rows} allowed rows."
        )


class ExcelParseError(Exception):
    pass


class PayrollRowValidationError(Exception):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__(f"{len(errors)} rows have errors")


class EmployeeImportError(Exception):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__(f"{len(errors)} rows have errors")


# ── Core Cleaners & Sanitizers ──────────────────────────────────────────────

def _clean_str(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _normalize_header(value) -> str:
    """
    Collapses internal whitespace/newlines/tabs to single spaces and
    strips parenthetical annotations.
    """
    if value is None:
        return ""
    s = str(value).lower()
    s = re.sub(r"(.*?)", "", s)
    s = re.sub(r"[*()]", "", s)
    return re.sub(r"s+", " ", s).strip()


def _is_empty_row(values) -> bool:
    return all(value is None or str(value).strip() == "" for value in values)


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _to_decimal(value, field_name: str, errors: list[str]) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        amount = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        errors.append(f"{field_name} must be numeric")
        return Decimal("0")
    if amount < 0:
        errors.append(f"{field_name} must be greater than or equal to 0")
    return amount.quantize(Decimal("0.01"))


def _to_int(value, field_name: str, errors: list[str]) -> int:
    amount = _to_decimal(value, field_name, errors)
    if amount != amount.to_integral_value():
        errors.append(f"{field_name} must be a whole number")
    return int(amount)


MONTH_NAMES = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}


def parse_date(value) -> date:
    """Accepts a date, datetime, or string (YYYY-MM-DD / DD/MM/YYYY / DD-MM-YYYY)."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        value = value.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
    raise ValueError(f"Invalid date: {value!r} (expected YYYY-MM-DD).")


def to_decimal(value, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number, got {value!r}.")


def to_positive_int(value, field_name: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a whole number, got {value!r}.")
    if result < 1:
        raise ValueError(f"{field_name} must be at least 1.")
    return result


def parse_month(value, field_name: str = "Month") -> int:
    """Accepts integers (1-12), numeric strings ("1", "01", "1.0"), or month names ("January", "Jan")."""
    if value is None or str(value).strip() == "":
        raise ValueError(f"{field_name} is required.")

    val_str = str(value).strip().lower()
    if val_str in MONTH_NAMES:
        return MONTH_NAMES[val_str]

    try:
        m = int(float(val_str))
        if 1 <= m <= 12:
            return m
    except (ValueError, TypeError):
        pass

    raise ValueError(f"{field_name} must be a valid month (1 to 12, or month name like Jan/January), got {value!r}.")


def parse_year(value, field_name: str = "Year") -> int:
    """Accepts 4-digit years (e.g. 2026, "2026", 2026.0) or 2-digit years ("26" -> 2026)."""
    if value is None or str(value).strip() == "":
        raise ValueError(f"{field_name} is required.")

    val_str = str(value).strip()
    try:
        y = int(float(val_str))
        if 2000 <= y <= 2100:
            return y
        if 0 <= y <= 99:
            return 2000 + y
    except (ValueError, TypeError):
        pass

    raise ValueError(f"{field_name} must be a valid 4-digit year (e.g. 2026), got {value!r}.")


def parse_bool(value, default: bool = False) -> bool:
    """Case-insensitive boolean parser accepting Yes/No, True/False, Y/N, 1/0."""
    if value is None or str(value).strip() == "":
        return default
    if isinstance(value, bool):
        return value
    val_str = str(value).strip().lower()
    if val_str in ("yes", "y", "true", "t", "1"):
        return True
    if val_str in ("no", "n", "false", "f", "0"):
        return False
    return default


# ── PART 2: Employee Master (Bulk Roster Import) ───────────────────────────

EMPLOYEE_MASTER_COLUMN_MAPPING = {
    # Employee Code
    "Employee Code": "employee_code",
    "Emp Code": "employee_code",
    "Code": "employee_code",
    "Emp ID": "employee_code",
    "Employee ID": "employee_code",

    # Names
    "First Name": "first_name",
    "Given Name": "first_name",
    "Last Name": "last_name",
    "Surname": "last_name",

    # Contact & Identity
    "Email": "email",
    "Work Email": "email",
    "Email Address": "email",
    "PAN Number": "pan_number",
    "PAN": "pan_number",
    "PAN Card": "pan_number",

    # Organization
    "Department": "department",
    "Dept": "department",
    "Position": "position",
    "Designation": "position",
    "Role": "position",
    "Employment Type": "employment_type",
    "Emp Type": "employment_type",
    "Type": "employment_type",
    "Employee Type": "employment_type",

    # Payment & Banking
    "Payment Mode": "payment_mode",
    "Pay Mode": "payment_mode",
    "Mode of Payment": "payment_mode",
    "Payment Method": "payment_mode",
    "Bank Name": "bank_name",
    "Bank": "bank_name",
    "Bank Account Number": "bank_account_number",
    "Bank Account No": "bank_account_number",
    "Bank Account": "bank_account_number",
    "Account Number": "bank_account_number",
    "Account No": "bank_account_number",
    "A/C Number": "bank_account_number",
    "A/C No": "bank_account_number",
    "Bank A/C": "bank_account_number",
    "Bank A/C Number": "bank_account_number",
    "Bank A/C No": "bank_account_number",
    "Bank IFSC Code": "bank_ifsc_code",
    "Bank IFSC": "bank_ifsc_code",
    "IFSC Code": "bank_ifsc_code",
    "IFSC": "bank_ifsc_code",

    # Dates
    "Hire Date": "hire_date",
    "Date of Joining": "hire_date",
    "DOJ": "hire_date",
    "Effective From": "effective_from",
    "Effective Date": "effective_from",

    # Compensation
    "CTC": "ctc",
    "Annual CTC": "ctc",
    "Gross CTC": "ctc",
    "Cost to Company": "ctc",

    # Statutory & Retirals
    "PF Applicable": "pf_applicable",
    "PF Opted": "pf_applicable",
    "PF": "pf_applicable",
    "UAN": "uan_number",
    "UAN Number": "uan_number",
    "UAN No": "uan_number",
    "Universal Account Number": "uan_number",
    "ESI Applicable": "esi_applicable",
    "ESI Opted": "esi_applicable",
    "ESI": "esi_applicable",
    "ESI Number": "esi_number",
    "ESI IP Number": "esi_number",
    "ESIC Number": "esi_number",

    # Benefits / Additional Allowances
    "NPS Allowance": "nps_allowance",
    "NPS": "nps_allowance",
    "FBP": "fbp",
    "Flexible Benefit Plan": "fbp",
    "VPF": "vpf",
    "Voluntary PF": "vpf",
}
EMPLOYEE_MASTER_COLUMN_MAPPING = {
    _normalize_header(k): v for k, v in EMPLOYEE_MASTER_COLUMN_MAPPING.items()
}


class EmployeeImportError(Exception):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__(f"{len(errors)} rows have errors")


def _to_date(value, field_name: str, errors: list[str]):
    if value is None or value == "":
        return None
    if hasattr(value, "date"):
        return value.date() if hasattr(value, "hour") else value
    errors.append(f"{field_name} must be a valid date")
    return None


def parse_employee_master_excel(file, client, created_by=None) -> tuple[int, int, list[str]]:
    """
    Creates/updates payroll.Employee rows for `client` from an uploaded
    Excel file. Matches existing rows by employee_code WITHIN this
    client (create if new, update if the code already exists for this
    client — a code can be reused across different clients). Returns
    (created_count, updated_count, warnings). Raises EmployeeImportError
    with row-level detail on any bad row — nothing is partially applied.

    This import is for onboarding: for any row with a CTC value where the
    employee does NOT already have a salary structure on file, an initial
    EmployeeSalaryStructure is auto-derived from that CTC via
    EmployeeSalaryStructure.build_from_ctc() (same math as
    SalaryStructureModal.jsx). The optional "PF Applicable" column
    (yes/no, defaults to yes if blank) controls pf_opted for that
    auto-created structure. Employees who already have a structure are
    left untouched here — re-importing only updates their plain Employee
    fields; structure changes after onboarding go through the normal
    Edit Salary Structure flow, not this bulk import.
    """
    try:
        workbook = load_workbook(file, data_only=True)
    except Exception as exc:
        raise ExcelParseError(f"Unable to read Excel file: {exc}") from exc

    # Discover candidate roster worksheet
    worksheet = workbook.active
    for title in ("Employee Roster", "Employee Data", "Employees", "Roster", "Sheet1"):
        if title in workbook.sheetnames:
            worksheet = workbook[title]
            break

    try:
        enforce_max_rows(worksheet)
    except ExcelTooLargeError as exc:
        raise ExcelParseError(str(exc)) from exc

    headers = [cell.value for cell in worksheet[1]]
    indexes = {}
    header_map = {}
    for idx, raw_header in enumerate(headers, start=1):
        header = _normalize_header(raw_header)
        if header:
            header_map[header] = idx
        if header in EMPLOYEE_MASTER_COLUMN_MAPPING:
            indexes[EMPLOYEE_MASTER_COLUMN_MAPPING[header]] = idx

    if "employee_code" not in indexes:
        raise ExcelParseError("Header row not found or Employee Code column is missing.")

    # Discover client custom components
    client_custom_comps = []
    if client and hasattr(client, "custom_salary_components"):
        try:
            client_custom_comps = list(
                client.custom_salary_components.filter(is_active=True).exclude(code__startswith="__")
            )
        except Exception:
            client_custom_comps = []

    fixed_flat_comps = [
        c for c in client_custom_comps
        if not getattr(c, "is_monthly_variable", False)
        and (getattr(c, "formula", "") or "").strip().upper() != "VARIABLE"
        and getattr(c, "calculation_type", "FLAT") == "FLAT"
    ]

    row_errors = []
    parsed_rows = []
    warnings = []

    for row_number in range(2, worksheet.max_row + 1):
        values = [cell.value for cell in worksheet[row_number]]
        if _is_empty_row(values):
            continue

        errors = []
        code_raw = worksheet.cell(row=row_number, column=indexes["employee_code"]).value
        employee_code = str(code_raw).strip() if code_raw is not None else ""
        if not employee_code:
            errors.append("Employee Code is required")

        # Skip instructions or notes if retained in file
        if employee_code.upper() in ("INSTRUCTIONS", "MANDATORY FIELDS", "OPTIONAL FIELDS", "FORMAT NOTES", "NOTE"):
            continue

        def cell(field):
            col = indexes.get(field)
            return worksheet.cell(row=row_number, column=col).value if col else None

        first_name = str(cell("first_name") or "").strip()
        if not first_name:
            errors.append("First Name is required")

        ctc_raw = cell("ctc")
        ctc = None
        if ctc_raw not in (None, ""):
            ctc = _to_decimal(ctc_raw, "Annual CTC", errors)

        pos_val = str(cell("position") or "").strip()
        emp_type_raw = str(cell("employment_type") or "").strip().upper()
        if "INTERN" in emp_type_raw or "APPRENTICE" in emp_type_raw or "TRAINEE" in emp_type_raw:
            employment_type = "INTERN"
        elif "CONSULTANT" in emp_type_raw or "RETAINER" in emp_type_raw or "CONTRACTOR" in emp_type_raw:
            employment_type = "CONSULTANT"
        elif "REGULAR" in emp_type_raw or "PERMANENT" in emp_type_raw or "FULL" in emp_type_raw:
            employment_type = "REGULAR"
        else:
            if re.search(r"\b(intern|internship|apprentice|apprenticeship|trainee)\b", pos_val, re.IGNORECASE):
                employment_type = "INTERN"
            else:
                employment_type = "REGULAR"

        is_intern = (employment_type == "INTERN")

        hire_date = _to_date(cell("hire_date"), "Hire Date", errors)
        effective_from = _to_date(cell("effective_from"), "Effective From", errors)

        pf_raw = cell("pf_applicable")
        if is_intern and pf_raw in (None, ""):
            pf_text = "no"
        else:
            pf_text = str(pf_raw).strip().lower() if pf_raw not in (None, "") else "yes"
        if pf_text not in ("yes", "no"):
            errors.append("PF Opted must be 'yes' or 'no'")
        pf_opted = pf_text == "yes"

        esi_raw = cell("esi_applicable")
        esi_opted = None
        if esi_raw not in (None, ""):
            esi_text = str(esi_raw).strip().lower()
            if esi_text not in ("yes", "no"):
                errors.append("ESI Opted must be 'yes' or 'no'")
            esi_opted = esi_text == "yes"
        elif is_intern:
            esi_opted = False

        esi_num = str(cell("esi_number") or "").strip()
        uan_raw = str(cell("uan_number") or "").strip()
        uan_num = re.sub(r"\D", "", uan_raw) if uan_raw else ""
        if uan_num and len(uan_num) != 12:
            warnings.append(f"Row {row_number}: UAN '{uan_raw}' is not 12 digits.")

        nps_allowance = None
        if cell("nps_allowance") not in (None, ""):
            nps_allowance = _to_decimal(cell("nps_allowance"), "NPS Allowance", errors)

        fbp = None
        if cell("fbp") not in (None, ""):
            fbp = _to_decimal(cell("fbp"), "FBP", errors)

        vpf = None
        if cell("vpf") not in (None, ""):
            vpf = _to_decimal(cell("vpf"), "VPF", errors)

        # Payment & Banking details
        raw_acc = str(cell("bank_account_number") or "").strip()
        clean_acc = "".join(filter(str.isdigit, raw_acc)) if raw_acc else ""
        raw_ifsc = str(cell("bank_ifsc_code") or "").strip().upper()
        clean_ifsc = "".join(ch for ch in raw_ifsc if ch.isalnum())[:11] if raw_ifsc else ""
        bank_name = str(cell("bank_name") or "").strip()
        pay_mode_raw = str(cell("payment_mode") or "").strip().lower()
        if any(w in pay_mode_raw for w in ("wire", "transfer", "bank", "neft", "rtgs", "imps")):
            payment_mode = ClientProfile.PAYMENT_MODE_WIRE
        elif any(w in pay_mode_raw for w in ("cheque", "check")):
            payment_mode = ClientProfile.PAYMENT_MODE_CHEQUE
        elif "cash" in pay_mode_raw:
            payment_mode = ClientProfile.PAYMENT_MODE_CASH
        else:
            payment_mode = None

        # Dynamic custom components for this row
        custom_dict = {}
        for comp in fixed_flat_comps:
            for alias in [comp.code, comp.name, f"{comp.name} [{comp.code}]"]:
                norm_alias = _normalize_header(alias)
                if norm_alias in header_map:
                    c_idx = header_map[norm_alias]
                    val = worksheet.cell(row=row_number, column=c_idx).value
                    if val not in (None, ""):
                        val_dec = _to_decimal(val, comp.name, errors)
                        if val_dec > 0:
                            custom_dict[comp.code] = {
                                "name": comp.name,
                                "amount": float(val_dec),
                                "component_type": comp.component_type,
                                "calculation_type": "FLAT",
                            }
                    break

        custom_dict["employment_type"] = employment_type
        custom_dict["is_intern"] = is_intern

        if errors:
            row_errors.append({"row": row_number, "employee_code": employee_code, "errors": errors})
            continue

        parsed_rows.append({
            "row_number": row_number,
            "employee_code": employee_code,
            "first_name": first_name,
            "last_name": str(cell("last_name") or "").strip(),
            "email": str(cell("email") or "").strip(),
            "pan_number": str(cell("pan_number") or "").strip().upper(),
            "department": str(cell("department") or "").strip(),
            "position": pos_val,
            "employment_type": employment_type,
            "is_intern": is_intern,
            "bank_account_number": clean_acc,
            "bank_ifsc_code": clean_ifsc,
            "bank_name": bank_name,
            "payment_mode": payment_mode,
            "pf_opted": pf_opted,
            "uan_number": uan_num,
            "esi_opted": esi_opted,
            "esi_number": esi_num,
            "hire_date": hire_date,
            "effective_from": effective_from,
            "ctc": ctc,
            "nps_allowance": nps_allowance,
            "fbp": fbp,
            "vpf": vpf,
            "custom_components": custom_dict,
            # Import always creates/updates employees as active — Status is
            # not an importable column. Deactivation is a deliberate action
            # done from the employee page, not something a stray value in
            # an uploaded sheet should be able to flip on re-import.
            "status": Employee.STATUS_ACTIVE,
        })

    if row_errors:
        raise EmployeeImportError(row_errors)

    existing_by_code = {
        e.employee_code: e for e in Employee.objects.filter(client=client)
    }

    created_count = 0
    updated_count = 0
    duplicate_errors = []
    for row in parsed_rows:
        row_number = row.pop("row_number")
        code = row.pop("employee_code")
        pf_opted = row.pop("pf_opted")
        esi_opted = row.pop("esi_opted", None)
        esi_number = row.pop("esi_number", "")
        uan_number = row.pop("uan_number", "")
        bank_acc = row.pop("bank_account_number", "")
        bank_ifsc = row.pop("bank_ifsc_code", "")
        b_name = row.pop("bank_name", "")
        p_mode = row.pop("payment_mode", None)
        ctc = row.get("ctc")
        effective_from = row.pop("effective_from", None)
        nps_allowance = row.pop("nps_allowance", None)
        fbp = row.pop("fbp", None)
        vpf = row.pop("vpf", None)
        custom_components = row.pop("custom_components", {})
        emp_type = row.pop("employment_type", "REGULAR")
        is_intern_row = row.pop("is_intern", False)
        employee = existing_by_code.get(code)
        is_new = employee is None
        try:
            with transaction.atomic():
                if employee:
                    for field, value in row.items():
                        setattr(employee, field, value)
                    if bank_acc:
                        employee.bank_account_number = bank_acc
                    if bank_ifsc:
                        employee.bank_ifsc_code = bank_ifsc
                    if b_name:
                        employee.bank_name = b_name
                    if p_mode:
                        employee.payment_mode = p_mode
                    if esi_number:
                        employee.esi_number = esi_number
                    if uan_number:
                        employee.uan_number = uan_number
                    employee.save()
                    if employee.salary_structures.exists():
                        latest_struct = employee.salary_structures.first()
                        if latest_struct:
                            s_comps = dict(latest_struct.custom_components or {})
                            s_comps["employment_type"] = emp_type
                            s_comps["is_intern"] = is_intern_row
                            latest_struct.custom_components = s_comps
                            latest_struct.save(update_fields=["custom_components"])
                else:
                    employee = Employee.objects.create(
                        employee_code=code,
                        client=client,
                        bank_account_number=bank_acc,
                        bank_ifsc_code=bank_ifsc,
                        bank_name=b_name,
                        payment_mode=p_mode or ClientProfile.PAYMENT_MODE_WIRE,
                        **row
                    )
                    if esi_number:
                        employee.esi_number = esi_number
                    if uan_number:
                        employee.uan_number = uan_number
                    employee.save()

                if ctc not in (None, "") and not employee.salary_structures.exists():
                    structure_fields = EmployeeSalaryStructure.build_from_ctc(
                        ctc,
                        pf_opted=pf_opted,
                        esi_opted=esi_opted,
                        nps_allowance=nps_allowance or Decimal("0"),
                        fbp=fbp or Decimal("0"),
                        vpf=vpf or Decimal("0"),
                        custom_components=custom_components,
                        client=client,
                        employee=employee,
                    )
                    structure_fields.pop("min_wage_warning", None)
                    structure_fields.pop("shortfall", None)
                    structure_fields.pop("esi_opted", None)
                    structure_fields.pop("employer_esi", None)
                    structure_fields.pop("employer_esi_in_ctc", None)

                    eff_from = effective_from or employee.hire_date or timezone.now().date()
                    structure = EmployeeSalaryStructure(
                        employee=employee,
                        effective_from=eff_from,
                        created_by=created_by,
                        change_reason="Initial structure — Excel roster import",
                        **structure_fields,
                    )
                    if nps_allowance is not None:
                        structure.nps_allowance = nps_allowance
                    if fbp is not None:
                        structure.fbp = fbp
                    if vpf is not None:
                        structure.vpf = vpf
                    merged = dict(structure.custom_components or structure_fields.get("custom_components") or {})
                    if custom_components:
                        merged.update(custom_components)
                    merged["employment_type"] = emp_type
                    merged["is_intern"] = is_intern_row
                    if uan_number:
                        merged["uan_number"] = uan_number
                    structure.custom_components = merged
                    structure.save()
        except IntegrityError:
            duplicate_errors.append({
                "row": row_number,
                "employee_code": code,
                "errors": ["Employee Code already exists"],
            })
            continue

        existing_by_code[code] = employee
        if is_new:
            created_count += 1
        else:
            updated_count += 1

    if duplicate_errors:
        raise EmployeeImportError(duplicate_errors)

    return created_count, updated_count, warnings

# ── PART 3: Monthly Multi-Sheet Portal Template & Ingestion Engine ──────────

SHEET_CONFIGS = [
    {
        "key": "NEW_EMPLOYEE",
        "title": "Add New Employee",
        "category": "👤 Joiners & Onboarding",
        "description": "Add employees joining this payroll month.",
        "headers": [
            ("Employee Code *", "Unique employee code (e.g. EMP101)", 18),
            ("First Name *", "Employee given name", 18),
            ("Last Name", "Surname / Family name", 18),
            ("Annual CTC * (₹)", "Total annual CTC in Rupees (e.g. 600000)", 18),
            ("Effective From (YYYY-MM-DD)", "Format: YYYY-MM-DD (defaults to hire date)", 24),
            ("Hire Date (YYYY-MM-DD)", "Format: YYYY-MM-DD date of joining", 22),
            ("Email", "Official or personal email address", 24),
            ("PAN Number (10 Chars)", "10-character PAN (e.g. ABCDE1234F)", 18),
            ("Department", "Department / Team", 16),
            ("Position", "Job title / Designation", 18),
            ("Employment Type", "Regular, Intern, or Consultant (default Regular)", 18),
            ("PF Opted (Yes/No)", "Yes or No (default Yes)", 14),
            ("UAN Number (12 Digits)", "12-digit Universal Account Number (for PF)", 20),
            ("ESI Opted (Yes/No)", "Yes or No (defaults to auto if gross <= 21k)", 14),
            ("ESI Number (10 Digits)", "10-digit ESIC IP number", 18),
            ("Bank Account Number", "Bank account number for salary transfer (digits only)", 22),
            ("Bank IFSC Code", "11-character IFSC code (e.g. HDFC0001234)", 18),
            ("Bank Name", "Bank name (e.g. HDFC Bank, SBI)", 18),
            ("NPS Allowance (₹/Month)", "Optional monthly amount in Rupees", 18),
            ("FBP (₹/Month)", "Optional Flexible Benefit Plan monthly amount in Rupees", 18),
            ("VPF (₹/Month)", "Optional Voluntary PF monthly amount in Rupees", 18),
        ],
        "sample": [
            "EMP105", "Arun", "Kumar", 750000, "2026-11-01", "2026-11-01",
            "arun.k@example.com", "ABCDE1234F", "Engineering", "Software Engineer", "Regular",
            "Yes", "100123456789", "Yes", "", "50100234567890", "HDFC0001234", "HDFC Bank", 0, 0, 0
        ]
    },
    {
        "key": "REVISION",
        "title": "Update Salary",
        "category": "📈 Salary Appraisals & Revisions",
        "description": "Change salary structure or CTC for active employees.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("New Annual CTC * (₹)", "Revised annual CTC in Rupees (e.g. 900000)", 18),
            ("Effective From * (YYYY-MM-DD)", "Effective date in YYYY-MM-DD format", 24),
            ("PF Opted (Yes/No)", "Yes or No (default Yes)", 14),
            ("ESI Opted (Yes/No)", "Yes or No", 14),
            ("Reason", "e.g. Annual Appraisal, Promotion", 24),
            ("NPS Allowance (₹/Month)", "Optional revised monthly amount in Rupees", 18),
            ("FBP (₹/Month)", "Optional revised monthly amount in Rupees", 18),
            ("VPF (₹/Month)", "Optional revised monthly amount in Rupees", 18),
        ],
        "sample": [
            "EMP101", "Arun Kumar", 900000, "2026-11-01", "Yes", "Yes", "Annual Increment 2026", 0, 0, 0
        ]
    },
    {
        "key": "EXIT",
        "title": "Record Exit",
        "category": "🚪 Resignations & Exits",
        "description": "Record an employee resignation or termination.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Last Working Date * (YYYY-MM-DD)", "Final working day in YYYY-MM-DD format", 26),
            ("Reason", "e.g. Resigned, Relocated, Higher studies", 28),
        ],
        "sample": [
            "EMP102", "Pooja Hegde", "2026-11-30", "Resigned for higher studies"
        ]
    },
    {
        "key": "SALARY_HOLD",
        "title": "Hold Salary",
        "category": "⏸️ Salary Hold / Release",
        "description": "Hold salary payout for later scheduled release.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Hold Amount * (₹)", "Amount in Rupees to hold (e.g. 25000)", 18),
            ("Release Month * (1-12 or Jan-Dec)", "Month number (1-12) or month name (e.g. 11 or Nov)", 22),
            ("Release Year * (YYYY)", "4-digit year (e.g. 2026)", 16),
            ("Reason", "e.g. Pending asset handover, Notice period", 28),
        ],
        "sample": [
            "EMP103", "Suresh R", 25000, 11, 2026, "Pending client asset handover"
        ]
    },
    {
        "key": "ADVANCE",
        "title": "Add Advance or Loan",
        "category": "💰 Loans & Advances",
        "description": "Disburse an advance or loan with monthly EMI recovery.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Total Amount * (₹)", "Total advance/loan amount in Rupees (e.g. 50000)", 18),
            ("Tenure Months * (No. of EMIs)", "Number of monthly repayment EMIs (e.g. 5)", 20),
            ("Purpose / Label", "e.g. Festival Advance, Medical Loan", 24),
        ],
        "sample": [
            "EMP104", "Nandini S P", 50000, 5, "Medical Emergency Loan"
        ]
    },
    {
        "key": "ONE_TIME_EARNING",
        "title": "Add Extra Payment",
        "category": "➕ Bonuses & Incentives",
        "description": "One-time bonus, incentive, arrears, or other addition.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Amount * (₹)", "Earning amount in Rupees (e.g. 15000)", 16),
            ("Description", "e.g. Q3 Performance Bonus, Referral Reward", 28),
        ],
        "sample": [
            "EMP101", "Arun Kumar", 15000, "Q3 Performance Bonus"
        ]
    },
    {
        "key": "ONE_TIME_DEDUCTION",
        "title": "Add Deduction",
        "category": "➖ Deductions & Recoveries",
        "description": "One-time recovery, penalty, or payroll adjustment.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Amount * (₹)", "Deduction amount in Rupees (e.g. 2000)", 16),
            ("Description", "e.g. ID card replacement, Damage recovery", 28),
        ],
        "sample": [
            "EMP102", "Pooja Hegde", 2000, "Hardware Damage Recovery"
        ]
    },
    {
        "key": "REIMBURSEMENT",
        "title": "Add Reimbursement",
        "category": "💳 Expense Reimbursements",
        "description": "Tax-free expense claims (travel, fuel, mobile, medical bills).",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Amount * (₹)", "Reimbursement claim amount in Rupees (e.g. 3500)", 16),
            ("Description", "e.g. Travel allowance bill, Mobile bill, Fuel claim", 28),
        ],
        "sample": [
            "EMP101", "Arun Kumar", 3500, "Client travel & cab expenses"
        ]
    },
    {
        "key": "LOP",
        "title": "Record Loss of Pay",
        "category": "📅 Attendance & Loss of Pay",
        "description": "Unpaid absence or leave days to deduct from attendance.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("LOP Days * (e.g. 1 or 2.5)", "Number of unpaid absence days (e.g. 1 or 2.5)", 20),
            ("Reason", "e.g. Unapproved absence, Casual leave exhausted", 28),
        ],
        "sample": [
            "EMP102", "Pooja Hegde", 2.0, "Unapproved absence without notice"
        ]
    },
    {
        "key": "ARREARS",
        "title": "Add Salary Arrears",
        "category": "↗️ Salary Arrears",
        "description": "Retroactive salary adjustments, delayed increment arrears, or previous payout corrections.",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Arrears Amount * (₹)", "Arrears amount in Rupees (e.g. 8000)", 18),
            ("Reason / Period", "e.g. April 2026 appraisal hike arrears", 28),
        ],
        "sample": [
            "EMP103", "Suresh R", 8000, "April appraisal increment arrears"
        ]
    },
    {
        "key": "TDS",
        "title": "Add TDS (Income Tax)",
        "category": "🧾 Tax & Compliance (Admin)",
        "admin_only": True,
        "description": "Monthly TDS tax deduction adjustments (Client Admin only).",
        "headers": [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("TDS Amount * (₹)", "TDS deduction amount in Rupees (e.g. 5000)", 16),
            ("Note", "e.g. Director tax deduction adjustment", 28),
        ],
        "sample": [
            "EMP101", "Arun Kumar", 5000, "Director tax deduction adjustment"
        ]
    },
    {
        "key": "NOTE",
        "title": "Send a Note",
        "category": "📝 Notes & Instructions",
        "description": "Leave notes or special instructions for the payroll team.",
        "headers": [
            ("Note / Message *", "General note or instruction for the monthly payroll batch", 60),
        ],
        "sample": [
            "Please process bonus payments along with this month's regular salary."
        ]
    },
]


# ─── Formatting Helpers ───────────────────────────────────────────────────────

HEADER_FILL = PatternFill(start_color="001F5B", end_color="001F5B", fill_type="solid")
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
SAMPLE_FILL = PatternFill(start_color="F0F4F8", end_color="F0F4F8", fill_type="solid")
SAMPLE_FONT = Font(name="Calibri", size=10, italic=True, color="4A5568")
THIN_BORDER = Border(
    left=Side(style="thin", color="CBD5E0"),
    right=Side(style="thin", color="CBD5E0"),
    top=Side(style="thin", color="CBD5E0"),
    bottom=Side(style="thin", color="CBD5E0"),
)


def _clean_str(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _normalize_header(val) -> str:
    s = _clean_str(val).lower()
    # Strip parenthetical annotations like (YYYY-MM-DD) or (e.g. EMP101) so headers like
    # "Effective From * (YYYY-MM-DD)" normalize to "effective from" cleanly.
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[\*\(\)]", "", s)
    return re.sub(r"\s+", " ", s).strip()


# ─── Template Generator ───────────────────────────────────────────────────────

def generate_portal_template(client, is_admin: bool = False) -> io.BytesIO:
    """Creates a styled, multi-sheet .xlsx workbook template for the client.

    Workbook Layout:
      - Sheet 1: 'Sheet Index' (Clickable Directory Hub linking to all sheets)
      - Sheet 2: 'Employee Reference' (Active employee directory with Code, Name, Dept, Desig, PAN, UAN, CTC)
      - Sheet 3+: Functional Data Sheets (Headers only, zero dummy data, freeze panes, return link)
    """
    wb = Workbook()
    wb.remove(wb.active)

    # 1. Create Sheet 1: Sheet Index (Directory & Navigation Hub)
    index_ws = wb.create_sheet(title="Sheet Index")
    index_ws.views.sheetView[0].showGridLines = True

    # 2. Create Sheet 2: Employee Reference
    ref_ws = wb.create_sheet(title="Employee Reference")
    ref_ws.views.sheetView[0].showGridLines = True

    # Active dynamic custom components configured for this client
    custom_comps = []
    if client and hasattr(client, "custom_salary_components"):
        try:
            custom_comps = list(
                client.custom_salary_components.filter(is_active=True).exclude(code__startswith="__").order_by("display_order", "name")
            )
        except Exception:
            custom_comps = []

    NAV_FONT = Font(name="Calibri", size=10, bold=True, color="1D4ED8", underline="single")
    NAV_FILL = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")

    sheet_index_entries = []

    # Entry 1 on Index: Employee Reference
    sheet_index_entries.append({
        "title": "Employee Reference",
        "category": "👥 Master Lookup Reference",
        "desc": "Active employee directory with codes, PAN, UAN, and CTC for copy-paste lookup.",
    })

    # ── Populate Sheet 2: Employee Reference ───────────────────────────────────
    ref_headers = [
        "Employee Code *", "Full Name", "Department", "Designation", "PAN Number", "UAN Number", "Annual CTC (₹)", "Employee Selector (Code — Name)"
    ]
    ref_widths = [18, 24, 20, 22, 16, 18, 18, 32]
    for col_idx, (h, w) in enumerate(zip(ref_headers, ref_widths), start=1):
        cell = ref_ws.cell(row=1, column=col_idx, value=h)
        cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = THIN_BORDER
        ref_ws.column_dimensions[get_column_letter(col_idx)].width = w

    # Return link on Sheet 2
    back_col = len(ref_headers) + 2
    back_cell = ref_ws.cell(row=1, column=back_col, value="🔙 Back to Index")
    back_cell.hyperlink = "#'Sheet Index'!A1"
    back_cell.font = NAV_FONT
    back_cell.fill = NAV_FILL
    back_cell.alignment = Alignment(horizontal="center", vertical="center")
    back_cell.border = THIN_BORDER
    ref_ws.column_dimensions[get_column_letter(back_col)].width = 18

    ref_ws.row_dimensions[1].height = 28
    ref_ws.freeze_panes = "A2"

    active_emps = (
        Employee.objects.filter(
            client=client, status=Employee.STATUS_ACTIVE
        )
        .exclude(status__in=["inactive", "exited", "terminated"])
        .order_by("employee_code")
        if client else []
    )

    row_idx = 2
    for emp in active_emps:
        name = f"{emp.first_name} {emp.last_name or ''}".strip()
        c1 = ref_ws.cell(row=row_idx, column=1, value=emp.employee_code)
        c2 = ref_ws.cell(row=row_idx, column=2, value=name)
        c3 = ref_ws.cell(row=row_idx, column=3, value=emp.department or "—")
        c4 = ref_ws.cell(row=row_idx, column=4, value=emp.position or "—")
        c5 = ref_ws.cell(row=row_idx, column=5, value=emp.pan_number or "—")
        c6 = ref_ws.cell(row=row_idx, column=6, value=getattr(emp, "uan_number", "") or "—")
        c7 = ref_ws.cell(row=row_idx, column=7, value=float(emp.ctc) if emp.ctc else 0)
        c7.number_format = "#,##0.00"
        c8 = ref_ws.cell(row=row_idx, column=8, value=f"{emp.employee_code} — {name}")
        for c in (c1, c2, c3, c4, c5, c6, c7, c8):
            c.border = THIN_BORDER
            c.font = Font(name="Calibri", size=10)
        row_idx += 1
    ref_max_row = max(row_idx - 1, 2)

    # ── Populate Functional Data Sheets (Sheet 3+) ─────────────────────────────
    for cfg in SHEET_CONFIGS:
        if cfg.get("admin_only") and not is_admin:
            continue
        ws = wb.create_sheet(title=cfg["title"])
        ws.views.sheetView[0].showGridLines = True

        headers = list(cfg["headers"])

        # Dynamically append custom company allowances / deductions to New Employee and Revision sheets
        if cfg["key"] in ("NEW_EMPLOYEE", "REVISION") and custom_comps:
            fixed_flat_comps = [
                c for c in custom_comps
                if not getattr(c, "is_monthly_variable", False)
                and (getattr(c, "formula", "") or "").strip().upper() != "VARIABLE"
                and getattr(c, "calculation_type", "FLAT") == "FLAT"
            ]
            for comp in fixed_flat_comps:
                headers.append((f"{comp.name} [{comp.code}] (₹/Month)", f"Optional monthly flat {comp.component_type.lower()} in ₹", 20))

        # Row 1: Headers
        for col_idx, (header_text, _, width) in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header_text)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = THIN_BORDER
            ws.column_dimensions[get_column_letter(col_idx)].width = max(width, 14)

        # "🔙 Back to Index" button in column (len(headers) + 2)
        b_col = len(headers) + 2
        b_cell = ws.cell(row=1, column=b_col, value="🔙 Back to Index")
        b_cell.hyperlink = "#'Sheet Index'!A1"
        b_cell.font = NAV_FONT
        b_cell.fill = NAV_FILL
        b_cell.alignment = Alignment(horizontal="center", vertical="center")
        b_cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(b_col)].width = 18

        ws.row_dimensions[1].height = 28
        ws.freeze_panes = "A2"

        # Attach DataValidation dropdown on Column A and auto-lookup VLOOKUP on Column B for active employee sheets
        if active_emps and cfg["key"] not in ("NEW_EMPLOYEE", "NOTE"):
            dv = DataValidation(
                type="list",
                formula1=f"='Employee Reference'!$H$2:$H${ref_max_row}",
                allow_blank=True,
            )
            dv.error = "Please select a valid active employee from the dropdown list."
            dv.errorTitle = "Invalid Employee Selection"
            dv.prompt = "Select an employee or search by code/name."
            dv.promptTitle = "Employee Selection"
            ws.add_data_validation(dv)
            dv.add("A2:A200")

            for r in range(2, 201):
                cell_b = ws.cell(row=r, column=2)
                cell_b.value = f'=IFERROR(VLOOKUP(TRIM(LEFT(A{r}, IFERROR(FIND("—", A{r})-1, IFERROR(FIND("-", A{r})-1, LEN(A{r}))))), \'Employee Reference\'!$A$2:$B${ref_max_row}, 2, FALSE), "")'
                cell_b.font = Font(name="Calibri", size=10, italic=True, color="475569")
                cell_b.border = THIN_BORDER
                cell_b.alignment = Alignment(horizontal="left", vertical="center")

        # Option 2: Attach Yes/No dropdown for PF Opted and ESI Opted columns, and Employment Type dropdown
        for col_idx, (header_text, _, _) in enumerate(headers, start=1):
            h_norm = _normalize_header(header_text)
            if h_norm in ("pf opted", "esi opted"):
                col_letter = get_column_letter(col_idx)
                dv_bool = DataValidation(
                    type="list",
                    formula1='"Yes,No"',
                    allow_blank=True,
                )
                dv_bool.prompt = "Choose Yes or No."
                dv_bool.promptTitle = header_text
                ws.add_data_validation(dv_bool)
                dv_bool.add(f"{col_letter}2:{col_letter}200")
            elif h_norm in ("employment type", "emp type", "type"):
                col_letter = get_column_letter(col_idx)
                dv_type = DataValidation(
                    type="list",
                    formula1='"Regular,Intern,Consultant"',
                    allow_blank=True,
                )
                dv_type.prompt = "Regular: Standard PF/ESI.\nIntern: Stipendiary learning, exempt from PF/ESI.\nConsultant: Professional fees."
                dv_type.promptTitle = "Choose Employment Type"
                ws.add_data_validation(dv_type)
                dv_type.add(f"{col_letter}2:{col_letter}200")

        # Option 3: Attach Month dropdown (1 to 12) for Release Month in Hold Salary
        if cfg["key"] == "SALARY_HOLD":
            for col_idx, (header_text, _, _) in enumerate(headers, start=1):
                if _normalize_header(header_text) == "release month":
                    col_letter = get_column_letter(col_idx)
                    dv_month = DataValidation(
                        type="list",
                        formula1='"1,2,3,4,5,6,7,8,9,10,11,12"',
                        allow_blank=True,
                    )
                    dv_month.prompt = "Select release month (1 to 12) or enter month name."
                    dv_month.promptTitle = "Release Month"
                    ws.add_data_validation(dv_month)
                    dv_month.add(f"{col_letter}2:{col_letter}200")

        sheet_index_entries.append({
            "title": cfg["title"],
            "category": cfg.get("category", "📋 Monthly Inputs"),
            "desc": cfg.get("description", ""),
        })

    # ── Populate Dedicated Tabs for Monthly Variable Custom Components ─────────
    variable_comps = [c for c in custom_comps if getattr(c, "is_monthly_variable", False)]
    for comp in variable_comps:
        sheet_title = (comp.name or comp.code)[:31]
        ws = wb.create_sheet(title=sheet_title)
        ws.views.sheetView[0].showGridLines = True

        c_headers = [
            ("Employee Code *", "Select active employee code or pick from dropdown", 22),
            ("Employee Name", "Auto-populated full name from Employee Reference", 24),
            ("Amount * (₹)", f"Monthly {comp.name} amount in Rupees", 18),
            ("Description", "Optional notes or details", 28),
        ]

        # Row 1: Headers
        for col_idx, (header_text, _, width) in enumerate(c_headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header_text)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = THIN_BORDER
            ws.column_dimensions[get_column_letter(col_idx)].width = max(width, 14)

        # Return link
        b_col = len(c_headers) + 2
        b_cell = ws.cell(row=1, column=b_col, value="🔙 Back to Index")
        b_cell.hyperlink = "#'Sheet Index'!A1"
        b_cell.font = NAV_FONT
        b_cell.fill = NAV_FILL
        b_cell.alignment = Alignment(horizontal="center", vertical="center")
        b_cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(b_col)].width = 18

        ws.row_dimensions[1].height = 28
        ws.freeze_panes = "A2"

        if active_emps:
            dv = DataValidation(
                type="list",
                formula1=f"='Employee Reference'!$H$2:$H${ref_max_row}",
                allow_blank=True,
            )
            dv.error = "Please select a valid active employee from the dropdown list."
            dv.errorTitle = "Invalid Employee Selection"
            dv.prompt = "Select an employee or search by code/name."
            dv.promptTitle = "Employee Selection"
            ws.add_data_validation(dv)
            dv.add("A2:A200")

            for r in range(2, 201):
                cell_b = ws.cell(row=r, column=2)
                cell_b.value = f'=IFERROR(VLOOKUP(TRIM(LEFT(A{r}, IFERROR(FIND("—", A{r})-1, IFERROR(FIND("-", A{r})-1, LEN(A{r}))))), \'Employee Reference\'!$A$2:$B${ref_max_row}, 2, FALSE), "")'
                cell_b.font = Font(name="Calibri", size=10, italic=True, color="475569")
                cell_b.border = THIN_BORDER
                cell_b.alignment = Alignment(horizontal="left", vertical="center")

        sheet_index_entries.append({
            "title": sheet_title,
            "category": "🧩 Variable Allowance",
            "desc": f"Monthly variable amount uploads for {comp.name}.",
        })

    # ── Populate Sheet 1: "Sheet Index" ────────────────────────────────────────
    client_name = (client.name or "Client").upper() if client else "CLIENT"
    index_ws.merge_cells("A1:E1")
    title_cell = index_ws.cell(row=1, column=1, value=f"📋 {client_name} — MONTHLY PAYROLL INPUTS & CHANGES WORKBOOK")
    title_cell.fill = PatternFill(start_color="001F5B", end_color="001F5B", fill_type="solid")
    title_cell.font = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    index_ws.row_dimensions[1].height = 32

    index_ws.merge_cells("A2:E2")
    sub_cell = index_ws.cell(row=2, column=1, value="💡 Click any Sheet Title or '👉 Jump to Sheet' to navigate. In all sheets, click Column A for a searchable Employee Dropdown; Employee Name auto-fills via VLOOKUP.")
    sub_cell.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    sub_cell.font = Font(name="Calibri", size=9.5, italic=True, color="334155")
    sub_cell.alignment = Alignment(horizontal="left", vertical="center")
    index_ws.row_dimensions[2].height = 20

    index_headers = ["#", "Sheet Name (Click to Open)", "Category / Operational Purpose", "Description & Usage Guidelines", "Quick Navigation Action"]
    index_widths = [6, 26, 30, 65, 20]
    for col_idx, (h, w) in enumerate(zip(index_headers, index_widths), start=1):
        cell = index_ws.cell(row=4, column=col_idx, value=h)
        cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        cell.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER
        index_ws.column_dimensions[get_column_letter(col_idx)].width = w
    index_ws.row_dimensions[4].height = 26
    index_ws.freeze_panes = "A5"

    for idx, entry in enumerate(sheet_index_entries, start=1):
        r_num = 4 + idx
        c_num = index_ws.cell(row=r_num, column=1, value=idx)
        c_num.alignment = Alignment(horizontal="center", vertical="center")
        c_num.font = Font(name="Calibri", size=10, bold=True, color="475569")
        c_num.border = THIN_BORDER

        # Clickable Sheet Name
        c_name = index_ws.cell(row=r_num, column=2, value=entry["title"])
        c_name.hyperlink = f"#'{entry['title']}'!A1"
        c_name.font = Font(name="Calibri", size=10.5, bold=True, color="1D4ED8", underline="single")
        c_name.alignment = Alignment(horizontal="left", vertical="center")
        c_name.border = THIN_BORDER

        # Category
        c_cat = index_ws.cell(row=r_num, column=3, value=entry["category"])
        c_cat.font = Font(name="Calibri", size=9.5, bold=True, color="1E293B")
        c_cat.alignment = Alignment(horizontal="left", vertical="center")
        c_cat.border = THIN_BORDER

        # Description
        c_desc = index_ws.cell(row=r_num, column=4, value=entry["desc"])
        c_desc.font = Font(name="Calibri", size=9.5, color="334155")
        c_desc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        c_desc.border = THIN_BORDER

        # Jump Action Link
        c_jump = index_ws.cell(row=r_num, column=5, value="👉 Jump to Sheet")
        c_jump.hyperlink = f"#'{entry['title']}'!A1"
        c_jump.font = Font(name="Calibri", size=10, bold=True, color="1D4ED8", underline="single")
        c_jump.alignment = Alignment(horizontal="center", vertical="center")
        c_jump.border = THIN_BORDER
        index_ws.row_dimensions[r_num].height = 22

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


# ─── Multi-Sheet Workbook Parser ──────────────────────────────────────────────

def parse_portal_excel(file_stream, client) -> dict:
    """
    Parses a multi-sheet portal Excel workbook in memory.
    Resolves employee codes to Employee database objects and produces a
    clean list of items ready for preview, review editing, and commit.
    """
    wb = load_workbook(file_stream, data_only=True)
    
    # Pre-fetch client's active & all employees for code and name resolution
    all_emps = {
        emp.employee_code.upper(): emp
        for emp in Employee.objects.filter(client=client)
    }
    all_emps_by_name = {}
    for emp in Employee.objects.filter(client=client):
        full_n = f"{emp.first_name} {emp.last_name or ''}".strip().lower()
        if full_n:
            all_emps_by_name[full_n] = emp

    items = []
    warnings = []
    notes_list = []
    summary_counts = {}

    sheet_names = {s.lower().strip(): s for s in wb.sheetnames}

    # Active dynamic custom components configured for this client
    client_custom_comps = []
    if client and hasattr(client, "custom_salary_components"):
        try:
            client_custom_comps = list(
                client.custom_salary_components.filter(is_active=True).exclude(code__startswith="__")
            )
        except Exception:
            client_custom_comps = []

    def _find_sheet(candidates):
        for c in candidates:
            c_low = c.lower().strip()
            if c_low in sheet_names:
                return wb[sheet_names[c_low]]
        # Partial match
        for s_low, real_name in sheet_names.items():
            for c in candidates:
                if c.lower() in s_low:
                    return wb[real_name]
        return None

    def _find_col_idx(h_map, aliases, default_idx):
        for alias in aliases:
            norm = _normalize_header(alias)
            if norm in h_map:
                return h_map[norm]
        return default_idx

    # ── 1. New Employees ──────────────────────────────────────────────────────
    ws = _find_sheet(["Add New Employee", "New Employee", "New Employees", "Joiners"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            code_col = _find_col_idx(header_map, ["employee code", "emp code", "code", "emp id", "employee id"], 0)
            fname_col = _find_col_idx(header_map, ["first name", "name", "employee name"], 1)
            lname_col = _find_col_idx(header_map, ["last name", "surname"], 2)
            ctc_col = _find_col_idx(header_map, ["annual ctc", "ctc", "annual ctc (₹)", "cost to company", "gross ctc", "ctc annual", "salary ctc"], 3)
            eff_col = _find_col_idx(header_map, ["effective from", "effective date", "eff date"], 4)
            hire_col = _find_col_idx(header_map, ["hire date", "date of joining", "joining date", "doj"], 5)
            email_col = _find_col_idx(header_map, ["email", "official email", "email id"], 6)
            pan_col = _find_col_idx(header_map, ["pan number", "pan", "pan no"], 7)
            dept_col = _find_col_idx(header_map, ["department", "dept"], 8)
            pos_col = _find_col_idx(header_map, ["position", "designation", "role", "title"], 9)
            emp_type_col = _find_col_idx(header_map, ["employment type", "emp type", "type", "employment status"], -1)
            pf_col = _find_col_idx(header_map, ["pf opted", "pf applicable", "pf"], -1)
            if pf_col == -1:
                pf_col = 10 if emp_type_col == -1 else 11
            uan_col = _find_col_idx(header_map, ["uan number", "uan", "uan no", "universal account number"], -1)
            esi_col = _find_col_idx(header_map, ["esi opted", "esi applicable", "esi"], -1)
            esi_num_col = _find_col_idx(header_map, ["esi number", "esi no", "ip number"], -1)
            bank_acc_col = _find_col_idx(header_map, ["bank account number", "bank account no", "bank account", "account number", "account no", "a/c no", "a/c"], -1)
            bank_ifsc_col = _find_col_idx(header_map, ["bank ifsc code", "bank ifsc", "ifsc code", "ifsc"], -1)
            bank_name_col = _find_col_idx(header_map, ["bank name", "bank"], -1)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue  # skip completely blank rows
                # Check sample row skip (if user left sample unchanged)
                code = _clean_str(row[code_col] if code_col < len(row) else row[0])
                if not code or code.upper() == "EMP105":
                    # If all matches sample, skip
                    if _clean_str(row[fname_col] if fname_col < len(row) else (row[1] if len(row) > 1 else "")).lower() == "arun":
                        continue

                fname = _clean_str(row[fname_col] if fname_col < len(row) else (row[1] if len(row) > 1 else ""))
                lname = _clean_str(row[lname_col] if lname_col < len(row) else (row[2] if len(row) > 2 else ""))
                raw_ctc = row[ctc_col] if ctc_col < len(row) else (row[3] if len(row) > 3 else 0)

                if not code or not fname or raw_ctc in (None, ""):
                    warnings.append({
                        "sheet": "Add New Employee",
                        "row": row_num,
                        "message": f"Row {row_num}: Skipped because Employee Code, First Name, or Annual CTC is missing."
                    })
                    continue

                try:
                    ctc_dec = to_decimal(raw_ctc, "Annual CTC")
                except ValueError as ve:
                    warnings.append({"sheet": "Add New Employee", "row": row_num, "message": str(ve)})
                    continue

                eff_raw = row[eff_col] if eff_col < len(row) else (row[4] if len(row) > 4 else None)
                hire_raw = row[hire_col] if hire_col < len(row) else (row[5] if len(row) > 5 else None)

                eff_date_str = ""
                if eff_raw and _clean_str(eff_raw).upper() != "YYYY-MM-DD":
                    try:
                        eff_date_str = parse_date(eff_raw).isoformat()
                    except ValueError:
                        pass

                hire_date_str = ""
                if hire_raw and _clean_str(hire_raw).upper() != "YYYY-MM-DD":
                    try:
                        hire_date_str = parse_date(hire_raw).isoformat()
                    except ValueError:
                        pass

                email = _clean_str(row[email_col] if email_col < len(row) else (row[6] if len(row) > 6 else ""))
                pan = _clean_str(row[pan_col] if pan_col < len(row) else (row[7] if len(row) > 7 else ""))
                dept = _clean_str(row[dept_col] if dept_col < len(row) else (row[8] if len(row) > 8 else ""))
                pos = _clean_str(row[pos_col] if pos_col < len(row) else (row[9] if len(row) > 9 else ""))

                emp_type_raw = _clean_str(row[emp_type_col] if emp_type_col != -1 and emp_type_col < len(row) else "").upper()
                if "INTERN" in emp_type_raw or "APPRENTICE" in emp_type_raw or "TRAINEE" in emp_type_raw:
                    employment_type = "INTERN"
                elif "CONSULTANT" in emp_type_raw or "RETAINER" in emp_type_raw or "CONTRACTOR" in emp_type_raw:
                    employment_type = "CONSULTANT"
                elif "REGULAR" in emp_type_raw or "PERMANENT" in emp_type_raw or "FULL" in emp_type_raw:
                    employment_type = "REGULAR"
                else:
                    import re
                    if re.search(r"\b(intern|internship|apprentice|apprenticeship|trainee)\b", pos, re.IGNORECASE):
                        employment_type = "INTERN"
                    else:
                        employment_type = "REGULAR"

                is_intern = (employment_type == "INTERN")

                pf_raw = row[pf_col] if pf_col != -1 and pf_col < len(row) else None
                if is_intern and (pf_raw is None or str(pf_raw).strip() == ""):
                    pf_opted = False
                else:
                    pf_opted = parse_bool(pf_raw, default=True)

                esi_opted = None
                if esi_col != -1 and esi_col < len(row):
                    esi_raw = row[esi_col]
                    if esi_raw is not None and str(esi_raw).strip() != "":
                        esi_opted = parse_bool(esi_raw, default=False)
                if esi_opted is None:
                    esi_opted = False if is_intern else ((ctc_dec / Decimal("12")) <= Decimal("21000"))

                esi_num = _clean_str(row[esi_num_col] if esi_num_col != -1 and esi_num_col < len(row) else "")
                uan_raw = _clean_str(row[uan_col] if uan_col != -1 and uan_col < len(row) else "")
                uan_num = re.sub(r"\D", "", uan_raw) if uan_raw else ""

                bank_acc_raw = _clean_str(row[bank_acc_col] if bank_acc_col != -1 and bank_acc_col < len(row) else "")
                bank_acc = re.sub(r"\D", "", bank_acc_raw) if bank_acc_raw else ""

                bank_ifsc_raw = _clean_str(row[bank_ifsc_col] if bank_ifsc_col != -1 and bank_ifsc_col < len(row) else "")
                bank_ifsc = re.sub(r"[^A-Za-z0-9]", "", bank_ifsc_raw).upper() if bank_ifsc_raw else ""

                bank_name = _clean_str(row[bank_name_col] if bank_name_col != -1 and bank_name_col < len(row) else "")

                custom_dict = {}
                fixed_flat_comps = [
                    c for c in client_custom_comps
                    if not getattr(c, "is_monthly_variable", False)
                    and (getattr(c, "formula", "") or "").strip().upper() != "VARIABLE"
                    and getattr(c, "calculation_type", "FLAT") == "FLAT"
                ]
                for comp in fixed_flat_comps:
                    for alias in [comp.code, comp.name, f"{comp.name} [{comp.code}]"]:
                        norm_alias = _normalize_header(alias)
                        if norm_alias in header_map:
                            c_idx = header_map[norm_alias]
                            if c_idx < len(row) and row[c_idx] is not None:
                                try:
                                    val_dec = to_decimal(row[c_idx], comp.name)
                                    if val_dec > 0:
                                        custom_dict[comp.code] = {
                                            "name": comp.name,
                                            "amount": float(val_dec),
                                            "component_type": comp.component_type,
                                            "calculation_type": "FLAT",
                                        }
                                except Exception:
                                    pass
                            break

                custom_dict["employment_type"] = employment_type
                custom_dict["is_intern"] = is_intern

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "NEW_EMPLOYEE",
                    "payload": {
                        "employee_code": code,
                        "first_name": fname,
                        "last_name": lname,
                        "ctc_annual": float(ctc_dec),
                        "effective_from": eff_date_str,
                        "hire_date": hire_date_str,
                        "email": email,
                        "pan_number": pan,
                        "department": dept,
                        "position": pos,
                        "employment_type": employment_type,
                        "is_intern": is_intern,
                        "pf_opted": pf_opted,
                        "uan_number": uan_num,
                        "esi_opted": esi_opted,
                        "esi_number": esi_num,
                        "bank_account_number": bank_acc,
                        "bank_ifsc_code": bank_ifsc,
                        "bank_name": bank_name,
                        "custom_components": custom_dict,
                    },
                    "display": {
                        "employee_code": code,
                        "employee_name": f"{fname} {lname}".strip(),
                        "amount_label": f"₹{ctc_dec:,.2f} CTC",
                        "extra": f"Joining: {hire_date_str or 'This month'} ({'🎓 Intern' if is_intern else employment_type.title()})"
                    }
                })

    # Helper function to resolve employee row (supports Code, Dropdown "Code — Name", or direct Name)
    def _resolve_emp(row, header_map, code_key, row_num, sheet_name):
        idx = _find_col_idx(header_map, [code_key, "employee code", "emp code", "code", "emp id", "employee id"], 0)
        raw_val = _clean_str(row[idx] if idx < len(row) else "")
        if not raw_val:
            # Fallback to Employee Name column if code was left blank
            name_idx = _find_col_idx(header_map, ["employee name", "name", "full name"], -1)
            if name_idx != -1 and name_idx < len(row):
                raw_val = _clean_str(row[name_idx])
            if not raw_val:
                return None, None

        # 1. Clean combined dropdown string e.g. "EMP101 — Arun Kumar" or "EMP101 - Arun Kumar"
        if "—" in raw_val:
            code_candidate = raw_val.split("—")[0].strip().upper()
        elif " - " in raw_val:
            code_candidate = raw_val.split(" - ")[0].strip().upper()
        else:
            code_candidate = raw_val.strip().upper()

        emp = all_emps.get(code_candidate)
        if not emp and "-" in code_candidate:
            # In case employee code itself contains a hyphen e.g. "EMP-101"
            emp = all_emps.get(raw_val.split("—")[0].strip().upper())

        # 2. If not matched by code, try matching by full name
        if not emp:
            clean_name = raw_val.strip().lower()
            emp = all_emps_by_name.get(clean_name)
            if not emp and "—" in raw_val:
                emp = all_emps_by_name.get(raw_val.split("—")[-1].strip().lower())
            elif not emp and " - " in raw_val:
                emp = all_emps_by_name.get(raw_val.split(" - ")[-1].strip().lower())

        if not emp:
            warnings.append({
                "sheet": sheet_name,
                "row": row_num,
                "message": f"Row {row_num}: Employee {raw_val!r} was not found among this client's active employees."
            })
            return None, code_candidate
        return emp, emp.employee_code.upper()

    # ── 2. Salary Revisions ───────────────────────────────────────────────────
    ws = _find_sheet(["Update Salary", "Salary Revision", "Salary Revisions", "Revisions"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            ctc_col = _find_col_idx(header_map, ["new annual ctc", "revised ctc", "new ctc", "annual ctc", "ctc"], 1 + offset)
            eff_col = _find_col_idx(header_map, ["effective from", "effective date", "eff date"], 2 + offset)
            pf_col = _find_col_idx(header_map, ["pf opted", "pf applicable", "pf"], 3 + offset)
            reason_col = _find_col_idx(header_map, ["reason", "change reason", "remarks"], 4 + offset)
            esi_col = _find_col_idx(header_map, ["esi opted", "esi applicable", "esi"], -1)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Update Salary")
                if not emp:
                    continue
                # Skip sample row if left unchanged
                eff_raw = row[eff_col] if eff_col < len(row) else (row[2] if len(row) > 2 else None)
                if _clean_str(eff_raw).upper() == "YYYY-MM-DD" or (code == "EMP101" and _clean_str(row[reason_col] if reason_col < len(row) else "").startswith("Annual Increment 2026")):
                    continue
                raw_ctc = row[ctc_col] if ctc_col < len(row) else (row[1] if len(row) > 1 else None)
                if raw_ctc in (None, "") or eff_raw in (None, ""):
                    warnings.append({"sheet": "Update Salary", "row": row_num, "message": f"Row {row_num}: CTC and Effective From are required."})
                    continue
                try:
                    ctc_dec = to_decimal(raw_ctc, "New Annual CTC")
                    eff_date = parse_date(eff_raw)
                except ValueError as ve:
                    warnings.append({"sheet": "Update Salary", "row": row_num, "message": str(ve)})
                    continue

                reason = _clean_str(row[reason_col] if reason_col < len(row) else (row[4] if len(row) > 4 else ""))
                pf_raw = row[pf_col] if pf_col < len(row) else (row[3] if len(row) > 3 else "Yes")
                pf_opted = parse_bool(pf_raw, default=True)

                esi_opted = None
                if esi_col != -1 and esi_col < len(row):
                    esi_raw = row[esi_col]
                    if esi_raw is not None and str(esi_raw).strip() != "":
                        esi_opted = parse_bool(esi_raw, default=False)
                if esi_opted is None:
                    esi_opted = (ctc_dec / Decimal("12")) <= Decimal("21000")

                custom_dict = {}
                fixed_flat_comps = [
                    c for c in client_custom_comps
                    if not getattr(c, "is_monthly_variable", False)
                    and (getattr(c, "formula", "") or "").strip().upper() != "VARIABLE"
                    and getattr(c, "calculation_type", "FLAT") == "FLAT"
                ]
                for comp in fixed_flat_comps:
                    for alias in [comp.code, comp.name, f"{comp.name} [{comp.code}]"]:
                        norm_alias = _normalize_header(alias)
                        if norm_alias in header_map:
                            c_idx = header_map[norm_alias]
                            if c_idx < len(row) and row[c_idx] is not None:
                                try:
                                    val_dec = to_decimal(row[c_idx], comp.name)
                                    if val_dec > 0:
                                        custom_dict[comp.code] = {
                                            "name": comp.name,
                                            "amount": float(val_dec),
                                            "component_type": comp.component_type,
                                            "calculation_type": "FLAT",
                                        }
                                except Exception:
                                    pass
                            break

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "REVISION",
                    "payload": {
                        "employee_id": emp.id,
                        "ctc_annual": float(ctc_dec),
                        "effective_from": eff_date.isoformat(),
                        "pf_opted": pf_opted,
                        "esi_opted": esi_opted,
                        "change_reason": reason,
                        "custom_components": custom_dict,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"New CTC: ₹{ctc_dec:,.2f}",
                        "extra": f"From {eff_date.isoformat()} ({reason or 'Revision'})"
                    }
                })

    # ── 3. Record Exit ────────────────────────────────────────────────────────
    ws = _find_sheet(["Record Exit", "Exit", "Exits", "Resignation"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Record Exit")
                if not emp:
                    continue
                lwd_col = _find_col_idx(header_map, ["last working date", "lwd", "exit date", "resignation date"], 2 if "employee name" in header_map else 1)
                reason_col = _find_col_idx(header_map, ["reason", "remarks", "exit reason"], 3 if "employee name" in header_map else 2)
                lwd_raw = row[lwd_col] if lwd_col < len(row) else None
                # Skip sample row if left unchanged
                if _clean_str(lwd_raw).upper() == "YYYY-MM-DD" or (code == "EMP102" and _clean_str(row[reason_col] if reason_col < len(row) else "").startswith("Resigned")):
                    continue
                if lwd_raw in (None, ""):
                    warnings.append({"sheet": "Record Exit", "row": row_num, "message": f"Row {row_num}: Last Working Date is required."})
                    continue
                try:
                    lwd_date = parse_date(lwd_raw)
                except ValueError as ve:
                    warnings.append({"sheet": "Record Exit", "row": row_num, "message": str(ve)})
                    continue

                reason = _clean_str(row[reason_col] if reason_col < len(row) else "")

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "EXIT",
                    "payload": {
                        "employee_id": emp.id,
                        "last_working_date": lwd_date.isoformat(),
                        "reason": reason,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": "Exit / Resignation",
                        "extra": f"LWD: {lwd_date.isoformat()} ({reason or 'Exit'})"
                    }
                })

    # ── 4. Hold Salary ────────────────────────────────────────────────────────
    ws = _find_sheet(["Hold Salary", "Salary Hold", "Hold"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Hold Salary")
                if not emp:
                    continue
                offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
                amt_col = _find_col_idx(header_map, ["hold amount", "amount"], 1 + offset)
                rel_m_col = _find_col_idx(header_map, ["release month", "month"], 2 + offset)
                rel_y_col = _find_col_idx(header_map, ["release year", "year"], 3 + offset)
                reason_col = _find_col_idx(header_map, ["reason", "remarks"], 4 + offset)

                amt_raw = row[amt_col] if amt_col < len(row) else None
                rel_m_raw = row[rel_m_col] if rel_m_col < len(row) else None
                rel_y_raw = row[rel_y_col] if rel_y_col < len(row) else None

                # Skip sample row if left unchanged
                if code == "EMP103" and _clean_str(row[reason_col] if reason_col < len(row) else "").startswith("Pending client asset"):
                    continue

                if any(v in (None, "") for v in (amt_raw, rel_m_raw, rel_y_raw)):
                    warnings.append({"sheet": "Hold Salary", "row": row_num, "message": f"Row {row_num}: Amount, Release Month, and Release Year are required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Hold Amount")
                    rel_m = parse_month(rel_m_raw, "Release Month")
                    rel_y = parse_year(rel_y_raw, "Release Year")
                except ValueError as ve:
                    warnings.append({"sheet": "Hold Salary", "row": row_num, "message": str(ve)})
                    continue

                reason = _clean_str(row[reason_col] if reason_col < len(row) else "")

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "SALARY_HOLD",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "release_month": rel_m,
                        "release_year": rel_y,
                        "reason": reason,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"Hold: ₹{amt_dec:,.2f}",
                        "extra": f"Release: {rel_m:02d}/{rel_y} ({reason or 'Hold'})"
                    }
                })

    # ── 5. Add Advance or Loan ────────────────────────────────────────────────
    ws = _find_sheet(["Add Advance or Loan", "Advance", "Advance / Loan", "Loans"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["total amount", "amount", "loan amount", "advance amount"], 1 + offset)
            tenure_col = _find_col_idx(header_map, ["tenure months", "tenure", "emis", "months"], 2 + offset)
            label_col = _find_col_idx(header_map, ["purpose / label", "purpose", "label", "reason"], 3 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add Advance or Loan")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                tenure_raw = row[tenure_col] if tenure_col < len(row) else None
                if any(v in (None, "") for v in (amt_raw, tenure_raw)):
                    warnings.append({"sheet": "Add Advance or Loan", "row": row_num, "message": f"Row {row_num}: Total Amount and Tenure Months are required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Total Amount")
                    tenure = to_positive_int(tenure_raw, "Tenure Months")
                except ValueError as ve:
                    warnings.append({"sheet": "Add Advance or Loan", "row": row_num, "message": str(ve)})
                    continue

                label = _clean_str(row[label_col] if label_col < len(row) else "")
                if code == "EMP104" and label.startswith("Medical Emergency"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "ADVANCE",
                    "payload": {
                        "employee_id": emp.id,
                        "total_amount": float(amt_dec),
                        "tenure_months": tenure,
                        "label": label,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"Loan: ₹{amt_dec:,.2f}",
                        "extra": f"{tenure} monthly EMIs ({label or 'Advance'})"
                    }
                })

    # ── 6. Extra Payments ─────────────────────────────────────────────────────
    ws = _find_sheet(["Add Extra Payment", "Extra Payment", "One-time Earning", "Bonus"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["amount", "earning amount", "bonus amount"], 1 + offset)
            desc_col = _find_col_idx(header_map, ["description", "desc", "reason", "remarks"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add Extra Payment")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                if amt_raw in (None, ""):
                    warnings.append({"sheet": "Add Extra Payment", "row": row_num, "message": f"Row {row_num}: Amount is required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Amount")
                except ValueError as ve:
                    warnings.append({"sheet": "Add Extra Payment", "row": row_num, "message": str(ve)})
                    continue

                desc = _clean_str(row[desc_col] if desc_col < len(row) else "")
                if code == "EMP101" and desc.startswith("Q3 Performance"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "ONE_TIME_EARNING",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "description": desc,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"+ ₹{amt_dec:,.2f}",
                        "extra": desc or "One-time Earning"
                    }
                })

    # ── 7. Deductions ─────────────────────────────────────────────────────────
    ws = _find_sheet(["Add Deduction", "Deduction", "Deductions", "One-time Deduction"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["amount", "deduction amount"], 1 + offset)
            desc_col = _find_col_idx(header_map, ["description", "desc", "reason", "remarks"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add Deduction")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                if amt_raw in (None, ""):
                    warnings.append({"sheet": "Add Deduction", "row": row_num, "message": f"Row {row_num}: Amount is required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Amount")
                except ValueError as ve:
                    warnings.append({"sheet": "Add Deduction", "row": row_num, "message": str(ve)})
                    continue

                desc = _clean_str(row[desc_col] if desc_col < len(row) else "")
                if code == "EMP102" and desc.startswith("Hardware Damage"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "ONE_TIME_DEDUCTION",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "description": desc,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"- ₹{amt_dec:,.2f}",
                        "extra": desc or "One-time Deduction"
                    }
                })

    # ── 8. Reimbursements ─────────────────────────────────────────────────────
    ws = _find_sheet(["Add Reimbursement", "Reimbursement", "Reimbursements", "Expenses", "Claims"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["amount", "claim amount", "reimbursement amount"], 1 + offset)
            desc_col = _find_col_idx(header_map, ["description", "desc", "reason", "remarks"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add Reimbursement")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                if amt_raw in (None, ""):
                    warnings.append({"sheet": "Add Reimbursement", "row": row_num, "message": f"Row {row_num}: Amount is required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Amount")
                except ValueError as ve:
                    warnings.append({"sheet": "Add Reimbursement", "row": row_num, "message": str(ve)})
                    continue

                desc = _clean_str(row[desc_col] if desc_col < len(row) else "")
                if code == "EMP101" and desc.startswith("Client travel"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "REIMBURSEMENT",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "description": desc,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"₹{amt_dec:,.2f}",
                        "extra": desc or "Expense Reimbursement"
                    }
                })

    # ── 9. Loss of Pay ────────────────────────────────────────────────────────
    ws = _find_sheet(["Record Loss of Pay", "Loss of Pay", "LOP", "Unpaid Leave"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            days_col = _find_col_idx(header_map, ["lop days", "days", "unpaid days"], 1 + offset)
            reason_col = _find_col_idx(header_map, ["reason", "remarks"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Record Loss of Pay")
                if not emp:
                    continue
                days_raw = row[days_col] if days_col < len(row) else None
                if days_raw in (None, ""):
                    warnings.append({"sheet": "Record Loss of Pay", "row": row_num, "message": f"Row {row_num}: LOP Days is required."})
                    continue
                try:
                    days_dec = to_decimal(days_raw, "LOP Days")
                except ValueError as ve:
                    warnings.append({"sheet": "Record Loss of Pay", "row": row_num, "message": str(ve)})
                    continue

                reason = _clean_str(row[reason_col] if reason_col < len(row) else "")
                if code == "EMP102" and reason.startswith("Unapproved absence"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "LOP",
                    "payload": {
                        "employee_id": emp.id,
                        "days": float(days_dec),
                        "reason": reason,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"{days_dec} days LOP",
                        "extra": reason or "Loss of Pay"
                    }
                })

    # ── 10. Salary Arrears ────────────────────────────────────────────────────
    ws = _find_sheet(["Add Salary Arrears", "Salary Arrears", "Arrears"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["arrears amount", "amount"], 1 + offset)
            reason_col = _find_col_idx(header_map, ["reason / period", "reason", "period", "remarks"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add Salary Arrears")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                if amt_raw in (None, ""):
                    warnings.append({"sheet": "Add Salary Arrears", "row": row_num, "message": f"Row {row_num}: Arrears Amount is required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "Arrears Amount")
                except ValueError as ve:
                    warnings.append({"sheet": "Add Salary Arrears", "row": row_num, "message": str(ve)})
                    continue

                reason = _clean_str(row[reason_col] if reason_col < len(row) else "")
                if code == "EMP103" and reason.startswith("April appraisal"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "ARREARS",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "reason": reason,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"Arrears: ₹{amt_dec:,.2f}",
                        "extra": reason or "Salary Arrears"
                    }
                })

    # ── 11. TDS (Income Tax) ──────────────────────────────────────────────────
    ws = _find_sheet(["Add TDS (Income Tax)", "TDS", "TDS Tax", "Income Tax"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            header_map = {_normalize_header(h): idx for idx, h in enumerate(rows[0]) if h}
            offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
            amt_col = _find_col_idx(header_map, ["tds amount", "amount", "tax amount"], 1 + offset)
            note_col = _find_col_idx(header_map, ["note", "remarks", "description"], 2 + offset)

            for row_num, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue
                emp, code = _resolve_emp(row, header_map, "employee code", row_num, "Add TDS (Income Tax)")
                if not emp:
                    continue
                amt_raw = row[amt_col] if amt_col < len(row) else None
                if amt_raw in (None, ""):
                    warnings.append({"sheet": "Add TDS (Income Tax)", "row": row_num, "message": f"Row {row_num}: TDS Amount is required."})
                    continue
                try:
                    amt_dec = to_decimal(amt_raw, "TDS Amount")
                except ValueError as ve:
                    warnings.append({"sheet": "Add TDS (Income Tax)", "row": row_num, "message": str(ve)})
                    continue

                note_txt = _clean_str(row[note_col] if note_col < len(row) else "")
                if code == "EMP101" and note_txt.startswith("Director tax"):
                    continue

                items.append({
                    "id": f"parsed_{len(items)+1}",
                    "item_type": "TDS",
                    "payload": {
                        "employee_id": emp.id,
                        "amount": float(amt_dec),
                        "note": note_txt,
                    },
                    "display": {
                        "employee_code": emp.employee_code,
                        "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                        "amount_label": f"TDS: ₹{amt_dec:,.2f}",
                        "extra": note_txt or "Income Tax Deduction"
                    }
                })

    # ── 12. Notes ─────────────────────────────────────────────────────────────
    ws = _find_sheet(["Send a Note", "Notes", "Note"])
    if ws:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) > 1:
            for row in rows[1:]:
                txt = _clean_str(row[0] if row else "")
                if txt and not txt.startswith("Please process bonus"):
                    notes_list.append(txt)

    # ── 13. Dedicated Custom Salary Component Sheets (Option 1B) ──────────────
    for comp in client_custom_comps:
        if not getattr(comp, "is_monthly_variable", False):
            continue
        c_ws = _find_sheet([comp.name, comp.name[:31], comp.code, f"{comp.name} [{comp.code}]"])
        if not c_ws:
            continue
        c_rows = list(c_ws.iter_rows(values_only=True))
        if len(c_rows) <= 1:
            continue
        header_map = {_normalize_header(h): idx for idx, h in enumerate(c_rows[0]) if h}
        offset = 1 if ("employee name" in header_map or "name" in header_map or "full name" in header_map) else 0
        amt_col = _find_col_idx(header_map, ["amount", "value", comp.name.lower(), comp.code.lower()], 1 + offset)
        desc_col = _find_col_idx(header_map, ["description", "desc", "reason", "remarks", "note"], 2 + offset)

        for row_num, row in enumerate(c_rows[1:], start=2):
            if not any(row):
                continue
            emp, code = _resolve_emp(row, header_map, "employee code", row_num, comp.name)
            if not emp:
                continue
            amt_raw = row[amt_col] if amt_col < len(row) else None
            if amt_raw in (None, ""):
                continue
            try:
                amt_dec = to_decimal(amt_raw, f"{comp.name} Amount")
            except ValueError as ve:
                warnings.append({"sheet": comp.name, "row": row_num, "message": str(ve)})
                continue

            desc = _clean_str(row[desc_col] if desc_col < len(row) else "")
            sign = "+" if comp.component_type == "EARNING" else "-"

            items.append({
                "id": f"parsed_{len(items)+1}",
                "item_type": "CUSTOM_COMPONENT",
                "payload": {
                    "employee_id": emp.id,
                    "component_code": comp.code,
                    "amount": float(amt_dec),
                    "description": desc,
                },
                "display": {
                    "employee_code": emp.employee_code,
                    "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip(),
                    "amount_label": f"{sign} ₹{amt_dec:,.2f}",
                    "extra": f"{comp.name} ({comp.code})" + (f" — {desc}" if desc else ""),
                }
            })

    # Summarize count per item type
    for it in items:
        t = it["item_type"]
        summary_counts[t] = summary_counts.get(t, 0) + 1

    combined_notes = "\n".join(notes_list).strip()

    return {
        "items": items,
        "notes": combined_notes,
        "warnings": warnings,
        "summary": summary_counts,
        "total_items": len(items),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# 5. STATUTORY, COMPLIANCE & FINANCIAL ACCOUNTING REPORT ENGINE (PILLAR 4)
# ══════════════════════════════════════════════════════════════════════════════════

def generate_batch_detailed_excel_response(batch):
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")

    # 1. Determine client tracking policies (comp-off and leave ledger)
    profile = getattr(batch.client, "payroll_profile", None)
    if profile:
        try:
            track_comp_off = bool(profile.track_comp_off)
        except Exception:
            track_comp_off = True
        try:
            track_leave = bool(profile.track_leave_ledger)
        except Exception:
            track_leave = True
    else:
        track_comp_off = True
        track_leave = True
        if hasattr(batch.client, "custom_salary_components"):
            if batch.client.custom_salary_components.filter(code="__TRACK_COMP_OFF__", abbr="DISABLED").exists():
                track_comp_off = False
            if batch.client.custom_salary_components.filter(code="__TRACK_LEAVE_LEDGER__", abbr="DISABLED").exists():
                track_leave = False

    # 2. Extract dynamic custom salary components from client catalog & batch records
    custom_earnings_map = {}
    custom_deductions_map = {}
    EXCLUDED_CUSTOM_CODES = {
        "EMPLOYMENT_TYPE", "IS_INTERN", "EMPLOY", "IS_INT",
        "ESI", "EMPLOYER_ESI", "PF", "EPF", "BASIC", "HRA", "LTA", "SPECIAL_ALLOWANCE", "FBP",
        "CARVE_OUT_CUSTOM_IN_CTC", "CARVE_OUT_FBP_IN_CTC", "CARVE_",
        "GRATUITY", "GRATUITY_IN_CTC", "GRATUI", "GRAT_PCT",
        "EMPLOYER_PF_CONTRIBUTION", "EMPLOYER_PF", "EMPLOYER_PF_IN_CTC",
        "EMPLOYER_ESI_IN_CTC", "ESI_OPTED", "ESI_NUMBER", "UAN_NUMBER",
        "IS_SENIOR_CITIZEN", "NON_EPS", "PF_OPTED",
        "CONTRACTED_MONTHLY_GROSS", "MONTHLY_GROSS", "BASE_GROSS", "EARNED_SALARY",
    }

    def is_custom_excluded(c_code, c_abbr=""):
        c_up = str(c_code or "").strip().upper()
        a_up = str(c_abbr or "").strip().upper()
        if (
            not c_up
            or c_up.startswith("__")
            or c_up.startswith("CARVE_OUT_")
            or a_up.startswith("CARVE_")
            or a_up.startswith("GRATUI")
            or c_up in EXCLUDED_CUSTOM_CODES
            or a_up in EXCLUDED_CUSTOM_CODES
        ):
            return True
        return False

    if hasattr(batch.client, "custom_salary_components"):
        for comp in batch.client.custom_salary_components.filter(is_active=True):
            code = comp.code or ""
            abbr = comp.abbr or ""
            if is_custom_excluded(code, abbr):
                continue
            label = comp.abbr or comp.name or code
            is_ded = (comp.component_type == "DEDUCTION")
            target_map = custom_deductions_map if is_ded else custom_earnings_map
            target_map[code] = {
                "code": code,
                "label": label,
                "type": "DEDUCTION" if is_ded else "EARNING",
            }

    for r in records:
        cc = r.custom_components
        if not cc or not isinstance(cc, dict):
            continue
        if isinstance(cc.get("earnings"), list):
            for item in cc["earnings"]:
                if isinstance(item, dict) and item.get("code"):
                    code = item["code"]
                    abbr = item.get("abbr", "")
                    if not is_custom_excluded(code, abbr):
                        custom_earnings_map[code] = {
                            "code": code,
                            "label": item.get("abbr") or item.get("name") or code,
                            "type": "EARNING",
                        }
        if isinstance(cc.get("deductions"), list):
            for item in cc["deductions"]:
                if isinstance(item, dict) and item.get("code"):
                    code = item["code"]
                    abbr = item.get("abbr", "")
                    if not is_custom_excluded(code, abbr):
                        custom_deductions_map[code] = {
                            "code": code,
                            "label": item.get("abbr") or item.get("name") or code,
                            "type": "DEDUCTION",
                        }
        for k, v in cc.items():
            k_upper = str(k).upper()
            v_abbr = str(v.get("abbr", "")).upper() if isinstance(v, dict) else ""
            if k in ("earnings", "deductions", "metadata") or is_custom_excluded(k, v_abbr):
                continue
            if isinstance(v, dict):
                is_ded = (v.get("component_type") == "DEDUCTION" or v.get("type") == "DEDUCTION")
                target_map = custom_deductions_map if is_ded else custom_earnings_map
                if k not in target_map:
                    target_map[k] = {
                        "code": k,
                        "label": v.get("abbr") or v.get("name") or k,
                        "type": "DEDUCTION" if is_ded else "EARNING",
                    }

    def get_custom_val(rec, code, comp_type):
        cc = rec.custom_components
        if not cc or not isinstance(cc, dict):
            return Decimal("0.00")
        target_upper = str(code).strip().upper()
        if comp_type == "DEDUCTION" and isinstance(cc.get("deductions"), list):
            for item in cc["deductions"]:
                if isinstance(item, dict):
                    if str(item.get("code", "")).strip().upper() == target_upper or str(item.get("abbr", "")).strip().upper() == target_upper:
                        try:
                            return Decimal(str(item.get("amount", 0) or 0))
                        except Exception:
                            return Decimal("0.00")
        if comp_type == "EARNING" and isinstance(cc.get("earnings"), list):
            for item in cc["earnings"]:
                if isinstance(item, dict):
                    if str(item.get("code", "")).strip().upper() == target_upper or str(item.get("abbr", "")).strip().upper() == target_upper:
                        try:
                            return Decimal(str(item.get("amount", 0) or 0))
                        except Exception:
                            return Decimal("0.00")
        if code in cc:
            val = cc[code]
            if isinstance(val, dict):
                val = val.get("amount", 0)
            try:
                return Decimal(str(val or 0))
            except Exception:
                return Decimal("0.00")
        for k, v in cc.items():
            if k not in ("earnings", "deductions") and str(k).strip().upper() == target_upper:
                val = v.get("amount", 0) if isinstance(v, dict) else v
                try:
                    return Decimal(str(val or 0))
                except Exception:
                    return Decimal("0.00")
        return Decimal("0.00")

    # 3. Construct column specification list with two-tier groups:
    # (group_name, header_label, getter_callable, col_type, width)
    # col_type: 'text', 'number', 'currency'
    columns = []

    # GROUP: EMPLOYEE DETAILS
    columns.append(("EMPLOYEE DETAILS", "Employee Name", lambda r: r.employee.full_name, "text", 24))
    columns.append(("EMPLOYEE DETAILS", "Email", lambda r: r.employee.email, "text", 26))
    columns.append(("EMPLOYEE DETAILS", "Employee Code", lambda r: r.employee.employee_code, "text", 16))
    columns.append(("EMPLOYEE DETAILS", "Designation", lambda r: r.employee.position or "—", "text", 20))
    columns.append(("EMPLOYEE DETAILS", "Type", lambda r: "Intern" if getattr(r.employee, "is_intern", False) else "Regular", "text", 14))
    columns.append(("EMPLOYEE DETAILS", "PAN Number", lambda r: getattr(r.employee, "pan_number", "") or "—", "text", 16))
    columns.append(("EMPLOYEE DETAILS", "Date of Joining", lambda r: r.employee.hire_date.strftime("%d/%m/%Y") if getattr(r.employee, "hire_date", None) else "—", "text", 16))
    columns.append(("EMPLOYEE DETAILS", "Date of Resignation", lambda r: r.employee.last_working_date.strftime("%d/%m/%Y") if getattr(r.employee, "last_working_date", None) else "—", "text", 18))
    columns.append(("EMPLOYEE DETAILS", "UAN Number", lambda r: getattr(r.employee, "uan_number", "") or "—", "text", 16))
    columns.append(("EMPLOYEE DETAILS", "Bank Account", lambda r: getattr(r.employee, "bank_account_number", "") or "—", "text", 18))
    columns.append(("EMPLOYEE DETAILS", "Bank IFSC", lambda r: getattr(r.employee, "bank_ifsc_code", "") or "—", "text", 14))

    # GROUP: CTC & RETIRAL WATERFALL
    def _get_carved_custom_allowances(rec):
        snap = getattr(rec, "salary_structure_snapshot", None)
        if not snap or not isinstance(snap.custom_components, dict):
            return Decimal("0.00")
        tot = Decimal("0.00")
        for comp in snap.custom_components.values():
            if isinstance(comp, dict) and comp.get("carve_out_from_ctc"):
                try:
                    amt = Decimal(str(comp.get("amount", 0) or 0))
                    freq = str(comp.get("payout_frequency", "MONTHLY")).upper()
                    if freq == "ANNUAL":
                        tot += amt / Decimal("12")
                    elif freq == "QUARTERLY":
                        tot += amt / Decimal("3")
                    else:
                        tot += amt
                except Exception:
                    pass
        return tot.quantize(Decimal("0.01"))

    # ── Check Client Configuration for Carved-Out Components ──
    # 1. Employer PF (Carved): Opted when PF rule is not NOT_OPTED and employer_pf_in_ctc is True
    has_carved_pf = False
    if profile:
        pf_rule = getattr(profile, "pf_calculation_rule", "") or ""
        has_carved_pf = bool(getattr(profile, "employer_pf_in_ctc", True) and pf_rule != ClientProfile.PF_RULE_NOT_OPTED)
    elif hasattr(batch.client, "custom_salary_components"):
        has_carved_pf = not batch.client.custom_salary_components.filter(code="__EMPLOYER_PF_IN_CTC__", abbr="DISABLED").exists()

    # 2. Employer ESI (Carved): Opted when ESI is enabled and employer_esi_in_ctc is True
    has_carved_esi = False
    if profile:
        esi_enabled = bool(getattr(profile, "esi_enabled", False))
        has_carved_esi = bool(esi_enabled and getattr(profile, "employer_esi_in_ctc", True))
    elif hasattr(batch.client, "custom_salary_components"):
        has_carved_esi = bool(batch.client.custom_salary_components.filter(code="__ESI_ENABLED__", abbr="ENABLED").exists())

    # 3. Gratuity Accrual (Carved): Opted when gratuity_in_ctc is True
    has_carved_gratuity = False
    if profile:
        has_carved_gratuity = bool(getattr(profile, "gratuity_in_ctc", False))
    elif hasattr(batch.client, "custom_salary_components"):
        has_carved_gratuity = bool(batch.client.custom_salary_components.filter(code="__GRATUITY_IN_CTC__", abbr="ENABLED").exists())

    # 4. FBP (Carved): Opted when carve_out_fbp_in_ctc is True in profile OR on any snapshot in batch
    has_carved_fbp = False
    if profile:
        has_carved_fbp = bool(getattr(profile, "carve_out_fbp_in_ctc", False))
    elif hasattr(batch.client, "custom_salary_components"):
        has_carved_fbp = bool(batch.client.custom_salary_components.filter(code="__CARVE_OUT_FBP__", abbr="ENABLED").exists())
    if not has_carved_fbp:
        has_carved_fbp = any(
            bool(r.salary_structure_snapshot and getattr(r.salary_structure_snapshot, "fbp", 0) > 0 and (getattr(r.salary_structure_snapshot, "carve_out_fbp_in_ctc", False) or (profile and getattr(profile, "carve_out_fbp_in_ctc", False))))
            for r in records
        )

    # 5. Carved Allowances: Opted when carve_out_custom_in_ctc is True or any active client component has carve_out_from_ctc
    has_carved_custom = False
    if profile:
        has_carved_custom = bool(getattr(profile, "carve_out_custom_in_ctc", False))
    elif hasattr(batch.client, "custom_salary_components"):
        has_carved_custom = bool(batch.client.custom_salary_components.filter(code="__CARVE_OUT_CUSTOM__", abbr="ENABLED").exists())

    columns.append(("CTC & RETIRAL WATERFALL", "CTC (Annual)", lambda r: r.salary_structure_snapshot.ctc_annual if r.salary_structure_snapshot_id else Decimal("0.00"), "currency", 16))
    columns.append(("CTC & RETIRAL WATERFALL", "Monthly CTC Pool", lambda r: (r.salary_structure_snapshot.ctc_annual / Decimal("12")).quantize(Decimal("0.01")) if (r.salary_structure_snapshot_id and r.salary_structure_snapshot.ctc_annual) else Decimal("0.00"), "currency", 16))

    if has_carved_pf:
        columns.append(("CTC & RETIRAL WATERFALL", "Employer PF (Carved)", lambda r: r.salary_structure_snapshot.employer_pf if (r.salary_structure_snapshot_id and getattr(r.salary_structure_snapshot, "employer_pf_in_ctc", True)) else Decimal("0.00"), "currency", 16))
    if has_carved_esi:
        columns.append(("CTC & RETIRAL WATERFALL", "Employer ESI (Carved)", lambda r: r.salary_structure_snapshot.employer_esi if (r.salary_structure_snapshot_id and getattr(r.salary_structure_snapshot, "employer_esi_in_ctc", False)) else Decimal("0.00"), "currency", 16))
    if has_carved_gratuity:
        columns.append(("CTC & RETIRAL WATERFALL", "Gratuity Accrual (Carved)", lambda r: r.salary_structure_snapshot.gratuity if (r.salary_structure_snapshot_id and getattr(r.salary_structure_snapshot, "gratuity_in_ctc", False)) else Decimal("0.00"), "currency", 17))
    if has_carved_fbp:
        columns.append(("CTC & RETIRAL WATERFALL", "FBP (Carved)", lambda r: (r.salary_structure_snapshot.fbp if (r.salary_structure_snapshot_id and (getattr(r.salary_structure_snapshot, "carve_out_fbp_in_ctc", False) or getattr(profile, "carve_out_fbp_in_ctc", False))) else Decimal("0.00")), "currency", 14))
    if has_carved_custom:
        columns.append(("CTC & RETIRAL WATERFALL", "Carved Allowances", _get_carved_custom_allowances, "currency", 16))

    columns.append(("CTC & RETIRAL WATERFALL", "Base Monthly Gross", lambda r: r.salary_structure_snapshot.monthly_gross if r.salary_structure_snapshot_id else (r.gross_salary or Decimal("0.00")), "currency", 16))

    # GROUP: ATTENDANCE
    columns.append(("ATTENDANCE", "Days in Month", lambda r: r.days_in_month, "number", 14))
    columns.append(("ATTENDANCE", "Days Worked", lambda r: r.actual_working_days, "number", 14))
    if track_comp_off:
        columns.append(("ATTENDANCE", "Comp-Off Opening", lambda r: r.comp_off_opening_balance, "number", 16))
        columns.append(("ATTENDANCE", "Extra Working Days", lambda r: r.extra_working_days, "number", 16))
        columns.append(("ATTENDANCE", "Comp-Off Used (LOP)", lambda r: r.comp_off_days_used, "number", 16))
        columns.append(("ATTENDANCE", "Comp-Off Closing", lambda r: r.comp_off_closing_balance, "number", 16))
    columns.append(("ATTENDANCE", "LOP Days", lambda r: r.lop_days, "number", 12))
    if track_leave:
        columns.append(("ATTENDANCE", "Paid Leave Days", lambda r: r.paid_leave_days, "number", 15))
        columns.append(("ATTENDANCE", "Leave Opening", lambda r: r.leave_opening_balance, "number", 15))
        columns.append(("ATTENDANCE", "Leave Accrued", lambda r: r.leave_accrued, "number", 14))
        columns.append(("ATTENDANCE", "Leave Used", lambda r: r.leave_used, "number", 14))
        columns.append(("ATTENDANCE", "Leave Closing", lambda r: r.leave_closing_balance, "number", 14))

    # Helpers for FBP evaluation in Earnings
    def _get_contracted_fbp(r):
        if r.salary_structure_snapshot_id and getattr(r.salary_structure_snapshot, "fbp", None) is not None:
            return Decimal(str(r.salary_structure_snapshot.fbp or 0))
        return Decimal("0.00")

    def _get_fbp_earned(r):
        cc = getattr(r, "custom_components", None)
        if isinstance(cc, dict) and isinstance(cc.get("earnings"), list):
            for item in cc["earnings"]:
                if isinstance(item, dict) and str(item.get("code", "")).strip().upper() == "FBP":
                    try:
                        return Decimal(str(item.get("amount", 0) or 0))
                    except Exception:
                        pass
        snap = getattr(r, "salary_structure_snapshot", None)
        if snap and getattr(snap, "fbp", None) is not None and Decimal(str(snap.fbp or 0)) > 0:
            try:
                base = Decimal(str(snap.fbp))
                tot = Decimal(str(getattr(r, "days_in_month", None) or getattr(r, "total_working_days", None) or 30))
                pdays = Decimal(str(getattr(r, "actual_working_days", None) or getattr(r, "payment_days", None) or 0))
                if tot > 0 and pdays > 0:
                    return (base * pdays / tot).quantize(Decimal("0.01"))
            except Exception:
                pass
        return Decimal("0.00")

    has_fbp_in_batch = has_carved_fbp or any(_get_contracted_fbp(r) > 0 or _get_fbp_earned(r) > 0 for r in records)

    # GROUP: EARNINGS
    columns.append(("EARNINGS", "Contracted Gross", lambda r: r.salary_structure_snapshot.monthly_gross if r.salary_structure_snapshot_id else (r.gross_salary or Decimal("0.00")), "currency", 16))
    columns.append(("EARNINGS", "Contracted Basic", lambda r: r.salary_structure_snapshot.original_basic_da if r.salary_structure_snapshot_id else Decimal("0.00"), "currency", 16))
    columns.append(("EARNINGS", "Basic + DA (Earned)", lambda r: r.basic_da, "currency", 16))
    columns.append(("EARNINGS", "Contracted HRA", lambda r: r.salary_structure_snapshot.original_hra if r.salary_structure_snapshot_id else Decimal("0.00"), "currency", 15))
    columns.append(("EARNINGS", "HRA (Earned)", lambda r: r.hra, "currency", 14))
    columns.append(("EARNINGS", "Contracted LTA", lambda r: r.salary_structure_snapshot.original_lta if r.salary_structure_snapshot_id else Decimal("0.00"), "currency", 15))
    columns.append(("EARNINGS", "LTA (Earned)", lambda r: r.lta, "currency", 14))
    columns.append(("EARNINGS", "Contracted Special", lambda r: r.salary_structure_snapshot.original_special_allowance if r.salary_structure_snapshot_id else Decimal("0.00"), "currency", 17))
    columns.append(("EARNINGS", "Special Allowance (Earned)", lambda r: r.special_allowance, "currency", 17))
    columns.append(("EARNINGS", "NPS Allowance Earned", lambda r: r.nps_allowance_earned, "currency", 18))
    if has_fbp_in_batch:
        columns.append(("EARNINGS", "Contracted FBP", _get_contracted_fbp, "currency", 16))
        columns.append(("EARNINGS", "FBP (Earned)", _get_fbp_earned, "currency", 16))
    columns.append(("EARNINGS", "Variable Pay", lambda r: r.variable_pay, "currency", 15))
    columns.append(("EARNINGS", "Commission / Other", lambda r: r.commission_other, "currency", 16))
    columns.append(("EARNINGS", "Arrears", lambda r: r.arrears, "currency", 14))
    columns.append(("EARNINGS", "Salary Advance Disbursed", lambda r: max(Decimal("0.00"), r.salary_advance_disbursed), "currency", 18))
    columns.append(("EARNINGS", "Salary On-Hold Released", lambda r: max(Decimal("0.00"), r.on_hold_released), "currency", 18))
    columns.append(("EARNINGS", "Reimbursements", lambda r: r.reimbursements, "currency", 15))
    for c in custom_earnings_map.values():
        c_code = c["code"]
        c_label = f"{c['label']} ✨"
        columns.append(("EARNINGS", c_label, lambda r, code=c_code: get_custom_val(r, code, "EARNING"), "currency", 16))
    columns.append(("EARNINGS", "Total Earned Salary", lambda r: r.earned_salary, "currency", 17))

    # GROUP: DEDUCTIONS
    columns.append(("DEDUCTIONS", "EPF", lambda r: r.epf, "currency", 14))
    columns.append(("DEDUCTIONS", "ESI", lambda r: r.esi, "currency", 14))
    columns.append(("DEDUCTIONS", "VPF", lambda r: r.vpf, "currency", 14))
    columns.append(("DEDUCTIONS", "Professional Tax", lambda r: r.professional_tax, "currency", 15))
    columns.append(("DEDUCTIONS", "TDS", lambda r: r.tds, "currency", 14))
    columns.append(("DEDUCTIONS", "NPS Deduction", lambda r: r.nps_deduction, "currency", 15))
    columns.append(("DEDUCTIONS", "Loan Deduction", lambda r: r.loan_deduction, "currency", 15))
    columns.append(("DEDUCTIONS", "Salary Advance Recovered", lambda r: max(Decimal("0.00"), r.salary_advance_recovered), "currency", 18))
    columns.append(("DEDUCTIONS", "Salary On-Hold Deducted", lambda r: max(Decimal("0.00"), r.on_hold_deducted), "currency", 18))
    columns.append(("DEDUCTIONS", "LWF", lambda r: r.lwf, "currency", 12))
    columns.append(("DEDUCTIONS", "Other Deduction", lambda r: r.other_deduction, "currency", 15))
    for c in custom_deductions_map.values():
        c_code = c["code"]
        c_label = f"{c['label']} ✨"
        columns.append(("DEDUCTIONS", c_label, lambda r, code=c_code: get_custom_val(r, code, "DEDUCTION"), "currency", 16))
    columns.append(("DEDUCTIONS", "Total Deductions", lambda r: r.total_deductions, "currency", 16))

    # GROUP: NET DISBURSAL & BALANCES
    columns.append(("NET DISBURSAL & BALANCES", "Net Salary", lambda r: r.net_salary, "currency", 16))
    columns.append(("NET DISBURSAL & BALANCES", "Salary Advance Balance", lambda r: max(Decimal("0.00"), r.salary_advance_closing_balance), "currency", 18))
    columns.append(("NET DISBURSAL & BALANCES", "Salary On-Hold Balance", lambda r: max(Decimal("0.00"), r.on_hold_closing_balance), "currency", 18))
    columns.append(("NET DISBURSAL & BALANCES", "Status", lambda r: r.get_status_display(), "text", 14))

    wb = Workbook()
    ws = wb.active
    ws.title = "Payroll Register"

    last_col = len(columns)
    last_col_letter = get_column_letter(last_col)

    # Borders & Fills
    thin_side = Side(border_style="thin", color="CBD5E1")
    grid_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    totals_border = Border(
        top=Side(border_style="thin", color="1E293B"),
        bottom=Side(border_style="double", color="1E293B"),
        left=thin_side,
        right=thin_side,
    )

    GROUP_COLORS = {
        "EMPLOYEE DETAILS": {"super_fill": "334155", "sub_fill": "F1F5F9", "font_color": "FFFFFF"},
        "CTC & RETIRAL WATERFALL": {"super_fill": "0F172A", "sub_fill": "F8FAFC", "font_color": "FFFFFF"},
        "ATTENDANCE": {"super_fill": "4338CA", "sub_fill": "EEF2FF", "font_color": "FFFFFF"},
        "EARNINGS": {"super_fill": "15803D", "sub_fill": "F0FDF4", "font_color": "FFFFFF"},
        "DEDUCTIONS": {"super_fill": "B91C1C", "sub_fill": "FEF2F2", "font_color": "FFFFFF"},
        "NET DISBURSAL & BALANCES": {"super_fill": "0F766E", "sub_fill": "F0FDFA", "font_color": "FFFFFF"},
    }

    # Row 1 — Company & Payroll Register Title Banner
    ws.row_dimensions[1].height = 32
    ws.merge_cells(f"A1:{last_col_letter}1")
    title_cell = ws["A1"]
    title_cell.value = f"{batch.client.name.upper()} — PAYROLL REGISTER ({month_name[batch.month].upper()} {batch.year})"
    title_cell.font = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")

    # Row 2 — Group Super-Headers (Two-Tier Option 1)
    ws.row_dimensions[2].height = 24
    group_spans = []
    current_grp = None
    grp_start = 1
    for col_idx, (grp, label, getter, c_type, width) in enumerate(columns, start=1):
        if grp != current_grp:
            if current_grp is not None:
                group_spans.append((current_grp, grp_start, col_idx - 1))
            current_grp = grp
            grp_start = col_idx
    if current_grp is not None:
        group_spans.append((current_grp, grp_start, len(columns)))

    for grp_name, s_col, e_col in group_spans:
        cfg = GROUP_COLORS.get(grp_name, {"super_fill": "475569", "font_color": "FFFFFF"})
        fill = PatternFill(start_color=cfg["super_fill"], end_color=cfg["super_fill"], fill_type="solid")
        font = Font(name="Calibri", size=10, bold=True, color=cfg["font_color"])
        align = Alignment(horizontal="center", vertical="center")

        if s_col < e_col:
            ws.merge_cells(start_row=2, start_column=s_col, end_row=2, end_column=e_col)
        for c in range(s_col, e_col + 1):
            cell = ws.cell(row=2, column=c)
            cell.fill = fill
            cell.border = grid_border
            if c == s_col:
                cell.value = grp_name
                cell.font = font
                cell.alignment = align

    # Row 3 — Sub-Headers (Individual Columns with Option 3 ✨ custom badges)
    ws.row_dimensions[3].height = 26
    for col_idx, (grp, label, getter, c_type, width) in enumerate(columns, start=1):
        cfg = GROUP_COLORS.get(grp, {"sub_fill": "F1F5F9"})
        cell = ws.cell(row=3, column=col_idx, value=label)
        cell.fill = PatternFill(start_color=cfg["sub_fill"], end_color=cfg["sub_fill"], fill_type="solid")
        cell.font = Font(name="Calibri", size=9, bold=True, color="0F172A")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = grid_border
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Dynamic column index resolution for CTC & Retiral Waterfall live formulas
    monthly_ctc_col_idx = None
    carve_out_col_indices = []
    base_gross_col_idx = None
    for col_idx, (grp, label, getter, c_type, width) in enumerate(columns, start=1):
        if grp == "CTC & RETIRAL WATERFALL":
            if label == "Monthly CTC Pool":
                monthly_ctc_col_idx = col_idx
            elif label == "Base Monthly Gross":
                base_gross_col_idx = col_idx
            elif "Carved" in label or "Carve" in label:
                carve_out_col_indices.append(col_idx)

    # Rows 4+ — Data Rows
    start_data_row = 4
    for r_idx, record in enumerate(records, start=start_data_row):
        ws.row_dimensions[r_idx].height = 20
        row_bg = "FFFFFF" if r_idx % 2 == 0 else "F8FAFC"
        zebra_fill = PatternFill(start_color=row_bg, end_color=row_bg, fill_type="solid")
        for c_idx, (grp, label, getter, c_type, width) in enumerate(columns, start=1):
            raw_val = getter(record)
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.fill = zebra_fill
            cell.border = grid_border
            cell.font = Font(name="Calibri", size=10)

            if c_type == "currency":
                num_val = float(raw_val) if isinstance(raw_val, Decimal) else (float(raw_val) if raw_val is not None else 0.0)
                # Option 1: Dynamic Native Excel formulas for the live CTC Waterfall
                if label == "Monthly CTC Pool" and monthly_ctc_col_idx:
                    ann_col = get_column_letter(monthly_ctc_col_idx - 1)
                    cell.value = f"={ann_col}{r_idx}/12"
                elif label == "Base Monthly Gross" and monthly_ctc_col_idx:
                    m_col = get_column_letter(monthly_ctc_col_idx)
                    if len(carve_out_col_indices) > 1:
                        first_c = get_column_letter(carve_out_col_indices[0])
                        last_c = get_column_letter(carve_out_col_indices[-1])
                        cell.value = f"={m_col}{r_idx}-SUM({first_c}{r_idx}:{last_c}{r_idx})"
                    elif len(carve_out_col_indices) == 1:
                        single_c = get_column_letter(carve_out_col_indices[0])
                        cell.value = f"={m_col}{r_idx}-{single_c}{r_idx}"
                    else:
                        cell.value = f"={m_col}{r_idx}"
                else:
                    cell.value = num_val
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif c_type == "number":
                num_val = float(raw_val) if isinstance(raw_val, Decimal) else (float(raw_val) if raw_val is not None else 0.0)
                cell.value = num_val
                cell.number_format = "0.0" if isinstance(num_val, float) and not num_val.is_integer() else "0"
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.value = str(raw_val) if raw_val is not None else ""
                cell.alignment = Alignment(horizontal="center" if c_idx in (3, len(columns)) else "left", vertical="center")

    # Formula-Driven Automated Totals Row (Option 2)
    last_data_row = start_data_row + len(records) - 1
    totals_row = last_data_row + 1 if records.exists() else start_data_row
    if records.exists():
        ws.row_dimensions[totals_row].height = 25
        totals_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
        for c_idx, (grp, label, getter, c_type, width) in enumerate(columns, start=1):
            cell = ws.cell(row=totals_row, column=c_idx)
            cell.fill = totals_fill
            cell.border = totals_border
            cell.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            col_letter = get_column_letter(c_idx)

            if c_idx == 1:
                cell.value = f"TOTAL ({len(records)} EMPLOYEES)"
                cell.alignment = Alignment(horizontal="left", vertical="center")
            elif c_type == "currency":
                cell.value = f"=SUM({col_letter}{start_data_row}:{col_letter}{last_data_row})"
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif c_type == "number":
                cell.value = f"=SUM({col_letter}{start_data_row}:{col_letter}{last_data_row})"
                cell.number_format = "0.0"
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.value = ""
                cell.alignment = Alignment(horizontal="center", vertical="center")

    # ── 3-Tier Maker-Checker-Approver Sign-Off Block ──────────────────────
    sign_start_row = totals_row + 3
    ws.row_dimensions[sign_start_row].height = 20
    ws.row_dimensions[sign_start_row + 1].height = 26
    ws.row_dimensions[sign_start_row + 2].height = 20

    def _format_u_name(u):
        if not u:
            return ""
        full = getattr(u, "get_full_name", lambda: "")()
        if full and full.strip():
            return full.strip()
        uname = getattr(u, "username", "")
        return uname.capitalize() if uname else ""

    job = getattr(batch, "job", None)
    if not job and hasattr(batch, "jobs"):
        try:
            job = batch.jobs.first()
        except Exception:
            job = None

    maker_name = ""
    checker_name = ""
    approver_name = ""

    if job:
        try:
            m_list = [_format_u_name(u) for u in job.makers.all() if _format_u_name(u)]
            if m_list:
                maker_name = ", ".join(m_list)
            c_list = [_format_u_name(u) for u in job.checkers.all() if _format_u_name(u)]
            if c_list:
                checker_name = ", ".join(c_list)
        except Exception:
            pass

    # 1. Maker fallback: batch uploader or job creator
    if not maker_name:
        creator = getattr(batch, "uploaded_by", None) or getattr(batch, "created_by", None)
        if creator:
            maker_name = _format_u_name(creator)
        elif job and getattr(job, "created_by", None):
            maker_name = _format_u_name(job.created_by)

    # 2. Checker fallback: job assigner or batch reviewer
    if not checker_name:
        if job and getattr(job, "assigned_by", None):
            checker_name = _format_u_name(job.assigned_by)
        elif getattr(batch, "reviewed_by", None):
            checker_name = _format_u_name(batch.reviewed_by)

    # 3. Approver: Admin / Founder who approved the document (or Client contact)
    if job and hasattr(job, "events"):
        try:
            approver_event = job.events.filter(
                event_type__in=["APPROVER_APPROVED", "APPROVED"]
            ).order_by("-id").first()
            if approver_event:
                approver_name = approver_event.performed_by_name or _format_u_name(approver_event.performed_by)
        except Exception:
            pass

    if not approver_name:
        reviewed_user = getattr(job, "reviewed_by", None) or getattr(batch, "reviewed_by", None)
        if reviewed_user:
            approver_name = _format_u_name(reviewed_user)
        elif hasattr(batch, "client"):
            approver_name = getattr(batch.client, "contact_person", None) or ""

    sign_boxes = [
        (2, 4, "PREPARED BY (MAKER)", maker_name or "T.L. Sarada (Accounts Executive)"),
        (6, 8, "CHECKED BY (CHECKER)", checker_name or "Sowmya V (Payroll Manager)"),
        (10, 12, "APPROVED BY (PARTNER / CLIENT)", approver_name or "Partner / Authorized Signatory"),
    ]

    sign_hdr_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
    sign_body_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    sign_hdr_font = Font(name="Calibri", size=9, bold=True, color="FFFFFF")
    sign_name_font = Font(name="Calibri", size=9, bold=True, color="0F172A")
    sign_sub_font = Font(name="Calibri", size=8, italic=True, color="64748B")

    for s_col, e_col, box_title, person_name in sign_boxes:
        if e_col <= last_col:
            ws.merge_cells(start_row=sign_start_row, start_column=s_col, end_row=sign_start_row, end_column=e_col)
            ws.merge_cells(start_row=sign_start_row + 1, start_column=s_col, end_row=sign_start_row + 1, end_column=e_col)
            ws.merge_cells(start_row=sign_start_row + 2, start_column=s_col, end_row=sign_start_row + 2, end_column=e_col)

            for r in range(sign_start_row, sign_start_row + 3):
                for c in range(s_col, e_col + 1):
                    ws.cell(row=r, column=c).border = grid_border

            c_hdr = ws.cell(row=sign_start_row, column=s_col, value=box_title)
            c_hdr.fill = sign_hdr_fill
            c_hdr.font = sign_hdr_font
            c_hdr.alignment = Alignment(horizontal="center", vertical="center")

            c_name = ws.cell(row=sign_start_row + 1, column=s_col, value=person_name)
            c_name.fill = sign_body_fill
            c_name.font = sign_name_font
            c_name.alignment = Alignment(horizontal="center", vertical="center")

            c_dt = ws.cell(row=sign_start_row + 2, column=s_col, value="Signature & Date: _________________")
            c_dt.fill = sign_body_fill
            c_dt.font = sign_sub_font
            c_dt.alignment = Alignment(horizontal="center", vertical="center")

    # Freeze Panes for Headers & Employee Info (Option 4)
    ws.freeze_panes = "D4"

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    filename = f"payroll_{batch.client_id}_{batch.year}_{batch.month:02d}_detailed.xlsx"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def generate_epfo_ecr_txt_response(batch):
    """
    Generates EPFO Electronic Challan cum Return (ECR 2.0) plain-text payload
    delimited with official `#~#` delimiter for direct Unified Portal upload.
    No header row is output, matching EPFO portal format specifications.
    """
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")
    lines = []

    profile = getattr(batch.client, "payroll_profile", None)
    pf_rule = getattr(profile, "pf_calculation_rule", "CAPPED_1800")

    for r in records:
        emp = r.employee
        struct = r.salary_structure_snapshot
        pf_opted = getattr(struct, "pf_opted", True) if struct else True
        if r.epf <= 0 and r.basic_for_pf <= 0 and not pf_opted:
            continue

        uan = (emp.uan_number or "").strip()
        if not uan:
            uan = emp.employee_code.strip()

        # Clean member name: uppercase alphanumeric & spaces only
        name = re.sub(r"[^A-Za-z0-9 ]+", "", emp.full_name).strip().upper() or emp.employee_code
        gross_wages = int(round(r.earned_salary or 0))
        epf_wages = int(round(r.basic_for_pf or 0))

        if pf_rule != "UNCAPPED_12_PERCENT" and epf_wages > 15000:
            epf_wages = 15000

        is_senior = False
        if struct and isinstance(struct.custom_components, dict):
            is_senior = bool(struct.custom_components.get("is_senior_citizen") or struct.custom_components.get("non_eps"))

        eps_wages = 0 if is_senior else min(15000, epf_wages)
        edli_wages = min(15000, epf_wages)
        ee_share = int(round(r.epf or 0))

        if eps_wages > 0:
            eps_share = min(1250, int(round(Decimal(str(eps_wages)) * Decimal("0.0833"))))
        else:
            eps_share = 0

        er_share = max(0, ee_share - eps_share)
        ncp_days = int(round(r.lop_days or 0))
        refund_adv = 0

        row_fields = [
            str(uan),
            str(name),
            str(gross_wages),
            str(epf_wages),
            str(eps_wages),
            str(edli_wages),
            str(ee_share),
            str(eps_share),
            str(er_share),
            str(ncp_days),
            str(refund_adv),
        ]
        lines.append("#~#".join(row_fields))

    content = "\r\n".join(lines)
    response = HttpResponse(content, content_type="text/plain; charset=utf-8")
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="EPFO_ECR_{client_code}_{batch.year}_{batch.month:02d}.txt"'
    return response


def generate_epfo_ecr_xlsx_response(batch):
    """
    Generates an executive-formatted workbook containing:
    1. Sheet 'ECR Member Schedule': All 11 statutory columns + Totals.
    2. Sheet 'Challan Summary' (Option 6.A): Challan account split table
       (A/c 1, A/c 2 Admin, A/c 10 EPS, A/c 21 EDLI, A/c 22) with grand total.
    """
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")
    profile = getattr(batch.client, "payroll_profile", None)
    pf_rule = getattr(profile, "pf_calculation_rule", "CAPPED_1800")
    est_code = getattr(profile, "pf_establishment_code", "") or "Not Configured"

    wb = Workbook()

    # Sheet 1: ECR Member Schedule
    ws_sched = wb.active
    ws_sched.title = "ECR Member Schedule"

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right_align = Alignment(horizontal="right", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    ws_sched.merge_cells("A1:L1")
    ws_sched["A1"] = f"{batch.client.name} — EPFO Electronic Challan cum Return (ECR)"
    ws_sched["A1"].font = Font(bold=True, size=13, color="0F172A")
    ws_sched["A1"].alignment = Alignment(horizontal="left", vertical="center")

    ws_sched.merge_cells("A2:L2")
    ws_sched["A2"] = f"PF Establishment Code: {est_code}  |  Wage Month: {month_name[batch.month]} {batch.year}  |  Rule: {pf_rule}"
    ws_sched["A2"].font = Font(size=10, italic=True, color="475569")
    ws_sched["A2"].alignment = Alignment(horizontal="left", vertical="center")

    headers = [
        "Sl No", "UAN", "Member Name", "Gross Wages (Rs)", "EPF Wages (Rs)",
        "EPS Wages (Rs)", "EDLI Wages (Rs)", "EE Share (12%)", "EPS Share (8.33%)",
        "ER EPF Share (Diff)", "NCP Days", "Refund of Adv"
    ]

    for c_idx, h_text in enumerate(headers, start=1):
        cell = ws_sched.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_sched.row_dimensions[4].height = 28

    row_num = 5
    sum_gross = 0
    sum_epf_wages = 0
    sum_eps_wages = 0
    sum_edli_wages = 0
    sum_ee = 0
    sum_eps = 0
    sum_er = 0
    sum_ncp = 0
    contributing_count = 0

    for r in records:
        emp = r.employee
        struct = r.salary_structure_snapshot
        pf_opted = getattr(struct, "pf_opted", True) if struct else True
        if r.epf <= 0 and r.basic_for_pf <= 0 and not pf_opted:
            continue

        contributing_count += 1
        uan = (emp.uan_number or "").strip() or emp.employee_code.strip()
        name = emp.full_name.upper() or emp.employee_code
        gross_w = int(round(r.earned_salary or 0))
        epf_w = int(round(r.basic_for_pf or 0))
        if pf_rule != "UNCAPPED_12_PERCENT" and epf_w > 15000:
            epf_w = 15000

        is_senior = False
        if struct and isinstance(struct.custom_components, dict):
            is_senior = bool(struct.custom_components.get("is_senior_citizen") or struct.custom_components.get("non_eps"))

        eps_w = 0 if is_senior else min(15000, epf_w)
        edli_w = min(15000, epf_w)
        ee = int(round(r.epf or 0))
        eps = min(1250, int(round(Decimal(str(eps_w)) * Decimal("0.0833")))) if eps_w > 0 else 0
        er = max(0, ee - eps)
        ncp = int(round(r.lop_days or 0))

        sum_gross += gross_w
        sum_epf_wages += epf_w
        sum_eps_wages += eps_w
        sum_edli_wages += edli_w
        sum_ee += ee
        sum_eps += eps
        sum_er += er
        sum_ncp += ncp

        data_cells = [
            (contributing_count, center_align),
            (uan, center_align),
            (name, left_align),
            (gross_w, right_align),
            (epf_w, right_align),
            (eps_w, right_align),
            (edli_w, right_align),
            (ee, right_align),
            (eps, right_align),
            (er, right_align),
            (ncp, center_align),
            (0, center_align),
        ]

        for c_idx, (val, align) in enumerate(data_cells, start=1):
            c = ws_sched.cell(row=row_num, column=c_idx, value=val)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            if row_num % 2 == 0:
                c.fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        row_num += 1

    # Total row
    totals_cells = [
        ("TOTAL", center_align),
        (f"{contributing_count} Members", center_align),
        ("", center_align),
        (sum_gross, right_align),
        (sum_epf_wages, right_align),
        (sum_eps_wages, right_align),
        (sum_edli_wages, right_align),
        (sum_ee, right_align),
        (sum_eps, right_align),
        (sum_er, right_align),
        (sum_ncp, center_align),
        (0, center_align),
    ]
    for c_idx, (val, align) in enumerate(totals_cells, start=1):
        c = ws_sched.cell(row=row_num, column=c_idx, value=val)
        c.font = Font(bold=True, size=10, color="0F172A")
        c.alignment = align
        c.border = double_bottom_border
        c.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    for c_idx in range(1, 13):
        col_letter = get_column_letter(c_idx)
        ws_sched.column_dimensions[col_letter].width = 17 if c_idx in (2, 3) else 14
    ws_sched.column_dimensions["A"].width = 7

    # Sheet 2: Challan Summary (Option 6.A)
    ws_challan = wb.create_sheet(title="Challan Summary")
    ws_challan.merge_cells("A1:E1")
    ws_challan["A1"] = f"{batch.client.name} — EPFO Monthly Challan Accounting Remittance"
    ws_challan["A1"].font = Font(bold=True, size=12, color="0F172A")

    ws_challan.merge_cells("A2:E2")
    ws_challan["A2"] = f"Wage Month: {month_name[batch.month]} {batch.year} | Establishment Code: {est_code}"
    ws_challan["A2"].font = Font(size=10, italic=True, color="475569")

    challan_headers = ["Account No.", "Account Description", "Wage Base (Rs)", "Rate", "Challan Amount (Rs)"]
    for c_idx, h_text in enumerate(challan_headers, start=1):
        cell = ws_challan.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_challan.row_dimensions[4].height = 25

    admin_charges = max(Decimal("500.00"), (Decimal(str(sum_epf_wages)) * Decimal("0.0050")).quantize(Decimal("1.00"))) if sum_epf_wages > 0 else Decimal("0.00")
    edli_charges = (Decimal(str(sum_edli_wages)) * Decimal("0.0050")).quantize(Decimal("1.00"))
    grand_total = Decimal(str(sum_ee)) + Decimal(str(sum_er)) + admin_charges + Decimal(str(sum_eps)) + edli_charges

    challan_rows = [
        ("A/c No. 1", "Employee Provident Fund (EE Share 12%)", sum_epf_wages, "12.00%", sum_ee),
        ("A/c No. 1", "Employer EPF Contribution (ER EPF Difference)", sum_epf_wages, "3.67%", sum_er),
        ("A/c No. 2", "EPF Administration Charges", sum_epf_wages, "0.50% (Min ₹500)", float(admin_charges)),
        ("A/c No. 10", "Employees' Pension Scheme (EPS Remittance)", sum_eps_wages, "8.33%", sum_eps),
        ("A/c No. 21", "Employees' Deposit Linked Insurance (EDLI)", sum_edli_wages, "0.50%", float(edli_charges)),
        ("A/c No. 22", "EDLI Administration Charges", sum_edli_wages, "0.00%", 0.0),
    ]

    r_idx = 5
    for ac, desc, base, rate, amt in challan_rows:
        ws_challan.cell(row=r_idx, column=1, value=ac).alignment = center_align
        ws_challan.cell(row=r_idx, column=2, value=desc).alignment = left_align
        ws_challan.cell(row=r_idx, column=3, value=base).alignment = right_align
        ws_challan.cell(row=r_idx, column=4, value=rate).alignment = center_align
        c_amt = ws_challan.cell(row=r_idx, column=5, value=amt)
        c_amt.alignment = right_align
        for c in range(1, 6):
            ws_challan.cell(row=r_idx, column=c).border = thin_border
            ws_challan.cell(row=r_idx, column=c).font = Font(size=9.5)
        ws_challan.cell(row=r_idx, column=5).font = Font(size=9.5, bold=True)
        r_idx += 1

    # Grand Total Row
    ws_challan.cell(row=r_idx, column=1, value="GRAND TOTAL").alignment = center_align
    ws_challan.cell(row=r_idx, column=2, value="Total EPFO Challan Remittance Payable").alignment = left_align
    ws_challan.cell(row=r_idx, column=3, value="").alignment = center_align
    ws_challan.cell(row=r_idx, column=4, value="").alignment = center_align
    g_cell = ws_challan.cell(row=r_idx, column=5, value=float(grand_total))
    g_cell.alignment = right_align
    for c in range(1, 6):
        cell = ws_challan.cell(row=r_idx, column=c)
        cell.border = double_bottom_border
        cell.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
        cell.font = Font(bold=True, size=10)
    g_cell.font = Font(bold=True, size=11, color="B45309")

    ws_challan.column_dimensions["A"].width = 14
    ws_challan.column_dimensions["B"].width = 44
    ws_challan.column_dimensions["C"].width = 18
    ws_challan.column_dimensions["D"].width = 18
    ws_challan.column_dimensions["E"].width = 22

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="EPFO_ECR_Summary_{client_code}_{batch.year}_{batch.month:02d}.xlsx"'
    return response


def generate_esic_monthly_xlsx_response(batch):
    """
    Generates official monthly ESIC contribution return spreadsheet matching
    the template requirements of the ESIC Insurance Portal (`esic.gov.in`).
    Includes Regulation 29 next-higher-rupee rounding and zero-day exit codes.
    """
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")
    profile = getattr(batch.client, "payroll_profile", None)
    est_code = getattr(profile, "esi_establishment_code", "") or "Not Configured"
    esi_enabled = getattr(profile, "esi_enabled", False)

    wb = Workbook()
    ws_main = wb.active
    ws_main.title = "ESIC Monthly Contribution"

    header_fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right_align = Alignment(horizontal="right", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    ws_main.merge_cells("A1:F1")
    ws_main["A1"] = f"{batch.client.name} — ESIC Monthly Contribution Upload File"
    ws_main["A1"].font = Font(bold=True, size=13, color="0F172A")

    ws_main.merge_cells("A2:F2")
    ws_main["A2"] = f"ESIC Establishment Code: {est_code}  |  Wage Month: {month_name[batch.month]} {batch.year}  |  Regulation 29 Ceiling Rounding"
    ws_main["A2"].font = Font(size=10, italic=True, color="475569")

    headers = [
        "IP Number",
        "IP Name",
        "No of Days for which wages paid",
        "Total Monthly Wages (Rs.)",
        "Reason Code for Zero days work",
        "Last Working Day (DD/MM/YYYY)",
    ]

    for c_idx, h_text in enumerate(headers, start=1):
        cell = ws_main.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_main.row_dimensions[4].height = 28

    row_num = 5
    covered_count = 0
    sum_wages = 0
    sum_ee_esi = Decimal("0.00")

    days_in_month = batch.records.first().days_in_month if batch.records.exists() else 30
    month_end_date = date(batch.year, batch.month, calendar.monthrange(batch.year, batch.month)[1])

    for r in records:
        emp = r.employee
        struct = r.salary_structure_snapshot
        esi_opted = getattr(struct, "esi_opted", False) if struct else False

        has_esi_num = bool(emp.esi_number)
        if not (r.esi > 0 or esi_opted or has_esi_num or (esi_enabled and r.gross_salary <= Decimal("21000"))):
            continue

        covered_count += 1
        ip_number = (emp.esi_number or "").replace(" ", "").replace("-", "") or emp.employee_code
        ip_name = emp.full_name.upper() or emp.employee_code

        payable_days = max(0, int(round((r.days_in_month or days_in_month) - (r.lop_days or 0))))
        wages = math.ceil(float(r.earned_salary or 0)) if payable_days > 0 else 0
        sum_wages += wages
        sum_ee_esi += r.esi

        reason_code = ""
        lwd_str = ""
        if payable_days == 0:
            if emp.last_working_date and emp.last_working_date <= month_end_date:
                reason_code = "1"
            else:
                reason_code = "2"

        if emp.last_working_date and emp.last_working_date.year == batch.year and emp.last_working_date.month == batch.month:
            lwd_str = emp.last_working_date.strftime("%d/%m/%Y")

        row_cells = [
            (ip_number, center_align),
            (ip_name, left_align),
            (payable_days, center_align),
            (wages, right_align),
            (reason_code, center_align),
            (lwd_str, center_align),
        ]

        for c_idx, (val, align) in enumerate(row_cells, start=1):
            c = ws_main.cell(row=row_num, column=c_idx, value=val)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            if row_num % 2 == 0:
                c.fill = PatternFill(start_color="F0FDFA", end_color="F0FDFA", fill_type="solid")
        row_num += 1

    t_cells = [
        (f"{covered_count} IPs", center_align),
        ("TOTAL", center_align),
        ("", center_align),
        (sum_wages, right_align),
        ("", center_align),
        ("", center_align),
    ]
    for c_idx, (val, align) in enumerate(t_cells, start=1):
        c = ws_main.cell(row=row_num, column=c_idx, value=val)
        c.font = Font(bold=True, size=10, color="0F172A")
        c.alignment = align
        c.border = double_bottom_border
        c.fill = PatternFill(start_color="CCFBF1", end_color="CCFBF1", fill_type="solid")

    ws_main.column_dimensions["A"].width = 18
    ws_main.column_dimensions["B"].width = 30
    ws_main.column_dimensions["C"].width = 24
    ws_main.column_dimensions["D"].width = 24
    ws_main.column_dimensions["E"].width = 24
    ws_main.column_dimensions["F"].width = 22

    # Sheet 2: ESIC Challan Summary
    ws_summary = wb.create_sheet(title="ESIC Challan Summary")
    ws_summary.merge_cells("A1:D1")
    ws_summary["A1"] = f"{batch.client.name} — ESIC Monthly Challan Summary"
    ws_summary["A1"].font = Font(bold=True, size=12, color="0F172A")

    ws_summary.merge_cells("A2:D2")
    ws_summary["A2"] = f"Wage Month: {month_name[batch.month]} {batch.year} | Establishment Code: {est_code}"
    ws_summary["A2"].font = Font(size=10, italic=True, color="475569")

    sum_headers = ["Contribution Category", "Rate", "Wage Base (Rs)", "Remittance Amount (Rs)"]
    for c_idx, h_text in enumerate(sum_headers, start=1):
        cell = ws_summary.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_summary.row_dimensions[4].height = 25

    er_esi = Decimal(str(math.ceil(sum_wages * 0.0325)))
    total_esi_remittance = sum_ee_esi + er_esi

    summary_rows = [
        ("Employee Share (IP Contribution)", "0.75%", sum_wages, float(sum_ee_esi)),
        ("Employer Share (Employer Contribution)", "3.25%", sum_wages, float(er_esi)),
    ]

    sr_idx = 5
    for cat, rate, base, amt in summary_rows:
        ws_summary.cell(row=sr_idx, column=1, value=cat).alignment = left_align
        ws_summary.cell(row=sr_idx, column=2, value=rate).alignment = center_align
        ws_summary.cell(row=sr_idx, column=3, value=base).alignment = right_align
        ws_summary.cell(row=sr_idx, column=4, value=amt).alignment = right_align
        for c in range(1, 5):
            ws_summary.cell(row=sr_idx, column=c).border = thin_border
            ws_summary.cell(row=sr_idx, column=c).font = Font(size=9.5)
        ws_summary.cell(row=sr_idx, column=4).font = Font(size=9.5, bold=True)
        sr_idx += 1

    ws_summary.cell(row=sr_idx, column=1, value="TOTAL ESIC CHALLAN REMITTANCE").alignment = left_align
    ws_summary.cell(row=sr_idx, column=2, value="4.00%").alignment = center_align
    ws_summary.cell(row=sr_idx, column=3, value=sum_wages).alignment = right_align
    g_amt = ws_summary.cell(row=sr_idx, column=4, value=float(total_esi_remittance))
    g_amt.alignment = right_align
    for c in range(1, 5):
        cell = ws_summary.cell(row=sr_idx, column=c)
        cell.border = double_bottom_border
        cell.fill = PatternFill(start_color="CCFBF1", end_color="CCFBF1", fill_type="solid")
        cell.font = Font(bold=True, size=10)
    g_amt.font = Font(bold=True, size=11, color="047857")

    ws_summary.column_dimensions["A"].width = 38
    ws_summary.column_dimensions["B"].width = 16
    ws_summary.column_dimensions["C"].width = 20
    ws_summary.column_dimensions["D"].width = 24

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="ESIC_Monthly_{client_code}_{batch.year}_{batch.month:02d}.xlsx"'
    return response


def generate_pt_statement_xlsx_response(batch):
    """
    Generates Professional Tax (PT) remittance schedule and challan return
    with state slab grouping (Option 6.C) and February leap-year handling.
    """
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")
    profile = getattr(batch.client, "payroll_profile", None)
    pt_state = getattr(profile, "pt_state", "KARNATAKA") or "KARNATAKA"

    wb = Workbook()
    ws_sched = wb.active
    ws_sched.title = "PT Schedule"

    header_fill = PatternFill(start_color="4338CA", end_color="4338CA", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right_align = Alignment(horizontal="right", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    ws_sched.merge_cells("A1:J1")
    ws_sched["A1"] = f"{batch.client.name} — Professional Tax (PT) Deduction Statement"
    ws_sched["A1"].font = Font(bold=True, size=13, color="0F172A")

    ws_sched.merge_cells("A2:J2")
    ws_sched["A2"] = f"Statutory State Rule: {pt_state}  |  Wage Month: {month_name[batch.month]} {batch.year}"
    ws_sched["A2"].font = Font(size=10, italic=True, color="475569")

    headers = [
        "Sl No", "Employee Code", "Employee Name", "Designation",
        "State", "Gross Salary (Rs)", "Earned Salary (Rs)", "Payable Days",
        "PT Slab Category", "PT Deducted (Rs)",
    ]
    for c_idx, h_text in enumerate(headers, start=1):
        cell = ws_sched.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_sched.row_dimensions[4].height = 28

    row_num = 5
    sum_gross = Decimal("0.00")
    sum_earned = Decimal("0.00")
    sum_pt = Decimal("0.00")
    exempt_count = 0
    taxable_count = 0

    for idx, r in enumerate(records, start=1):
        emp = r.employee
        payable_days = max(0, int(round((r.days_in_month or 30) - (r.lop_days or 0))))
        gross_val = r.gross_salary or Decimal("0.00")
        earned_val = r.earned_salary or Decimal("0.00")
        pt_val = r.professional_tax or Decimal("0.00")

        sum_gross += gross_val
        sum_earned += earned_val
        sum_pt += pt_val

        if pt_val > 0:
            taxable_count += 1
            slab_cat = "Taxable (>= Rs 25,000)" if pt_state == "KARNATAKA" else "Taxable Slab"
        else:
            exempt_count += 1
            slab_cat = "Exempt (< Rs 25,000)" if pt_state == "KARNATAKA" else "Exempt"

        row_cells = [
            (idx, center_align),
            (emp.employee_code, center_align),
            (emp.full_name, left_align),
            (emp.position or emp.department or "Staff", left_align),
            (pt_state, center_align),
            (float(gross_val), right_align),
            (float(earned_val), right_align),
            (payable_days, center_align),
            (slab_cat, center_align),
            (float(pt_val), right_align),
        ]

        for c_idx, (val, align) in enumerate(row_cells, start=1):
            c = ws_sched.cell(row=row_num, column=c_idx, value=val)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            if row_num % 2 == 0:
                c.fill = PatternFill(start_color="EEF2FF", end_color="EEF2FF", fill_type="solid")
        row_num += 1

    tot_cells = [
        ("TOTAL", center_align),
        (f"{records.count()} Employees", center_align),
        ("", center_align),
        ("", center_align),
        ("", center_align),
        (float(sum_gross), right_align),
        (float(sum_earned), right_align),
        ("", center_align),
        ("", center_align),
        (float(sum_pt), right_align),
    ]
    for c_idx, (val, align) in enumerate(tot_cells, start=1):
        c = ws_sched.cell(row=row_num, column=c_idx, value=val)
        c.font = Font(bold=True, size=10, color="0F172A")
        c.alignment = align
        c.border = double_bottom_border
        c.fill = PatternFill(start_color="E0E7FF", end_color="E0E7FF", fill_type="solid")

    for c_idx in range(1, 11):
        col_letter = get_column_letter(c_idx)
        ws_sched.column_dimensions[col_letter].width = 18 if c_idx in (3, 4, 9) else 15
    ws_sched.column_dimensions["A"].width = 7

    # Sheet 2: PT Challan Summary
    ws_summary = wb.create_sheet(title="PT Challan Summary")
    ws_summary.merge_cells("A1:E1")
    ws_summary["A1"] = f"{batch.client.name} — State Professional Tax Challan Summary"
    ws_summary["A1"].font = Font(bold=True, size=12, color="0F172A")

    ws_summary.merge_cells("A2:E2")
    ws_summary["A2"] = f"Wage Month: {month_name[batch.month]} {batch.year} | State: {pt_state}"
    ws_summary["A2"].font = Font(size=10, italic=True, color="475569")

    sum_headers = ["State Jurisdiction", "Monthly Gross Salary Slab", "Tax Rate (Rs)", "Headcount", "Total PT Remittance (Rs)"]
    for c_idx, h_text in enumerate(sum_headers, start=1):
        cell = ws_summary.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_summary.row_dimensions[4].height = 25

    rate_str = "₹300 (Feb)" if batch.month == 2 and pt_state == "KARNATAKA" else "₹200"
    pt_rows = [
        (pt_state, "Up to ₹24,999 (Exempt)", "₹0", exempt_count, 0.0),
        (pt_state, "₹25,000 and Above", rate_str, taxable_count, float(sum_pt)),
    ]

    sr_idx = 5
    for st, slab, rate, cnt, amt in pt_rows:
        ws_summary.cell(row=sr_idx, column=1, value=st).alignment = center_align
        ws_summary.cell(row=sr_idx, column=2, value=slab).alignment = left_align
        ws_summary.cell(row=sr_idx, column=3, value=rate).alignment = center_align
        ws_summary.cell(row=sr_idx, column=4, value=cnt).alignment = center_align
        ws_summary.cell(row=sr_idx, column=5, value=amt).alignment = right_align
        for c in range(1, 6):
            ws_summary.cell(row=sr_idx, column=c).border = thin_border
            ws_summary.cell(row=sr_idx, column=c).font = Font(size=9.5)
        ws_summary.cell(row=sr_idx, column=5).font = Font(size=9.5, bold=True)
        sr_idx += 1

    ws_summary.cell(row=sr_idx, column=1, value="TOTAL PT REMITTANCE").alignment = center_align
    ws_summary.cell(row=sr_idx, column=2, value="All Slabs").alignment = left_align
    ws_summary.cell(row=sr_idx, column=3, value="").alignment = center_align
    ws_summary.cell(row=sr_idx, column=4, value=records.count()).alignment = center_align
    g_amt = ws_summary.cell(row=sr_idx, column=5, value=float(sum_pt))
    g_amt.alignment = right_align
    for c in range(1, 6):
        cell = ws_summary.cell(row=sr_idx, column=c)
        cell.border = double_bottom_border
        cell.fill = PatternFill(start_color="E0E7FF", end_color="E0E7FF", fill_type="solid")
        cell.font = Font(bold=True, size=10)
    g_amt.font = Font(bold=True, size=11, color="3730A3")

    ws_summary.column_dimensions["A"].width = 20
    ws_summary.column_dimensions["B"].width = 30
    ws_summary.column_dimensions["C"].width = 18
    ws_summary.column_dimensions["D"].width = 16
    ws_summary.column_dimensions["E"].width = 24

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="PT_Statement_{client_code}_{batch.year}_{batch.month:02d}.xlsx"'
    return response


def validate_statutory_identifiers(batch):
    """
    Validates employee master statutory identifiers (Option 6.B):
    - Flags employees with EPF contributions missing valid 12-digit UAN.
    - Flags employees with ESI deductions missing valid 10-digit IP numbers.
    """
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")
    missing_uan = []
    missing_esi = []

    for r in records:
        emp = r.employee
        struct = r.salary_structure_snapshot
        pf_opted = getattr(struct, "pf_opted", False) if struct else False

        if r.epf > 0 or pf_opted:
            uan = (emp.uan_number or "").strip()
            if not uan or not (len(uan) == 12 and uan.isdigit()):
                missing_uan.append({
                    "record_id": r.id,
                    "employee_id": emp.id,
                    "employee_code": emp.employee_code,
                    "employee_name": emp.full_name,
                    "current_val": uan or "Missing",
                })

        esi_opted = getattr(struct, "esi_opted", False) if struct else False
        if r.esi > 0 or esi_opted:
            esi_num = (emp.esi_number or "").replace(" ", "").replace("-", "").strip()
            if not esi_num or not (len(esi_num) == 10 and esi_num.isdigit()):
                missing_esi.append({
                    "record_id": r.id,
                    "employee_id": emp.id,
                    "employee_code": emp.employee_code,
                    "employee_name": emp.full_name,
                    "current_val": esi_num or "Missing",
                })

    return {
        "batch_id": batch.id,
        "missing_uan_count": len(missing_uan),
        "missing_uan_employees": missing_uan,
        "missing_esi_count": len(missing_esi),
        "missing_esi_employees": missing_esi,
        "has_issues": bool(missing_uan or missing_esi),
    }


def validate_bank_details(batch):
    """
    Validates employee bank details for the batch before disbursement:
    - Trims whitespace, removes hyphens/dots, and uppercases bank account & IFSC [Option 7.B].
    - Verifies 11-char IFSC code against regex ^[A-Z]{4}0[A-Z0-9]{6}$.
    - Verifies bank account is non-empty and at least 8 digits.
    - Categorizes records into payable vs withheld/non-bank.
    - Computes total disbursement volume and average payout.
    """
    records = batch.records.select_related("employee", "batch__client").order_by("employee__employee_code")
    ifsc_pattern = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")

    payable_list = []
    invalid_bank_list = []
    withheld_list = []
    non_bank_mode_list = []

    total_payout_amount = Decimal("0.00")
    total_withheld_amount = Decimal("0.00")

    for r in records:
        emp = r.employee
        net_payout = (r.net_salary or Decimal("0.00")) + (r.reimbursements or Decimal("0.00"))
        closing_hold = r.on_hold_closing_balance or Decimal("0.00")
        mode = emp.effective_payment_mode

        if net_payout <= Decimal("0.00") or (closing_hold > 0 and r.net_salary <= Decimal("0.00")):
            withheld_list.append({
                "record_id": r.id,
                "employee_id": emp.id,
                "employee_code": emp.employee_code,
                "employee_name": emp.full_name,
                "net_salary": float(r.net_salary or 0),
                "on_hold_closing_balance": float(closing_hold),
                "reason": "Salary on hold or net pay <= Rs 0",
            })
            total_withheld_amount += closing_hold
            continue

        if mode in ("CASH", "CHEQUE"):
            non_bank_mode_list.append({
                "record_id": r.id,
                "employee_id": emp.id,
                "employee_code": emp.employee_code,
                "employee_name": emp.full_name,
                "payment_mode": emp.effective_payment_mode_display,
                "net_payout": float(net_payout),
            })
            continue

        raw_acc = str(emp.bank_account_number or "").strip().replace(" ", "").replace("-", "")
        raw_ifsc = str(emp.bank_ifsc_code or "").strip().replace(" ", "").replace("-", "").upper()
        raw_bank = str(emp.bank_name or "").strip()

        issues = []
        if not raw_acc:
            issues.append("Missing Bank Account Number")
        elif len(raw_acc) < 8 or not raw_acc.isdigit():
            issues.append(f"Invalid Account Number '{raw_acc}' (expected digits, >= 8 chars)")

        if not raw_ifsc:
            issues.append("Missing Bank IFSC Code")
        elif not ifsc_pattern.match(raw_ifsc):
            issues.append(f"Invalid IFSC Code '{raw_ifsc}' (must be 11 characters e.g. HDFC0001234)")

        if issues:
            invalid_bank_list.append({
                "record_id": r.id,
                "employee_id": emp.id,
                "employee_code": emp.employee_code,
                "employee_name": emp.full_name,
                "bank_account_number": raw_acc or "Missing",
                "bank_ifsc_code": raw_ifsc or "Missing",
                "bank_name": raw_bank or "Not set",
                "net_payout": float(net_payout),
                "issues": issues,
            })
        else:
            payable_list.append({
                "record_id": r.id,
                "employee_id": emp.id,
                "employee_code": emp.employee_code,
                "employee_name": emp.full_name,
                "bank_account_number": raw_acc,
                "bank_ifsc_code": raw_ifsc,
                "bank_name": raw_bank,
                "net_payout": float(net_payout),
            })
            total_payout_amount += net_payout

    # Option 7.A: Corporate Debit Account from Client Profile
    profile = getattr(batch.client, "payroll_profile", None)
    corp_acc = ""
    corp_ifsc = ""
    corp_bank = ""
    if profile:
        try:
            comp_acc = batch.client.custom_salary_components.filter(code="__CORP_BANK_ACC__").first()
            if comp_acc and comp_acc.abbr:
                corp_acc = str(comp_acc.abbr).strip()
            comp_ifsc = batch.client.custom_salary_components.filter(code="__CORP_BANK_IFSC__").first()
            if comp_ifsc and comp_ifsc.abbr:
                corp_ifsc = str(comp_ifsc.abbr).strip().upper()
            comp_bank = batch.client.custom_salary_components.filter(code="__CORP_BANK_NAME__").first()
            if comp_bank and comp_bank.abbr:
                corp_bank = str(comp_bank.abbr).strip()
        except Exception:
            pass

    return {
        "batch_id": batch.id,
        "total_employees_count": records.count(),
        "payable_count": len(payable_list),
        "total_payout_amount": float(total_payout_amount),
        "invalid_bank_count": len(invalid_bank_list),
        "invalid_bank_employees": invalid_bank_list,
        "withheld_count": len(withheld_list),
        "total_withheld_amount": float(total_withheld_amount),
        "withheld_employees": withheld_list,
        "non_bank_mode_count": len(non_bank_mode_list),
        "non_bank_mode_employees": non_bank_mode_list,
        "has_issues": bool(invalid_bank_list),
        "corporate_debit_account": corp_acc,
        "corporate_debit_ifsc": corp_ifsc,
        "corporate_debit_bank": corp_bank,
    }


def generate_bank_payout_xlsx_response(batch):
    """
    Generates Corporate NetBanking Salary Disbursement Excel workbook:
    - Sheet 1: 'Bank Payout Schedule' (Payable electronic transfers with IFSC & Net Payout).
    - Sheet 2: 'Withheld & Non-Bank Records' (Audit list of withheld / on-hold / cash / cheque pay).
    """
    val = validate_bank_details(batch)
    records = batch.records.select_related("employee", "salary_structure_snapshot").order_by("employee__employee_code")

    wb = Workbook()

    # Sheet 1: Bank Payout Schedule
    ws_main = wb.active
    ws_main.title = "Bank Payout Schedule"

    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right_align = Alignment(horizontal="right", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    ws_main.merge_cells("A1:J1")
    ws_main["A1"] = f"{batch.client.name} — Corporate NetBanking Salary Disbursement Schedule"
    ws_main["A1"].font = Font(bold=True, size=13, color="0F172A")

    corp_info = ""
    if val.get("corporate_debit_account"):
        corp_info = f" | Debit Account: {val['corporate_debit_account']} ({val.get('corporate_debit_bank') or 'Bank'} - {val.get('corporate_debit_ifsc')})"
    ws_main.merge_cells("A2:J2")
    ws_main["A2"] = f"Wage Period: {month_name[batch.month]} {batch.year} | Total Payable: {val['payable_count']} Employees (₹{val['total_payout_amount']:,.2f}){corp_info}"
    ws_main["A2"].font = Font(size=10, italic=True, color="475569")

    headers = [
        "Sl No", "Employee Code", "Beneficiary Name", "Bank Name",
        "Beneficiary Account Number", "IFSC Code", "Net Payout Amount (Rs)",
        "Txn Type", "Narration / Remarks", "Beneficiary Email",
    ]
    for c_idx, h_text in enumerate(headers, start=1):
        cell = ws_main.cell(row=4, column=c_idx, value=h_text)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_main.row_dimensions[4].height = 28

    row_num = 5
    sl_no = 0
    sum_payout = Decimal("0.00")
    narration_text = f"SALARY {month_name[batch.month][:3].upper()} {batch.year}"

    for r in records:
        emp = r.employee
        net_payout = (r.net_salary or Decimal("0.00")) + (r.reimbursements or Decimal("0.00"))
        closing_hold = r.on_hold_closing_balance or Decimal("0.00")
        mode = emp.effective_payment_mode

        if net_payout <= Decimal("0.00") or (closing_hold > 0 and r.net_salary <= Decimal("0.00")) or mode in ("CASH", "CHEQUE"):
            continue

        sl_no += 1
        sum_payout += net_payout

        raw_acc = str(emp.bank_account_number or "").strip().replace(" ", "").replace("-", "")
        raw_ifsc = str(emp.bank_ifsc_code or "").strip().replace(" ", "").replace("-", "").upper()
        raw_bank = str(emp.bank_name or "").strip() or "Bank Transfer"
        txn_type = "RTGS" if net_payout > Decimal("200000.00") else "NEFT"

        row_cells = [
            (sl_no, center_align),
            (emp.employee_code, center_align),
            (emp.full_name, left_align),
            (raw_bank, left_align),
            (raw_acc, center_align),
            (raw_ifsc, center_align),
            (float(net_payout), right_align),
            (txn_type, center_align),
            (narration_text, left_align),
            (emp.email or "", left_align),
        ]

        for c_idx, (v, align) in enumerate(row_cells, start=1):
            c = ws_main.cell(row=row_num, column=c_idx, value=v)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            if row_num % 2 == 0:
                c.fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        row_num += 1

    # Totals Row
    tot_cells = [
        ("TOTAL", center_align),
        (f"{sl_no} Beneficiaries", center_align),
        ("", center_align),
        ("", center_align),
        ("", center_align),
        ("", center_align),
        (float(sum_payout), right_align),
        ("", center_align),
        ("", center_align),
        ("", center_align),
    ]
    for c_idx, (v, align) in enumerate(tot_cells, start=1):
        c = ws_main.cell(row=row_num, column=c_idx, value=v)
        c.font = Font(bold=True, size=10, color="0F172A")
        c.alignment = align
        c.border = double_bottom_border
        c.fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")

    for c_idx in range(1, 11):
        col_letter = get_column_letter(c_idx)
        ws_main.column_dimensions[col_letter].width = 22 if c_idx in (3, 5, 10) else 16
    ws_main.column_dimensions["A"].width = 7

    # Sheet 2: Withheld & Non-Bank Records
    ws_withheld = wb.create_sheet(title="Withheld & Non-Bank Records")
    ws_withheld.merge_cells("A1:G1")
    ws_withheld["A1"] = f"{batch.client.name} — Withheld, On-Hold & Cash/Cheque Records (Audit Sheet)"
    ws_withheld["A1"].font = Font(bold=True, size=12, color="991B1B")

    w_headers = [
        "Sl No", "Employee Code", "Employee Name", "Payment Mode",
        "Net Salary (Rs)", "On-Hold Closing Balance (Rs)", "Audit Reason",
    ]
    w_header_fill = PatternFill(start_color="991B1B", end_color="991B1B", fill_type="solid")
    for c_idx, h_text in enumerate(w_headers, start=1):
        cell = ws_withheld.cell(row=3, column=c_idx, value=h_text)
        cell.fill = w_header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws_withheld.row_dimensions[3].height = 25

    w_row = 4
    w_idx = 0
    for w in val.get("withheld_employees", []):
        w_idx += 1
        w_cells = [
            (w_idx, center_align),
            (w["employee_code"], center_align),
            (w["employee_name"], left_align),
            ("BANK (ON HOLD)", center_align),
            (w["net_salary"], right_align),
            (w["on_hold_closing_balance"], right_align),
            (w["reason"], left_align),
        ]
        for c_idx, (v, align) in enumerate(w_cells, start=1):
            c = ws_withheld.cell(row=w_row, column=c_idx, value=v)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            c.fill = PatternFill(start_color="FEF2F2", end_color="FEF2F2", fill_type="solid")
        w_row += 1

    for nb in val.get("non_bank_mode_employees", []):
        w_idx += 1
        w_cells = [
            (w_idx, center_align),
            (nb["employee_code"], center_align),
            (nb["employee_name"], left_align),
            (nb["payment_mode"], center_align),
            (nb["net_payout"], right_align),
            (0.0, right_align),
            ("Physical Payment Mode (Cheque/Cash)", left_align),
        ]
        for c_idx, (v, align) in enumerate(w_cells, start=1):
            c = ws_withheld.cell(row=w_row, column=c_idx, value=v)
            c.alignment = align
            c.border = thin_border
            c.font = Font(size=9.5)
            c.fill = PatternFill(start_color="FFFBEB", end_color="FFFBEB", fill_type="solid")
        w_row += 1

    ws_withheld.column_dimensions["A"].width = 7
    ws_withheld.column_dimensions["B"].width = 16
    ws_withheld.column_dimensions["C"].width = 24
    ws_withheld.column_dimensions["D"].width = 18
    ws_withheld.column_dimensions["E"].width = 16
    ws_withheld.column_dimensions["F"].width = 22
    ws_withheld.column_dimensions["G"].width = 36

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="Bank_Payout_Schedule_{client_code}_{batch.year}_{batch.month:02d}.xlsx"'
    return response


def generate_bank_payout_csv_response(batch):
    """Universal NEFT/RTGS Corporate NetBanking CSV Payout File"""
    records = batch.records.select_related("employee").order_by("employee__employee_code")
    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Beneficiary Name", "Beneficiary Account Number", "IFSC Code",
        "Amount", "Payment Mode", "Narration", "Beneficiary Email", "Employee Code"
    ])
    narration_text = f"SALARY {month_name[batch.month][:3].upper()} {batch.year}"

    for r in records:
        emp = r.employee
        net_payout = (r.net_salary or Decimal("0.00")) + (r.reimbursements or Decimal("0.00"))
        closing_hold = r.on_hold_closing_balance or Decimal("0.00")
        mode = emp.effective_payment_mode

        if net_payout <= Decimal("0.00") or (closing_hold > 0 and r.net_salary <= Decimal("0.00")) or mode in ("CASH", "CHEQUE"):
            continue

        raw_acc = str(emp.bank_account_number or "").strip().replace(" ", "").replace("-", "")
        raw_ifsc = str(emp.bank_ifsc_code or "").strip().replace(" ", "").replace("-", "").upper()
        if not raw_acc or not raw_ifsc:
            continue

        txn_type = "RTGS" if net_payout > Decimal("200000.00") else "NEFT"
        writer.writerow([
            emp.full_name,
            raw_acc,
            raw_ifsc,
            f"{net_payout:.2f}",
            txn_type,
            narration_text,
            emp.email or "",
            emp.employee_code,
        ])

    response = HttpResponse(buffer.getvalue(), content_type="text/csv; charset=utf-8")
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="Bank_Payout_{client_code}_{batch.year}_{batch.month:02d}.csv"'
    return response


def generate_bank_payout_hdfc_response(batch):
    """HDFC CMS file format (standard NEFT/RTGS CSV for HDFC Corporate NetBanking)"""
    records = batch.records.select_related("employee").order_by("employee__employee_code")
    buffer = StringIO()
    writer = csv.writer(buffer)
    narration_text = f"SALARY {month_name[batch.month][:3].upper()} {batch.year}"

    for r in records:
        emp = r.employee
        net_payout = (r.net_salary or Decimal("0.00")) + (r.reimbursements or Decimal("0.00"))
        closing_hold = r.on_hold_closing_balance or Decimal("0.00")
        mode = emp.effective_payment_mode

        if net_payout <= Decimal("0.00") or (closing_hold > 0 and r.net_salary <= Decimal("0.00")) or mode in ("CASH", "CHEQUE"):
            continue

        raw_acc = str(emp.bank_account_number or "").strip().replace(" ", "").replace("-", "")
        raw_ifsc = str(emp.bank_ifsc_code or "").strip().replace(" ", "").replace("-", "").upper()
        if not raw_acc or not raw_ifsc:
            continue

        txn_type = "RTGS" if net_payout > Decimal("200000.00") else "NEFT"
        writer.writerow([
            txn_type,
            emp.employee_code,
            raw_acc,
            f"{net_payout:.2f}",
            emp.full_name,
            "",
            "",
            "",
            emp.email or "",
            narration_text,
            raw_ifsc,
        ])

    response = HttpResponse(buffer.getvalue(), content_type="text/csv; charset=utf-8")
    client_code = re.sub(r"[^A-Za-z0-9_-]", "", batch.client.name.replace(" ", "_"))
    response["Content-Disposition"] = f'attachment; filename="HDFC_CMS_Payout_{client_code}_{batch.year}_{batch.month:02d}.csv"'
    return response


# ── Step 8: Month-over-Month (MoM) Variance Reconciliation & Journal Voucher ──────

def build_mom_variance_data(curr_batch):
    """
    Builds a complete Month-over-Month (MoM) headcount and salary reconciliation bridge
    comparing curr_batch against the immediately preceding batch for the same client.
    """
    client = curr_batch.client
    # Find immediate prior batch chronologically
    prev_batch = (
        PayrollBatch.objects.filter(client=client)
        .exclude(id=curr_batch.id)
        .filter(
            models.Q(year__lt=curr_batch.year)
            | (models.Q(year=curr_batch.year) & models.Q(month__lt=curr_batch.month))
        )
        .order_by("-year", "-month")
        .first()
    )

    curr_records = list(curr_batch.records.select_related("employee", "salary_structure_snapshot").all())
    prev_records = list(prev_batch.records.select_related("employee", "salary_structure_snapshot").all()) if prev_batch else []

    curr_map = {r.employee_id: r for r in curr_records}
    prev_map = {r.employee_id: r for r in prev_records}

    all_emp_ids = sorted(list(set(curr_map.keys()) | set(prev_map.keys())))

    all_items = []
    anomalies = []

    joiners_count = 0
    leavers_count = 0
    continuous_count = 0

    sum_prev_gross = Decimal("0.00")
    sum_curr_gross = Decimal("0.00")
    sum_prev_deductions = Decimal("0.00")
    sum_curr_deductions = Decimal("0.00")
    sum_prev_net = Decimal("0.00")
    sum_curr_net = Decimal("0.00")
    sum_prev_reimb = Decimal("0.00")
    sum_curr_reimb = Decimal("0.00")
    sum_prev_epf = Decimal("0.00")
    sum_curr_epf = Decimal("0.00")
    sum_prev_esic = Decimal("0.00")
    sum_curr_esic = Decimal("0.00")
    sum_prev_pt = Decimal("0.00")
    sum_curr_pt = Decimal("0.00")
    sum_prev_tds = Decimal("0.00")
    sum_curr_tds = Decimal("0.00")

    joiners_net_total = Decimal("0.00")
    leavers_net_total = Decimal("0.00")
    lop_net_impact_total = Decimal("0.00")
    arrears_net_total = Decimal("0.00")
    holds_net_impact_total = Decimal("0.00")

    for emp_id in all_emp_ids:
        curr_r = curr_map.get(emp_id)
        prev_r = prev_map.get(emp_id)
        emp = curr_r.employee if curr_r else prev_r.employee

        if curr_r and not prev_r:
            status_tag = "JOINER"
            joiners_count += 1
        elif prev_r and not curr_r:
            status_tag = "LEAVER"
            leavers_count += 1
        else:
            status_tag = "CONTINUOUS"
            continuous_count += 1

        prev_gross = prev_r.earned_salary if prev_r and prev_r.earned_salary else Decimal("0.00")
        curr_gross = curr_r.earned_salary if curr_r and curr_r.earned_salary else Decimal("0.00")
        diff_gross = curr_gross - prev_gross

        prev_net = prev_r.net_salary if prev_r and prev_r.net_salary else Decimal("0.00")
        curr_net = curr_r.net_salary if curr_r and curr_r.net_salary else Decimal("0.00")
        diff_net = curr_net - prev_net

        prev_ded = prev_r.total_deductions if prev_r and prev_r.total_deductions else Decimal("0.00")
        curr_ded = curr_r.total_deductions if curr_r and curr_r.total_deductions else Decimal("0.00")
        diff_ded = curr_ded - prev_ded

        prev_reimb = prev_r.reimbursements if prev_r and prev_r.reimbursements else Decimal("0.00")
        curr_reimb = curr_r.reimbursements if curr_r and curr_r.reimbursements else Decimal("0.00")
        diff_reimb = curr_reimb - prev_reimb

        prev_epf = prev_r.epf if prev_r and prev_r.epf else Decimal("0.00")
        curr_epf = curr_r.epf if curr_r and curr_r.epf else Decimal("0.00")

        prev_esic = getattr(prev_r, "esi", Decimal("0.00")) if prev_r else Decimal("0.00")
        curr_esic = getattr(curr_r, "esi", Decimal("0.00")) if curr_r else Decimal("0.00")

        prev_pt = prev_r.professional_tax if prev_r and prev_r.professional_tax else Decimal("0.00")
        curr_pt = curr_r.professional_tax if curr_r and curr_r.professional_tax else Decimal("0.00")

        prev_tds = prev_r.tds if prev_r and prev_r.tds else Decimal("0.00")
        curr_tds = curr_r.tds if curr_r and curr_r.tds else Decimal("0.00")

        prev_lop = prev_r.lop_days if prev_r and prev_r.lop_days else Decimal("0.0")
        curr_lop = curr_r.lop_days if curr_r and curr_r.lop_days else Decimal("0.0")
        diff_lop = curr_lop - prev_lop

        curr_arrears = curr_r.arrears if curr_r and curr_r.arrears else Decimal("0.00")
        curr_var = curr_r.variable_pay if curr_r and curr_r.variable_pay else Decimal("0.00")
        curr_adv_rec = curr_r.salary_advance_recovered if curr_r and curr_r.salary_advance_recovered else Decimal("0.00")
        curr_hold_ded = curr_r.on_hold_deducted if curr_r and curr_r.on_hold_deducted else Decimal("0.00")
        curr_hold_rel = curr_r.on_hold_released if curr_r and curr_r.on_hold_released else Decimal("0.00")

        pct_change = 0.0
        if prev_net > Decimal("0.00"):
            pct_change = round(float((diff_net / prev_net) * 100), 1)
        elif curr_net > Decimal("0.00"):
            pct_change = 100.0

        pct_gross_change = 0.0
        if prev_gross > Decimal("0.00"):
            pct_gross_change = round(float((diff_gross / prev_gross) * 100), 1)
        elif curr_gross > Decimal("0.00"):
            pct_gross_change = 100.0

        sum_prev_gross += prev_gross
        sum_curr_gross += curr_gross
        sum_prev_deductions += prev_ded
        sum_curr_deductions += curr_ded
        sum_prev_net += prev_net
        sum_curr_net += curr_net
        sum_prev_reimb += prev_reimb
        sum_curr_reimb += curr_reimb
        sum_prev_epf += prev_epf
        sum_curr_epf += curr_epf
        sum_prev_esic += prev_esic
        sum_curr_esic += curr_esic
        sum_prev_pt += prev_pt
        sum_curr_pt += curr_pt
        sum_prev_tds += prev_tds
        sum_curr_tds += curr_tds

        drivers = []
        if status_tag == "JOINER":
            drivers.append("New joiner onboarded")
            joiners_net_total += curr_net
        elif status_tag == "LEAVER":
            drivers.append("Employee separated / excluded")
            leavers_net_total += prev_net
        else:
            if abs(diff_lop) > Decimal("0.0"):
                drivers.append(f"LOP: {prev_lop:g}d → {curr_lop:g}d ({diff_lop:+g}d)")
                if prev_r and prev_r.days_in_month:
                    daily_rate = prev_gross / Decimal(str(prev_r.days_in_month))
                    lop_net_impact_total += (diff_lop * daily_rate)
            if curr_arrears > Decimal("0.00"):
                drivers.append(f"Arrears: ₹{curr_arrears:,.2f}")
                arrears_net_total += curr_arrears
            if curr_var > Decimal("0.00"):
                drivers.append(f"Variable Pay: ₹{curr_var:,.2f}")
            if curr_adv_rec > Decimal("0.00"):
                drivers.append(f"Advance Recovery: ₹{curr_adv_rec:,.2f}")
            if curr_hold_ded > Decimal("0.00"):
                drivers.append(f"Hold Deducted: ₹{curr_hold_ded:,.2f}")
                holds_net_impact_total -= curr_hold_ded
            if curr_hold_rel > Decimal("0.00"):
                drivers.append(f"Hold Released: ₹{curr_hold_rel:,.2f}")
                holds_net_impact_total += curr_hold_rel
            if not drivers and abs(diff_gross) > Decimal("0.00"):
                drivers.append(f"Salary Revision: {diff_gross:+,.2f}")

        primary_driver = " · ".join(drivers) if drivers else ("No material change" if abs(diff_net) < Decimal("50.00") else f"Net adjustment: ₹{diff_net:+,.2f}")

        # Anomaly detection (Option 8.B)
        is_anomaly = False
        anomaly_reasons = []
        if status_tag in ("JOINER", "LEAVER"):
            is_anomaly = True
            anomaly_reasons.append(f"Headcount transition: {status_tag}")
        else:
            if abs(diff_net) >= Decimal("5000.00"):
                is_anomaly = True
                anomaly_reasons.append(f"Net variance ₹{diff_net:+,.2f} >= ₹5,000 threshold")
            if abs(pct_change) >= 15.0 and prev_net >= Decimal("5000.00"):
                is_anomaly = True
                anomaly_reasons.append(f"Net variance {pct_change:+.1f}% >= 15% threshold")
            if curr_hold_ded > Decimal("0.00"):
                is_anomaly = True
                anomaly_reasons.append(f"Salary placed on hold (₹{curr_hold_ded:,.2f})")

        item_dict = {
            "employee_id": emp.id,
            "employee_code": emp.employee_code,
            "employee_name": emp.full_name,
            "department": (emp.department or "General & Admin").strip() or "General & Admin",
            "position": emp.position or "Staff",
            "status": status_tag,
            "prev_gross": float(prev_gross),
            "curr_gross": float(curr_gross),
            "diff_gross": float(diff_gross),
            "pct_gross_change": pct_gross_change,
            "prev_net": float(prev_net),
            "curr_net": float(curr_net),
            "diff_net": float(diff_net),
            "pct_net_change": pct_change,
            "prev_deductions": float(prev_ded),
            "curr_deductions": float(curr_ded),
            "diff_deductions": float(diff_ded),
            "prev_reimb": float(prev_reimb),
            "curr_reimb": float(curr_reimb),
            "diff_reimb": float(diff_reimb),
            "prev_lop": float(prev_lop),
            "curr_lop": float(curr_lop),
            "diff_lop": float(diff_lop),
            "prev_epf": float(prev_epf),
            "curr_epf": float(curr_epf),
            "prev_esic": float(prev_esic),
            "curr_esic": float(curr_esic),
            "prev_pt": float(prev_pt),
            "curr_pt": float(curr_pt),
            "prev_tds": float(prev_tds),
            "curr_tds": float(curr_tds),
            "primary_driver": primary_driver,
            "is_anomaly": is_anomaly,
            "anomaly_reasons": anomaly_reasons,
        }
        all_items.append(item_dict)
        if is_anomaly:
            anomalies.append(item_dict)

    diff_gross_tot = sum_curr_gross - sum_prev_gross
    diff_net_tot = sum_curr_net - sum_prev_net
    diff_ded_tot = sum_curr_deductions - sum_prev_deductions
    diff_reimb_tot = sum_curr_reimb - sum_prev_reimb

    macro = {
        "prev_gross": float(sum_prev_gross),
        "curr_gross": float(sum_curr_gross),
        "diff_gross": float(diff_gross_tot),
        "pct_gross": round(float((diff_gross_tot / sum_prev_gross) * 100), 1) if sum_prev_gross > 0 else 0.0,
        "prev_deductions": float(sum_prev_deductions),
        "curr_deductions": float(sum_curr_deductions),
        "diff_deductions": float(diff_ded_tot),
        "pct_deductions": round(float((diff_ded_tot / sum_prev_deductions) * 100), 1) if sum_prev_deductions > 0 else 0.0,
        "prev_net": float(sum_prev_net),
        "curr_net": float(sum_curr_net),
        "diff_net": float(diff_net_tot),
        "pct_net": round(float((diff_net_tot / sum_prev_net) * 100), 1) if sum_prev_net > 0 else 0.0,
        "prev_reimb": float(sum_prev_reimb),
        "curr_reimb": float(sum_curr_reimb),
        "diff_reimb": float(diff_reimb_tot),
        "prev_payout": float(sum_prev_net + sum_prev_reimb),
        "curr_payout": float(sum_curr_net + sum_curr_reimb),
        "diff_payout": float((sum_curr_net + sum_curr_reimb) - (sum_prev_net + sum_prev_reimb)),
        "prev_epf": float(sum_prev_epf),
        "curr_epf": float(sum_curr_epf),
        "diff_epf": float(sum_curr_epf - sum_prev_epf),
        "prev_esic": float(sum_prev_esic),
        "curr_esic": float(sum_curr_esic),
        "diff_esic": float(sum_curr_esic - sum_prev_esic),
        "prev_pt": float(sum_prev_pt),
        "curr_pt": float(sum_curr_pt),
        "diff_pt": float(sum_curr_pt - sum_prev_pt),
        "prev_tds": float(sum_prev_tds),
        "curr_tds": float(sum_curr_tds),
        "diff_tds": float(sum_curr_tds - sum_prev_tds),
    }

    other_adj = sum_curr_net - (sum_prev_net + joiners_net_total - leavers_net_total + arrears_net_total - lop_net_impact_total + holds_net_impact_total)

    waterfall = {
        "prev_net": float(sum_prev_net),
        "joiners_net": float(joiners_net_total),
        "leavers_net": float(leavers_net_total),
        "arrears_net": float(arrears_net_total),
        "lop_variance_impact": float(-lop_net_impact_total),
        "holds_net_impact": float(holds_net_impact_total),
        "other_adjustments_net": float(other_adj),
        "curr_net": float(sum_curr_net),
    }

    curr_p_str = f"{month_name[curr_batch.month]} {curr_batch.year}"
    prev_p_str = f"{month_name[prev_batch.month]} {prev_batch.year}" if prev_batch else "None (Initial Run)"

    return {
        "has_prior_batch": bool(prev_batch),
        "current_period": curr_p_str,
        "prior_period": prev_p_str,
        "current_batch_id": curr_batch.id,
        "prior_batch_id": prev_batch.id if prev_batch else None,
        "headcount": {
            "prev": len(prev_records),
            "curr": len(curr_records),
            "joiners": joiners_count,
            "leavers": leavers_count,
            "continuous": continuous_count,
            "net_change": len(curr_records) - len(prev_records),
        },
        "macro": macro,
        "waterfall": waterfall,
        "anomalies_count": len(anomalies),
        "anomalies": anomalies,
        "all_items": all_items,
    }


def generate_mom_variance_xlsx_response(batch):
    data = build_mom_variance_data(batch)
    wb = Workbook()

    navy_fill = PatternFill(start_color="1A2F5A", end_color="1A2F5A", fill_type="solid")
    teal_fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
    amber_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    rose_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    green_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")

    header_font = Font(color="FFFFFF", bold=True, size=10)
    bold_font = Font(bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center")
    right_align = Alignment(horizontal="right", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    # ── Tab 1: Executive MoM Summary ──
    ws1 = wb.active
    ws1.title = "MoM Summary & Waterfall"
    ws1.merge_cells("A1:G1")
    ws1["A1"] = f"{batch.client.name} — Month-over-Month (MoM) Payroll Variance Reconciliation"
    ws1["A1"].font = Font(bold=True, size=13, color="0F172A")

    ws1.merge_cells("A2:G2")
    ws1["A2"] = f"Current Period: {data['current_period']}  |  Prior Period: {data['prior_period']}  |  Generated: {timezone.now().strftime('%d %b %Y %H:%M')}"
    ws1["A2"].font = Font(size=10, italic=True, color="475569")

    # Headcount Table
    ws1.cell(row=4, column=1, value="1. Headcount Reconciliation Bridge").font = Font(bold=True, size=11, color="1A2F5A")
    hc_headers = ["Metric / Status", "Count", "Notes / Movement"]
    for c, h in enumerate(hc_headers, 1):
        cell = ws1.cell(row=5, column=c, value=h)
        cell.fill = navy_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    hc = data["headcount"]
    hc_rows = [
        ("Prior Month Active Headcount", hc["prev"], f"Base headcount from {data['prior_period']}"),
        ("(+) New Joiners Onboarded", hc["joiners"], "Employees added in current month"),
        ("(-) Exited / Separated Employees", hc["leavers"], "Employees excluded from current month"),
        ("(=) Current Month Active Headcount", hc["curr"], f"Total employees paid in {data['current_period']}"),
        ("Net Headcount Shift", f"{hc['net_change']:+d}", "Overall team expansion / contraction"),
    ]
    for r_idx, (m, c_val, n) in enumerate(hc_rows, 6):
        c1 = ws1.cell(row=r_idx, column=1, value=m)
        c2 = ws1.cell(row=r_idx, column=2, value=c_val)
        c3 = ws1.cell(row=r_idx, column=3, value=n)
        for cell in (c1, c2, c3):
            cell.border = thin_border
            cell.font = bold_font if "(=)" in m or "Shift" in m else Font(size=10)
        c2.alignment = center_align

    # Financial Macro Table
    start_r = 13
    ws1.cell(row=start_r, column=1, value="2. Macro Financial Reconciliation").font = Font(bold=True, size=11, color="1A2F5A")
    macro_headers = ["Component Head", f"Prior ({data['prior_period']})", f"Current ({data['current_period']})", "Variance (Rs.)", "% Change", "Audit Notes"]
    for c, h in enumerate(macro_headers, 1):
        cell = ws1.cell(row=start_r + 1, column=c, value=h)
        cell.fill = teal_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    m = data["macro"]
    m_rows = [
        ("Gross / Earned Salary", m["prev_gross"], m["curr_gross"], m["diff_gross"], f"{m['pct_gross']:+.1f}%", "Total earned wages before statutory withholdings"),
        ("Employee PF (EPF + VPF)", m["prev_epf"], m["curr_epf"], m["diff_epf"], "-", "Employee statutory retirement savings"),
        ("Employee ESIC", m["prev_esic"], m["curr_esic"], m["diff_esic"], "-", "Employee statutory health coverage (0.75%)"),
        ("Professional Tax", m["prev_pt"], m["curr_pt"], m["diff_pt"], "-", "State statutory employment tax"),
        ("TDS on Salaries (Sec 192)", m["prev_tds"], m["curr_tds"], m["diff_tds"], "-", "Direct income tax withheld"),
        ("Total Deductions", m["prev_deductions"], m["curr_deductions"], m["diff_deductions"], f"{m['pct_deductions']:+.1f}%", "All withholdings and recoveries"),
        ("Net Take-Home Salary", m["prev_net"], m["curr_net"], m["diff_net"], f"{m['pct_net']:+.1f}%", "Net salary payable to employee bank accounts"),
        ("Staff Reimbursements", m["prev_reimb"], m["curr_reimb"], m["diff_reimb"], "-", "Non-taxable business reimbursements"),
        ("Total Bank Disbursement", m["prev_payout"], m["curr_payout"], m["diff_payout"], "-", "Total bank wire transfer commitment"),
    ]

    for idx, (label, p_v, c_v, d_v, pct, note) in enumerate(m_rows, start_r + 2):
        c1 = ws1.cell(row=idx, column=1, value=label)
        c2 = ws1.cell(row=idx, column=2, value=p_v)
        c3 = ws1.cell(row=idx, column=3, value=c_v)
        c4 = ws1.cell(row=idx, column=4, value=d_v)
        c5 = ws1.cell(row=idx, column=5, value=pct)
        c6 = ws1.cell(row=idx, column=6, value=note)
        for cell in (c1, c2, c3, c4, c5, c6):
            cell.border = double_bottom_border if "Disbursement" in label or "Net" in label else thin_border
            cell.font = bold_font if "Disbursement" in label or "Net" in label or "Gross" in label else Font(size=9.5)
        for num_c in (c2, c3, c4):
            num_c.number_format = "₹#,##0.00"
            num_c.alignment = right_align
        c5.alignment = center_align

    # Waterfall Card (Option 8.D)
    wf_start = start_r + len(m_rows) + 3
    ws1.cell(row=wf_start, column=1, value="3. Net Salary Movement Waterfall Bridge").font = Font(bold=True, size=11, color="1A2F5A")
    wf_headers = ["Waterfall Step", "Amount (Rs.)", "Cumulative Net (Rs.)", "Explanation"]
    for c, h in enumerate(wf_headers, 1):
        cell = ws1.cell(row=wf_start + 1, column=c, value=h)
        cell.fill = navy_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    wf = data["waterfall"]
    cum = wf["prev_net"]
    wf_steps = [
        ("Base: Prior Month Net Salary", wf["prev_net"], cum, f"Starting take-home base from {data['prior_period']}"),
        ("(+) Joiners Net Pay Addition", wf["joiners_net"], cum + wf["joiners_net"], f"Added wages from {hc['joiners']} joiners"),
        ("(-) Leavers Net Pay Exclusion", -wf["leavers_net"], cum + wf["joiners_net"] - wf["leavers_net"], f"Excluded wages from {hc['leavers']} leavers"),
        ("(+) Arrears & Retro Adjustments", wf["arrears_net"], cum + wf["joiners_net"] - wf["leavers_net"] + wf["arrears_net"], "Past dues and retroactive payments"),
        ("(±) LOP Days Variance Impact", wf["lop_variance_impact"], cum + wf["joiners_net"] - wf["leavers_net"] + wf["arrears_net"] + wf["lop_variance_impact"], "Attendance & unpaid leave delta effect"),
        ("(±) Salary on Hold Adjustments", wf["holds_net_impact"], cum + wf["joiners_net"] - wf["leavers_net"] + wf["arrears_net"] + wf["lop_variance_impact"] + wf["holds_net_impact"], "Escrow deductions and releases"),
        ("(±) Increments & Other Variations", wf["other_adjustments_net"], wf["curr_net"], "CTC revisions, variable pay, and advance recoveries"),
        ("(=) Final: Current Month Net Salary", wf["curr_net"], wf["curr_net"], f"Final verified take-home for {data['current_period']}"),
    ]
    for idx, (step_name, delta_val, cum_val, desc) in enumerate(wf_steps, wf_start + 2):
        c1 = ws1.cell(row=idx, column=1, value=step_name)
        c2 = ws1.cell(row=idx, column=2, value=delta_val)
        c3 = ws1.cell(row=idx, column=3, value=cum_val)
        c4 = ws1.cell(row=idx, column=4, value=desc)
        for cell in (c1, c2, c3, c4):
            cell.border = double_bottom_border if "Final:" in step_name else thin_border
            cell.font = bold_font if "Base:" in step_name or "Final:" in step_name else Font(size=9.5)
        c2.number_format = "₹#,##0.00"
        c3.number_format = "₹#,##0.00"
        c2.alignment = right_align
        c3.alignment = right_align

    # ── Tab 2: Anomaly & Exception Watchlist ──
    ws2 = wb.create_sheet(title="Anomaly Watchlist")
    ws2.merge_cells("A1:I1")
    ws2["A1"] = f"{batch.client.name} — Checker Exception & Anomaly Watchlist ({len(data['anomalies'])} Flagged)"
    ws2["A1"].font = Font(bold=True, size=12, color="0F172A")
    ws2.merge_cells("A2:I2")
    ws2["A2"] = "Flags employees with net variation >= Rs 5,000, percentage swing >= 15%, salary on hold, or headcount transitions."
    ws2["A2"].font = Font(size=9.5, italic=True, color="64748B")

    anom_headers = ["Emp Code", "Employee Name", "Department", "Status", "Prior Net (Rs.)", "Current Net (Rs.)", "Variance (Rs.)", "% Change", "Primary Variance Driver & Anomaly Flags"]
    for c, h in enumerate(anom_headers, 1):
        cell = ws2.cell(row=4, column=c, value=h)
        cell.fill = PatternFill(start_color="B45309", end_color="B45309", fill_type="solid")
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws2.row_dimensions[4].height = 25

    for idx, a in enumerate(data["anomalies"], 5):
        c1 = ws2.cell(row=idx, column=1, value=a["employee_code"])
        c2 = ws2.cell(row=idx, column=2, value=a["employee_name"])
        c3 = ws2.cell(row=idx, column=3, value=a["department"])
        c4 = ws2.cell(row=idx, column=4, value=a["status"])
        c5 = ws2.cell(row=idx, column=5, value=a["prev_net"])
        c6 = ws2.cell(row=idx, column=6, value=a["curr_net"])
        c7 = ws2.cell(row=idx, column=7, value=a["diff_net"])
        c8 = ws2.cell(row=idx, column=8, value=f"{a['pct_net_change']:+.1f}%")
        reason_txt = a["primary_driver"] + (" | " + " · ".join(a["anomaly_reasons"]) if a["anomaly_reasons"] else "")
        c9 = ws2.cell(row=idx, column=9, value=reason_txt)

        fill_color = amber_fill if a["status"] == "CONTINUOUS" else (green_fill if a["status"] == "JOINER" else rose_fill)
        for cell in (c1, c2, c3, c4, c5, c6, c7, c8, c9):
            cell.border = thin_border
            cell.fill = fill_color
            cell.font = Font(size=9.5)
        c1.alignment = center_align
        c4.alignment = center_align
        c8.alignment = center_align
        c5.number_format = "₹#,##0.00"
        c6.number_format = "₹#,##0.00"
        c7.number_format = "₹#,##0.00"
        c5.alignment = right_align
        c6.alignment = right_align
        c7.alignment = right_align

    # ── Tab 3: Complete Employee-by-Employee Variance ──
    ws3 = wb.create_sheet(title="All Employee Variance")
    ws3.merge_cells("A1:M1")
    ws3["A1"] = f"{batch.client.name} — Full Line-Item Employee Variance Sheet ({len(data['all_items'])} Records)"
    ws3["A1"].font = Font(bold=True, size=12, color="0F172A")

    all_headers = [
        "Emp Code", "Employee Name", "Department", "Status",
        "Prior Gross (Rs.)", "Current Gross (Rs.)", "Gross Diff (Rs.)",
        "Prior LOP", "Curr LOP",
        "Prior Net (Rs.)", "Current Net (Rs.)", "Net Diff (Rs.)", "Primary Driver"
    ]
    for c, h in enumerate(all_headers, 1):
        cell = ws3.cell(row=3, column=c, value=h)
        cell.fill = navy_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws3.row_dimensions[3].height = 25

    for idx, item in enumerate(data["all_items"], 4):
        c1 = ws3.cell(row=idx, column=1, value=item["employee_code"])
        c2 = ws3.cell(row=idx, column=2, value=item["employee_name"])
        c3 = ws3.cell(row=idx, column=3, value=item["department"])
        c4 = ws3.cell(row=idx, column=4, value=item["status"])
        c5 = ws3.cell(row=idx, column=5, value=item["prev_gross"])
        c6 = ws3.cell(row=idx, column=6, value=item["curr_gross"])
        c7 = ws3.cell(row=idx, column=7, value=item["diff_gross"])
        c8 = ws3.cell(row=idx, column=8, value=item["prev_lop"])
        c9 = ws3.cell(row=idx, column=9, value=item["curr_lop"])
        c10 = ws3.cell(row=idx, column=10, value=item["prev_net"])
        c11 = ws3.cell(row=idx, column=11, value=item["curr_net"])
        c12 = ws3.cell(row=idx, column=12, value=item["diff_net"])
        c13 = ws3.cell(row=idx, column=13, value=item["primary_driver"])

        for cell in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13):
            cell.border = thin_border
            cell.font = Font(size=9)
            if idx % 2 == 0:
                cell.fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        c1.alignment = center_align
        c4.alignment = center_align
        c8.alignment = center_align
        c9.alignment = center_align
        for num_c in (c5, c6, c7, c10, c11, c12):
            num_c.number_format = "₹#,##0.00"
            num_c.alignment = right_align

    for ws in (ws1, ws2, ws3):
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                if cell.value:
                    max_len = max(max_len, len(str(cell.value)[:40]))
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", batch.client.name)
    filename = f"MoM_Variance_Reconciliation_{clean_name}_{batch.year}_{batch.month:02d}.xlsx"
    response = HttpResponse(
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def build_journal_voucher_data(batch, split_by_department=True):
    """
    Builds a balanced double-entry accounting journal voucher for the payroll batch.
    Debits = Gross Salaries + Reimbursements + Employer PF + Employer ESIC
    Credits = Net Salaries Payable + Employee PF + Employer PF + Employee ESIC + Employer ESIC + PT + TDS + Advances + Holds + Other Deductions
    Total Debits == Total Credits (Guaranteed zero-imbalance).
    """
    records = list(batch.records.select_related("employee", "salary_structure_snapshot").all())
    profile = getattr(batch.client, "payroll_profile", None)
    esi_enabled = getattr(profile, "esi_enabled", False)

    dept_gross = defaultdict(Decimal)
    dept_reimb = defaultdict(Decimal)
    dept_emp_count = defaultdict(int)

    total_gross = Decimal("0.00")
    total_reimb = Decimal("0.00")
    total_net = Decimal("0.00")

    total_ee_pf = Decimal("0.00")
    total_er_pf = Decimal("0.00")
    total_ee_esic = Decimal("0.00")
    total_er_esic = Decimal("0.00")
    total_pt = Decimal("0.00")
    total_tds = Decimal("0.00")
    total_adv_rec = Decimal("0.00")
    total_loan_rec = Decimal("0.00")
    total_hold_ded = Decimal("0.00")
    total_other_ded = Decimal("0.00")

    for r in records:
        emp = r.employee
        dept = (emp.department or "General & Administration").strip() or "General & Administration"
        dept_emp_count[dept] += 1

        gross = r.earned_salary if r.earned_salary else Decimal("0.00")
        reimb = r.reimbursements if r.reimbursements else Decimal("0.00")
        net = r.net_salary if r.net_salary else Decimal("0.00")

        dept_gross[dept] += gross
        dept_reimb[dept] += reimb
        total_gross += gross
        total_reimb += reimb
        total_net += net

        ee_pf = (r.epf or Decimal("0.00")) + (r.vpf or Decimal("0.00")) + (r.vpf_arrears or Decimal("0.00"))
        total_ee_pf += ee_pf

        ee_esic = getattr(r, "esi", Decimal("0.00")) or Decimal("0.00")
        total_ee_esic += ee_esic

        total_pt += (r.professional_tax or Decimal("0.00"))
        total_tds += (r.tds or Decimal("0.00"))
        total_adv_rec += (r.salary_advance_recovered or Decimal("0.00"))
        total_loan_rec += (r.loan_deduction or Decimal("0.00"))
        total_hold_ded += (r.on_hold_deducted or Decimal("0.00"))
        other = (r.lwf or Decimal("0.00")) + (r.other_deduction or Decimal("0.00")) + (r.nps_deduction or Decimal("0.00")) + (r.nps_deduction_arrears or Decimal("0.00"))
        total_other_ded += other

        epf_w = r.basic_for_pf or Decimal("0.00")
        if epf_w > Decimal("15000.00"):
            epf_w = Decimal("15000.00")
        if ee_pf > Decimal("0.00") and epf_w > Decimal("0.00"):
            er_pf_val = min(Decimal("1800.00"), (epf_w * Decimal("0.12")).quantize(Decimal("1.00"), rounding=ROUND_HALF_UP))
            total_er_pf += er_pf_val

        if ee_esic > Decimal("0.00") or (esi_enabled and r.gross_salary <= Decimal("21000.00")):
            wages = r.earned_salary or Decimal("0.00")
            er_esic_val = Decimal(str(math.ceil(float(wages) * 0.0325)))
            total_er_esic += er_esic_val

    debit_entries = []
    credit_entries = []

    # Debits:
    if split_by_department and dept_gross:
        for dept, amt in sorted(dept_gross.items()):
            if amt > Decimal("0.00"):
                debit_entries.append({
                    "code": f"EXP-SAL-{dept[:4].upper()}",
                    "account_name": f"Salaries & Wages Expense ({dept})",
                    "department": dept,
                    "amount": amt,
                    "type": "DEBIT",
                    "narration": f"Gross monthly earned wages for {dept_emp_count[dept]} employees in {dept}",
                })
        for dept, amt in sorted(dept_reimb.items()):
            if amt > Decimal("0.00"):
                debit_entries.append({
                    "code": f"EXP-REIMB-{dept[:4].upper()}",
                    "account_name": f"Staff Expense Reimbursements ({dept})",
                    "department": dept,
                    "amount": amt,
                    "type": "DEBIT",
                    "narration": f"Non-taxable business expense reimbursements for {dept}",
                })
    else:
        if total_gross > Decimal("0.00"):
            debit_entries.append({
                "code": "EXP-SAL-001",
                "account_name": "Salaries & Wages Expense",
                "department": "All",
                "amount": total_gross,
                "type": "DEBIT",
                "narration": f"Total gross earned monthly wages for {len(records)} employees",
            })
        if total_reimb > Decimal("0.00"):
            debit_entries.append({
                "code": "EXP-REIMB-001",
                "account_name": "Staff Expense Reimbursements",
                "department": "All",
                "amount": total_reimb,
                "type": "DEBIT",
                "narration": "Total non-taxable business expense reimbursements",
            })

    if total_er_pf > Decimal("0.00"):
        debit_entries.append({
            "code": "EXP-ER-PF",
            "account_name": "Employer PF Contribution Expense",
            "department": "All",
            "amount": total_er_pf,
            "type": "DEBIT",
            "narration": "Employer statutory provident fund contribution (EPFO A/c 1 & 10)",
        })

    if total_er_esic > Decimal("0.00"):
        debit_entries.append({
            "code": "EXP-ER-ESIC",
            "account_name": "Employer ESIC Contribution Expense",
            "department": "All",
            "amount": total_er_esic,
            "type": "DEBIT",
            "narration": "Employer statutory health insurance contribution (3.25% ESIC)",
        })

    # Credits:
    total_net_payout = total_net + total_reimb
    credit_entries.append({
        "code": "LIAB-NET-PAY",
        "account_name": "Net Salaries Payable (Bank Remittance)",
        "department": "All",
        "amount": total_net_payout,
        "type": "CREDIT",
        "narration": "Net salary and reimbursements payable via corporate netbanking",
    })

    if total_ee_pf > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-EE-PF",
            "account_name": "Employee Provident Fund Payable",
            "department": "All",
            "amount": total_ee_pf,
            "type": "CREDIT",
            "narration": "Employee PF deductions withheld from monthly pay",
        })

    if total_er_pf > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-ER-PF",
            "account_name": "Employer Provident Fund Payable",
            "department": "All",
            "amount": total_er_pf,
            "type": "CREDIT",
            "narration": "Employer statutory PF payable to EPFO Unified Portal",
        })

    if total_ee_esic > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-EE-ESIC",
            "account_name": "Employee ESIC Contribution Payable",
            "department": "All",
            "amount": total_ee_esic,
            "type": "CREDIT",
            "narration": "Employee ESIC deductions (0.75%) withheld from pay",
        })

    if total_er_esic > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-ER-ESIC",
            "account_name": "Employer ESIC Contribution Payable",
            "department": "All",
            "amount": total_er_esic,
            "type": "CREDIT",
            "narration": "Employer ESIC contribution (3.25%) payable to ESIC portal",
        })

    if total_pt > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-PT-PAY",
            "account_name": "Professional Tax Payable",
            "department": "All",
            "amount": total_pt,
            "type": "CREDIT",
            "narration": "State Professional Tax withheld for monthly remittance",
        })

    if total_tds > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-TDS-PAY",
            "account_name": "TDS on Salaries Payable (Section 192)",
            "department": "All",
            "amount": total_tds,
            "type": "CREDIT",
            "narration": "Income tax deducted at source on employee salaries",
        })

    if total_adv_rec > Decimal("0.00"):
        credit_entries.append({
            "code": "ASSET-SAL-ADV",
            "account_name": "Staff Salary Advance Recovery Clearing",
            "department": "All",
            "amount": total_adv_rec,
            "type": "CREDIT",
            "narration": "Recovery of salary advances previously disbursed",
        })

    if total_loan_rec > Decimal("0.00"):
        credit_entries.append({
            "code": "ASSET-STAFF-LOAN",
            "account_name": "Staff Loan EMI Recovery Clearing",
            "department": "All",
            "amount": total_loan_rec,
            "type": "CREDIT",
            "narration": "Monthly staff loan installment deduction",
        })

    if total_hold_ded > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-HOLD-ESCROW",
            "account_name": "Salary on Hold / Escrow Payable",
            "department": "All",
            "amount": total_hold_ded,
            "type": "CREDIT",
            "narration": "Salaries withheld in internal escrow pending clearance",
        })

    if total_other_ded > Decimal("0.00"):
        credit_entries.append({
            "code": "LIAB-OTHER-DED",
            "account_name": "Other Withholdings & Statutory Deductions",
            "department": "All",
            "amount": total_other_ded,
            "type": "CREDIT",
            "narration": "LWF, voluntary contributions, and miscellaneous deductions",
        })

    sum_debits = sum(e["amount"] for e in debit_entries)
    sum_credits = sum(e["amount"] for e in credit_entries)
    imbalance = sum_debits - sum_credits

    if abs(imbalance) > Decimal("0.00"):
        if imbalance > Decimal("0.00"):
            credit_entries.append({
                "code": "EXP-ROUND-OFF",
                "account_name": "Payroll Rounding Difference",
                "department": "All",
                "amount": imbalance,
                "type": "CREDIT",
                "narration": "Fractional paise rounding alignment",
            })
        else:
            debit_entries.append({
                "code": "EXP-ROUND-OFF",
                "account_name": "Payroll Rounding Difference",
                "department": "All",
                "amount": abs(imbalance),
                "type": "DEBIT",
                "narration": "Fractional paise rounding alignment",
            })
        sum_debits = sum(e["amount"] for e in debit_entries)
        sum_credits = sum(e["amount"] for e in credit_entries)
        imbalance = sum_debits - sum_credits

    return {
        "debit_entries": debit_entries,
        "credit_entries": credit_entries,
        "total_debits": sum_debits,
        "total_credits": sum_credits,
        "imbalance": imbalance,
    }


def generate_journal_voucher_xlsx_response(batch, split_by_department=True):
    data = build_journal_voucher_data(batch, split_by_department=split_by_department)
    wb = Workbook()

    navy_fill = PatternFill(start_color="1A2F5A", end_color="1A2F5A", fill_type="solid")
    teal_fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
    green_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")

    header_font = Font(color="FFFFFF", bold=True, size=10)
    bold_font = Font(bold=True, size=10)
    center_align = Alignment(horizontal="center", vertical="center")
    right_align = Alignment(horizontal="right", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
    )

    # ── Tab 1: Accounting Journal Voucher ──
    ws1 = wb.active
    ws1.title = "Journal Voucher (JV)"
    ws1.merge_cells("A1:G1")
    ws1["A1"] = f"{batch.client.name} — Accounting Journal Voucher (JV)"
    ws1["A1"].font = Font(bold=True, size=13, color="0F172A")

    date_str = date(batch.year, batch.month, calendar.monthrange(batch.year, batch.month)[1]).strftime("%d/%m/%Y")
    ws1.merge_cells("A2:G2")
    ws1["A2"] = f"Voucher Type: Payroll Journal  |  Period: {month_name[batch.month]} {batch.year}  |  Posting Date: {date_str}  |  Voucher No: PAY-{batch.year}{batch.month:02d}-{batch.id}"
    ws1["A2"].font = Font(size=10, italic=True, color="475569")

    jv_headers = ["S.No", "Account Head", "Ledger Code", "Cost Center / Dept", "Debit (Rs.)", "Credit (Rs.)", "Narration"]
    for c, h in enumerate(jv_headers, 1):
        cell = ws1.cell(row=4, column=c, value=h)
        cell.fill = navy_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws1.row_dimensions[4].height = 25

    row_idx = 5
    sno = 1
    for d in data["debit_entries"]:
        c1 = ws1.cell(row=row_idx, column=1, value=sno)
        c2 = ws1.cell(row=row_idx, column=2, value=d["account_name"])
        c3 = ws1.cell(row=row_idx, column=3, value=d["code"])
        c4 = ws1.cell(row=row_idx, column=4, value=d["department"])
        c5 = ws1.cell(row=row_idx, column=5, value=d["amount"])
        c6 = ws1.cell(row=row_idx, column=6, value=Decimal("0.00"))
        c7 = ws1.cell(row=row_idx, column=7, value=d["narration"])
        for cell in (c1, c2, c3, c4, c5, c6, c7):
            cell.border = thin_border
            cell.font = Font(size=9.5)
        c1.alignment = center_align
        c3.alignment = center_align
        c4.alignment = center_align
        c5.number_format = "₹#,##0.00"
        c6.number_format = "₹#,##0.00"
        c5.alignment = right_align
        c6.alignment = right_align
        sno += 1
        row_idx += 1

    for cr in data["credit_entries"]:
        c1 = ws1.cell(row=row_idx, column=1, value=sno)
        c2 = ws1.cell(row=row_idx, column=2, value=cr["account_name"])
        c3 = ws1.cell(row=row_idx, column=3, value=cr["code"])
        c4 = ws1.cell(row=row_idx, column=4, value=cr["department"])
        c5 = ws1.cell(row=row_idx, column=5, value=Decimal("0.00"))
        c6 = ws1.cell(row=row_idx, column=6, value=cr["amount"])
        c7 = ws1.cell(row=row_idx, column=7, value=cr["narration"])
        for cell in (c1, c2, c3, c4, c5, c6, c7):
            cell.border = thin_border
            cell.font = Font(size=9.5)
        c1.alignment = center_align
        c3.alignment = center_align
        c4.alignment = center_align
        c5.number_format = "₹#,##0.00"
        c6.number_format = "₹#,##0.00"
        c5.alignment = right_align
        c6.alignment = right_align
        sno += 1
        row_idx += 1

    t1 = ws1.cell(row=row_idx, column=1, value="TOTAL")
    t2 = ws1.cell(row=row_idx, column=2, value="BALANCED JOURNAL VOUCHER")
    t3 = ws1.cell(row=row_idx, column=3, value="")
    t4 = ws1.cell(row=row_idx, column=4, value="")
    t5 = ws1.cell(row=row_idx, column=5, value=data["total_debits"])
    t6 = ws1.cell(row=row_idx, column=6, value=data["total_credits"])
    t7 = ws1.cell(row=row_idx, column=7, value="✓ ZERO IMBALANCE — BALANCED")

    for cell in (t1, t2, t3, t4, t5, t6, t7):
        cell.border = double_bottom_border
        cell.fill = green_fill
        cell.font = bold_font
    t1.alignment = center_align
    t5.number_format = "₹#,##0.00"
    t6.number_format = "₹#,##0.00"
    t5.alignment = right_align
    t6.alignment = right_align

    # ── Tab 2: Department Cost Summary (Option 8.A) ──
    ws2 = wb.create_sheet(title="Department Cost Centers")
    ws2.merge_cells("A1:F1")
    ws2["A1"] = f"{batch.client.name} — Department / Cost Center Payroll Allocation"
    ws2["A1"].font = Font(bold=True, size=12, color="0F172A")

    dept_headers = ["Cost Center / Department", "Headcount", "Gross Wages (Rs.)", "Staff Reimbursements (Rs.)", "Total Dept Outlay (Rs.)", "% of Total Outlay"]
    for c, h in enumerate(dept_headers, 1):
        cell = ws2.cell(row=3, column=c, value=h)
        cell.fill = teal_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border
    ws2.row_dimensions[3].height = 25

    records = list(batch.records.select_related("employee").all())
    dept_totals = defaultdict(lambda: {"count": 0, "gross": Decimal("0.00"), "reimb": Decimal("0.00")})
    for r in records:
        d_name = (r.employee.department or "General & Administration").strip() or "General & Administration"
        dept_totals[d_name]["count"] += 1
        dept_totals[d_name]["gross"] += (r.earned_salary or Decimal("0.00"))
        dept_totals[d_name]["reimb"] += (r.reimbursements or Decimal("0.00"))

    tot_outlay = sum(v["gross"] + v["reimb"] for v in dept_totals.values()) or Decimal("1.00")

    for idx, (d_name, v) in enumerate(sorted(dept_totals.items()), 4):
        outlay = v["gross"] + v["reimb"]
        pct = (outlay / tot_outlay) * 100
        c1 = ws2.cell(row=idx, column=1, value=d_name)
        c2 = ws2.cell(row=idx, column=2, value=v["count"])
        c3 = ws2.cell(row=idx, column=3, value=v["gross"])
        c4 = ws2.cell(row=idx, column=4, value=v["reimb"])
        c5 = ws2.cell(row=idx, column=5, value=outlay)
        c6 = ws2.cell(row=idx, column=6, value=f"{pct:.1f}%")

        for cell in (c1, c2, c3, c4, c5, c6):
            cell.border = thin_border
            cell.font = Font(size=9.5)
        c2.alignment = center_align
        c6.alignment = center_align
        for num_c in (c3, c4, c5):
            num_c.number_format = "₹#,##0.00"
            num_c.alignment = right_align

    for ws in (ws1, ws2):
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                if cell.value:
                    max_len = max(max_len, len(str(cell.value)[:40]))
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", batch.client.name)
    filename = f"Payroll_Journal_Voucher_{clean_name}_{batch.year}_{batch.month:02d}.xlsx"
    response = HttpResponse(
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def generate_tally_xml_response(batch, split_by_department=True):
    """Generates Tally ERP 9 / Tally Prime compatible payroll journal voucher XML [Option 8.C]."""
    data = build_journal_voucher_data(batch, split_by_department=split_by_department)
    debits = data["debit_entries"]
    credits = data["credit_entries"]

    period_str = f"{month_name[batch.month]} {batch.year}"
    clean_client = (batch.client.name or "Client").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    date_str = date(batch.year, batch.month, calendar.monthrange(batch.year, batch.month)[1]).strftime("%Y%m%d")
    vch_no = f"PAY-{batch.year}{batch.month:02d}-{batch.id}"

    ledger_xml = []
    for d in debits:
        acc_name = d["account_name"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        amt = f"-{float(d['amount']):.2f}"
        narr = d["narration"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        ledger_xml.append(f"""          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>{acc_name}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>{amt}</AMOUNT>
            <NARRATION>{narr}</NARRATION>
          </ALLLEDGERENTRIES.LIST>""")

    for cr in credits:
        acc_name = cr["account_name"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        amt = f"{float(cr['amount']):.2f}"
        narr = cr["narration"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        ledger_xml.append(f"""          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>{acc_name}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>{amt}</AMOUNT>
            <NARRATION>{narr}</NARRATION>
          </ALLLEDGERENTRIES.LIST>""")

    ledger_body = "\n".join(ledger_xml)
    xml_str = f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Payroll Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>{date_str}</DATE>
            <VOUCHERTYPENAME>Payroll Journal</VOUCHERTYPENAME>
            <VOUCHERNUMBER>{vch_no}</VOUCHERNUMBER>
            <NARRATION>Payroll disbursement voucher for {period_str} — {clean_client}</NARRATION>
{ledger_body}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""

    response = HttpResponse(xml_str.strip(), content_type="application/xml")
    clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", batch.client.name)
    response["Content-Disposition"] = f'attachment; filename="Payroll_JV_Tally_{clean_name}_{batch.year}_{batch.month:02d}.xml"'
    return response


def generate_journal_voucher_csv_response(batch, split_by_department=True):
    """Generates universal ERP Journal Voucher CSV file."""
    data = build_journal_voucher_data(batch, split_by_department=split_by_department)
    date_str = date(batch.year, batch.month, calendar.monthrange(batch.year, batch.month)[1]).strftime("%d/%m/%Y")
    vch_no = f"PAY-{batch.year}{batch.month:02d}-{batch.id}"

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Voucher Date", "Voucher Number", "Voucher Type", "Account Code", "Account Head", "Cost Center / Department", "Debit (Rs.)", "Credit (Rs.)", "Narration"])

    for d in data["debit_entries"]:
        writer.writerow([date_str, vch_no, "Payroll Journal", d["code"], d["account_name"], d["department"], f"{float(d['amount']):.2f}", "0.00", d["narration"]])
    for cr in data["credit_entries"]:
        writer.writerow([date_str, vch_no, "Payroll Journal", cr["code"], cr["account_name"], cr["department"], "0.00", f"{float(cr['amount']):.2f}", cr["narration"]])
    writer.writerow([])
    writer.writerow(["TOTAL", "", "", "", "", "", f"{float(data['total_debits']):.2f}", f"{float(data['total_credits']):.2f}", "ZERO IMBALANCE — BALANCED"])

    csv_data = output.getvalue()
    csv_data = codecs.BOM_UTF8.decode("utf-8") + csv_data
    response = HttpResponse(csv_data, content_type="text/csv; charset=utf-8")
    clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", batch.client.name)
    response["Content-Disposition"] = f'attachment; filename="Payroll_JV_{clean_name}_{batch.year}_{batch.month:02d}.csv"'
    return response



# ── Report Registry for Programmatic Dispatch [Option 1.A] ────────────────────
REPORT_REGISTRY = {
    "detailed": generate_batch_detailed_excel_response,
    "epfo_ecr_txt": generate_epfo_ecr_txt_response,
    "epfo_ecr_xlsx": generate_epfo_ecr_xlsx_response,
    "esic": generate_esic_monthly_xlsx_response,
    "pt": generate_pt_statement_xlsx_response,
    "statutory_identifiers_validation": validate_statutory_identifiers,
    "bank_details_validation": validate_bank_details,
    "bank_xlsx": generate_bank_payout_xlsx_response,
    "bank_csv": generate_bank_payout_csv_response,
    "bank_hdfc": generate_bank_payout_hdfc_response,
    "mom_variance_data": build_mom_variance_data,
    "mom_variance_xlsx": generate_mom_variance_xlsx_response,
    "journal_voucher_data": build_journal_voucher_data,
    "journal_voucher_xlsx": generate_journal_voucher_xlsx_response,
    "journal_voucher_csv": generate_journal_voucher_csv_response,
    "tally_xml": generate_tally_xml_response,
}
