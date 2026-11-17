import sys
"""apps/payroll/calculations/calculations.py

Computes the salary-component fields (basic_da, hra, basic_for_pf, epf,
vpf, professional_tax, gross_salary, earned_salary) that used
to be expected as columns in the monthly payroll excel. The real sheet
only carries attendance figures and a handful of allowances/deductions
(see excel_parser.VARIABLE_COLUMN_MAPPING) — everything else is derived
here from the employee's EmployeeSalaryStructure (static/contracted
values) plus that month's attendance.

Formulas confirmed with the user, reusing the logic from the retired
frontend PayrollTable.jsx, adapted to read from EmployeeSalaryStructure
instead of raw employee fields:

  - basic_da / hra: prorated by
  (effective_present_days / days_in_month) against the
  structure's contracted (static) value.

  effective_present_days consists of:
    - actual_working_days
    - approved paid_leave_days
    - leave days automatically used to cover LOP
    - comp-off days automatically used to cover any remaining LOP

  Only LOP that cannot be covered by leave or comp-off reduces
  effective_present_days (and therefore salary).
  - basic_for_pf: PF wage base, capped at the statutory EPF wage ceiling
    (currently Rs 15,000/month — see PF_WAGE_CEILING below; this ceiling
    is reportedly under revision to Rs 25,000 as of 2026, hence the named
    constant rather than a scattered magic number).
  - epf: if the structure's pf_opted flag is True, 12% of the structure's
    CONTRACTED (unprorated) basic_da, capped at 12% of PF_WAGE_CEILING
    (currently Rs 1,800/month) — this is the EMPLOYEE's own share and is
    a real monthly deduction; only the EMPLOYER's matching Rs 1,800
    share was carved out of Special Allowance/HRA/Basic+DA at
    CTC-structuring time (see EmployeeSalaryStructure.pf_opted), so
    charging this here does not double-count anything. If pf_opted is
    False, epf is 0 — no reserve was carved out anywhere for this
    employee and nothing is deducted from them either.
  - vpf: flat value from EmployeeSalaryStructure.vpf, not prorated — no
    longer needs to come from the excel at all.
  - professional_tax: Karnataka PT Amendment Act 2025 (effective 1 Apr
    2025). Nil if monthly_gross < Rs 25,000 (contracted/unprorated salary
    decides the bracket, not this month's LOP-reduced payout — an
    employee's PT liability shouldn't flip month to month because of
    unpaid leave). If monthly_gross >= Rs 25,000: Rs 300 in February,
    Rs 200 every other month (Apr-Jan, Mar) — totals the statutory
    Rs 2,500/year cap.
  - gross_salary: EmployeeSalaryStructure.monthly_gross, unprorated (the
    "if fully present" figure).
  - night_shift: DEPRECATED, no longer computed. Night-shift pay is now
    expected to be folded into another field before upload.
  - earned_salary: sum of prorated basic_da + hra, plus lta, special
    allowance, nps_allowance_earned, variable_pay, commission_other,
    and arrears.

General leave ledger (CL/SL/EL — separate from the Comp-Off ledger):

  - Employees accrue 22/12 leave days every month after probation.
    Employees in probation accrue no leave.

  - Approved Paid Leave (paid_leave_days):
      * is entered by HR through the monthly payroll upload.
      * reduces the employee's leave balance.
      * counts as paid attendance and therefore does NOT reduce salary.

  - Leave balance is used automatically to cover any uploaded LOP
    (Leave Without Pay). This automatic adjustment is stored as
    leave_used.

  - If LOP still remains after consuming the available leave balance,
    the remaining LOP is automatically covered using the employee's
    available Comp-Off balance (comp_off_days_used).

  - Only LOP that remains after both leave and Comp-Off are exhausted
    reduces effective_present_days and therefore reduces salary.

  - Leave closing balance:
        opening_leave
      + monthly_accrual
      - approved_paid_leave
      - leave_used

  - Comp-Off closing balance:
        opening_comp_off
      + extra_working_days
      - comp_off_days_used

  - Leave cashout is handled separately through LeaveAdjustment and is
    outside the scope of this calculation.
"""

import calendar
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING
from typing import Any, Dict, List, Optional, Union

def sanitize_for_json(obj):
    """
    Recursively converts Decimal objects to 2-decimal rounded floats
    so dictionaries and lists can safely be stored in Django JSONFields or serialized to JSON.
    """
    if isinstance(obj, Decimal):
        return round(float(obj), 2)
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    return obj

# Statutory EPF wage ceilings:
# - PF_WAGE_CEILING (Rs 15,000/month -> Rs 1,800/month @ 12%)
# - PF_WAGE_CEILING_25K (Rs 25,000/month -> Rs 3,000/month @ 12%)
PF_WAGE_CEILING = Decimal("15000")
PF_WAGE_CEILING_25K = Decimal("25000")
EPF_RATE = Decimal("0.12")

PT_HIGH = Decimal("300")  # charged in PT_HIGH_MONTH only
PT_OTHER = Decimal("200")
PT_HIGH_MONTH = 2  # February — Karnataka PT Amendment Act 2025 puts the Rs 300 charge here, not March
PT_THRESHOLD = Decimal("25000")  # monthly_gross below this is PT-exempt

# General leave accrual: 22 annual leave days / 12 months. Kept as an
# exact Decimal fraction (not pre-rounded to e.g. 1.83 or 1.8) so
# leave_closing_balance never drifts from rounding error month to month.
LEAVE_ANNUAL_DAYS = Decimal("22")
LEAVE_MONTHLY_ACCRUAL = LEAVE_ANNUAL_DAYS / Decimal("12")


def calculate_professional_tax(
    monthly_gross: Decimal,
    month: int,
    pt_state: str = "KARNATAKA",
    gender: str = "M",
    custom_amount: Decimal = Decimal("0"),
    basic_da: Decimal = Decimal("0"),
    earned_salary: Decimal = Decimal("0"),
    pt_custom_pct: Decimal = Decimal("0"),
    pt_custom_base: str = "GROSS",
    pt_custom_cap: Decimal = Decimal("200"),
) -> Decimal:
    """
    Computes Professional Tax (PT) deduction based on state statutory tax slabs.
    Supported states / rules:
      - 'KARNATAKA' (default):
          * Under Rs 25,000 -> Rs 0 (exempt)
          * Rs 25,000 and above -> Rs 300 in February, Rs 200 in all other months (totals statutory Rs 2,500/year cap)
      - 'TELANGANA_AP' (Telangana & Andhra Pradesh):
          * Up to Rs 15,000 -> Rs 0
          * Rs 15,001 to Rs 20,000 -> Rs 150
          * Above Rs 20,000 -> Rs 200
      - 'MAHARASHTRA':
          * Men: Up to Rs 7,500 -> Rs 0; Rs 7,501 to Rs 10,000 -> Rs 175; Above Rs 10,000 -> Rs 200 (Rs 300 in Feb)
          * Women: Up to Rs 25,000 -> Rs 0 (exempt); Above Rs 25,000 -> Rs 200 (Rs 300 in Feb)
      - 'GUJARAT':
          * Up to Rs 12,000 -> Rs 0
          * Above Rs 12,000 -> Rs 200
      - 'EXEMPT_ZERO' (Delhi, Haryana, UP, Rajasthan, Punjab, Himachal Pradesh, etc.):
          * Flat Rs 0 across all salary brackets
      - 'CUSTOM_FIXED':
          * Flat custom amount specified by client
      - 'CUSTOM_PERCENT':
          * Custom percentage of selected base ('GROSS', 'BASIC', or 'EARNED'), optionally capped at pt_custom_cap
    """
    state = str(pt_state or "KARNATAKA").strip().upper()
    mg = Decimal(str(monthly_gross or 0))

    if state in ("EXEMPT_ZERO", "EXEMPT", "NONE", "DELHI", "HARYANA", "UP", "RAJASTHAN"):
        return Decimal("0")

    if state == "CUSTOM_FIXED":
        return Decimal(str(custom_amount or 0)).quantize(Decimal("0.01"))

    if state == "CUSTOM_PERCENT":
        pct = Decimal(str(pt_custom_pct or 0))
        if pct <= Decimal("0"):
            return Decimal("0")
        base_mode = str(pt_custom_base or "GROSS").strip().upper()
        if base_mode == "BASIC":
            base_val = Decimal(str(basic_da or 0))
        elif base_mode == "EARNED":
            base_val = Decimal(str(earned_salary or mg))
        else:
            base_val = mg
        computed_pt = (base_val * (pct / Decimal("100"))).quantize(Decimal("0.01"))
        cap_val = Decimal(str(pt_custom_cap or 0))
        if cap_val > Decimal("0"):
            computed_pt = min(computed_pt, cap_val)
        return computed_pt.quantize(Decimal("0.01"))

    if state in ("TELANGANA_AP", "TELANGANA", "ANDHRA_PRADESH", "AP", "TS"):
        if mg <= Decimal("15000"):
            return Decimal("0")
        elif mg <= Decimal("20000"):
            return Decimal("150")
        else:
            return Decimal("200")

    if state in ("MAHARASHTRA", "MH"):
        is_female = str(gender or "").strip().upper() in ("F", "FEMALE", "WOMAN")
        if is_female:
            if mg <= Decimal("25000"):
                return Decimal("0")
            return Decimal("300") if month == 2 else Decimal("200")
        else:
            if mg <= Decimal("7500"):
                return Decimal("0")
            elif mg <= Decimal("10000"):
                return Decimal("175")
            else:
                return Decimal("300") if month == 2 else Decimal("200")

    if state in ("GUJARAT", "GJ"):
        if mg <= Decimal("12000"):
            return Decimal("0")
        return Decimal("200")

    # Default: KARNATAKA (Karnataka PT Amendment Act 2025)
    if mg < PT_THRESHOLD:
        return Decimal("0")
    return PT_HIGH if month == PT_HIGH_MONTH else PT_OTHER


def is_in_probation(date_of_joining, year: int, month: int, probation_months: int = 6) -> bool:
    """
    Whether an employee is still within their probation period (default 6 months)
    for the given payroll month/year. A whole payroll month counts as
    POST-probation once the probation mark falls on/before the 1st of that
    month. If probation_months is 0, employee is immediately confirmed.
    """
    if date_of_joining is None or probation_months <= 0:
        return False

    import calendar

    total_months = date_of_joining.month - 1 + probation_months
    end_year = date_of_joining.year + total_months // 12
    end_month = total_months % 12 + 1
    end_day = min(date_of_joining.day, calendar.monthrange(end_year, end_month)[1])
    probation_end = date(end_year, end_month, end_day)

    first_of_payroll_month = date(year, month, 1)
    return first_of_payroll_month < probation_end



# ══════════════════════════════════════════════════════════════════════════════════
# 5-STAGE SEQUENTIAL CALCULATION PIPELINE (HOTSPOT 1)
# ══════════════════════════════════════════════════════════════════════════════════

@dataclass
class PayrollContext:
    """
    State container passed down the 5-stage sequential calculation pipeline.
    Encapsulates all static configuration, attendance inputs, intermediate proration metrics,
    evaluated statutory deductions, and final payslip results.
    """
    # ── 1. Static Configuration & Master Entity Inputs ──
    structure: Any = None
    row: Dict[str, Any] = field(default_factory=dict)
    month: int = 1
    days_in_month: int = 30
    year: Optional[int] = None
    client_profile: Any = None

    # ── 2. Attendance & Ledger Initial States ──
    comp_off_opening_balance: Decimal = Decimal("0")
    leave_opening_balance: Decimal = Decimal("0")
    is_probation: bool = False
    lop_policy: str = "ACCRUE_LEAVE_DEBT"
    annual_leave_days: Optional[Decimal] = None
    employee_gender: str = "M"
    track_leave_ledger: bool = True
    track_comp_off: bool = True

    # ── 3. Statutory Configuration Parameters ──
    pt_state: str = "KARNATAKA"
    pt_amount: Decimal = Decimal("0")
    pf_calculation_rule: Optional[str] = None
    pf_wage_ceiling: Optional[Decimal] = None
    pf_custom_pct: Optional[Decimal] = None
    pf_custom_base: Optional[str] = None
    pf_custom_capped: Optional[bool] = None
    pt_custom_pct: Optional[Decimal] = None
    pt_custom_base: Optional[str] = None
    pt_custom_cap: Optional[Decimal] = None
    esi_continuity_active: Optional[bool] = None

    # ── 4. Intermediate & Derived Attendance Attributes (Stage 1) ──
    actual_working_days: Decimal = Decimal("0")
    effective_present_days: Decimal = Decimal("0")
    proration_ratio: Decimal = Decimal("1")
    comp_off_days_used: Decimal = Decimal("0")
    comp_off_closing_balance: Decimal = Decimal("0")
    leave_accrued: Decimal = Decimal("0")
    leave_used: Decimal = Decimal("0")
    leave_closing_balance: Decimal = Decimal("0")

    # ── 5. Contracted & Dynamic Earnings (Stage 2) ──
    original_basic_da: Decimal = Decimal("0")
    original_hra: Decimal = Decimal("0")
    original_special_allowance: Decimal = Decimal("0")
    original_lta: Decimal = Decimal("0")
    original_nps_allowance: Decimal = Decimal("0")
    original_fbp: Decimal = Decimal("0")
    monthly_gross: Decimal = Decimal("0")
    vpf: Decimal = Decimal("0")
    pf_opted: bool = True
    basic_da: Decimal = Decimal("0")
    hra: Decimal = Decimal("0")
    variable_pay: Decimal = Decimal("0")
    special_allowance: Decimal = Decimal("0")
    lta: Decimal = Decimal("0")
    nps_allowance_earned: Decimal = Decimal("0")
    fbp: Decimal = Decimal("0")
    earned_salary: Decimal = Decimal("0")
    custom_earnings_list: List[Dict[str, Any]] = field(default_factory=list)
    custom_deductions_list: List[Dict[str, Any]] = field(default_factory=list)
    dynamic_earnings_total: Decimal = Decimal("0")
    dynamic_deductions_total: Decimal = Decimal("0")
    pf_extra_contracted: Decimal = Decimal("0")
    pf_extra_earned: Decimal = Decimal("0")
    esi_excluded_earnings: Decimal = Decimal("0")

    # ── 6. Statutory Deductions (Stage 3) ──
    basic_for_pf: Decimal = Decimal("0")
    epf: Decimal = Decimal("0")
    employer_pf: Decimal = Decimal("0")
    esi: Decimal = Decimal("0")
    employer_esi: Decimal = Decimal("0")
    professional_tax: Decimal = Decimal("0")
    computed_lwf: Decimal = Decimal("0")

    # ── 7. Internal Deductions & Adjustments (Stage 4) ──
    tds: Decimal = Decimal("0")
    loan_deduction: Decimal = Decimal("0")
    salary_advance_recovered: Decimal = Decimal("0")
    on_hold_deducted: Decimal = Decimal("0")
    other_deduction: Decimal = Decimal("0")

    # ── 8. Net Settlement & Audit Snapshots (Stage 5) ──
    total_deductions: Decimal = Decimal("0")
    net_salary: Decimal = Decimal("0")
    evaluated_custom_components: Dict[str, Any] = field(default_factory=dict)
    audit_trail: Dict[str, Any] = field(default_factory=dict)
    result_dict: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return self.result_dict


# ── Stage 1: Attendance, LOP & Leave Balances ─────────────────────────────────

def settle_attendance_and_proration(context: PayrollContext) -> PayrollContext:
    """
    Evaluates monthly attendance, leave debt accrual, comp-off banking,
    and derives the proration ratio according to the client profile policy.
    """
    row = context.row or {}
    days_in_month = Decimal(str(context.days_in_month or 30))
    actual_working_days = Decimal(str(row.get("actual_working_days", 0) or 0))
    lop_days = Decimal(str(row.get("lop_days", 0) or 0))
    extra_working_days = Decimal(str(row.get("extra_working_days", 0) or 0))
    paid_leave_days = Decimal(str(row.get("paid_leave_days", 0) or 0))

    leave_opening_balance = context.leave_opening_balance if context.track_leave_ledger else Decimal("0")
    comp_off_opening_balance = context.comp_off_opening_balance if context.track_comp_off else Decimal("0")

    if context.is_probation:
        leave_accrued = Decimal("0")
        leave_used = Decimal("0")
        leave_closing_balance = leave_opening_balance if context.track_leave_ledger else Decimal("0")
        comp_off_days_used = Decimal("0")
        comp_off_closing_balance = comp_off_opening_balance if context.track_comp_off else Decimal("0")
        effective_actual_days = min(actual_working_days, max(Decimal("0"), days_in_month - lop_days - paid_leave_days))
        effective_present_days = min(effective_actual_days, days_in_month)
    else:
        if context.track_leave_ledger:
            if context.annual_leave_days is not None:
                leave_accrued = (Decimal(str(context.annual_leave_days)) / Decimal("12")).quantize(Decimal("0.0001"))
            else:
                leave_accrued = LEAVE_MONTHLY_ACCRUAL
            leave_available = leave_opening_balance + leave_accrued
        else:
            leave_accrued = Decimal("0")
            leave_available = Decimal("0")

        if context.lop_policy == "REDUCE_SALARY":
            if context.track_leave_ledger:
                leave_used = min(paid_leave_days, max(leave_available, Decimal("0")))
                leave_closing_balance = leave_available - leave_used
            else:
                leave_used = Decimal("0")
                leave_closing_balance = Decimal("0")

            remaining_lop = lop_days

            if context.track_comp_off:
                comp_off_available = comp_off_opening_balance + extra_working_days
                comp_off_days_used = min(remaining_lop, max(comp_off_available, Decimal("0")))
                comp_off_closing_balance = comp_off_available - comp_off_days_used
            else:
                comp_off_days_used = Decimal("0")
                comp_off_closing_balance = Decimal("0")

            uncovered_lop = remaining_lop - comp_off_days_used
            effective_actual_days = min(
                actual_working_days,
                max(Decimal("0"), days_in_month - lop_days - paid_leave_days),
            )
            effective_present_days = min(
                effective_actual_days + paid_leave_days + (lop_days - uncovered_lop),
                days_in_month,
            )
        else:
            total_days_to_cover = paid_leave_days + lop_days
            if context.track_leave_ledger:
                leave_used = min(total_days_to_cover, max(leave_available, Decimal("0")))
                remaining_after_leave = total_days_to_cover - leave_used
            else:
                leave_used = Decimal("0")
                remaining_after_leave = total_days_to_cover

            if context.track_comp_off:
                comp_off_available = comp_off_opening_balance + extra_working_days
                comp_off_days_used = min(remaining_after_leave, max(comp_off_available, Decimal("0")))
                comp_off_closing_balance = comp_off_available - comp_off_days_used
            else:
                comp_off_days_used = Decimal("0")
                comp_off_closing_balance = Decimal("0")

            if context.track_leave_ledger:
                remaining_after_comp_off = remaining_after_leave - comp_off_days_used
                leave_closing_balance = (leave_available - leave_used) - remaining_after_comp_off

                if context.track_comp_off and comp_off_closing_balance > 0 and leave_closing_balance < 0:
                    settlement = min(comp_off_closing_balance, -leave_closing_balance)
                    comp_off_closing_balance -= settlement
                    leave_closing_balance += settlement
            else:
                leave_closing_balance = Decimal("0")

            effective_actual_days = actual_working_days
            effective_present_days = min(
                actual_working_days + total_days_to_cover,
                days_in_month,
            )

    client_profile = context.client_profile
    if client_profile is None and context.structure is not None:
        try:
            emp_obj = getattr(context.structure, "employee", None)
            client_obj = getattr(emp_obj, "client", None) if emp_obj is not None else None
            client_profile = getattr(client_obj, "payroll_profile", None) if client_obj is not None else None
            context.client_profile = client_profile
        except Exception:
            pass

    proration_rule = (
        str(getattr(client_profile, "mid_month_proration_rule", "ACTUAL_CALENDAR_DAYS") or "ACTUAL_CALENDAR_DAYS").strip().upper()
        if client_profile is not None
        else "ACTUAL_CALENDAR_DAYS"
    )
    if not days_in_month:
        proration_ratio = Decimal("0")
    elif effective_present_days >= days_in_month or proration_rule == "DISABLED":
        proration_ratio = Decimal("1")
    elif proration_rule == "STANDARD_30_DAYS":
        shortfall_days = max(Decimal("0"), days_in_month - effective_present_days)
        proration_ratio = max(Decimal("0"), (Decimal("30") - shortfall_days) / Decimal("30"))
    elif proration_rule == "WORKING_DAYS_26":
        shortfall_days = max(Decimal("0"), days_in_month - effective_present_days)
        proration_ratio = max(Decimal("0"), (Decimal("26") - shortfall_days) / Decimal("26"))
    else:
        proration_ratio = effective_present_days / days_in_month

    context.actual_working_days = effective_actual_days
    context.effective_present_days = effective_present_days
    context.proration_ratio = proration_ratio
    context.comp_off_days_used = comp_off_days_used
    context.comp_off_closing_balance = comp_off_closing_balance
    context.leave_accrued = leave_accrued
    context.leave_used = leave_used
    context.leave_closing_balance = leave_closing_balance
    context.audit_trail["stage_1_attendance"] = {
        "actual_working_days": float(effective_actual_days),
        "effective_present_days": float(effective_present_days),
        "proration_ratio": float(proration_ratio),
        "proration_rule": proration_rule,
        "comp_off_days_used": float(comp_off_days_used),
        "comp_off_closing": float(comp_off_closing_balance),
        "leave_closing": float(leave_closing_balance),
    }
    return context


# ── Stage 2: Contracted & Dynamic Earnings ───────────────────────────────────

def compute_contracted_and_dynamic_earnings(context: PayrollContext) -> PayrollContext:
    """
    Scales static contracted components by the proration ratio, incorporates
    monthly top-up figures, evaluates dynamic Three-Amount custom components,
    and derives total earned salary.
    """
    structure = context.structure
    row = context.row or {}
    proration_ratio = context.proration_ratio

    if structure is None:
        original_basic_da = Decimal("0")
        original_hra = Decimal("0")
        original_special_allowance = Decimal("0")
        original_lta = Decimal("0")
        original_nps_allowance = Decimal("0")
        original_fbp = Decimal("0")
        monthly_gross = Decimal("0")
        vpf = Decimal("0")
        pf_opted = True
    else:
        original_basic_da = Decimal(str(structure.original_basic_da or 0))
        original_hra = Decimal(str(structure.original_hra or 0))
        original_special_allowance = Decimal(str(structure.original_special_allowance or 0))
        original_lta = Decimal(str(structure.original_lta or 0))
        original_nps_allowance = Decimal(str(structure.nps_allowance or 0))
        original_fbp = Decimal(str(structure.fbp or 0))
        monthly_gross = Decimal(str(structure.monthly_gross or 0))
        vpf = Decimal(str(structure.vpf or 0))
        pf_opted = bool(structure.pf_opted)

    basic_da = (original_basic_da * proration_ratio).quantize(Decimal("0.01"))
    hra = (original_hra * proration_ratio).quantize(Decimal("0.01"))

    raw_var_pay = row.get("variable_pay", Decimal("0"))
    try:
        variable_pay = Decimal(str(raw_var_pay if raw_var_pay is not None else "0")).quantize(Decimal("0.01"))
    except Exception:
        variable_pay = Decimal("0")

    special_allowance = (
        (original_special_allowance * proration_ratio).quantize(Decimal("0.01"))
        + Decimal(str(row.get("special_allowance", 0) or 0))
    )
    lta = (
        (original_lta * proration_ratio).quantize(Decimal("0.01"))
        + Decimal(str(row.get("lta", 0) or 0))
    )
    nps_allowance_earned = (
        (original_nps_allowance * proration_ratio).quantize(Decimal("0.01"))
        + Decimal(str(row.get("nps_allowance_earned", 0) or 0))
    )

    # Dynamic Custom Components Evaluation (Three-Amount Anatomy)
    custom_earnings_list = []
    custom_deductions_list = []
    dynamic_earnings_total = Decimal("0")
    dynamic_deductions_total = Decimal("0")
    pf_extra_contracted = Decimal("0")
    pf_extra_earned = Decimal("0")
    esi_excluded_earnings = Decimal("0")

    struct_custom = getattr(structure, "custom_components", {}) or {}
    if not isinstance(struct_custom, dict):
        struct_custom = {}
    row_custom = row.get("custom_components", {}) or {}
    if not isinstance(row_custom, dict):
        row_custom = {}

    # Flexible Benefit Plan (FBP) Evaluation
    raw_fbp_add = row.get("fbp")
    if raw_fbp_add is None:
        raw_fbp_add = row_custom.get("FBP") or row_custom.get("fbp")
    if isinstance(raw_fbp_add, dict):
        raw_fbp_add = raw_fbp_add.get("additional_amount") or raw_fbp_add.get("amount") or Decimal("0")
    try:
        fbp_additional = Decimal(str(raw_fbp_add if raw_fbp_add is not None else "0")).quantize(Decimal("0.01"))
    except Exception:
        fbp_additional = Decimal("0")

    earned_fbp = ((original_fbp * proration_ratio).quantize(Decimal("0.01")) + fbp_additional).quantize(Decimal("0.01"))

    if original_fbp > Decimal("0") or earned_fbp > Decimal("0"):
        fbp_comp_dict = {
            "code": "FBP",
            "abbr": "FBP",
            "name": "Flexible Benefit Plan",
            "component_code": "FBP",
            "component_name": "Flexible Benefit Plan",
            "component_type": "EARNING",
            "type": "EARNING",
            "payout_frequency": "MONTHLY",
            "payout_month": None,
            "contracted_amount": round(float(original_fbp), 2),
            "earned_prorated": round(float((original_fbp * proration_ratio).quantize(Decimal("0.01"))), 2),
            "additional_amount": round(float(fbp_additional), 2),
            "arrears_amount": 0.0,
            "total_amount": round(float(earned_fbp), 2),
            "amount": round(float(earned_fbp), 2),
            "is_taxable": True,
            "is_pf_eligible": False,
            "is_esi_eligible": False,
            "remove_if_zero_valued": True,
            "source": "CONTRACT_MASTER",
        }
        custom_earnings_list.append(fbp_comp_dict)
        dynamic_earnings_total += earned_fbp

    all_custom_codes = sorted(list(set(struct_custom.keys()) | set(row_custom.keys())))
    METADATA_KEYS = {
        "esi_opted", "employer_esi", "employer_esi_in_ctc",
        "esi_number", "uan_number", "employer_pf", "employer_pf_in_ctc",
        "employer_pf_contribution", "is_senior_citizen", "non_eps",
        "employment_type", "is_intern", "pf_opted",
        "gratuity", "gratuity_in_ctc",
        "carve_out_fbp_in_ctc", "carve_out_custom_in_ctc",
    }

    for code in all_custom_codes:
        code_clean = str(code).strip().lower()
        if (
            code_clean in METADATA_KEYS
            or code_clean.startswith("__")
            or code_clean.startswith("carve_out_")
            or code_clean in ("basic_da", "hra", "lta", "special_allowance", "fbp", "contracted_fbp")
        ):
            continue

        c_struct = struct_custom.get(code, {})
        c_row = row_custom.get(code, {})
        if not isinstance(c_struct, dict):
            try:
                c_struct = {"contracted_amount": Decimal(str(c_struct))}
            except Exception:
                c_struct = {}
        if not isinstance(c_row, dict):
            try:
                c_row = {"additional_amount": Decimal(str(c_row))}
            except Exception:
                c_row = {}

        comp_type = str(c_row.get("component_type") or c_struct.get("component_type") or "EARNING").upper()
        payout_freq = str(c_row.get("payout_frequency") or c_struct.get("payout_frequency") or "MONTHLY").upper()
        payout_month = c_row.get("payout_month") if c_row.get("payout_month") is not None else c_struct.get("payout_month")

        try:
            contracted_amt = Decimal(str(c_struct.get("contracted_amount", 0) or 0))
        except Exception:
            contracted_amt = Decimal("0")
        try:
            additional_amt = Decimal(str(c_row.get("additional_amount", 0) or 0))
        except Exception:
            additional_amt = Decimal("0")
        try:
            arrears_amt = Decimal(str(c_row.get("arrears_amount", 0) or 0))
        except Exception:
            arrears_amt = Decimal("0")

        is_taxable = bool(c_struct.get("is_taxable", True) if "is_taxable" in c_struct else c_row.get("is_taxable", True))
        is_pf_eligible = bool(c_struct.get("is_pf_eligible", False) or c_row.get("is_pf_eligible", False))
        is_esi_eligible = bool(c_struct.get("is_esi_eligible", True) if ("is_esi_eligible" in c_struct or "is_esi_eligible" in c_row) else True)

        is_payout_active = True
        if payout_freq == "ANNUAL":
            try:
                p_month_int = int(payout_month) if payout_month is not None else None
            except Exception:
                p_month_int = None
            if p_month_int is not None and context.month != p_month_int:
                is_payout_active = False

        if not is_payout_active:
            earned_prorated = Decimal("0.00")
            total_component_amt = (additional_amt + arrears_amt).quantize(Decimal("0.01"))
        else:
            earned_prorated = (contracted_amt * proration_ratio).quantize(Decimal("0.01"))
            total_component_amt = (earned_prorated + additional_amt + arrears_amt).quantize(Decimal("0.01"))

        comp_dict = {
            "component_code": code,
            "component_name": c_row.get("component_name") or c_struct.get("component_name") or code,
            "component_type": comp_type,
            "payout_frequency": payout_freq,
            "payout_month": payout_month,
            "contracted_amount": round(float(contracted_amt), 2),
            "earned_prorated": round(float(earned_prorated), 2),
            "additional_amount": round(float(additional_amt), 2),
            "arrears_amount": round(float(arrears_amt), 2),
            "total_amount": round(float(total_component_amt), 2),
            "amount": round(float(total_component_amt), 2),
            "is_taxable": is_taxable,
            "is_pf_eligible": is_pf_eligible,
            "is_esi_eligible": is_esi_eligible,
        }

        if comp_type == "EARNING":
            custom_earnings_list.append(comp_dict)
            dynamic_earnings_total += total_component_amt
            if is_pf_eligible:
                pf_extra_contracted += contracted_amt
                pf_extra_earned += total_component_amt
            if not is_esi_eligible:
                esi_excluded_earnings += total_component_amt
        else:
            custom_deductions_list.append(comp_dict)
            dynamic_deductions_total += total_component_amt

    commission_other = Decimal(str(row.get("commission_other", 0) or 0))
    arrears = Decimal(str(row.get("arrears", 0) or 0))

    earned_salary = (
        basic_da + hra
        + lta
        + special_allowance
        + nps_allowance_earned
        + variable_pay
        + commission_other
        + arrears
        + dynamic_earnings_total
    ).quantize(Decimal("0.01"))

    context.original_basic_da = original_basic_da
    context.original_hra = original_hra
    context.original_special_allowance = original_special_allowance
    context.original_lta = original_lta
    context.original_nps_allowance = original_nps_allowance
    context.original_fbp = original_fbp
    context.monthly_gross = monthly_gross
    context.vpf = vpf
    context.pf_opted = pf_opted
    context.basic_da = basic_da
    context.hra = hra
    context.variable_pay = variable_pay
    context.special_allowance = special_allowance
    context.lta = lta
    context.nps_allowance_earned = nps_allowance_earned
    context.fbp = earned_fbp
    context.earned_salary = earned_salary
    context.custom_earnings_list = custom_earnings_list
    context.custom_deductions_list = custom_deductions_list
    context.dynamic_earnings_total = dynamic_earnings_total
    context.dynamic_deductions_total = dynamic_deductions_total
    context.pf_extra_contracted = pf_extra_contracted
    context.pf_extra_earned = pf_extra_earned
    context.esi_excluded_earnings = esi_excluded_earnings

    context.audit_trail["stage_2_earnings"] = {
        "monthly_gross": float(monthly_gross),
        "earned_basic_da": float(basic_da),
        "earned_hra": float(hra),
        "earned_salary": float(earned_salary),
        "dynamic_earnings_total": float(dynamic_earnings_total),
    }
    return context


# ── Stage 3: Statutory Compliance Deductions ──────────────────────────────────

def compute_statutory_deductions(context: PayrollContext) -> PayrollContext:
    """
    Evaluates statutory deductions for EPF, ESIC, State Professional Tax,
    and Labour Welfare Fund (LWF) according to statutory ceilings and state rules.
    """
    structure = context.structure
    row = context.row or {}
    client_profile = context.client_profile
    pf_opted = context.pf_opted
    basic_da = context.basic_da
    original_basic_da = context.original_basic_da
    earned_salary = context.earned_salary
    month = context.month
    year = context.year

    # 1. Statutory EPF & Wage Ceiling Evaluation
    pf_rule = (
        context.pf_calculation_rule
        or getattr(structure, "pf_calculation_rule", None)
        or (getattr(client_profile, "pf_calculation_rule", None) if client_profile else None)
        or ("CAPPED_1800" if pf_opted else "NOT_OPTED")
    )
    raw_ceiling = (
        context.pf_wage_ceiling
        if context.pf_wage_ceiling is not None
        else getattr(structure, "pf_wage_ceiling", None)
    )
    if raw_ceiling is None and client_profile is not None:
        raw_ceiling = getattr(client_profile, "pf_wage_ceiling", None)

    if raw_ceiling is not None:
        try:
            effective_pf_ceiling = Decimal(str(raw_ceiling))
        except Exception:
            effective_pf_ceiling = PF_WAGE_CEILING_25K if pf_rule == "CAPPED_3000" else PF_WAGE_CEILING
    else:
        effective_pf_ceiling = PF_WAGE_CEILING_25K if pf_rule == "CAPPED_3000" else PF_WAGE_CEILING

    if effective_pf_ceiling <= Decimal("0"):
        effective_pf_ceiling = PF_WAGE_CEILING_25K if pf_rule == "CAPPED_3000" else PF_WAGE_CEILING

    pf_wage_earned = max(Decimal("0.00"), basic_da + context.pf_extra_earned)
    pf_wage_contracted = max(Decimal("0.00"), original_basic_da + context.pf_extra_contracted)
    basic_for_pf = max(Decimal("0.00"), min(pf_wage_earned, effective_pf_ceiling))

    if not pf_opted or pf_rule == "NOT_OPTED" or pf_wage_earned <= Decimal("0"):
        epf = Decimal("0.00")
        basic_for_pf = Decimal("0.00")
    elif pf_rule == "ON_ACTUAL_BASIC":
        epf = (pf_wage_earned * EPF_RATE).quantize(Decimal("0.01"))
        basic_for_pf = pf_wage_earned
    elif pf_rule == "ON_GROSS_MINUS_HRA":
        gross_ex_hra = max(Decimal("0.00"), earned_salary - context.hra)
        epf = (gross_ex_hra * EPF_RATE).quantize(Decimal("0.01"))
        basic_for_pf = gross_ex_hra
    elif pf_rule == "CUSTOM_PERCENTAGE":
        resolved_pf_pct = (
            context.pf_custom_pct
            if context.pf_custom_pct is not None
            else getattr(structure, "pf_custom_pct", None)
        )
        if resolved_pf_pct is None and client_profile is not None:
            resolved_pf_pct = getattr(client_profile, "pf_custom_pct", Decimal("12"))
        resolved_pf_base = (
            context.pf_custom_base
            or getattr(structure, "pf_custom_base", None)
            or (getattr(client_profile, "pf_custom_base", "BASIC") if client_profile else "BASIC")
        )
        if context.pf_custom_capped is not None:
            resolved_pf_capped = bool(context.pf_custom_capped)
        elif getattr(structure, "pf_custom_capped", None) is not None:
            resolved_pf_capped = bool(getattr(structure, "pf_custom_capped"))
        elif client_profile is not None:
            resolved_pf_capped = bool(getattr(client_profile, "pf_custom_capped", True))
        else:
            resolved_pf_capped = True

        custom_rate = Decimal(str(resolved_pf_pct if resolved_pf_pct is not None else 12)) / Decimal("100")
        custom_base_val = earned_salary if str(resolved_pf_base).upper() == "GROSS" else pf_wage_earned
        if resolved_pf_capped:
            custom_base_val = min(custom_base_val, effective_pf_ceiling)
        epf = (custom_base_val * custom_rate).quantize(Decimal("0.01"))
    else:
        epf = (basic_for_pf * EPF_RATE).quantize(Decimal("0.01"))

    if basic_da > Decimal("0") and epf > basic_da:
        epf = basic_da.quantize(Decimal("0.01"))
    elif basic_da <= Decimal("0") and epf > Decimal("0"):
        epf = Decimal("0.00")

    empr_pf_in_ctc = bool(
        getattr(structure, "employer_pf_in_ctc", True)
        if structure is not None
        else (getattr(client_profile, "employer_pf_in_ctc", True) if client_profile else True)
    )
    employer_pf = epf if (pf_opted and empr_pf_in_ctc) else Decimal("0.00")

    # 2. Professional Tax (PT) Evaluation
    resolved_pt_pct = (
        context.pt_custom_pct
        if context.pt_custom_pct is not None
        else (getattr(client_profile, "pt_custom_pct", Decimal("0")) if client_profile else Decimal("0"))
    )
    resolved_pt_base = (
        context.pt_custom_base
        or (getattr(client_profile, "pt_custom_base", "GROSS") if client_profile else "GROSS")
    )
    resolved_pt_cap = (
        context.pt_custom_cap
        if context.pt_custom_cap is not None
        else (getattr(client_profile, "pt_custom_cap", Decimal("200")) if client_profile else Decimal("200"))
    )
    professional_tax = calculate_professional_tax(
        monthly_gross=context.monthly_gross,
        month=month,
        pt_state=context.pt_state,
        gender=context.employee_gender,
        custom_amount=context.pt_amount,
        basic_da=original_basic_da,
        earned_salary=earned_salary,
        pt_custom_pct=resolved_pt_pct,
        pt_custom_base=resolved_pt_base,
        pt_custom_cap=resolved_pt_cap,
    )

    # 3. Statutory ESI Evaluation
    esi_rule = (
        str(getattr(client_profile, "esi_calculation_rule", "STATUTORY_21K") or "STATUTORY_21K").strip().upper()
        if client_profile is not None
        else "STATUTORY_21K"
    )
    default_esi_ceil = Decimal("25000") if esi_rule == "STATUTORY_25K" else Decimal("21000")
    raw_esi_ceil = getattr(client_profile, "esi_wage_ceiling", None) if client_profile is not None else None
    try:
        parsed_esi_ceil = Decimal(str(raw_esi_ceil)) if raw_esi_ceil is not None else Decimal("0")
    except Exception:
        parsed_esi_ceil = Decimal("0")
    if esi_rule == "STATUTORY_25K" and parsed_esi_ceil == Decimal("21000"):
        ESI_WAGE_CEILING = Decimal("25000")
    elif parsed_esi_ceil > 0:
        ESI_WAGE_CEILING = parsed_esi_ceil
    else:
        ESI_WAGE_CEILING = default_esi_ceil

    raw_emp_pct = getattr(client_profile, "esi_employee_pct", "0.75") if client_profile is not None else "0.75"
    raw_empr_pct = getattr(client_profile, "esi_employer_pct", "3.25") if client_profile is not None else "3.25"
    try:
        ESI_EMPLOYEE_RATE = Decimal(str(raw_emp_pct if raw_emp_pct is not None else "0.75")) / Decimal("100")
    except Exception:
        ESI_EMPLOYEE_RATE = Decimal("0.0075")
    try:
        ESI_EMPLOYER_RATE = Decimal(str(raw_empr_pct if raw_empr_pct is not None else "3.25")) / Decimal("100")
    except Exception:
        ESI_EMPLOYER_RATE = Decimal("0.0325")
    esi_custom_base = (
        str(getattr(client_profile, "esi_custom_base", "GROSS") or "GROSS").strip().upper()
        if client_profile is not None
        else "GROSS"
    )
    esi_continuity_policy = (
        bool(getattr(client_profile, "esi_period_continuity", True))
        if client_profile is not None
        else True
    )

    esi_opted = getattr(structure, "esi_opted", False) if structure else False
    if not esi_opted and structure and (esi_rule == "UNCAPPED" or getattr(structure, "monthly_gross", Decimal("0")) <= ESI_WAGE_CEILING):
        if isinstance(getattr(structure, "custom_components", None), dict):
            esi_opted = bool(structure.custom_components.get("esi_opted", False))

    if not esi_opted and esi_continuity_policy:
        if context.esi_continuity_active is True:
            esi_opted = True
        elif context.esi_continuity_active is None and structure is not None and year is not None and month is not None:
            emp_obj = getattr(structure, "employee", None)
            if emp_obj is not None and hasattr(emp_obj, "has_esi_period_continuity"):
                esi_opted = bool(emp_obj.has_esi_period_continuity(int(year), int(month), ESI_WAGE_CEILING))

    if esi_opted and esi_rule != "UNCAPPED":
        contracted_gross = Decimal(str(getattr(structure, "monthly_gross", context.monthly_gross) or context.monthly_gross))
        if contracted_gross > ESI_WAGE_CEILING:
            has_cont = bool(context.esi_continuity_active)
            if not has_cont and esi_continuity_policy and structure is not None and year is not None and month is not None:
                emp_obj = getattr(structure, "employee", None)
                if emp_obj is not None and hasattr(emp_obj, "has_esi_period_continuity"):
                    has_cont = bool(emp_obj.has_esi_period_continuity(int(year), int(month), ESI_WAGE_CEILING))
            if not has_cont and not getattr(structure, "esi_opted", False):
                esi_opted = False

    if esi_rule == "CUSTOM_RULE" and esi_custom_base == "BASIC":
        esi_wage_base = max(Decimal("0"), basic_da)
    else:
        esi_wage_base = max(Decimal("0"), earned_salary - context.esi_excluded_earnings)

    esi_round_mode = (
        str(getattr(client_profile, "esi_rounding_mode", "CEIL_RUPEE") or "CEIL_RUPEE").strip().upper()
        if client_profile is not None
        else "CEIL_RUPEE"
    )

    def _round_esi_amount(raw_val: Decimal) -> Decimal:
        if raw_val <= Decimal("0"):
            return Decimal("0.00")
        if esi_round_mode == "CEIL_RUPEE":
            return raw_val.quantize(Decimal("1"), rounding=ROUND_CEILING).quantize(Decimal("0.01"))
        if esi_round_mode == "NEAREST_RUPEE":
            return raw_val.quantize(Decimal("1"), rounding=ROUND_HALF_UP).quantize(Decimal("0.01"))
        return raw_val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    if "esi" in row:
        esi_deduction = Decimal(str(row["esi"] or 0)).quantize(Decimal("0.01"))
    elif esi_opted:
        esi_deduction = _round_esi_amount(esi_wage_base * ESI_EMPLOYEE_RATE)
    else:
        esi_deduction = Decimal("0")

    employer_esi = _round_esi_amount(esi_wage_base * ESI_EMPLOYER_RATE) if esi_opted else Decimal("0")

    if esi_deduction > 0 and not any(d.get("code") == "ESI" for d in context.custom_deductions_list):
        esi_entry = {
            "code": "ESI",
            "name": "Employees' State Insurance",
            "abbr": "ESI",
            "default_amount": float(esi_deduction),
            "additional_amount": 0.0,
            "amount": float(esi_deduction),
            "depends_on_payment_days": False,
            "do_not_include_in_total": False,
            "source": "STATUTORY",
        }
        context.custom_deductions_list.append(esi_entry)
        context.dynamic_deductions_total += esi_deduction

    # 4. State Labour Welfare Fund (LWF) Evaluation
    lwf_rule = (
        str(getattr(client_profile, "lwf_state", "EXEMPT_ZERO") or "EXEMPT_ZERO").strip().upper()
        if client_profile is not None
        else "EXEMPT_ZERO"
    )
    lwf_emp_cfg = (
        Decimal(str(getattr(client_profile, "lwf_employee_amount", "20.00") or "20.00"))
        if client_profile is not None
        else Decimal("20.00")
    )
    computed_lwf = Decimal("0.00")
    if lwf_rule == "KARNATAKA_DEC" and int(month or 0) == 12:
        computed_lwf = lwf_emp_cfg if lwf_emp_cfg > 0 else Decimal("20.00")
    elif lwf_rule == "MAHARASHTRA_JUN_DEC" and int(month or 0) in (6, 12):
        computed_lwf = lwf_emp_cfg if lwf_emp_cfg > 0 else Decimal("25.00")
    elif lwf_rule == "CUSTOM_DECEMBER" and int(month or 0) == 12:
        computed_lwf = lwf_emp_cfg
    elif lwf_rule == "CUSTOM_MONTHLY":
        computed_lwf = lwf_emp_cfg

    context.basic_for_pf = basic_for_pf
    context.epf = epf
    context.employer_pf = employer_pf
    context.esi = esi_deduction
    context.employer_esi = employer_esi
    context.professional_tax = professional_tax
    context.computed_lwf = computed_lwf

    context.audit_trail["stage_3_statutory"] = {
        "pf_rule": pf_rule,
        "effective_pf_ceiling": float(effective_pf_ceiling),
        "epf": float(epf),
        "employer_pf": float(employer_pf),
        "professional_tax": float(professional_tax),
        "esi": float(esi_deduction),
        "employer_esi": float(employer_esi),
        "computed_lwf": float(computed_lwf),
    }
    return context


# ── Stage 4: Internal Deductions & Adjustments ────────────────────────────────

def compute_internal_adjustments_and_hold(context: PayrollContext) -> PayrollContext:
    """
    Collects internal monthly payroll deductions such as statutory TDS,
    loan EMI repayments, salary advance installments, and on-hold parking deductions.
    """
    row = context.row or {}

    tds = Decimal(str(row.get("tds", 0) or 0)).quantize(Decimal("0.01"))
    loan_deduction = Decimal(str(row.get("loan_deduction", 0) or 0)).quantize(Decimal("0.01"))
    salary_advance_recovered = Decimal(str(row.get("salary_advance_recovered", 0) or 0)).quantize(Decimal("0.01"))
    on_hold_deducted = Decimal(str(row.get("on_hold_deducted", 0) or 0)).quantize(Decimal("0.01"))
    other_deduction = Decimal(str(row.get("other_deduction", 0) or 0)).quantize(Decimal("0.01"))

    context.tds = tds
    context.loan_deduction = loan_deduction
    context.salary_advance_recovered = salary_advance_recovered
    context.on_hold_deducted = on_hold_deducted
    context.other_deduction = other_deduction

    context.audit_trail["stage_4_adjustments"] = {
        "tds": float(tds),
        "loan_deduction": float(loan_deduction),
        "salary_advance_recovered": float(salary_advance_recovered),
        "on_hold_deducted": float(on_hold_deducted),
        "other_deduction": float(other_deduction),
    }
    return context


# ── Stage 5: Net Settlement & Final Packaging ─────────────────────────────────

def settle_net_salary_and_ledgers(context: PayrollContext) -> PayrollContext:
    """
    Calculates total deductions, applies Zero Net Pay Guard to prevent negative salary,
    derives take-home net salary, and packages the complete result dictionary.
    """
    row = context.row or {}
    earned_salary = context.earned_salary

    total_deductions = (
        context.epf
        + context.esi
        + context.vpf
        + context.professional_tax
        + context.computed_lwf
        + context.tds
        + context.loan_deduction
        + context.salary_advance_recovered
        + context.on_hold_deducted
        + context.other_deduction
        + context.dynamic_deductions_total
    ).quantize(Decimal("0.01"))

    zero_net_capped = False
    capped_amount = Decimal("0.00")
    if total_deductions > earned_salary:
        excess = total_deductions - earned_salary
        if context.salary_advance_recovered > Decimal("0"):
            reduction = min(excess, context.salary_advance_recovered)
            context.salary_advance_recovered -= reduction
            total_deductions -= reduction
            excess -= reduction
            zero_net_capped = True
            capped_amount += reduction
        if excess > Decimal("0") and context.loan_deduction > Decimal("0"):
            reduction = min(excess, context.loan_deduction)
            context.loan_deduction -= reduction
            total_deductions -= reduction
            zero_net_capped = True
            capped_amount += reduction

    net_salary = max(Decimal("0.00"), (earned_salary - total_deductions).quantize(Decimal("0.01")))

    evaluated_custom_components = sanitize_for_json({
        "earnings": context.custom_earnings_list,
        "deductions": context.custom_deductions_list,
    })

    result_dict = {
        "actual_working_days": context.actual_working_days,
        "effective_present_days": context.effective_present_days,
        "basic_da": context.basic_da,
        "hra": context.hra,
        "lta": context.lta,
        "special_allowance": context.special_allowance,
        "nps_allowance_earned": context.nps_allowance_earned,
        "fbp": context.fbp,
        "basic_for_pf": context.basic_for_pf,
        "epf": context.epf,
        "employer_pf": context.employer_pf,
        "esi": context.esi,
        "employer_esi": context.employer_esi,
        "vpf": context.vpf,
        "professional_tax": context.professional_tax,
        "gross_salary": context.monthly_gross,
        "variable_pay": context.variable_pay,
        "earned_salary": context.earned_salary,
        "custom_components": evaluated_custom_components,
        "comp_off_opening_balance": context.comp_off_opening_balance,
        "comp_off_days_used": context.comp_off_days_used,
        "comp_off_closing_balance": context.comp_off_closing_balance,
        "leave_opening_balance": context.leave_opening_balance,
        "leave_accrued": context.leave_accrued,
        "leave_used": context.leave_used,
        "leave_closing_balance": context.leave_closing_balance,
    }
    if "lwf" not in row and context.computed_lwf > Decimal("0"):
        result_dict["lwf"] = context.computed_lwf.quantize(Decimal("0.01"))

    context.total_deductions = total_deductions
    context.net_salary = net_salary
    context.evaluated_custom_components = evaluated_custom_components
    context.result_dict = result_dict

    context.audit_trail["stage_5_settlement"] = {
        "total_deductions": float(total_deductions),
        "net_salary": float(net_salary),
        "zero_net_capped": zero_net_capped,
        "capped_amount": float(capped_amount),
    }
    result_dict["audit_trail"] = context.audit_trail
    return context


# ── Master Sequential Pipeline Coordinator ────────────────────────────────────

def calculate_payslip_fields(
    structure=None, row: dict = None, month: int = None, days_in_month: int = None,
    comp_off_opening_balance=Decimal("0"),
    leave_opening_balance=Decimal("0"),
    is_probation=False,
    lop_policy="ACCRUE_LEAVE_DEBT",
    pt_state="KARNATAKA",
    pt_amount=Decimal("0"),
    annual_leave_days=None,
    employee_gender="M",
    track_leave_ledger=True,
    track_comp_off=True,
    pf_calculation_rule=None,
    pf_wage_ceiling=None,
    pf_custom_pct=None,
    pf_custom_base=None,
    pf_custom_capped=None,
    pt_custom_pct=None,
    pt_custom_base=None,
    pt_custom_cap=None,
    client_profile=None,
    esi_continuity_active=None,
    year=None,
    context=None,
) -> dict:
    """
    Coordinates the 5-stage sequential calculation pipeline.
    Maintains 100% backward compatibility with all existing callers passing loose arguments,
    while also accepting a direct PayrollContext object.
    """
    # 1. Adapt from direct context or build from loose arguments
    if isinstance(structure, PayrollContext):
        ctx = structure
    elif context is not None:
        ctx = context
    else:
        ctx = PayrollContext(
            structure=structure,
            row=row or {},
            month=month,
            days_in_month=days_in_month,
            comp_off_opening_balance=Decimal(str(comp_off_opening_balance or 0)),
            leave_opening_balance=Decimal(str(leave_opening_balance or 0)),
            is_probation=is_probation,
            lop_policy=lop_policy,
            pt_state=pt_state,
            pt_amount=Decimal(str(pt_amount or 0)),
            annual_leave_days=annual_leave_days,
            employee_gender=employee_gender,
            track_leave_ledger=track_leave_ledger,
            track_comp_off=track_comp_off,
            pf_calculation_rule=pf_calculation_rule,
            pf_wage_ceiling=pf_wage_ceiling,
            pf_custom_pct=pf_custom_pct,
            pf_custom_base=pf_custom_base,
            pf_custom_capped=pf_custom_capped,
            pt_custom_pct=pt_custom_pct,
            pt_custom_base=pt_custom_base,
            pt_custom_cap=pt_custom_cap,
            client_profile=client_profile,
            esi_continuity_active=esi_continuity_active,
            year=year,
        )

    # 2. Sequential 5-Stage Pipeline Execution
    pipeline = [
        settle_attendance_and_proration,
        compute_contracted_and_dynamic_earnings,
        compute_statutory_deductions,
        compute_internal_adjustments_and_hold,
        settle_net_salary_and_ledgers,
    ]
    for stage in pipeline:
        ctx = stage(ctx)

    return ctx.to_dict()



# ─────────────────────────────────────────────────────────────────────────────
# CTC SALARY STRUCTURING ENGINE (build_from_ctc)
# ─────────────────────────────────────────────────────────────────────────────

RESERVED_METADATA_KEYS = {
    "esi_opted",
    "employer_esi",
    "employer_esi_in_ctc",
    "esi_number",
    "uan_number",
    "employer_pf",
    "employer_pf_in_ctc",
    "is_senior_citizen",
    "non_eps",
    "employment_type",
    "is_intern",
    "carve_out_fbp_in_ctc",
    "carve_out_custom_in_ctc",
    "pf_opted",
    "gratuity_in_ctc",
    "gratuity",
}

def _resolve_structuring_policy(policy: dict | None, client: Any, employee: Any) -> tuple[dict, Any, Any]:
    """
    Tier 0: Policy & Profile Resolution.
    Resolves client from employee, retrieves ClientProfile, and constructs
    the policy dictionary if not explicitly provided.
    """
    target_client = client
    if target_client is None and employee is not None:
        target_client = getattr(employee, "client", None)

    resolved_profile = None
    if target_client is not None:
        resolved_profile = getattr(target_client, "payroll_profile", None)
        if resolved_profile is None:
            from .models import ClientProfile
            if isinstance(target_client, (int, str)):
                resolved_profile = ClientProfile.objects.filter(client_id=target_client).first()
            else:
                resolved_profile = ClientProfile.objects.filter(client=target_client).first()

    if policy is None and resolved_profile is not None:
        policy = {
            "basic_calculation_type": resolved_profile.basic_calculation_type,
            "basic_percentage": resolved_profile.basic_percentage,
            "basic_flat_amount": resolved_profile.basic_flat_amount,
            "hra_calculation_type": resolved_profile.hra_calculation_type,
            "hra_percentage": resolved_profile.hra_percentage,
            "hra_flat_amount": resolved_profile.hra_flat_amount,
            "pf_calculation_rule": resolved_profile.pf_calculation_rule,
            "pf_wage_ceiling": resolved_profile.pf_wage_ceiling,
            "pf_custom_pct": resolved_profile.pf_custom_pct,
            "pf_custom_base": resolved_profile.pf_custom_base,
            "pf_custom_capped": resolved_profile.pf_custom_capped,
            "employer_pf_in_ctc": resolved_profile.employer_pf_in_ctc,
            "esi_enabled": resolved_profile.esi_enabled,
            "esi_calculation_rule": resolved_profile.esi_calculation_rule,
            "esi_wage_ceiling": resolved_profile.esi_wage_ceiling,
            "esi_employee_pct": resolved_profile.esi_employee_pct,
            "esi_employer_pct": resolved_profile.esi_employer_pct,
            "esi_custom_base": resolved_profile.esi_custom_base,
            "employer_esi_in_ctc": resolved_profile.employer_esi_in_ctc,
            "gratuity_in_ctc": resolved_profile.gratuity_in_ctc,
            "gratuity_pct": resolved_profile.gratuity_pct,
            "lta_calculation_type": resolved_profile.lta_calculation_type,
            "lta_percentage": resolved_profile.lta_percentage,
            "lta_flat_amount": resolved_profile.lta_flat_amount,
            "carve_out_fbp_in_ctc": resolved_profile.carve_out_fbp_in_ctc,
            "carve_out_custom_in_ctc": resolved_profile.carve_out_custom_in_ctc,
        }

    return (policy or {}, resolved_profile, target_client)


def _get_monthly_carveout(amount_dec: Decimal, freq_str: str) -> Decimal:
    """Helper to convert quarterly, annual, or separation payouts to monthly equivalents."""
    q = Decimal("0.01")
    f = str(freq_str or "MONTHLY").strip().upper()
    if f == "ANNUAL":
        return (amount_dec / Decimal("12")).quantize(q)
    if f == "QUARTERLY":
        return (amount_dec / Decimal("3")).quantize(q)
    if f in ("ON_SEPARATION", "SEPARATION"):
        return (amount_dec / Decimal("12")).quantize(q)
    return amount_dec


def _extract_upfront_carveouts(
    monthly_pool: Decimal,
    p: dict,
    custom_components: dict | None,
    target_client: Any,
    reapply_policy: bool,
    fbp: Decimal,
) -> tuple[Decimal, Decimal, Decimal, dict, dict, bool, bool]:
    """
    Tier 1: Upfront Non-Cash Carve-Outs.
    Separates Flexible Benefit Plan (FBP) and client catalog/custom non-cash allowances
    from the monthly pool before calculating monthly gross salary.
    """
    q = Decimal("0.01")
    carve_out_fbp = bool(p.get("carve_out_fbp_in_ctc", False))
    carve_out_custom = bool(p.get("carve_out_custom_in_ctc", False))
    fbp_carveout = fbp if carve_out_fbp else Decimal("0")

    catalog_comps_map = {}
    if target_client is not None:
        from django.db.models import Q
        from .models import SalaryComponent
        client_id = target_client if isinstance(target_client, (int, str)) else getattr(target_client, "id", None)
        if client_id:
            for c in SalaryComponent.objects.filter(
                Q(client_id=client_id) | Q(client__isnull=True),
                is_active=True
            ).exclude(code__startswith="__"):
                if not getattr(c, "is_monthly_variable", False) and (c.formula or "").strip().upper() != "VARIABLE":
                    catalog_comps_map[c.code] = c
                    catalog_comps_map[c.code.upper()] = c

    custom_carveout = Decimal("0")
    effective_custom_items = dict(custom_components or {})
    active_reserved_keys = getattr(sys.modules.get(__name__), "RESERVED_METADATA_KEYS", RESERVED_METADATA_KEYS)
    for mkey in active_reserved_keys:
        effective_custom_items.pop(mkey, None)

    # Include catalog defaults for any component not explicitly provided
    for code, c in catalog_comps_map.items():
        if code not in effective_custom_items and c.component_type == "EARNING" and c.calculation_type == "FLAT":
            if carve_out_custom or getattr(c, "carve_out_from_ctc", False):
                try:
                    amt = Decimal(str(c.default_value or 0))
                    freq = getattr(c, "payout_frequency", "MONTHLY")
                    custom_carveout += _get_monthly_carveout(amt, freq)
                except Exception:
                    pass

    for comp in effective_custom_items.values():
        if isinstance(comp, dict) and (comp.get("type") == "EARNING" or comp.get("component_type") == "EARNING") and (comp.get("calculation_type") or comp.get("calc_type", "FLAT")) == "FLAT":
            c_code = comp.get("code")
            if reapply_policy and target_client is not None and c_code and c_code not in catalog_comps_map:
                continue
            cat_comp = catalog_comps_map.get(c_code) if c_code else None
            is_carved = carve_out_custom or comp.get("carve_out_from_ctc") or (getattr(cat_comp, "carve_out_from_ctc", False) if cat_comp else False)
            if is_carved:
                try:
                    amt = Decimal(str(comp.get("amount", comp.get("default_value", 0)) or 0))
                    freq = comp.get("payout_frequency") or (getattr(cat_comp, "payout_frequency", "MONTHLY") if cat_comp else "MONTHLY")
                    custom_carveout += _get_monthly_carveout(amt, freq)
                except Exception:
                    pass
        elif isinstance(comp, (int, float, Decimal)):
            if carve_out_custom:
                try:
                    custom_carveout += Decimal(str(comp or 0))
                except Exception:
                    pass
        elif isinstance(comp, str):
            if carve_out_custom:
                try:
                    custom_carveout += Decimal(comp.strip() or "0")
                except Exception:
                    pass

    gross_pool = max(Decimal("0"), monthly_pool - fbp_carveout - custom_carveout)
    return (gross_pool, fbp_carveout, custom_carveout, catalog_comps_map, effective_custom_items, carve_out_fbp, carve_out_custom)


def _solve_statutory_reserves_and_gross(
    gross_pool: Decimal,
    monthly_pool: Decimal,
    p: dict,
    resolved_profile: Any,
    pf_opted: bool,
    employee: Any,
    custom_components: dict | None,
    kwargs: dict,
) -> dict:
    """
    Tier 2: Statutory Reserves & Simultaneous Gross Solver.
    Resolves EPF, ESIC, and Gratuity employer contribution reserves, and derives
    the true Monthly Base Gross algebraically without circular dependency loops.
    """
    q = Decimal("0.01")
    basic_calc_type = p.get("basic_calculation_type", "PERCENT_GROSS")
    basic_pct = Decimal(str(p.get("basic_percentage", "50.00"))) / Decimal("100")
    basic_flat = Decimal(str(p.get("basic_flat_amount", "0.00")))

    pf_rule = p.get("pf_calculation_rule", "CAPPED_1800" if pf_opted else "NOT_OPTED")
    employer_pf_in_ctc = p.get("employer_pf_in_ctc", True)
    actual_pf_opted = bool(pf_opted and pf_rule != "NOT_OPTED")

    pf_custom_pct_raw = p.get("pf_custom_pct", getattr(resolved_profile, "pf_custom_pct", "12.00") if resolved_profile else "12.00")
    pf_custom_rate = Decimal(str(pf_custom_pct_raw if pf_custom_pct_raw is not None else "12.00")) / Decimal("100")
    pf_custom_base = str(p.get("pf_custom_base", getattr(resolved_profile, "pf_custom_base", "BASIC") if resolved_profile else "BASIC") or "BASIC").strip().upper()
    pf_custom_capped_raw = p.get("pf_custom_capped", getattr(resolved_profile, "pf_custom_capped", True) if resolved_profile else True)
    pf_custom_capped = bool(pf_custom_capped_raw if pf_custom_capped_raw is not None else True)

    default_pf_ceiling = Decimal("25000") if pf_rule == "CAPPED_3000" else Decimal("15000")
    raw_pf_ceiling = p.get("pf_wage_ceiling", getattr(resolved_profile, "pf_wage_ceiling", None) if resolved_profile else None)
    try:
        parsed_ceiling = Decimal(str(raw_pf_ceiling)) if raw_pf_ceiling is not None else Decimal("0")
    except Exception:
        parsed_ceiling = Decimal("0")
    if pf_rule == "CAPPED_3000" and parsed_ceiling == Decimal("15000"):
        PF_WAGE_CEILING = Decimal("25000")
    elif parsed_ceiling > 0:
        PF_WAGE_CEILING = parsed_ceiling
    else:
        PF_WAGE_CEILING = default_pf_ceiling

    effective_pf_rate = pf_custom_rate if pf_rule == "CUSTOM_PERCENT" else Decimal("0.12")
    PF_FLAT_RESERVE = (PF_WAGE_CEILING * effective_pf_rate).quantize(q)
    is_pf_capped_rule = pf_rule in ("CAPPED_1800", "CAPPED_3000") or (pf_rule == "CUSTOM_PERCENT" and pf_custom_capped)

    # Employer ESI statutory constants & client configuration
    esi_rule = str(p.get("esi_calculation_rule", getattr(resolved_profile, "esi_calculation_rule", "STATUTORY_21K") if resolved_profile else "STATUTORY_21K") or "STATUTORY_21K").strip().upper()
    default_esi_ceiling = Decimal("25000") if esi_rule == "STATUTORY_25K" else Decimal("21000")
    raw_esi_ceiling = p.get("esi_wage_ceiling", getattr(resolved_profile, "esi_wage_ceiling", None) if resolved_profile else None)
    try:
        parsed_esi_ceiling = Decimal(str(raw_esi_ceiling)) if raw_esi_ceiling is not None else Decimal("0")
    except Exception:
        parsed_esi_ceiling = Decimal("0")
    if esi_rule == "STATUTORY_25K" and parsed_esi_ceiling == Decimal("21000"):
        ESI_WAGE_CEILING = Decimal("25000")
    elif parsed_esi_ceiling > 0:
        ESI_WAGE_CEILING = parsed_esi_ceiling
    else:
        ESI_WAGE_CEILING = default_esi_ceiling

    raw_esi_empr_pct = p.get("esi_employer_pct", getattr(resolved_profile, "esi_employer_pct", "3.25") if resolved_profile else "3.25")
    try:
        ESI_EMPLOYER_RATE = Decimal(str(raw_esi_empr_pct if raw_esi_empr_pct is not None else "3.25")) / Decimal("100")
    except Exception:
        ESI_EMPLOYER_RATE = Decimal("0.0325")
    esi_custom_base = str(p.get("esi_custom_base", getattr(resolved_profile, "esi_custom_base", "GROSS") if resolved_profile else "GROSS") or "GROSS").strip().upper()

    esi_enabled = p.get("esi_enabled")
    if esi_enabled is None and resolved_profile is not None:
        esi_enabled = getattr(resolved_profile, "esi_enabled", False)

    employer_esi_in_ctc = p.get("employer_esi_in_ctc", True)
    raw_esi_opted = kwargs.get("esi_opted")
    if raw_esi_opted is None and custom_components and isinstance(custom_components, dict):
        if "esi_opted" in custom_components:
            raw_esi_opted = custom_components["esi_opted"]
    if raw_esi_opted is None and employee is not None:
        try:
            emp_latest = getattr(employee, "latest_salary_structure", None)
            if not emp_latest and hasattr(employee, "salary_structures"):
                emp_latest = employee.salary_structures.order_by("-effective_from", "-id").first()
            if emp_latest:
                if isinstance(emp_latest.custom_components, dict) and "esi_opted" in emp_latest.custom_components:
                    raw_esi_opted = emp_latest.custom_components["esi_opted"]
                else:
                    raw_esi_opted = getattr(emp_latest, "esi_opted", None)
        except Exception:
            pass

    gratuity_in_ctc = bool(p.get("gratuity_in_ctc", getattr(resolved_profile, "gratuity_in_ctc", False) if resolved_profile else False))
    raw_grat_pct = p.get("gratuity_pct", getattr(resolved_profile, "gratuity_pct", "4.81") if resolved_profile else "4.81")
    try:
        GRATUITY_RATE = (Decimal(str(raw_grat_pct if raw_grat_pct is not None else "4.81")) / Decimal("100")) if gratuity_in_ctc else Decimal("0")
    except Exception:
        GRATUITY_RATE = Decimal("0.0481") if gratuity_in_ctc else Decimal("0")

    esi_pool_limit = (ESI_WAGE_CEILING * Decimal("1.15")).quantize(q)
    if raw_esi_opted is not None:
        actual_esi_opted = bool(raw_esi_opted)
    elif esi_enabled:
        actual_esi_opted = True if esi_rule == "UNCAPPED" else (gross_pool <= esi_pool_limit)
    else:
        actual_esi_opted = False

    pf_base_ratio = Decimal("1") if (pf_rule == "CUSTOM_PERCENT" and pf_custom_base == "GROSS") else basic_pct
    esi_base_ratio = basic_pct if (esi_rule == "CUSTOM_RULE" and esi_custom_base == "BASIC") else Decimal("1")
    grat_rate_factor = (GRATUITY_RATE * basic_pct) if (gratuity_in_ctc and basic_calc_type != "CUSTOM_FIXED") else Decimal("0")

    reserve = Decimal("0")
    esi_reserve = Decimal("0")
    grat_reserve = Decimal("0")

    # High bracket / capped PF shortcut:
    if actual_pf_opted and employer_pf_in_ctc and is_pf_capped_rule and not gratuity_in_ctc and ((gross_pool - PF_FLAT_RESERVE) * pf_base_ratio) >= PF_WAGE_CEILING and (gross_pool - PF_FLAT_RESERVE) > ESI_WAGE_CEILING and esi_rule != "UNCAPPED":
        reserve = PF_FLAT_RESERVE
        actual_esi_opted = False if raw_esi_opted is None else actual_esi_opted
        esi_reserve = ((gross_pool * esi_base_ratio) * ESI_EMPLOYER_RATE).quantize(q) if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0")
        monthly_gross = (gross_pool - reserve - esi_reserve).quantize(q)
    else:
        # General algebraic derivation
        pf_rate = (effective_pf_rate * pf_base_ratio) if (actual_pf_opted and employer_pf_in_ctc) else Decimal("0")
        esi_rate = (ESI_EMPLOYER_RATE * esi_base_ratio) if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0")
        denom = Decimal("1") + pf_rate + esi_rate + grat_rate_factor
        tentative_gross = (gross_pool / denom).quantize(q) if denom > 0 else gross_pool

        # Re-solve with flat PF ceiling if tentative basic exceeds ceiling
        t_check_basic = min(basic_flat, tentative_gross) if (basic_calc_type == "CUSTOM_FIXED" and basic_flat > 0) else (tentative_gross * basic_pct).quantize(q)
        t_check_pf_base = tentative_gross if (pf_rule == "CUSTOM_PERCENT" and pf_custom_base == "GROSS") else t_check_basic
        if actual_pf_opted and employer_pf_in_ctc and is_pf_capped_rule and t_check_pf_base >= PF_WAGE_CEILING:
            denom_capped = Decimal("1") + esi_rate + grat_rate_factor
            tentative_gross = (max(Decimal("0"), gross_pool - PF_FLAT_RESERVE) / denom_capped).quantize(q) if denom_capped > 0 else max(Decimal("0"), gross_pool - PF_FLAT_RESERVE)

        if raw_esi_opted is None and esi_enabled:
            actual_esi_opted = True if esi_rule == "UNCAPPED" else (tentative_gross <= ESI_WAGE_CEILING)
            esi_rate = (ESI_EMPLOYER_RATE * esi_base_ratio) if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0")
            if actual_pf_opted and employer_pf_in_ctc and is_pf_capped_rule and t_check_pf_base >= PF_WAGE_CEILING:
                denom_capped = Decimal("1") + esi_rate + grat_rate_factor
                tentative_gross = (max(Decimal("0"), gross_pool - PF_FLAT_RESERVE) / denom_capped).quantize(q) if denom_capped > 0 else max(Decimal("0"), gross_pool - PF_FLAT_RESERVE)
            else:
                denom = Decimal("1") + pf_rate + esi_rate + grat_rate_factor
                tentative_gross = (gross_pool / denom).quantize(q) if denom > 0 else gross_pool

        if basic_calc_type == "CUSTOM_FIXED" and basic_flat > 0:
            t_basic = min(basic_flat, tentative_gross)
        else:
            t_basic = (tentative_gross * basic_pct).quantize(q)

        if not actual_pf_opted:
            reserve = Decimal("0")
        elif pf_rule == "CUSTOM_PERCENT":
            t_pf_base = tentative_gross if pf_custom_base == "GROSS" else t_basic
            if pf_custom_capped:
                reserve = PF_FLAT_RESERVE if t_pf_base >= PF_WAGE_CEILING else (t_pf_base * pf_custom_rate).quantize(q)
            else:
                reserve = (t_pf_base * pf_custom_rate).quantize(q)
        elif pf_rule == "UNCAPPED_12_PERCENT":
            reserve = (t_basic * Decimal("0.12")).quantize(q)
        else:
            reserve = PF_FLAT_RESERVE if t_basic >= PF_WAGE_CEILING else (t_basic * Decimal("0.12")).quantize(q)

        t_esi_base = t_basic if (esi_rule == "CUSTOM_RULE" and esi_custom_base == "BASIC") else tentative_gross
        esi_reserve = (t_esi_base * ESI_EMPLOYER_RATE).quantize(q) if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0")
        grat_reserve = (t_basic * GRATUITY_RATE).quantize(q) if gratuity_in_ctc else Decimal("0")
        monthly_gross = (
            gross_pool
            - (reserve if (actual_pf_opted and employer_pf_in_ctc) else Decimal("0"))
            - (esi_reserve if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0"))
            - grat_reserve
        ).quantize(q)

    # Derive Basic+DA from the true Monthly Gross
    if basic_calc_type == "CUSTOM_FIXED" and basic_flat > 0:
        basic = min(basic_flat, monthly_gross)
    else:
        basic = (monthly_gross * basic_pct).quantize(q)
    basic = basic.quantize(q)

    # Re-verify and finalize PF and ESI on exact basic & gross
    if not actual_pf_opted:
        reserve = Decimal("0")
    elif pf_rule == "CUSTOM_PERCENT":
        final_pf_base = monthly_gross if pf_custom_base == "GROSS" else basic
        if pf_custom_capped:
            reserve = PF_FLAT_RESERVE if final_pf_base >= PF_WAGE_CEILING else (final_pf_base * pf_custom_rate).quantize(q)
        else:
            reserve = (final_pf_base * pf_custom_rate).quantize(q)
    elif pf_rule == "UNCAPPED_12_PERCENT":
        reserve = (basic * Decimal("0.12")).quantize(q)
    else:
        reserve = PF_FLAT_RESERVE if basic >= PF_WAGE_CEILING else (basic * Decimal("0.12")).quantize(q)

    if actual_esi_opted:
        final_esi_base = basic if (esi_rule == "CUSTOM_RULE" and esi_custom_base == "BASIC") else monthly_gross
        esi_reserve = (final_esi_base * ESI_EMPLOYER_RATE).quantize(q)
    else:
        esi_reserve = Decimal("0")

    return {
        "monthly_gross": monthly_gross,
        "basic": basic,
        "employer_pf": reserve.quantize(q),
        "employer_esi": esi_reserve.quantize(q),
        "gratuity": grat_reserve.quantize(q),
        "actual_pf_opted": actual_pf_opted,
        "pf_rule": pf_rule,
        "employer_pf_in_ctc": employer_pf_in_ctc,
        "actual_esi_opted": actual_esi_opted,
        "employer_esi_in_ctc": employer_esi_in_ctc,
        "gratuity_in_ctc": gratuity_in_ctc,
    }


def _waterfall_allocate_earnings(
    monthly_gross: Decimal,
    basic: Decimal,
    p: dict,
    resolved_profile: Any,
    catalog_comps_map: dict,
    raw_custom: dict,
    target_client: Any,
    reapply_policy: bool,
    current_lta: Decimal,
    nps_allowance: Decimal,
    fbp: Decimal,
    carve_out_fbp: bool,
    carve_out_custom: bool,
) -> tuple[Decimal, Decimal, Decimal, Decimal, dict, Decimal]:
    """
    Tier 3: Top-Down Waterfall Allocation.
    Cascades monthly gross through Basic, LTA, HRA, dynamic custom fixed components,
    and pours the remaining balance into Special Allowance.
    """
    q = Decimal("0.01")
    # 1. Derive LTA
    lta_calc_type = str(p.get("lta_calculation_type", getattr(resolved_profile, "lta_calculation_type", "OFF") if resolved_profile else "OFF") or "OFF").strip().upper()
    lta_pct_raw = p.get("lta_percentage", getattr(resolved_profile, "lta_percentage", "0.00") if resolved_profile else "0.00")
    try:
        lta_pct = Decimal(str(lta_pct_raw if lta_pct_raw is not None else "0.00")) / Decimal("100")
    except Exception:
        lta_pct = Decimal("0.00")
    lta_flat_raw = p.get("lta_flat_amount", getattr(resolved_profile, "lta_flat_amount", "0.00") if resolved_profile else "0.00")
    try:
        lta_flat = Decimal(str(lta_flat_raw if lta_flat_raw is not None else "0.00"))
    except Exception:
        lta_flat = Decimal("0.00")

    if reapply_policy or current_lta <= Decimal("0"):
        if lta_calc_type == "PERCENT_BASIC" and lta_pct > 0:
            current_lta = (basic * lta_pct).quantize(q)
        elif lta_calc_type == "CUSTOM_FIXED" and lta_flat > 0:
            current_lta = lta_flat.quantize(q)
        elif lta_calc_type == "OFF":
            current_lta = Decimal("0.00")

    # 2. Derive HRA
    hra_calc_type = p.get("hra_calculation_type", "PERCENT_BASIC")
    hra_pct = Decimal(str(p.get("hra_percentage", "50.00"))) / Decimal("100")
    hra_flat = Decimal(str(p.get("hra_flat_amount", "0.00")))

    allowance_deductions = current_lta + nps_allowance + (Decimal("0") if carve_out_fbp else fbp)
    available_for_hra = max(Decimal("0"), monthly_gross - basic - allowance_deductions)
    if hra_calc_type == "CUSTOM_FIXED" and hra_flat > 0:
        hra = max(Decimal("0"), min(hra_flat, available_for_hra))
    else:
        hra = max(Decimal("0"), min((basic * hra_pct).quantize(q), available_for_hra))
    hra = hra.quantize(q)

    # 3. Dynamic Custom Components Resolution & Evaluation
    custom_dict = {}

    for code, c in catalog_comps_map.items():
        rate_val = Decimal(str(c.default_value or 0))
        if c.calculation_type == "PERCENT_BASIC":
            evaluated_amt = (basic * (rate_val / Decimal("100"))).quantize(q)
        elif c.calculation_type == "PERCENT_GROSS":
            evaluated_amt = (monthly_gross * (rate_val / Decimal("100"))).quantize(q)
        else:
            evaluated_amt = rate_val.quantize(q)

        custom_dict[code] = {
            "name": c.name,
            "abbr": c.abbr,
            "type": c.component_type,
            "calculation_type": c.calculation_type,
            "is_monthly_variable": False,
            "formula": c.formula or "FIXED",
            "rate": float(rate_val),
            "amount": str(evaluated_amt),
            "depends_on_payment_days": c.depends_on_payment_days,
            "do_not_include_in_total": False if c.component_type == "EARNING" else c.do_not_include_in_total,
            "payout_frequency": getattr(c, "payout_frequency", "MONTHLY"),
            "payout_month": getattr(c, "payout_month", 3),
            "prorate_for_mid_year_joiners": getattr(c, "prorate_for_mid_year_joiners", False),
            "carve_out_from_ctc": getattr(c, "carve_out_from_ctc", False),
            "source": "CATALOG_DEFAULT",
        }

    active_reserved_keys = getattr(sys.modules.get(__name__), "RESERVED_METADATA_KEYS", RESERVED_METADATA_KEYS)
    for k, comp in raw_custom.items():
        k_str = str(k).strip()
        k_lower = k_str.lower()
        if k_lower in active_reserved_keys or k_str.startswith("__"):
            continue
        if reapply_policy and target_client is not None and (k_str not in catalog_comps_map and k_str.upper() not in catalog_comps_map):
            continue
        if isinstance(comp, dict):
            if comp.get("is_monthly_variable") or (comp.get("formula") or "").strip().upper() == "VARIABLE":
                continue
            calc_type = comp.get("calculation_type") or comp.get("calc_type", "FLAT")
            if calc_type == "PERCENT_BASIC":
                rate_val = Decimal(str(comp.get("rate", comp.get("percentage", comp.get("amount", 0))) or 0))
                evaluated_amt = (basic * (rate_val / Decimal("100"))).quantize(q)
            elif calc_type == "PERCENT_GROSS":
                rate_val = Decimal(str(comp.get("rate", comp.get("percentage", comp.get("amount", 0))) or 0))
                evaluated_amt = (monthly_gross * (rate_val / Decimal("100"))).quantize(q)
            else:
                raw_rate = comp.get("rate")
                raw_amt = comp.get("amount")
                if raw_rate not in (None, 0, "0", Decimal("0")):
                    rate_val = Decimal(str(raw_rate))
                elif raw_amt not in (None, ""):
                    rate_val = Decimal(str(raw_amt))
                else:
                    rate_val = Decimal(str(comp.get("percentage", 0) or 0))
                evaluated_amt = Decimal(str(comp.get("amount", rate_val) or 0)).quantize(q)

            custom_dict[k] = {
                **(custom_dict.get(k) or {}),
                **comp,
                "amount": str(evaluated_amt),
                "rate": float(rate_val),
                "calculation_type": calc_type,
                "is_monthly_variable": False,
                "formula": comp.get("formula", (custom_dict.get(k) or {}).get("formula", "FIXED")),
                "payout_frequency": comp.get("payout_frequency", (custom_dict.get(k) or {}).get("payout_frequency", "MONTHLY")),
                "payout_month": comp.get("payout_month", (custom_dict.get(k) or {}).get("payout_month", 3)),
                "prorate_for_mid_year_joiners": comp.get("prorate_for_mid_year_joiners", (custom_dict.get(k) or {}).get("prorate_for_mid_year_joiners", False)),
                "carve_out_from_ctc": comp.get("carve_out_from_ctc", (custom_dict.get(k) or {}).get("carve_out_from_ctc", False)),
                "source": comp.get("source", "CUSTOM_OVERRIDE"),
            }
        elif isinstance(comp, (int, float, Decimal)):
            try:
                dec_val = Decimal(str(comp or 0))
            except Exception:
                dec_val = Decimal("0")
            base_info = custom_dict.get(k) or {"name": k, "type": "EARNING", "calculation_type": "FLAT"}
            custom_dict[k] = {
                **base_info,
                "amount": str(dec_val.quantize(q)),
                "rate": float(dec_val),
                "calculation_type": "FLAT",
                "is_monthly_variable": False,
                "formula": "FIXED",
                "source": "CUSTOM_OVERRIDE",
            }
        elif isinstance(comp, str):
            try:
                dec_val = Decimal(comp.strip() or "0")
                base_info = custom_dict.get(k) or {"name": k, "type": "EARNING", "calculation_type": "FLAT"}
                custom_dict[k] = {
                    **base_info,
                    "amount": str(dec_val.quantize(q)),
                    "rate": float(dec_val),
                    "calculation_type": "FLAT",
                    "is_monthly_variable": False,
                    "formula": "FIXED",
                    "source": "CUSTOM_OVERRIDE",
                }
            except Exception:
                pass

    sum_custom_earnings = Decimal("0")
    for k, comp in custom_dict.items():
        if isinstance(comp, dict) and comp.get("type") == "EARNING":
            is_carved = comp.get("carve_out_from_ctc") or carve_out_custom
            if not is_carved:
                c_amt = Decimal(str(comp.get("amount", 0)))
                c_freq = comp.get("payout_frequency", "MONTHLY")
                sum_custom_earnings += _get_monthly_carveout(c_amt, c_freq)

    # 4. Special Allowance (balancing remainder)
    custom_earnings_in_gross = sum_custom_earnings
    non_special_earnings = basic + hra + allowance_deductions + custom_earnings_in_gross
    special_allowance = max(Decimal("0"), monthly_gross - non_special_earnings).quantize(q)

    return (basic, hra, special_allowance, current_lta, custom_dict, sum_custom_earnings)


def _package_salary_structure(
    ctc_annual: Decimal,
    monthly_pool: Decimal,
    gross_pool: Decimal,
    monthly_gross: Decimal,
    basic: Decimal,
    hra: Decimal,
    special_allowance: Decimal,
    current_lta: Decimal,
    nps_allowance: Decimal,
    fbp: Decimal,
    vpf: Decimal,
    stat_dict: dict,
    fbp_carveout: Decimal,
    custom_carveout: Decimal,
    carve_out_fbp: bool,
    carve_out_custom: bool,
    custom_dict: dict,
    sum_custom_earnings: Decimal,
    raw_custom: dict,
    employee: Any,
) -> dict:
    """
    Tier 4: Metadata Packaging, Rounding Calibration & Telemetry.
    Calibrates zero-rupee rounding precision (Option 1.A), checks statutory minimum wage
    floor warnings, embeds real-time waterfall telemetry (Option 1.C), and returns the
    authoritative structure payload.
    """
    q = Decimal("0.01")
    reserve = stat_dict["employer_pf"]
    esi_reserve = stat_dict["employer_esi"]
    grat_reserve = stat_dict["gratuity"]
    actual_pf_opted = stat_dict["actual_pf_opted"]
    pf_rule = stat_dict["pf_rule"]
    employer_pf_in_ctc = stat_dict["employer_pf_in_ctc"]
    actual_esi_opted = stat_dict["actual_esi_opted"]
    employer_esi_in_ctc = stat_dict["employer_esi_in_ctc"]
    gratuity_in_ctc = stat_dict["gratuity_in_ctc"]

    # Shortfall calculation
    allowance_deductions = current_lta + nps_allowance + (Decimal("0") if carve_out_fbp else fbp)
    total_allocated = (
        basic + hra + special_allowance + allowance_deductions + sum_custom_earnings
        + (reserve if (actual_pf_opted and employer_pf_in_ctc) else Decimal("0"))
        + (esi_reserve if (actual_esi_opted and employer_esi_in_ctc) else Decimal("0"))
        + (grat_reserve if gratuity_in_ctc else Decimal("0"))
        + (fbp_carveout if carve_out_fbp else Decimal("0"))
        + custom_carveout
    )
    excess_shortfall = max(Decimal("0"), total_allocated - monthly_pool)

    # Option 1.A: Zero-Rupee Rounding Leak Check & Calibration
    # If no shortfall exists, calibrate minor sub-paisa quantize discrepancy into special_allowance
    if excess_shortfall == Decimal("0") and special_allowance > Decimal("0"):
        rounding_diff = monthly_pool - total_allocated
        if Decimal("-0.02") <= rounding_diff <= Decimal("0.02") and rounding_diff != Decimal("0"):
            special_allowance = (special_allowance + rounding_diff).quantize(q)
            monthly_gross = (basic + hra + special_allowance + allowance_deductions + sum_custom_earnings).quantize(q)

    # Minimum wage floor advisory warning check (Karnataka commercial baseline Rs 16,500)
    min_wage_floor = Decimal("16500.00")
    min_wage_warning = (basic < min_wage_floor if monthly_gross >= min_wage_floor else False) or (basic < Decimal("15000.00") and monthly_pool >= min_wage_floor)

    # Metadata population
    custom_dict["esi_opted"] = actual_esi_opted
    custom_dict["employer_esi"] = str(esi_reserve)
    custom_dict["employer_esi_in_ctc"] = bool(employer_esi_in_ctc)
    custom_dict["gratuity"] = str(grat_reserve)
    custom_dict["gratuity_in_ctc"] = bool(gratuity_in_ctc)
    custom_dict["carve_out_fbp_in_ctc"] = bool(carve_out_fbp)
    custom_dict["carve_out_custom_in_ctc"] = bool(carve_out_custom)

    # Option 1.C: Real-Time Waterfall Telemetry Metadata
    custom_dict["__waterfall_audit__"] = {
        "monthly_pool": float(monthly_pool),
        "tier_1_carveouts": float(fbp_carveout + custom_carveout),
        "tier_2_gross_pool": float(gross_pool),
        "tier_2_reserves": {
            "employer_pf": float(reserve),
            "employer_esi": float(esi_reserve),
            "gratuity": float(grat_reserve),
        },
        "tier_3_monthly_gross": float(monthly_gross),
        "tier_3_waterfall": {
            "basic": float(basic),
            "hra": float(hra),
            "lta": float(current_lta),
            "nps": float(nps_allowance),
            "fbp": float(fbp),
            "custom_earnings": float(sum_custom_earnings),
            "special_allowance": float(special_allowance),
        },
        "shortfall": float(excess_shortfall),
    }

    # Restore protected non-catalog metadata
    for meta_k in ("esi_number", "uan_number", "is_senior_citizen", "non_eps", "employer_pf", "employer_pf_in_ctc", "gratuity", "gratuity_in_ctc", "employment_type", "is_intern"):
        if meta_k in raw_custom and meta_k not in custom_dict:
            custom_dict[meta_k] = raw_custom[meta_k]

    # Authoritative fallback from employee record
    if employee is not None:
        if "esi_number" not in custom_dict or not custom_dict["esi_number"]:
            emp_esi_num = getattr(employee, "esi_number", "")
            if emp_esi_num:
                custom_dict["esi_number"] = emp_esi_num
        if "uan_number" not in custom_dict or not custom_dict["uan_number"]:
            emp_uan_num = getattr(employee, "uan_number", "")
            if emp_uan_num:
                custom_dict["uan_number"] = emp_uan_num
        if "employment_type" not in custom_dict or not custom_dict["employment_type"]:
            emp_type = getattr(employee, "employment_type", "")
            if emp_type:
                custom_dict["employment_type"] = emp_type
        if "is_intern" not in custom_dict:
            emp_intern = getattr(employee, "is_intern", None)
            if emp_intern is not None:
                custom_dict["is_intern"] = bool(emp_intern)

    return {
        "ctc_annual": ctc_annual,
        "monthly_gross": monthly_gross.quantize(q),
        "original_basic_da": basic.quantize(q),
        "original_hra": hra.quantize(q),
        "original_special_allowance": special_allowance.quantize(q),
        "original_lta": current_lta.quantize(q),
        "nps_allowance": nps_allowance.quantize(q),
        "fbp": fbp.quantize(q),
        "vpf": vpf.quantize(q),
        "pf_opted": actual_pf_opted,
        "pf_calculation_rule": pf_rule,
        "employer_pf_in_ctc": employer_pf_in_ctc,
        "employer_pf": reserve.quantize(q),
        "esi_opted": actual_esi_opted,
        "employer_esi": esi_reserve.quantize(q),
        "employer_esi_in_ctc": employer_esi_in_ctc,
        "gratuity": grat_reserve.quantize(q),
        "gratuity_in_ctc": gratuity_in_ctc,
        "carve_out_fbp_in_ctc": carve_out_fbp,
        "carve_out_custom_in_ctc": carve_out_custom,
        "custom_components": custom_dict,
        "min_wage_warning": min_wage_warning,
        "shortfall": excess_shortfall.quantize(q),
    }


def build_from_ctc(
    cls=None,
    ctc_annual: Decimal = Decimal("0"),
    pf_opted: bool = True,
    current_lta: Decimal = Decimal("0"),
    nps_allowance: Decimal = Decimal("0"),
    fbp: Decimal = Decimal("0"),
    vpf: Decimal = Decimal("0"),
    policy: dict | None = None,
    custom_components: dict | None = None,
    client=None,
    employee=None,
    **kwargs,
) -> dict:
    """
    Auto-derives Basic+DA, HRA, Special Allowance and Monthly Gross
    from annual CTC using client-specific structuring policies
    or falling back to the standard 50% formula.
    Orchestrates the 4-tier Water Bucket Waterfall architecture.
    """
    q = Decimal("0.01")
    # Universal caller normalization: supports build_from_ctc(cls, ctc_annual, ...) or build_from_ctc(ctc_annual, ...)
    if isinstance(cls, (int, float, str, Decimal)):
        ctc_annual_val = Decimal(str(cls))
    else:
        ctc_annual_val = Decimal(str(ctc_annual))

    reapply_policy = bool(kwargs.get("reapply_policy", False))
    if reapply_policy:
        resolved_lta = Decimal("0")
    else:
        resolved_lta = Decimal(str(kwargs.get("original_lta", current_lta or 0)))
    resolved_nps = Decimal(str(kwargs.get("nps_allowance", nps_allowance or 0)))
    resolved_fbp = Decimal(str(kwargs.get("fbp", fbp or 0)))
    resolved_vpf = Decimal(str(kwargs.get("vpf", vpf or 0)))
    monthly_pool = (ctc_annual_val / Decimal("12")).quantize(q)

    # Tier 0: Structuring Policy & Client Resolution
    p, resolved_profile, target_client = _resolve_structuring_policy(policy, client, employee)

    # Tier 1: Upfront Non-Cash Carve-Outs
    gross_pool, fbp_carveout, custom_carveout, catalog_comps_map, effective_custom_items, carve_out_fbp, carve_out_custom = _extract_upfront_carveouts(
        monthly_pool=monthly_pool,
        p=p,
        custom_components=custom_components,
        target_client=target_client,
        reapply_policy=reapply_policy,
        fbp=resolved_fbp,
    )

    # Tier 2: Statutory Reserves & Algebraic Gross Derivation
    stat_dict = _solve_statutory_reserves_and_gross(
        gross_pool=gross_pool,
        monthly_pool=monthly_pool,
        p=p,
        resolved_profile=resolved_profile,
        pf_opted=pf_opted,
        employee=employee,
        custom_components=custom_components,
        kwargs=kwargs,
    )

    # Tier 3: Top-Down Waterfall Allocation
    basic, hra, special_allowance, resolved_lta, custom_dict, sum_custom_earnings = _waterfall_allocate_earnings(
        monthly_gross=stat_dict["monthly_gross"],
        basic=stat_dict["basic"],
        p=p,
        resolved_profile=resolved_profile,
        catalog_comps_map=catalog_comps_map,
        raw_custom=dict(custom_components or {}),
        target_client=target_client,
        reapply_policy=reapply_policy,
        current_lta=resolved_lta,
        nps_allowance=resolved_nps,
        fbp=resolved_fbp,
        carve_out_fbp=carve_out_fbp,
        carve_out_custom=carve_out_custom,
    )

    # Tier 4: Metadata Packaging & Telemetry
    return _package_salary_structure(
        ctc_annual=ctc_annual_val,
        monthly_pool=monthly_pool,
        gross_pool=gross_pool,
        monthly_gross=stat_dict["monthly_gross"],
        basic=basic,
        hra=hra,
        special_allowance=special_allowance,
        current_lta=resolved_lta,
        nps_allowance=resolved_nps,
        fbp=resolved_fbp,
        vpf=resolved_vpf,
        stat_dict=stat_dict,
        fbp_carveout=fbp_carveout,
        custom_carveout=custom_carveout,
        carve_out_fbp=carve_out_fbp,
        carve_out_custom=carve_out_custom,
        custom_dict=custom_dict,
        sum_custom_earnings=sum_custom_earnings,
        raw_custom=dict(custom_components or {}),
        employee=employee,
    )
