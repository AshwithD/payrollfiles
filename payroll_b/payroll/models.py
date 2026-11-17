"""hrms_backend/payroll/models.py"""

import calendar
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from django.utils.text import slugify

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone
from utils.encryption import decrypt_text, encrypt_text

class AuditableMixin(models.Model):
    """Provides created_at / updated_at timestamps for payroll models."""
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


PDF_DESIGN_CHOICES = [(i, f"Design {i}") for i in range(1, 9)]


class ClientProfile(models.Model):
    """
    Payroll-specific extension of the master `clients.Client` — the single
    source of truth for client identity lives in the Client module.

    Only payroll-owned concerns live here:
      * payroll_logo           → payslip letterhead logo (renamed from `logo`)
      * payroll_email          → payroll-only email override; empty = fall
                                 back to `client.email`
      * pdf_design             → which payslip layout (1-8) to render
      * pf_establishment_code  → PF establishment code for payslips
      * payroll_is_active      → payroll-service on/off toggle, OFF until
                                 someone switches it on in Firm Details. The
                                 master `client.is_active` acts as a hard
                                 kill-switch on top of it.

    The existence of a profile row IS payroll enrollment: a client in the
    master list without a ClientProfile row is not a payroll client.
    """

    client = models.OneToOneField(
        "clients.Client",
        on_delete=models.CASCADE,
        related_name="payroll_profile",
    )

    payroll_logo = models.ImageField(upload_to="payroll/client_logos/", null=True, blank=True)
    payroll_email = models.EmailField(blank=True)
    pdf_design = models.PositiveSmallIntegerField(choices=PDF_DESIGN_CHOICES, default=1)
    pf_establishment_code = models.CharField(max_length=40, blank=True)
    # OFF by default: enrolling a client in payroll is a deliberate act done
    # in Firm Details, not something a client inherits by existing in the
    # Client module. (Changing this default needs a migration — 0013.)
    payroll_is_active = models.BooleanField(default=False)

    # Configurable Client Salary Policy & Structuring Defaults
    BASIC_CALC_PERCENT_GROSS = "PERCENT_GROSS"
    BASIC_CALC_CUSTOM_FIXED = "CUSTOM_FIXED"
    BASIC_CALC_CHOICES = [
        (BASIC_CALC_PERCENT_GROSS, "Percentage of Gross"),
        (BASIC_CALC_CUSTOM_FIXED, "Custom Fixed Amount"),
    ]

    HRA_CALC_PERCENT_BASIC = "PERCENT_BASIC"
    HRA_CALC_CUSTOM_FIXED = "CUSTOM_FIXED"
    HRA_CALC_CHOICES = [
        (HRA_CALC_PERCENT_BASIC, "Percentage of Basic"),
        (HRA_CALC_CUSTOM_FIXED, "Custom Fixed Amount"),
    ]

    PF_RULE_CAPPED_1800 = "CAPPED_1800"
    PF_RULE_CAPPED_3000 = "CAPPED_3000"
    PF_RULE_UNCAPPED_12_PERCENT = "UNCAPPED_12_PERCENT"
    PF_RULE_CUSTOM_PERCENT = "CUSTOM_PERCENT"
    PF_RULE_NOT_OPTED = "NOT_OPTED"
    PF_RULE_CHOICES = [
        (PF_RULE_CAPPED_1800, "Statutory Capped (12% up to Rs 1,800)"),
        (PF_RULE_CAPPED_3000, "Statutory Capped — Rs 25k Ceiling (12% up to Rs 3,000)"),
        (PF_RULE_UNCAPPED_12_PERCENT, "Uncapped (12% of actual Basic)"),
        (PF_RULE_CUSTOM_PERCENT, "Custom Percentage"),
        (PF_RULE_NOT_OPTED, "Not Opted (0 PF)"),
    ]

    basic_calculation_type = models.CharField(
        max_length=20, choices=BASIC_CALC_CHOICES, default=BASIC_CALC_PERCENT_GROSS
    )
    basic_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("50.00")
    )
    basic_flat_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

    hra_calculation_type = models.CharField(
        max_length=20, choices=HRA_CALC_CHOICES, default=HRA_CALC_PERCENT_BASIC
    )
    hra_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("50.00")
    )
    hra_flat_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

    pf_calculation_rule = models.CharField(
        max_length=30, choices=PF_RULE_CHOICES, default=PF_RULE_CAPPED_1800
    )
    employer_pf_in_ctc = models.BooleanField(
        default=True,
        help_text="Carve out Employer PF from Special Allowance within CTC pool"
    )

    PAYMENT_MODE_WIRE = "WIRE_TRANSFER"
    PAYMENT_MODE_BANK = "BANK_TRANSFER"
    PAYMENT_MODE_CHEQUE = "CHEQUE"
    PAYMENT_MODE_CASH = "CASH"
    PAYMENT_MODE_CHOICES = [
        (PAYMENT_MODE_WIRE, "Wire Transfer"),
        (PAYMENT_MODE_BANK, "Bank Transfer / NEFT / RTGS"),
        (PAYMENT_MODE_CHEQUE, "Cheque"),
        (PAYMENT_MODE_CASH, "Cash"),
    ]

    default_payment_mode = models.CharField(
        max_length=30, choices=PAYMENT_MODE_CHOICES, default=PAYMENT_MODE_WIRE
    )
    show_payment_mode_in_payslip = models.BooleanField(
        default=True,
        help_text="Display payment mode (e.g. Wire Transfer) on employee payslips"
    )
    show_employer_contribution_in_payslip = models.BooleanField(
        default=True,
        help_text="Display Employer PF contribution disclosure line on payslips"
    )
    cycle_start_day = models.PositiveSmallIntegerField(
        default=1,
        help_text="Payroll attendance cycle start day (e.g. 1 for calendar month, 21 for 21st-20th)"
    )
    cycle_end_day = models.PositiveSmallIntegerField(
        default=0,
        help_text="Payroll attendance cycle end day (0 = end of month, or 20, 25, 15)"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_client_profiles"

    @property
    def email(self) -> str:
        """Payroll email override with fallback to the master client email."""
        return self.payroll_email or self.client.email

    @property
    def is_effectively_active(self) -> bool:
        """Master client must be active AND the payroll toggle on."""
        return bool(self.client.is_active and self.payroll_is_active)

    def get_cycle_dates(self, year: int, month: int) -> tuple[date, date, int]:
        """
        Returns (cycle_start_date, cycle_end_date, total_days_in_cycle).
        Supports calendar month (start=1, end=0) and custom cycles (e.g. 21st-20th).
        Includes month-end and leap-year clamping (Option 3.B).
        """
        start_cfg = getattr(self, "cycle_start_day", 1) or 1
        end_cfg = getattr(self, "cycle_end_day", 0) or 0
        days_in_curr_month = calendar.monthrange(year, month)[1]

        if start_cfg == 1 and (end_cfg == 0 or end_cfg >= days_in_curr_month):
            start_date = date(year, month, 1)
            end_date = date(year, month, days_in_curr_month)
            return start_date, end_date, days_in_curr_month

        prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
        days_in_prev_month = calendar.monthrange(prev_year, prev_month)[1]

        clamped_start = min(start_cfg, days_in_prev_month)
        clamped_end = days_in_curr_month if end_cfg == 0 else min(end_cfg, days_in_curr_month)

        try:
            start_date = date(prev_year, prev_month, clamped_start)
            end_date = date(year, month, clamped_end)
        except Exception:
            start_date = date(year, month, 1)
            end_date = date(year, month, days_in_curr_month)

        total_days = max(1, (end_date - start_date).days + 1)
        return start_date, end_date, total_days

    @property
    def lop_policy(self) -> str:
        """
        Client Loss of Pay (LOP) policy:
          - 'ACCRUE_LEAVE_DEBT': LOP recorded as negative debt balance (CKPS firm model).
          - 'REDUCE_SALARY': Uncovered LOP directly deducts payable days and salary (commercial client model).
        Persisted dynamically via custom_salary_components with code='__LOP_POLICY__'
        to maintain zero database schema migrations.
        """
        try:
            comp = self.client.custom_salary_components.filter(code="__LOP_POLICY__").first()
            if comp and comp.abbr in ("REDUCE_SALARY", "ACCRUE_LEAVE_DEBT"):
                return comp.abbr
        except Exception:
            pass
        return "ACCRUE_LEAVE_DEBT"

    @lop_policy.setter
    def lop_policy(self, value: str):
        if not self.client_id:
            return
        clean_val = str(value or "").strip().upper()
        try:
            if clean_val == "REDUCE_SALARY":
                comp = self.client.custom_salary_components.filter(code="__LOP_POLICY__").first()
                if comp:
                    comp.abbr = "REDUCE_SALARY"
                    comp.is_active = True
                    comp.save(update_fields=["abbr", "is_active", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__LOP_POLICY__",
                        name="Loss of Pay Policy",
                        abbr="REDUCE_SALARY",
                        component_type="DEDUCTION",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__LOP_POLICY__").delete()
        except Exception:
            pass

    @property
    def pt_state(self) -> str:
        """Professional Tax State slab rule (KARNATAKA, TELANGANA_AP, MAHARASHTRA, GUJARAT, EXEMPT_ZERO, CUSTOM_FIXED)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PT_STATE__").first()
            if comp and comp.abbr:
                return comp.abbr
        except Exception:
            pass
        return "KARNATAKA"

    @pt_state.setter
    def pt_state(self, value: str):
        if not self.client_id:
            return
        clean_val = str(value or "KARNATAKA").strip().upper()
        try:
            if clean_val and clean_val != "KARNATAKA":
                comp = self.client.custom_salary_components.filter(code="__PT_STATE__").first()
                if comp:
                    comp.abbr = clean_val
                    comp.is_active = True
                    comp.save(update_fields=["abbr", "is_active", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__PT_STATE__",
                        name="Professional Tax State",
                        abbr=clean_val,
                        component_type="DEDUCTION",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__PT_STATE__").delete()
        except Exception:
            pass

    @property
    def pt_amount(self) -> Decimal:
        """Custom fixed Professional Tax amount if pt_state == 'CUSTOM_FIXED'."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PT_AMOUNT__").first()
            if comp and comp.default_value is not None:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.00")

    @pt_amount.setter
    def pt_amount(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value or 0))
            if val > 0:
                comp = self.client.custom_salary_components.filter(code="__PT_AMOUNT__").first()
                if comp:
                    comp.default_value = val
                    comp.save(update_fields=["default_value", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__PT_AMOUNT__",
                        name="Professional Tax Custom Amount",
                        abbr="PT_AMT",
                        default_value=val,
                        component_type="DEDUCTION",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__PT_AMOUNT__").delete()
        except Exception:
            pass

    @property
    def annual_leave_days(self) -> Decimal:
        """Annual paid leave days pool (default 22 days per year)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ANNUAL_LEAVE_DAYS__").first()
            if comp and comp.default_value is not None:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("22.00")

    @annual_leave_days.setter
    def annual_leave_days(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value or 22))
            if val != Decimal("22"):
                comp = self.client.custom_salary_components.filter(code="__ANNUAL_LEAVE_DAYS__").first()
                if comp:
                    comp.default_value = val
                    comp.save(update_fields=["default_value", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__ANNUAL_LEAVE_DAYS__",
                        name="Annual Paid Leave Days",
                        abbr="LEAVES",
                        default_value=val,
                        component_type="EARNING",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__ANNUAL_LEAVE_DAYS__").delete()
        except Exception:
            pass

    @property
    def probation_months(self) -> int:
        """Probation period in months (default 6; 0 = immediate confirmation)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PROBATION_MONTHS__").first()
            if comp and comp.default_value is not None:
                return int(comp.default_value)
        except Exception:
            pass
        return 6

    @probation_months.setter
    def probation_months(self, value):
        if not self.client_id:
            return
        try:
            val = int(value if value is not None else 6)
            if val != 6:
                comp = self.client.custom_salary_components.filter(code="__PROBATION_MONTHS__").first()
                if comp:
                    comp.default_value = Decimal(str(val))
                    comp.save(update_fields=["default_value", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__PROBATION_MONTHS__",
                        name="Probation Duration Months",
                        abbr="PROB",
                        default_value=Decimal(str(val)),
                        component_type="EARNING",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__PROBATION_MONTHS__").delete()
        except Exception:
            pass

    @property
    def track_leave_ledger(self) -> bool:
        """Whether this client tracks paid leave accruals & carry-forward ledger balance (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__TRACK_LEAVE_LEDGER__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @track_leave_ledger.setter
    def track_leave_ledger(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp = self.client.custom_salary_components.filter(code="__TRACK_LEAVE_LEDGER__").first()
                if comp:
                    comp.abbr = "DISABLED"
                    comp.is_active = True
                    comp.save(update_fields=["abbr", "is_active", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__TRACK_LEAVE_LEDGER__",
                        name="Track Leave Ledger Toggle",
                        abbr="DISABLED",
                        component_type="EARNING",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__TRACK_LEAVE_LEDGER__").delete()
        except Exception:
            pass

    @property
    def track_comp_off(self) -> bool:
        """Whether this client tracks compensatory off (comp-off) banks & adjustments (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__TRACK_COMP_OFF__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @track_comp_off.setter
    def track_comp_off(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp = self.client.custom_salary_components.filter(code="__TRACK_COMP_OFF__").first()
                if comp:
                    comp.abbr = "DISABLED"
                    comp.is_active = True
                    comp.save(update_fields=["abbr", "is_active", "updated_at"])
                else:
                    self.client.custom_salary_components.create(
                        code="__TRACK_COMP_OFF__",
                        name="Track Comp Off Toggle",
                        abbr="DISABLED",
                        component_type="EARNING",
                        calculation_type="FLAT",
                        is_active=True,
                    )
            else:
                self.client.custom_salary_components.filter(code="__TRACK_COMP_OFF__").delete()
        except Exception:
            pass

    @property
    def esi_enabled(self) -> bool:
        """Whether this client establishment is enrolled in ESIC (default False)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_ENABLED__").first()
            if comp and comp.abbr == "ENABLED":
                return True
        except Exception:
            pass
        return False

    @esi_enabled.setter
    def esi_enabled(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__ESI_ENABLED__",
                    defaults={
                        "name": "ESI Enabled Toggle",
                        "abbr": "ENABLED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "ENABLED":
                    comp.abbr = "ENABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__ESI_ENABLED__").delete()
        except Exception:
            pass

    @property
    def esi_establishment_code(self) -> str:
        """17-digit ESIC Establishment Code."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_CODE__").first()
            if comp and comp.abbr:
                return str(comp.abbr).strip()
        except Exception:
            pass
        return ""

    @esi_establishment_code.setter
    def esi_establishment_code(self, value):
        if not self.client_id:
            return
        try:
            val = str(value or "").strip()
            if val:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__ESI_CODE__",
                    defaults={
                        "name": "ESIC Establishment Code",
                        "abbr": val,
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != val:
                    comp.abbr = val
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__ESI_CODE__").delete()
        except Exception:
            pass

    @property
    def employer_esi_in_ctc(self) -> bool:
        """Whether Employer ESI (3.25%) is carved out from Special Allowance in CTC pool (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__EMPLOYER_ESI_IN_CTC__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @employer_esi_in_ctc.setter
    def employer_esi_in_ctc(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__EMPLOYER_ESI_IN_CTC__",
                    defaults={
                        "name": "Employer ESI In CTC Toggle",
                        "abbr": "DISABLED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "DISABLED":
                    comp.abbr = "DISABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__EMPLOYER_ESI_IN_CTC__").delete()
        except Exception:
            pass

    @property
    def show_employer_esi_in_payslip(self) -> bool:
        """Display Employer ESI disclosure note on payslips (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__SHOW_EMPLOYER_ESI__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @show_employer_esi_in_payslip.setter
    def show_employer_esi_in_payslip(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__SHOW_EMPLOYER_ESI__",
                    defaults={
                        "name": "Show Employer ESI On Payslip Toggle",
                        "abbr": "DISABLED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "DISABLED":
                    comp.abbr = "DISABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__SHOW_EMPLOYER_ESI__").delete()
        except Exception:
            pass

    @property
    def show_uan_in_payslip(self) -> bool:
        """Display Employee UAN on payslips when PF is opted (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__SHOW_UAN_PAYSLIP__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @show_uan_in_payslip.setter
    def show_uan_in_payslip(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__SHOW_UAN_PAYSLIP__",
                    defaults={
                        "name": "Show UAN On Payslip Toggle",
                        "abbr": "DISABLED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "DISABLED":
                    comp.abbr = "DISABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__SHOW_UAN_PAYSLIP__").delete()
        except Exception:
            pass

    @property
    def pf_custom_pct(self) -> Decimal:
        """Custom EPF contribution percentage (default 12%)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PF_CUSTOM_PCT__").first()
            if comp and comp.default_value is not None:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("12.00")

    @pf_custom_pct.setter
    def pf_custom_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value or 12))
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PF_CUSTOM_PCT__",
                defaults={
                    "name": "Custom PF Percentage",
                    "abbr": "PF_PCT",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def pf_custom_base(self) -> str:
        """Custom EPF base ('BASIC' or 'GROSS', default 'BASIC')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PF_CUSTOM_BASE__").first()
            if comp and comp.abbr in ("BASIC", "GROSS"):
                return comp.abbr
        except Exception:
            pass
        return "BASIC"

    @pf_custom_base.setter
    def pf_custom_base(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "BASIC").strip().upper()
        if clean_val not in ("BASIC", "GROSS"):
            clean_val = "BASIC"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PF_CUSTOM_BASE__",
                defaults={
                    "name": "Custom PF Base",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def pf_custom_capped(self) -> bool:
        """Whether custom EPF is capped at the statutory PF wage ceiling (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PF_CUSTOM_CAPPED__").first()
            if comp and comp.abbr == "UNCAPPED":
                return False
        except Exception:
            pass
        return True

    @pf_custom_capped.setter
    def pf_custom_capped(self, value):
        if not self.client_id:
            return
        try:
            is_capped = bool(value)
            if not is_capped:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__PF_CUSTOM_CAPPED__",
                    defaults={
                        "name": "Custom PF Capped Toggle",
                        "abbr": "UNCAPPED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                comp.abbr = "UNCAPPED"
                comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__PF_CUSTOM_CAPPED__").delete()
        except Exception:
            pass

    @property
    def pf_wage_ceiling(self) -> Decimal:
        """Configurable Statutory PF Wage Ceiling (default Rs 25,000 for CAPPED_3000, Rs 15,000 otherwise)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PF_WAGE_CEILING__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) > 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        if getattr(self, "pf_calculation_rule", "") == "CAPPED_3000":
            return Decimal("25000.00")
        return Decimal("15000.00")

    @pf_wage_ceiling.setter
    def pf_wage_ceiling(self, value):
        if not self.client_id:
            return
        try:
            default_ceil = 25000 if getattr(self, "pf_calculation_rule", "") == "CAPPED_3000" else 15000
            val = Decimal(str(value or default_ceil))
            if val <= 0:
                val = Decimal(str(default_ceil))
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PF_WAGE_CEILING__",
                defaults={
                    "name": "Statutory PF Wage Ceiling",
                    "abbr": "PF_CEIL",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def pt_custom_pct(self) -> Decimal:
        """Custom Professional Tax percentage (default 0%)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PT_CUSTOM_PCT__").first()
            if comp and comp.default_value is not None:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.00")

    @pt_custom_pct.setter
    def pt_custom_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value or 0))
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PT_CUSTOM_PCT__",
                defaults={
                    "name": "Custom PT Percentage",
                    "abbr": "PT_PCT",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def pt_custom_base(self) -> str:
        """Custom Professional Tax base ('GROSS', 'BASIC', 'EARNED', default 'GROSS')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PT_CUSTOM_BASE__").first()
            if comp and comp.abbr in ("GROSS", "BASIC", "EARNED"):
                return comp.abbr
        except Exception:
            pass
        return "GROSS"

    @pt_custom_base.setter
    def pt_custom_base(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "GROSS").strip().upper()
        if clean_val not in ("GROSS", "BASIC", "EARNED"):
            clean_val = "GROSS"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PT_CUSTOM_BASE__",
                defaults={
                    "name": "Custom PT Base",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def pt_custom_cap(self) -> Decimal:
        """Custom Professional Tax monthly cap (default Rs 200.00; 0 = no cap)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__PT_CUSTOM_CAP__").first()
            if comp and comp.default_value is not None:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("200.00")

    @pt_custom_cap.setter
    def pt_custom_cap(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value or 200))
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__PT_CUSTOM_CAP__",
                defaults={
                    "name": "Custom PT Monthly Cap",
                    "abbr": "PT_CAP",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def carve_out_fbp_in_ctc(self) -> bool:
        """Whether Flexible Benefit Plan (FBP) is carved out upfront from annual CTC before deriving Gross & Basic (default False)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__CARVE_OUT_FBP__").first()
            if comp and comp.abbr == "ENABLED":
                return True
        except Exception:
            pass
        return False

    @carve_out_fbp_in_ctc.setter
    def carve_out_fbp_in_ctc(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__CARVE_OUT_FBP__",
                    defaults={
                        "name": "Carve Out FBP From CTC Toggle",
                        "abbr": "ENABLED",
                        "component_type": "EARNING",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "ENABLED":
                    comp.abbr = "ENABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__CARVE_OUT_FBP__").delete()
        except Exception:
            pass

    @property
    def carve_out_custom_in_ctc(self) -> bool:
        """Whether Non-Cash & Custom Allowances are carved out upfront from annual CTC before deriving Gross & Basic (default False)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__CARVE_OUT_CUSTOM__").first()
            if comp and comp.abbr == "ENABLED":
                return True
        except Exception:
            pass
        return False

    @carve_out_custom_in_ctc.setter
    def carve_out_custom_in_ctc(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__CARVE_OUT_CUSTOM__",
                    defaults={
                        "name": "Carve Out Custom Allowances From CTC Toggle",
                        "abbr": "ENABLED",
                        "component_type": "EARNING",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "ENABLED":
                    comp.abbr = "ENABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__CARVE_OUT_CUSTOM__").delete()
        except Exception:
            pass

    @property
    def esi_calculation_rule(self) -> str:
        """ESI calculation rule ('STATUTORY_21K', 'STATUTORY_25K', 'UNCAPPED', 'CUSTOM_RULE', default 'STATUTORY_21K')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_CALC_RULE__").first()
            if comp and comp.abbr in ("STATUTORY_21K", "STATUTORY_25K", "UNCAPPED", "CUSTOM_RULE"):
                return comp.abbr
        except Exception:
            pass
        return "STATUTORY_21K"

    @esi_calculation_rule.setter
    def esi_calculation_rule(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "STATUTORY_21K").strip().upper()
        if clean_val not in ("STATUTORY_21K", "STATUTORY_25K", "UNCAPPED", "CUSTOM_RULE"):
            clean_val = "STATUTORY_21K"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_CALC_RULE__",
                defaults={
                    "name": "ESI Calculation Rule",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def esi_wage_ceiling(self) -> Decimal:
        """Configurable Statutory ESI Wage Ceiling (default Rs 25,000 for STATUTORY_25K, Rs 21,000 otherwise)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_WAGE_CEILING__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) > 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        if getattr(self, "esi_calculation_rule", "") == "STATUTORY_25K":
            return Decimal("25000.00")
        return Decimal("21000.00")

    @esi_wage_ceiling.setter
    def esi_wage_ceiling(self, value):
        if not self.client_id:
            return
        try:
            default_ceil = 25000 if getattr(self, "esi_calculation_rule", "") == "STATUTORY_25K" else 21000
            val = Decimal(str(value or default_ceil))
            if val <= 0:
                val = Decimal(str(default_ceil))
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_WAGE_CEILING__",
                defaults={
                    "name": "Statutory ESI Wage Ceiling",
                    "abbr": "ESI_CEIL",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def esi_employee_pct(self) -> Decimal:
        """Configurable Employee ESI contribution percentage (default 0.75%)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_EMPLOYEE_PCT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.75")

    @esi_employee_pct.setter
    def esi_employee_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "0.75"))
            if val < 0:
                val = Decimal("0.75")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_EMPLOYEE_PCT__",
                defaults={
                    "name": "Employee ESI Percentage",
                    "abbr": "ESI_EMP",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def esi_employer_pct(self) -> Decimal:
        """Configurable Employer ESI contribution percentage (default 3.25%)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_EMPLOYER_PCT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("3.25")

    @esi_employer_pct.setter
    def esi_employer_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "3.25"))
            if val < 0:
                val = Decimal("3.25")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_EMPLOYER_PCT__",
                defaults={
                    "name": "Employer ESI Percentage",
                    "abbr": "ESI_EMPR",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def esi_custom_base(self) -> str:
        """ESI calculation base ('GROSS' or 'BASIC', default 'GROSS')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_CUSTOM_BASE__").first()
            if comp and comp.abbr in ("GROSS", "BASIC"):
                return comp.abbr
        except Exception:
            pass
        return "GROSS"

    @esi_custom_base.setter
    def esi_custom_base(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "GROSS").strip().upper()
        if clean_val not in ("GROSS", "BASIC"):
            clean_val = "GROSS"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_CUSTOM_BASE__",
                defaults={
                    "name": "Custom ESI Base",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def esi_period_continuity(self) -> bool:
        """Whether 6-Month Contribution Period Continuity (Apr-Sep / Oct-Mar) is enforced for ESI (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_PERIOD_CONTINUITY__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @esi_period_continuity.setter
    def esi_period_continuity(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__ESI_PERIOD_CONTINUITY__",
                    defaults={
                        "name": "ESI 6-Month Period Continuity Toggle",
                        "abbr": "DISABLED",
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "DISABLED":
                    comp.abbr = "DISABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__ESI_PERIOD_CONTINUITY__").delete()
        except Exception:
            pass

    @property
    def mid_month_proration_rule(self) -> str:
        """Divisor rule for mid-month joiners, exits, and revisions ('ACTUAL_CALENDAR_DAYS', 'STANDARD_30_DAYS', 'WORKING_DAYS_26', 'DISABLED')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__MID_MONTH_PRORATION_RULE__").first()
            if comp and comp.abbr in ("ACTUAL_CALENDAR_DAYS", "STANDARD_30_DAYS", "WORKING_DAYS_26", "DISABLED"):
                return comp.abbr
        except Exception:
            pass
        return "ACTUAL_CALENDAR_DAYS"

    @mid_month_proration_rule.setter
    def mid_month_proration_rule(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "ACTUAL_CALENDAR_DAYS").strip().upper()
        if clean_val not in ("ACTUAL_CALENDAR_DAYS", "STANDARD_30_DAYS", "WORKING_DAYS_26", "DISABLED"):
            clean_val = "ACTUAL_CALENDAR_DAYS"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__MID_MONTH_PRORATION_RULE__",
                defaults={
                    "name": "Mid-Month Proration Divisor Rule",
                    "abbr": clean_val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def auto_prorate_mid_month(self) -> bool:
        """Whether mid-month joiners, exits, and mid-month salary revisions are automatically prorated (default True)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__AUTO_PRORATE_MID_MONTH__").first()
            if comp and comp.abbr == "DISABLED":
                return False
        except Exception:
            pass
        return True

    @auto_prorate_mid_month.setter
    def auto_prorate_mid_month(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if not is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__AUTO_PRORATE_MID_MONTH__",
                    defaults={
                        "name": "Auto Prorate Mid-Month Joiners & Exits Toggle",
                        "abbr": "DISABLED",
                        "component_type": "EARNING",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "DISABLED":
                    comp.abbr = "DISABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__AUTO_PRORATE_MID_MONTH__").delete()
        except Exception:
            pass

    @property
    def lwf_state(self) -> str:
        """State Labour Welfare Fund (LWF) schedule ('EXEMPT_ZERO', 'KARNATAKA_DEC', 'MAHARASHTRA_JUN_DEC', 'CUSTOM_MONTHLY', 'CUSTOM_DECEMBER')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LWF_STATE__").first()
            if comp and comp.abbr in ("EXEMPT_ZERO", "KARNATAKA_DEC", "MAHARASHTRA_JUN_DEC", "CUSTOM_MONTHLY", "CUSTOM_DECEMBER"):
                return comp.abbr
        except Exception:
            pass
        return "EXEMPT_ZERO"

    @lwf_state.setter
    def lwf_state(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "EXEMPT_ZERO").strip().upper()
        if clean_val not in ("EXEMPT_ZERO", "KARNATAKA_DEC", "MAHARASHTRA_JUN_DEC", "CUSTOM_MONTHLY", "CUSTOM_DECEMBER"):
            clean_val = "EXEMPT_ZERO"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LWF_STATE__",
                defaults={
                    "name": "Labour Welfare Fund State Rule",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def lwf_employee_amount(self) -> Decimal:
        """Employee LWF deduction amount (default Rs 20.00)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LWF_EMPLOYEE_AMOUNT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("20.00")

    @lwf_employee_amount.setter
    def lwf_employee_amount(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "20.00"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LWF_EMPLOYEE_AMOUNT__",
                defaults={
                    "name": "Employee LWF Amount",
                    "abbr": "LWF_EMP",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def lwf_employer_amount(self) -> Decimal:
        """Employer LWF contribution amount (default Rs 40.00)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LWF_EMPLOYER_AMOUNT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("40.00")

    @lwf_employer_amount.setter
    def lwf_employer_amount(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "40.00"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LWF_EMPLOYER_AMOUNT__",
                defaults={
                    "name": "Employer LWF Amount",
                    "abbr": "LWF_EMPR",
                    "default_value": val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def statutory_bonus_pct(self) -> Decimal:
        """Configurable Statutory Bonus percentage under Payment of Bonus Act (default 0.00%, e.g. 8.33% to 20%)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__STATUTORY_BONUS_PCT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.00")

    @statutory_bonus_pct.setter
    def statutory_bonus_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "0.00"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__STATUTORY_BONUS_PCT__",
                defaults={
                    "name": "Statutory Bonus Percentage",
                    "abbr": "BONUS_PCT",
                    "default_value": val,
                    "component_type": "EARNING",
                    "calculation_type": "PERCENT_BASIC",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def esi_rounding_mode(self) -> str:
        """Statutory ESI rounding rule ('CEIL_RUPEE' under ESIC Reg 29, 'NEAREST_RUPEE', or 'EXACT_PAISA')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__ESI_ROUNDING_MODE__").first()
            if comp and comp.abbr in ("CEIL_RUPEE", "NEAREST_RUPEE", "EXACT_PAISA"):
                return comp.abbr
        except Exception:
            pass
        return "CEIL_RUPEE"

    @esi_rounding_mode.setter
    def esi_rounding_mode(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "CEIL_RUPEE").strip().upper()
        if clean_val not in ("CEIL_RUPEE", "NEAREST_RUPEE", "EXACT_PAISA"):
            clean_val = "CEIL_RUPEE"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__ESI_ROUNDING_MODE__",
                defaults={
                    "name": "ESI Rounding Rule",
                    "abbr": clean_val,
                    "component_type": "DEDUCTION",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def net_pay_rounding_mode(self) -> str:
        """Final Net Salary rounding rule ('EXACT_PAISA' or 'NEAREST_RUPEE')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__NET_PAY_ROUNDING_MODE__").first()
            if comp and comp.abbr in ("EXACT_PAISA", "NEAREST_RUPEE"):
                return comp.abbr
        except Exception:
            pass
        return "EXACT_PAISA"

    @net_pay_rounding_mode.setter
    def net_pay_rounding_mode(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "EXACT_PAISA").strip().upper()
        if clean_val not in ("EXACT_PAISA", "NEAREST_RUPEE"):
            clean_val = "EXACT_PAISA"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__NET_PAY_ROUNDING_MODE__",
                defaults={
                    "name": "Net Pay Rounding Rule",
                    "abbr": clean_val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def gratuity_in_ctc(self) -> bool:
        """Whether Statutory Gratuity (e.g. 4.81% of Basic) is carved out of the CTC pool (default False)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__GRATUITY_IN_CTC__").first()
            if comp and comp.abbr == "ENABLED":
                return True
        except Exception:
            pass
        return False

    @gratuity_in_ctc.setter
    def gratuity_in_ctc(self, value):
        if not self.client_id:
            return
        try:
            is_enabled = bool(value)
            if is_enabled:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code="__GRATUITY_IN_CTC__",
                    defaults={
                        "name": "Carve Out Gratuity in CTC Toggle",
                        "abbr": "ENABLED",
                        "component_type": "EMPLOYER_CONTRIBUTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != "ENABLED":
                    comp.abbr = "ENABLED"
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code="__GRATUITY_IN_CTC__").delete()
        except Exception:
            pass

    @property
    def gratuity_pct(self) -> Decimal:
        """Statutory Gratuity percentage of Basic (default 4.81% under Payment of Gratuity Act, 1972)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__GRATUITY_PCT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("4.81")

    @gratuity_pct.setter
    def gratuity_pct(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "4.81"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__GRATUITY_PCT__",
                defaults={
                    "name": "Gratuity Percentage of Basic",
                    "abbr": "GRAT_PCT",
                    "default_value": val,
                    "component_type": "EMPLOYER_CONTRIBUTION",
                    "calculation_type": "PERCENT_BASIC",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def leave_encashment_base(self) -> str:
        """Leave encashment calculation base ('BASIC' or 'GROSS', default 'BASIC')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LEAVE_ENCASHMENT_BASE__").first()
            if comp and comp.abbr in ("BASIC", "GROSS"):
                return comp.abbr
        except Exception:
            pass
        return "BASIC"

    @leave_encashment_base.setter
    def leave_encashment_base(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "BASIC").strip().upper()
        if clean_val not in ("BASIC", "GROSS"):
            clean_val = "BASIC"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LEAVE_ENCASHMENT_BASE__",
                defaults={
                    "name": "Leave Encashment Wage Base",
                    "abbr": clean_val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def leave_encashment_divisor(self) -> str:
        """Leave encashment daily divisor ('30' or '26', default '30')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LEAVE_ENCASHMENT_DIVISOR__").first()
            if comp and comp.abbr in ("30", "26"):
                return comp.abbr
        except Exception:
            pass
        return "30"

    @leave_encashment_divisor.setter
    def leave_encashment_divisor(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "30").strip()
        if clean_val not in ("30", "26"):
            clean_val = "30"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LEAVE_ENCASHMENT_DIVISOR__",
                defaults={
                    "name": "Leave Encashment Divisor",
                    "abbr": clean_val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def lta_calculation_type(self) -> str:
        """LTA calculation rule ('OFF', 'PERCENT_BASIC', 'CUSTOM_FIXED', default 'OFF')."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LTA_CALC_TYPE__").first()
            if comp and comp.abbr in ("OFF", "PERCENT_BASIC", "CUSTOM_FIXED"):
                return comp.abbr
        except Exception:
            pass
        return "OFF"

    @lta_calculation_type.setter
    def lta_calculation_type(self, value):
        if not self.client_id:
            return
        clean_val = str(value or "OFF").strip().upper()
        if clean_val not in ("OFF", "PERCENT_BASIC", "CUSTOM_FIXED"):
            clean_val = "OFF"
        try:
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LTA_CALC_TYPE__",
                defaults={
                    "name": "LTA Calculation Type",
                    "abbr": clean_val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.abbr = clean_val
            comp.save(update_fields=["abbr", "updated_at"])
        except Exception:
            pass

    @property
    def lta_percentage(self) -> Decimal:
        """LTA percentage of Basic (default 0.00%, CA benchmark 8.33% = 1 mo basic)."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LTA_PERCENTAGE__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.00")

    @lta_percentage.setter
    def lta_percentage(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "0.00"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LTA_PERCENTAGE__",
                defaults={
                    "name": "LTA Percentage of Basic",
                    "abbr": "LTA_PCT",
                    "default_value": val,
                    "component_type": "EARNING",
                    "calculation_type": "PERCENT_BASIC",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    @property
    def lta_flat_amount(self) -> Decimal:
        """LTA flat monthly amount."""
        try:
            comp = self.client.custom_salary_components.filter(code="__LTA_FLAT_AMOUNT__").first()
            if comp and comp.default_value is not None and Decimal(str(comp.default_value)) >= 0:
                return Decimal(str(comp.default_value))
        except Exception:
            pass
        return Decimal("0.00")

    @lta_flat_amount.setter
    def lta_flat_amount(self, value):
        if not self.client_id:
            return
        try:
            val = Decimal(str(value if value is not None else "0.00"))
            if val < 0:
                val = Decimal("0.00")
            comp, _ = self.client.custom_salary_components.get_or_create(
                code="__LTA_FLAT_AMOUNT__",
                defaults={
                    "name": "LTA Flat Monthly Amount",
                    "abbr": "LTA_FLAT",
                    "default_value": val,
                    "component_type": "EARNING",
                    "calculation_type": "FLAT",
                    "is_active": True,
                }
            )
            comp.default_value = val
            comp.save(update_fields=["default_value", "updated_at"])
        except Exception:
            pass

    def __str__(self) -> str:
        return self.client.name


class Employee(models.Model):
    """
    Payroll-local Employee record. Deliberately self-contained — payroll
    has no visibility into (and no FK to) any Employee model from another
    app. Every field here is one payroll itself actually reads.

    This will not automatically stay in sync with any HR-side employee
    record elsewhere in CAOAS — name changes, department transfers, exits
    recorded in HR won't propagate here. It's kept up to date the same way
    monthly batch records already are: via Excel upload (see
    excel_parser.py's employee-master import), not by mirroring another
    model.
    """

    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    employee_code = models.CharField(max_length=50)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    pan_number = models.CharField(max_length=20, blank=True)
    department = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    last_working_date = models.DateField(null=True, blank=True, db_index=True)
    ctc = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    client = models.ForeignKey(
        "clients.Client", on_delete=models.PROTECT, related_name="payroll_employees",
    )
    payment_mode = models.CharField(
        max_length=30,
        choices=ClientProfile.PAYMENT_MODE_CHOICES,
        null=True,
        blank=True,
        help_text="Override client default payment mode for this specific employee",
    )
    bank_name = models.CharField(max_length=100, blank=True)
    bank_account_number = models.CharField(max_length=50, blank=True)
    bank_ifsc_code = models.CharField(max_length=20, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_employees"
        ordering = ["employee_code"]
        unique_together = ("client", "employee_code")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def effective_payment_mode(self) -> str:
        """Returns employee override if set; otherwise falls back to client profile default."""
        if self.payment_mode:
            return self.payment_mode
        profile = getattr(self.client, "payroll_profile", None)
        return getattr(profile, "default_payment_mode", ClientProfile.PAYMENT_MODE_WIRE)

    @property
    def effective_payment_mode_display(self) -> str:
        code = self.effective_payment_mode
        mapping = dict(ClientProfile.PAYMENT_MODE_CHOICES)
        return mapping.get(code, code)

    @property
    def esi_number(self) -> str:
        """10-digit ESIC Insurance Person (IP) number."""
        # 1. Check latest salary structure snapshot custom_components
        try:
            struct = self.salary_structures.first()
            if struct and isinstance(struct.custom_components, dict):
                num = struct.custom_components.get("esi_number")
                if num:
                    return str(num).strip()
        except Exception:
            pass
        # 2. Check client-scoped virtual component
        if self.client_id and self.id:
            try:
                comp = self.client.custom_salary_components.filter(code=f"__ESI_NUM_{self.id}__").first()
                if comp and comp.abbr:
                    return str(comp.abbr).strip()
            except Exception:
                pass
        return ""

    @esi_number.setter
    def esi_number(self, value):
        val = str(value or "").strip()
        try:
            struct = self.salary_structures.first()
            if struct:
                cc = dict(struct.custom_components or {})
                cc["esi_number"] = val
                struct.custom_components = cc
                struct.save(update_fields=["custom_components"])
        except Exception:
            pass
        if not self.client_id or not self.id:
            return
        try:
            if val:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code=f"__ESI_NUM_{self.id}__",
                    defaults={
                        "name": f"ESI Number for {self.employee_code}",
                        "abbr": val,
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != val:
                    comp.abbr = val
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code=f"__ESI_NUM_{self.id}__").delete()
        except Exception:
            pass

    @property
    def uan_number(self) -> str:
        """12-digit EPFO Universal Account Number (UAN)."""
        # 1. Check latest salary structure snapshot custom_components
        try:
            struct = self.salary_structures.first()
            if struct and isinstance(struct.custom_components, dict):
                num = struct.custom_components.get("uan_number")
                if num:
                    return str(num).strip()
        except Exception:
            pass
        # 2. Check client-scoped virtual component
        if self.client_id and self.id:
            try:
                comp = self.client.custom_salary_components.filter(code=f"__UAN_NUM_{self.id}__").first()
                if comp and comp.abbr:
                    return str(comp.abbr).strip()
            except Exception:
                pass
        return ""

    @uan_number.setter
    def uan_number(self, value):
        val = str(value or "").strip()
        try:
            struct = self.salary_structures.first()
            if struct:
                cc = dict(struct.custom_components or {})
                cc["uan_number"] = val
                struct.custom_components = cc
                struct.save(update_fields=["custom_components"])
        except Exception:
            pass
        if not self.client_id or not self.id:
            return
        try:
            if val:
                comp, _ = self.client.custom_salary_components.get_or_create(
                    code=f"__UAN_NUM_{self.id}__",
                    defaults={
                        "name": f"UAN Number for {self.employee_code}",
                        "abbr": val,
                        "component_type": "DEDUCTION",
                        "calculation_type": "FLAT",
                        "is_active": True,
                    }
                )
                if comp.abbr != val:
                    comp.abbr = val
                    comp.save(update_fields=["abbr", "updated_at"])
            else:
                self.client.custom_salary_components.filter(code=f"__UAN_NUM_{self.id}__").delete()
        except Exception:
            pass

    @property
    def is_intern(self) -> bool:
        """True if the employee is an intern / apprentice receiving a stipend rather than regular salary."""
        try:
            struct = self.salary_structures.first()
            if struct and isinstance(struct.custom_components, dict):
                if struct.custom_components.get("is_intern") is not None:
                    return bool(struct.custom_components.get("is_intern"))
                if struct.custom_components.get("employment_type"):
                    return struct.custom_components.get("employment_type") == "INTERN"
        except Exception:
            pass
        pos = str(self.position or "")
        import re
        if re.search(r"\b(intern|internship|apprentice|apprenticeship|trainee)\b", pos, re.IGNORECASE):
            return True
        return False

    @property
    def employment_type(self) -> str:
        """Employment type: REGULAR, INTERN, or CONSULTANT."""
        try:
            struct = self.salary_structures.first()
            if struct and isinstance(struct.custom_components, dict):
                et = struct.custom_components.get("employment_type")
                if et in ("REGULAR", "INTERN", "CONSULTANT"):
                    return et
                if struct.custom_components.get("is_intern"):
                    return "INTERN"
        except Exception:
            pass
        return "INTERN" if self.is_intern else "REGULAR"

    def has_esi_period_continuity(self, year: int, month: int, wage_ceiling: Decimal = None) -> bool:
        """
        Under Section 2(9) Proviso of the ESI Act, 1948, if an insured employee is covered
        at the start of (or joins during) a 6-month Contribution Period (Apr 1 - Sep 30 or
        Oct 1 - Mar 31) with monthly gross <= ESI wage ceiling, they continue to contribute
        to ESI until the end of that 6-month period even if a mid-period salary revision
        raises their monthly gross above the ceiling.
        """
        import calendar
        from datetime import date

        try:
            profile = getattr(self.client, "payroll_profile", None) if self.client_id else None
            if profile is not None and not getattr(profile, "esi_period_continuity", True):
                return False
            ceil = wage_ceiling if wage_ceiling is not None else (getattr(profile, "esi_wage_ceiling", Decimal("21000")) if profile else Decimal("21000"))
            ceil = Decimal(str(ceil or 21000))

            # Determine start of current 6-month ESIC contribution window
            if 4 <= int(month) <= 9:
                period_start = date(int(year), 4, 1)
            elif int(month) >= 10:
                period_start = date(int(year), 10, 1)
            else:
                period_start = date(int(year) - 1, 10, 1)

            month_end = date(int(year), int(month), calendar.monthrange(int(year), int(month))[1])
            structs = list(self.salary_structures.filter(effective_from__lte=month_end).order_by("-effective_from", "-created_at"))
            if not structs:
                return False

            # Check structures that were active at period_start or took effect within [period_start, month_end]
            for idx, st in enumerate(structs):
                is_opted = bool(getattr(st, "esi_opted", False))
                if not is_opted and isinstance(getattr(st, "custom_components", None), dict):
                    is_opted = bool(st.custom_components.get("esi_opted", False))
                mg = Decimal(str(getattr(st, "monthly_gross", 0) or 0))
                if st.effective_from >= period_start:
                    if is_opted and mg <= ceil:
                        return True
                else:
                    # This is the structure that was already in effect on period_start
                    if is_opted and mg <= ceil:
                        return True
                    break
        except Exception:
            pass
        return False

    def __str__(self) -> str:
        return f"{self.employee_code} — {self.full_name}"


def get_client_slug(client) -> str:
    """Derive clean, lowercase slug for a client company."""
    if client is None:
        return "general"
    if isinstance(client, str):
        return slugify(client) or "client"
    name = getattr(client, "name", None) or getattr(client, "company_name", None)
    if name:
        slug = slugify(name)
        if slug:
            return slug
    cid = getattr(client, "id", None)
    if cid is not None:
        return f"client-{cid}"
    return "client"


def get_month_folder(month: int | str) -> str:
    """Formats month as '10-October', '01-January', etc."""
    try:
        m = int(month)
    except (ValueError, TypeError):
        m = 1
    m = max(1, min(12, m))
    return f"{m:02d}-{calendar.month_name[m]}"


def get_payroll_storage_rel_path(
    client,
    year: int | str,
    month: int | str,
    category: str = "excel",
    filename: str = "",
) -> str:
    """
    Returns relative storage path from MEDIA_ROOT:
    payroll/clients/<client_slug>/<year>/<month_folder>/<category>/[filename]
    """
    client_slug = get_client_slug(client)
    month_folder = get_month_folder(month)
    parts = ["payroll", "clients", client_slug, str(year), month_folder, category]
    if filename:
        parts.append(filename)
    return "/".join(parts)


def get_payroll_storage_abs_path(
    client,
    year: int | str,
    month: int | str,
    category: str = "payslips",
    filename: str = "",
) -> Path:
    """
    Returns absolute Path in the filesystem:
    settings.MEDIA_ROOT / payroll / clients / <client_slug> / <year> / <month_folder> / <category> / [filename]
    """
    media_root = getattr(settings, "MEDIA_ROOT", "/tmp/media") if settings.configured else "/tmp/media"
    rel_path = get_payroll_storage_rel_path(client, year, month, category=category, filename=filename)
    return Path(media_root) / rel_path


def payroll_source_file_path(instance, filename):
    # Uses local get_payroll_storage_rel_path
    client = getattr(instance, "client", None)
    year = getattr(instance, "year", None)
    month = getattr(instance, "month", None)
    if not year or not month:
        from django.utils import timezone
        now = timezone.now()
        year = year or now.year
        month = month or now.month
    return get_payroll_storage_rel_path(
        client=client,
        year=year,
        month=month,
        category="excel",
        filename=filename,
    )


class PayrollBatch(AuditableMixin, models.Model):
    AUDIT_ACTION_CREATE = "BATCH_UPLOADED"
    AUDIT_ACTION_UPDATE = "BATCH_UPDATED"

    STATUS_UPLOADED = "UPLOADED"
    STATUS_REVIEWED = "REVIEWED"
    STATUS_SENDING = "SENDING"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_FAILED = "FAILED"

    STATUS_CHOICES = [
        (STATUS_UPLOADED, "Uploaded"),
        (STATUS_REVIEWED, "Reviewed"),
        (STATUS_SENDING, "Sending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.PROTECT,
        related_name="payroll_batches",
    )
    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UPLOADED)
    source_file = models.FileField(upload_to=payroll_source_file_path, null=True, blank=True)
    total_records = models.IntegerField(default=0)
    email_sent = models.IntegerField(default=0)
    email_failed = models.IntegerField(default=0)
    error_log = models.TextField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="payroll_batches_uploaded",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_batches_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_batches_sent",
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_batches"
        unique_together = [("client", "month", "year")]
        ordering = ["-year", "-month", "-created_at"]

    def __str__(self) -> str:
        return f"{self.client} {self.month:02d}/{self.year}"

    @property
    def created_by(self):
        """Backward-compatible alias pointing to uploaded_by (requires zero DB migrations)."""
        return self.uploaded_by

    def get_cycle_dates(self) -> tuple[date, date, int]:
        """Returns (cycle_start_date, cycle_end_date, total_days) for this batch."""
        client = getattr(self, "client", None)
        profile = getattr(client, "payroll_profile", None) if client else None
        if profile and hasattr(profile, "get_cycle_dates"):
            return profile.get_cycle_dates(self.year, self.month)
        days = calendar.monthrange(self.year, self.month)[1]
        return date(self.year, self.month, 1), date(self.year, self.month, days), days


class CompOffAdjustment(AuditableMixin, models.Model):
    """
    Manual correction to an employee's comp-off balance, layered on top
    of the auto-carried PayslipRecord ledger rather than editing it in
    place — PayslipRecord.comp_off_closing_balance stays an immutable,
    auto-computed value (see PayslipRecord docstring / batch generation).

    An adjustment is "pending" until the next payroll batch is generated
    for this employee, at which point its amount is folded into that
    batch's comp_off_opening_balance and `applied_in_record` is set —
    see PayrollUploadView. Once applied, an adjustment is historical
    and no longer affects future opening-balance calculations.
    """

    AUDIT_ACTION_CREATE = "COMP_OFF_ADJUSTMENT_CREATED"
    AUDIT_TRACKED_FIELDS = ["employee_id", "amount", "reason"]

    employee = models.ForeignKey(
        "payroll.Employee", on_delete=models.CASCADE, related_name="comp_off_adjustments",
    )
    amount = models.DecimalField(
        max_digits=6, decimal_places=2,
        help_text="Signed number of days — positive to grant extra comp-off, "
                   "negative to correct/deduct.",
    )
    reason = models.TextField()
    applied_in_record = models.ForeignKey(
        "payroll.PayslipRecord", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="comp_off_adjustments_applied",
        help_text="Set once this adjustment has been folded into a payroll "
                   "batch's opening balance — null means still pending.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="comp_off_adjustments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_comp_off_adjustments"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.employee} — {self.amount:+} days"


class SalaryAdvance(AuditableMixin, models.Model):
    """
    An EMI-style salary advance plan: employee borrows `total_amount` and
    it's auto-recovered from payroll in equal-ish monthly installments
    over `tenure_months`, with no manual monthly adjustment required.

    Deliberately additive alongside SalaryAdvanceAdjustment rather than a
    replacement for it — the actual rupee movement (both the initial
    lump-sum disbursement and each month's EMI recovery) still happens as
    ordinary SalaryAdvanceAdjustment rows, which is what
    salary_advance_opening/closing_balance and batch generation already
    key off of (see PayrollUploadView). This model only tracks the plan
    itself (total, tenure, computed EMI, progress) and links back to the
    adjustments it generated via SalaryAdvanceAdjustment.advance.

    A plan is fully recovered once months_recovered == tenure_months —
    see is_active property. Manual one-off advances/recoveries unrelated
    to any EMI plan continue to work exactly as before, as
    SalaryAdvanceAdjustment rows with advance=None.
    """

    AUDIT_ACTION_CREATE = "SALARY_ADVANCE_CREATED"
    AUDIT_TRACKED_FIELDS = ["employee_id", "total_amount", "tenure_months", "reason"]

    employee = models.ForeignKey(
        "payroll.Employee", on_delete=models.CASCADE, related_name="salary_advances",
    )
    total_amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Total lump-sum amount advanced to the employee.",
    )
    tenure_months = models.PositiveIntegerField(
        help_text="Number of months over which total_amount is auto-recovered.",
    )
    emi_amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Computed at creation as total_amount / tenure_months (rounded to "
                   "2dp). Each month's auto-recovery uses this amount, except the "
                   "final installment which is adjusted for any rounding remainder "
                   "so the sum of all recoveries exactly equals total_amount.",
    )
    months_recovered = models.PositiveIntegerField(
        default=0,
        help_text="How many EMI installments have actually been applied to a "
                   "payroll batch so far. Incremented alongside "
                   "SalaryAdvanceAdjustment.applied_in_record being set for this "
                   "plan's recovery adjustments — see PayrollUploadView.",
    )
    disbursement_adjustment = models.OneToOneField(
        "payroll.SalaryAdvanceAdjustment", on_delete=models.PROTECT,
        related_name="disbursement_for_advance",
        help_text="The +total_amount SalaryAdvanceAdjustment representing this "
                   "plan's initial lump-sum disbursement. Created together with "
                   "this plan; folds into salary_advance_disbursed the same way "
                   "any manual advance would.",
    )
    reason = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="salary_advances_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_salary_advances"
        ordering = ["-created_at"]

    @property
    def is_active(self) -> bool:
        return self.months_recovered < self.tenure_months

    def __str__(self) -> str:
        return f"{self.employee} — advance of {self.total_amount} over {self.tenure_months}mo"


class SalaryAdvanceAdjustment(AuditableMixin, models.Model):
    """
    Manual correction to an employee's salary-advance balance, layered on
    top of the auto-carried PayslipRecord ledger rather than editing it in
    place — PayslipRecord.salary_advance_closing_balance stays an
    immutable, auto-computed value (see PayslipRecord docstring / batch
    generation). Same pattern as CompOffAdjustment.

    Purely adjustment-driven: there is no monthly excel column for this,
    so a positive amount records a new advance given to the employee and
    a negative amount records an amount recovered from their salary — the
    balance only moves via these adjustments, not via any attendance
    figure.

    An adjustment is "pending" until the next payroll batch is generated
    for this employee, at which point its amount is folded into that
    batch's salary_advance_opening_balance and `applied_in_record` is set
    — see PayrollUploadView. Once applied, an adjustment is historical and
    no longer affects future opening-balance calculations.

    `advance` is set when this row belongs to a SalaryAdvance EMI plan
    (either its initial disbursement or one of its auto-generated monthly
    recoveries) — null for ordinary manual one-off adjustments, exactly
    as before this field was added.
    """

    AUDIT_ACTION_CREATE = "SALARY_ADVANCE_ADJUSTMENT_CREATED"
    AUDIT_TRACKED_FIELDS = ["employee_id", "amount", "reason"]

    employee = models.ForeignKey(
        "payroll.Employee", on_delete=models.CASCADE, related_name="salary_advance_adjustments",
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Signed rupee amount — positive to record a new advance given, "
                   "negative to record an amount recovered/corrected.",
    )
    reason = models.TextField()
    advance = models.ForeignKey(
        "payroll.SalaryAdvance", on_delete=models.CASCADE,
        null=True, blank=True, related_name="adjustments",
        help_text="Set when this adjustment belongs to an EMI-style SalaryAdvance "
                   "plan (its disbursement or one of its auto-recoveries). Null for "
                   "ordinary manual one-off advances/recoveries.",
    )
    applied_in_record = models.ForeignKey(
        "payroll.PayslipRecord", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="salary_advance_adjustments_applied",
        help_text="Set once this adjustment has been folded into a payroll "
                   "batch's opening balance — null means still pending.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="salary_advance_adjustments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_salary_advance_adjustments"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.employee} — {self.amount:+} salary advance"


class OnHoldAdjustment(AuditableMixin, models.Model):
    """
    Manual correction to an employee's on-hold-payable balance, layered on
    top of the auto-carried PayslipRecord ledger rather than editing it in
    place — PayslipRecord.on_hold_closing_balance stays an immutable,
    auto-computed value (see PayslipRecord docstring / batch generation).
    Same pattern as CompOffAdjustment.

    Purely adjustment-driven: there is no monthly excel column for this,
    so a positive amount records a new amount put on hold and a negative
    amount records an amount released back to the employee — the balance
    only moves via these adjustments, not via any attendance figure.

    An adjustment is "pending" until the next payroll batch is generated
    for this employee, at which point its amount is folded into that
    batch's on_hold_opening_balance and `applied_in_record` is set — see
    PayrollUploadView. Once applied, an adjustment is historical and no
    longer affects future opening-balance calculations.
    """

    AUDIT_ACTION_CREATE = "ON_HOLD_ADJUSTMENT_CREATED"
    AUDIT_TRACKED_FIELDS = ["employee_id", "amount", "reason"]

    employee = models.ForeignKey(
        "payroll.Employee", on_delete=models.CASCADE, related_name="on_hold_adjustments",
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Signed rupee amount — positive to put an amount on hold, "
                   "negative to release/correct.",
    )
    reason = models.TextField()
    applied_in_record = models.ForeignKey(
        "payroll.PayslipRecord", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="on_hold_adjustments_applied",
        help_text="Set once this adjustment has been folded into a payroll "
                   "batch's opening balance — null means still pending.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="on_hold_adjustments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_on_hold_adjustments"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.employee} — {self.amount:+} on-hold"


class SalaryComponent(AuditableMixin, models.Model):
    """
    Dynamic Salary Component Catalog.
    Can be firm-wide global (client=None) or client-specific (client=Client).
    Enables corporate clients to add custom allowances (Fuel, Internet, Driver)
    or custom deductions without database schema changes.
    """
    AUDIT_ACTION_CREATE = "SALARY_COMPONENT_CREATED"
    AUDIT_ACTION_UPDATE = "SALARY_COMPONENT_UPDATED"
    AUDIT_TRACKED_FIELDS = [
        "client_id", "name", "code", "abbr", "component_type",
        "calculation_type", "default_value", "is_active",
    ]

    TYPE_EARNING = "EARNING"
    TYPE_DEDUCTION = "DEDUCTION"
    TYPE_EMPLOYER_CONTRIBUTION = "EMPLOYER_CONTRIBUTION"
    TYPE_CHOICES = [
        (TYPE_EARNING, "Earning"),
        (TYPE_DEDUCTION, "Deduction"),
        (TYPE_EMPLOYER_CONTRIBUTION, "Employer Contribution (Off-Slip)"),
    ]

    CALC_FLAT = "FLAT"
    CALC_PERCENT_BASIC = "PERCENT_BASIC"
    CALC_PERCENT_GROSS = "PERCENT_GROSS"
    CALC_FORMULA = "FORMULA"
    CALC_CHOICES = [
        (CALC_FLAT, "Flat Monthly Amount"),
        (CALC_PERCENT_BASIC, "Percentage of Basic"),
        (CALC_PERCENT_GROSS, "Percentage of Gross"),
        (CALC_FORMULA, "Formula"),
    ]

    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="custom_salary_components",
        help_text="Leave blank for global firm standard; select client for client-specific allowances."
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)
    abbr = models.CharField(max_length=20, help_text="Short formula variable e.g. FUEL, INTERNET")
    component_type = models.CharField(max_length=30, choices=TYPE_CHOICES, default=TYPE_EARNING)
    calculation_type = models.CharField(max_length=20, choices=CALC_CHOICES, default=CALC_FLAT)
    formula = models.CharField(max_length=255, blank=True)
    default_value = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    depends_on_payment_days = models.BooleanField(default=True, help_text="Prorate based on attendance & LOP")
    do_not_include_in_total = models.BooleanField(default=False, help_text="Informational on payslip; excluded from net pay")
    statistical_component = models.BooleanField(default=False, help_text="Internal math variable; not printed on slip")
    remove_if_zero_valued = models.BooleanField(default=True, help_text="Omit from printed payslip if 0")
    round_to_nearest_integer = models.BooleanField(default=True, help_text="Round evaluated rupee amount to whole number")

    is_taxable = models.BooleanField(default=True)
    is_part_of_pf_wages = models.BooleanField(default=False)
    is_part_of_esi_wages = models.BooleanField(default=False)
    is_statutory = models.BooleanField(default=False)
    display_order = models.PositiveSmallIntegerField(default=10)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_salary_components"
        unique_together = [("client", "code")]
        ordering = ["display_order", "name"]

    @property
    def is_monthly_variable(self) -> bool:
        """
        True if this component amount changes every month (variable input via Excel / Workbench).
        False if it is fixed recurring baseline contracted in the salary structure.
        Persisted cleanly in existing `formula` column as 'VARIABLE' or 'FIXED' to maintain zero database migrations.
        """
        parts = [p.strip().upper() for p in (self.formula or "").split(",") if p.strip()]
        return "VARIABLE" in parts

    @is_monthly_variable.setter
    def is_monthly_variable(self, val: bool):
        parts = [p.strip() for p in (self.formula or "").split(",") if p.strip() and p.strip().upper() not in ("VARIABLE", "FIXED")]
        parts.insert(0, "VARIABLE" if val else "FIXED")
        self.formula = ",".join(parts)

    @property
    def carve_out_from_ctc(self) -> bool:
        """
        True if this component is carved out from the CTC pool upfront before calculating Basic/HRA.
        Persisted cleanly in the `formula` field alongside 'VARIABLE' or 'FIXED' (e.g. 'FIXED,CARVE_OUT') to avoid DB migrations.
        """
        raw = (self.formula or "").strip().upper()
        return "CARVE_OUT" in raw or self.do_not_include_in_total

    @carve_out_from_ctc.setter
    def carve_out_from_ctc(self, val: bool):
        parts = [p.strip() for p in (self.formula or "").split(",") if p.strip() and p.strip().upper() != "CARVE_OUT"]
        if val:
            parts.append("CARVE_OUT")
        self.formula = ",".join(parts) if parts else ("VARIABLE" if self.is_monthly_variable else "FIXED")

    @property
    def payout_frequency(self) -> str:
        """
        Disbursement Schedule: 'MONTHLY', 'ANNUAL', 'QUARTERLY', 'ON_SEPARATION'.
        Default is 'MONTHLY'.
        """
        raw = (self.formula or "").strip().upper()
        if "ANNUAL" in raw:
            return "ANNUAL"
        if "QUARTERLY" in raw:
            return "QUARTERLY"
        if "ON_SEPARATION" in raw or "SEPARATION" in raw:
            return "ON_SEPARATION"
        return "MONTHLY"

    @payout_frequency.setter
    def payout_frequency(self, val: str):
        target = str(val or "MONTHLY").strip().upper()
        parts = [
            p.strip() for p in (self.formula or "").split(",")
            if p.strip() and not p.strip().upper().startswith("ANNUAL")
            and p.strip().upper() not in ("QUARTERLY", "ON_SEPARATION", "SEPARATION", "MONTHLY")
        ]
        if target == "ANNUAL":
            parts.append(f"ANNUAL:{self.payout_month}")
        elif target in ("QUARTERLY", "ON_SEPARATION"):
            parts.append(target)
        else:
            parts.append("MONTHLY")
        self.formula = ",".join(parts)

    @property
    def payout_month(self) -> int:
        """
        For ANNUAL payout schedule, the target calendar month (1-12) when the lump sum is disbursed.
        Default is 3 (March fiscal year-end) or parsed from token like 'ANNUAL:10' or 'ANNUAL_M10'.
        """
        import re
        raw = (self.formula or "").strip().upper()
        m = re.search(r"ANNUAL[:_M]+(\d+)", raw)
        if m:
            try:
                val = int(m.group(1))
                if 1 <= val <= 12:
                    return val
            except Exception:
                pass
        return 3

    @payout_month.setter
    def payout_month(self, val: int):
        try:
            m_val = int(val)
            if not (1 <= m_val <= 12):
                m_val = 3
        except Exception:
            m_val = 3
        parts = [
            p.strip() for p in (self.formula or "").split(",")
            if p.strip() and not p.strip().upper().startswith("ANNUAL")
        ]
        parts.append(f"ANNUAL:{m_val}")
        self.formula = ",".join(parts)

    @property
    def prorate_for_mid_year_joiners(self) -> bool:
        """
        Whether annual bonus should prorate based on months worked for employees who joined mid-year.
        """
        raw = (self.formula or "").strip().upper()
        return "PRORATE_JOINER" in raw

    @prorate_for_mid_year_joiners.setter
    def prorate_for_mid_year_joiners(self, val: bool):
        parts = [p.strip() for p in (self.formula or "").split(",") if p.strip() and p.strip().upper() != "PRORATE_JOINER"]
        if val:
            parts.append("PRORATE_JOINER")
        self.formula = ",".join(parts)

    def __str__(self) -> str:
        client_tag = f" [{self.client.name}]" if self.client else " [GLOBAL]"
        return f"{self.name} ({self.abbr}){client_tag}"


class PayslipRecord(AuditableMixin, models.Model):
    AUDIT_ACTION_CREATE = "PAYSLIP_CREATED"
    AUDIT_ACTION_UPDATE = "PAYSLIP_UPDATED"

    STATUS_DRAFT = "DRAFT"
    STATUS_APPROVED = "APPROVED"
    STATUS_EMAIL_SENT = "EMAIL_SENT"
    STATUS_EMAIL_FAILED = "EMAIL_FAILED"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_EMAIL_SENT, "Email sent"),
        (STATUS_EMAIL_FAILED, "Email failed"),
    ]

    AUDIT_TRACKED_FIELDS = [
        "batch_id", "employee_id", "salary_structure_snapshot_id",
        "days_in_month", "actual_working_days", "extra_working_days",
        "comp_off_opening_balance", "comp_off_days_used", "comp_off_closing_balance",
        "leave_opening_balance", "leave_accrued", "leave_used", "leave_closing_balance",
        "salary_advance_opening_balance", "salary_advance_disbursed", "salary_advance_recovered",
        "salary_advance_closing_balance",
        "on_hold_opening_balance", "on_hold_deducted", "on_hold_released", "on_hold_closing_balance",
        "paid_leave_days", "lop_days",
        "basic_da", "basic_for_pf", "hra", "lta", "special_allowance",
        "nps_allowance_earned", "gross_salary", "variable_pay",
        "commission_other", "arrears", "reimbursements", "night_shift", "earned_salary", "tds", "epf", "vpf",
        "professional_tax", "nps_deduction", "vpf_arrears",
        "nps_deduction_arrears", "loan_deduction", "lwf", "other_deduction",
        "total_deductions", "net_salary", "pdf_path", "status", "edit_count",
    ]

    batch = models.ForeignKey(PayrollBatch, on_delete=models.PROTECT, related_name="records")
    employee = models.ForeignKey("payroll.Employee", on_delete=models.PROTECT, related_name="payslip_records")
    salary_structure_snapshot = models.ForeignKey(
        "payroll.EmployeeSalaryStructure",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payslip_records",
    )

    days_in_month = models.PositiveSmallIntegerField(default=31)
    actual_working_days = models.PositiveSmallIntegerField(default=0)
    extra_working_days = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Raw days worked beyond normal, from the monthly excel. "
                   "Credits comp_off_opening_balance -> comp_off_closing_balance "
                   "(see below), which can then offset LOP in a later month.",
    )
    comp_off_opening_balance = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="Read-only — auto-carried from this employee's PREVIOUS "
                   "month's comp_off_closing_balance. Not uploaded, not "
                   "editable; do not set this directly.",
    )
    comp_off_days_used = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="How many banked comp-off days were consumed this month "
                   "to cover LOP without reducing pay. "
                   "= min(lop_days, comp_off_opening_balance + extra_working_days).",
    )
    comp_off_closing_balance = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="= comp_off_opening_balance + extra_working_days - comp_off_days_used. "
                   "Becomes next month's comp_off_opening_balance.",
    )
    leave_opening_balance = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="Read-only — auto-carried from this employee's PREVIOUS "
                   "month's leave_closing_balance (plus any pending manual "
                   "LeaveAdjustment, e.g. a cashout). Not uploaded, not "
                   "editable; do not set this directly. General CL/SL/EL "
                   "leave pool — separate from the comp_off_* ledger above.",
    )
    leave_accrued = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="This month's accrual = 22/12 days, or 0 if the employee "
                   "is still within their 6-month probation period.",
    )
    leave_used = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="How many days of lop_days were covered by this leave "
                   "balance (after probation-check), before any remaining "
                   "LOP falls to comp-off. 0 for probation employees, since "
                   "their LOP is always a direct salary deduction.",
    )
    leave_closing_balance = models.DecimalField(
        max_digits=6, decimal_places=2, default=0,
        help_text="= leave_opening_balance + leave_accrued - leave_used. "
                   "Becomes next month's leave_opening_balance. Allowed to "
                   "go negative (displayed as-is) — this is informational "
                   "only and never reduces earned_salary/net_salary.",
    )
    paid_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    lop_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    salary_advance_opening_balance = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Read-only — auto-carried from this employee's PREVIOUS "
                   "month's salary_advance_closing_balance. Not uploaded, "
                   "not editable; do not set this directly.",
    )
    salary_advance_disbursed = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="This month's new advance(s) given to the employee (from "
                   "SalaryAdvanceAdjustment amounts >= 0 applied to this "
                   "record) — feeds into earned_salary as a real earning line.",
    )
    salary_advance_recovered = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="This month's amount recovered from the employee's pay "
                   "(from SalaryAdvanceAdjustment amounts < 0 applied to this "
                   "record) — feeds into total_deductions as a real deduction line.",
    )
    salary_advance_closing_balance = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="= salary_advance_opening_balance + salary_advance_disbursed "
                   "- salary_advance_recovered (computed in save()). Becomes "
                   "next month's salary_advance_opening_balance.",
    )
    on_hold_opening_balance = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Read-only — auto-carried from this employee's PREVIOUS "
                   "month's on_hold_closing_balance. Not uploaded, not "
                   "editable; do not set this directly.",
    )
    on_hold_deducted = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="This month's new amount(s) put on hold (from "
                   "OnHoldAdjustment amounts >= 0 applied to this record) — "
                   "feeds into total_deductions as a real deduction line.",
    )
    on_hold_released = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="This month's amount(s) released back to the employee "
                   "(from OnHoldAdjustment amounts < 0 applied to this "
                   "record) — feeds into earned_salary as a real earning line.",
    )
    on_hold_closing_balance = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="= on_hold_opening_balance + on_hold_deducted - "
                   "on_hold_released (computed in save()). Becomes next "
                   "month's on_hold_opening_balance.",
    )

    basic_da = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    basic_for_pf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    lta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    special_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    nps_allowance_earned = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Raw this-month-only extra/top-up as uploaded in Excel, kept separate
    # from the fields above (which hold the FINAL paid amount = salary
    # structure's prorated baseline + this extra). Needed so that a later
    # attendance edit can re-run calculate_payslip_fields() and re-derive
    # the combined figure from the baseline + this raw extra, without
    # double-adding the baseline on top of an already-combined value.
    lta_upload = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    special_allowance_upload = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    nps_allowance_upload = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    variable_pay = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    commission_other = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    arrears = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reimbursements = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Raw pass-through from the monthly excel upload. Deliberately "
                   "excluded from earned_salary/net_salary — paid out on top of "
                   "Net Salary as its own 'Total Payable' line on the payslip, "
                   "not blended into taxable earnings.",
    )
    night_shift = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="DEPRECATED — no longer uploaded or computed (night-shift pay "
                   "is now expected to be folded into another field before "
                   "upload). Kept for historical payslips only; not used in "
                   "earned_salary for new records.",
    )
    earned_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    tds = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    epf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vpf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    professional_tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    nps_deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vpf_arrears = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    nps_deduction_arrears = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    loan_deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    lwf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    net_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    pdf_path = models.CharField(max_length=500, null=True, blank=True)
    pdf_password = models.CharField(max_length=100, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    raw_row_data = models.JSONField(null=True, blank=True)
    custom_components = models.JSONField(default=dict, blank=True, help_text="Snapshot of dynamic custom allowances and deductions evaluated for this month")
    edit_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_payslip_records"
        unique_together = [("batch", "employee")]
        ordering = ["employee__employee_code"]

    def recompute_totals_and_balances(self) -> None:
        """
        Pure in-memory computation of earned_salary, total_deductions,
        net_salary, and ledger closing balances (advance & on-hold).
        Called automatically by save(), and can be called directly before
        bulk_update to ensure 100% mathematical parity in vectorized operations.
        """
        def _to_dec(val) -> Decimal:
            if val is None:
                return Decimal("0")
            if isinstance(val, Decimal):
                return val
            try:
                return Decimal(str(val))
            except Exception:
                return Decimal("0")

        self.earned_salary = sum(
            [
                _to_dec(self.basic_da),
                _to_dec(self.hra),
                _to_dec(self.lta),
                _to_dec(self.special_allowance),
                _to_dec(self.nps_allowance_earned),
                _to_dec(self.variable_pay),
                _to_dec(self.commission_other),
                _to_dec(self.arrears),
                _to_dec(self.salary_advance_disbursed),
                _to_dec(self.on_hold_released),
            ],
            Decimal("0"),
        )
        self.total_deductions = sum(
            [
                _to_dec(self.tds),
                _to_dec(self.epf),
                _to_dec(self.vpf),
                _to_dec(self.professional_tax),
                _to_dec(self.nps_deduction),
                _to_dec(self.vpf_arrears),
                _to_dec(self.nps_deduction_arrears),
                _to_dec(self.loan_deduction),
                _to_dec(self.lwf),
                _to_dec(self.other_deduction),
                _to_dec(self.salary_advance_recovered),
                _to_dec(self.on_hold_deducted),
            ],
            Decimal("0"),
        )
        # Dynamic custom components evaluation from JSON
        # Handles Form A (nested {"earnings": [...], "deductions": [...]}),
        # Form B (flat {"CODE": {"amount": ..., "type": ...}} or {"CODE": amount}),
        # AND Hybrid dictionaries (nested arrays + top-level component keys).
        custom_earnings = Decimal("0")
        custom_deductions = Decimal("0")
        if isinstance(self.custom_components, dict):
            METADATA_KEYS = {
                "esi_opted", "employer_esi", "employer_esi_in_ctc",
                "esi_number", "uan_number", "employer_pf", "employer_pf_in_ctc",
                "is_senior_citizen", "non_eps",
            }
            seen_codes = set()

            # 1. Process nested Form A sections if present
            if "earnings" in self.custom_components and isinstance(self.custom_components["earnings"], list):
                for e in self.custom_components.get("earnings", []):
                    if isinstance(e, dict):
                        c_code = str(e.get("code") or e.get("abbr") or "").strip().upper()
                        if c_code:
                            seen_codes.add(c_code)
                        is_stat = bool(e.get("statistical_component", False))
                        if not is_stat and not (e.get("do_not_include_in_total") and e.get("is_non_cash")):
                            custom_earnings += _to_dec(e.get("amount") if e.get("amount") is not None else e.get("total_amount"))

            if "deductions" in self.custom_components and isinstance(self.custom_components["deductions"], list):
                for d in self.custom_components.get("deductions", []):
                    if isinstance(d, dict):
                        c_code = str(d.get("code") or d.get("abbr") or "").strip().upper()
                        if c_code:
                            seen_codes.add(c_code)
                        if not d.get("do_not_include_in_total"):
                            custom_deductions += _to_dec(d.get("amount"))

            # 2. Process any top-level component keys (Form B or Hybrid loose entries)
            for code, val in self.custom_components.items():
                if code in ("earnings", "deductions") or code in METADATA_KEYS:
                    continue
                clean_code = str(code).strip().upper()
                if clean_code in seen_codes:
                    continue
                if isinstance(val, dict):
                    is_stat = bool(val.get("statistical_component", False))
                    if is_stat:
                        continue
                    comp_type = str(val.get("type", "EARNING")).upper()
                    amt = _to_dec(val.get("amount"))
                    if comp_type == "DEDUCTION":
                        if not val.get("do_not_include_in_total"):
                            custom_deductions += amt
                    else:
                        custom_earnings += amt
                else:
                    # Direct scalar amount (default EARNING)
                    custom_earnings += _to_dec(val)

            # Ensure FBP from snapshot is folded into earned_salary if missing from custom_components (legacy fallback)
            if "FBP" not in seen_codes:
                snap = getattr(self, "salary_structure_snapshot", None)
                if snap and getattr(snap, "fbp", None) is not None:
                    snap_fbp = _to_dec(snap.fbp)
                    if snap_fbp > Decimal("0"):
                        tot_days = _to_dec(getattr(self, "days_in_month", None) or 30)
                        p_days = _to_dec(getattr(self, "actual_working_days", None) or 0)
                        if tot_days > Decimal("0") and p_days > Decimal("0"):
                            fbp_prorated = ((snap_fbp * p_days) / tot_days).quantize(Decimal("0.01"))
                            custom_earnings += fbp_prorated

        self.earned_salary += custom_earnings
        self.total_deductions += custom_deductions

        # Zero-Floor Net Pay Guard: Cap voluntary salary advance recovery if deductions exceed earnings
        if self.total_deductions > self.earned_salary and _to_dec(self.salary_advance_recovered) > 0:
            excess_deductions = self.total_deductions - self.earned_salary
            recovery_reduction = min(_to_dec(self.salary_advance_recovered), excess_deductions)
            self.salary_advance_recovered = _to_dec(self.salary_advance_recovered) - recovery_reduction
            self.total_deductions -= recovery_reduction

        # Absolute zero-floor: net_salary can never be negative in banking / payslip accounting
        raw_net_salary = max(Decimal("0.00"), self.earned_salary - self.total_deductions)
        net_round_mode = "EXACT_PAISA"
        try:
            client_obj = getattr(self.batch, "client", None) if self.batch_id else None
            if client_obj is None and self.employee_id:
                client_obj = getattr(self.employee, "client", None)
            prof_obj = getattr(client_obj, "payroll_profile", None) if client_obj is not None else None
            if prof_obj is not None:
                net_round_mode = str(getattr(prof_obj, "net_pay_rounding_mode", "EXACT_PAISA") or "EXACT_PAISA").strip().upper()
        except Exception:
            net_round_mode = "EXACT_PAISA"

        if net_round_mode == "NEAREST_RUPEE":
            from decimal import ROUND_HALF_UP
            self.net_salary = raw_net_salary.quantize(Decimal("1"), rounding=ROUND_HALF_UP).quantize(Decimal("0.01"))
        else:
            self.net_salary = raw_net_salary.quantize(Decimal("0.01"))

        # Advance & On-Hold Ledger Non-Negative Self-Healing
        adv_open = max(Decimal("0.00"), abs(_to_dec(self.salary_advance_opening_balance)))
        self.salary_advance_opening_balance = adv_open
        self.salary_advance_disbursed = max(Decimal("0.00"), _to_dec(self.salary_advance_disbursed))
        self.salary_advance_recovered = max(Decimal("0.00"), _to_dec(self.salary_advance_recovered))
        self.salary_advance_closing_balance = max(
            Decimal("0.00"),
            adv_open + self.salary_advance_disbursed - self.salary_advance_recovered,
        )

        hold_open = max(Decimal("0.00"), abs(_to_dec(self.on_hold_opening_balance)))
        self.on_hold_opening_balance = hold_open
        self.on_hold_deducted = max(Decimal("0.00"), _to_dec(self.on_hold_deducted))
        self.on_hold_released = max(Decimal("0.00"), _to_dec(self.on_hold_released))
        self.on_hold_closing_balance = max(
            Decimal("0.00"),
            hold_open + self.on_hold_deducted - self.on_hold_released,
        )

    def save(self, *args, **kwargs) -> None:
        self.recompute_totals_and_balances()
        super().save(*args, **kwargs)

    @property
    def esi(self) -> Decimal:
        """Evaluated Employee ESI deduction for this month (0.75% of gross wages)."""
        if isinstance(self.custom_components, dict):
            for d in self.custom_components.get("deductions", []):
                if d.get("code") == "ESI":
                    try:
                        return Decimal(str(d.get("amount", 0)))
                    except Exception:
                        return Decimal("0.00")
        return Decimal("0.00")

    @esi.setter
    def esi(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        deductions = list(self.custom_components.get("deductions", []))
        val_dec = Decimal(str(value or 0)).quantize(Decimal("0.01"))
        found = False
        for d in deductions:
            if d.get("code") == "ESI":
                d["amount"] = float(val_dec)
                d["default_amount"] = float(val_dec)
                found = True
                break
        if not found and val_dec > 0:
            deductions.append({
                "code": "ESI",
                "name": "Employees' State Insurance",
                "abbr": "ESI",
                "default_amount": float(val_dec),
                "additional_amount": 0.0,
                "amount": float(val_dec),
                "depends_on_payment_days": False,
                "do_not_include_in_total": False,
                "source": "STATUTORY",
            })
        self.custom_components["deductions"] = deductions

    @property
    def employer_esi(self) -> Decimal:
        """Informational Employer ESI (3.25%) evaluated for this payslip."""
        if isinstance(self.custom_components, dict):
            val = self.custom_components.get("employer_esi")
            if val is not None:
                try:
                    return Decimal(str(val))
                except Exception:
                    pass
        if self.salary_structure_snapshot:
            return getattr(self.salary_structure_snapshot, "employer_esi", Decimal("0.00"))
        return Decimal("0.00")

    @employer_esi.setter
    def employer_esi(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["employer_esi"] = str(value)

    @property
    def employer_pf(self) -> Decimal:
        """Informational Employer PF (12% of basic up to statutory ceiling) evaluated for this payslip."""
        if isinstance(self.custom_components, dict):
            val = self.custom_components.get("employer_pf")
            if val is not None:
                try:
                    return Decimal(str(val))
                except Exception:
                    pass
        if self.salary_structure_snapshot:
            return getattr(self.salary_structure_snapshot, "employer_pf", Decimal("0.00"))
        return Decimal("0.00")

    @employer_pf.setter
    def employer_pf(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["employer_pf"] = str(value)

    @property
    def total_working_days(self) -> int:
        """Calendar days in payroll cycle month (default 30)."""
        return getattr(self, "days_in_month", None) or 30

    @property
    def payment_days(self) -> Decimal:
        """Actual payable days after attendance/LOP."""
        return getattr(self, "actual_working_days", None) or Decimal("0")

    @property
    def fbp(self) -> Decimal:
        """Flexible Benefit Plan earned amount from custom_components or in-memory cache."""
        if hasattr(self, "_fbp_runtime") and self._fbp_runtime is not None:
            return Decimal(str(self._fbp_runtime))
        if isinstance(self.custom_components, dict):
            for e in self.custom_components.get("earnings", []) or []:
                if isinstance(e, dict) and str(e.get("code", "")).upper() in ("FBP", "FLEXIBLE_BENEFIT_PLAN"):
                    return Decimal(str(e.get("amount", 0) or 0))
        return Decimal("0.00")

    @fbp.setter
    def fbp(self, value):
        self._fbp_runtime = value

    def __str__(self) -> str:
        return f"{self.employee.employee_code} - {self.batch.month:02d}/{self.batch.year}"


class LeaveAdjustment(AuditableMixin, models.Model):
    """
    Manual correction to an employee's general leave balance, layered on
    top of the auto-carried PayslipRecord ledger rather than editing it
    in place — same pattern as CompOffAdjustment above (see that model's
    docstring). Used for HR-initiated leave cashouts (negative amount —
    HR just records how many days were cashed out; no rupee amount is
    tracked here, since payout calculation happens outside CAOAS and is
    deliberately not shown on the payslip) as well as ordinary manual
    grants/corrections to the leave balance.

    An adjustment is "pending" until the next payroll batch is generated
    for this employee, at which point its amount is folded into that
    batch's leave_opening_balance and `applied_in_record` is set — same
    fold-in point as CompOffAdjustment in PayrollUploadView.
    """

    AUDIT_ACTION_CREATE = "LEAVE_ADJUSTMENT_CREATED"
    AUDIT_TRACKED_FIELDS = ["employee_id", "amount", "reason"]

    employee = models.ForeignKey(
        "payroll.Employee", on_delete=models.CASCADE, related_name="leave_adjustments",
    )
    amount = models.DecimalField(
        max_digits=6, decimal_places=2,
        help_text="Signed number of days — positive to grant extra leave, "
                   "negative for a cashout or correction/deduction.",
    )
    reason = models.TextField()
    applied_in_record = models.ForeignKey(
        "payroll.PayslipRecord", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="leave_adjustments_applied",
        help_text="Set once this adjustment has been folded into a payroll "
                   "batch's opening balance — null means still pending.",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="leave_adjustments_created")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_leave_adjustments"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.amount:+}"


class PayslipRecordEdit(models.Model):
    payslip_record = models.ForeignKey(PayslipRecord, on_delete=models.PROTECT, related_name="edits")
    edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payslip_edits")
    field_name = models.CharField(max_length=50)
    old_value = models.CharField(max_length=500)
    new_value = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_payslip_record_edits"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.payslip_record_id} {self.field_name}"


# Exhaustive concrete field whitelist for vectorized bulk_update operations
PAYSLIP_ALL_COMPUTED_FIELDS = [
    "salary_structure_snapshot",
    "days_in_month",
    "actual_working_days",
    "extra_working_days",
    "comp_off_opening_balance",
    "comp_off_days_used",
    "comp_off_closing_balance",
    "leave_opening_balance",
    "leave_accrued",
    "leave_used",
    "leave_closing_balance",
    "salary_advance_opening_balance",
    "salary_advance_disbursed",
    "salary_advance_recovered",
    "salary_advance_closing_balance",
    "on_hold_opening_balance",
    "on_hold_deducted",
    "on_hold_released",
    "on_hold_closing_balance",
    "paid_leave_days",
    "lop_days",
    "basic_da",
    "basic_for_pf",
    "hra",
    "lta",
    "special_allowance",
    "nps_allowance_earned",
    "gross_salary",
    "variable_pay",
    "commission_other",
    "arrears",
    "reimbursements",
    "night_shift",
    "earned_salary",
    "tds",
    "epf",
    "vpf",
    "professional_tax",
    "nps_deduction",
    "vpf_arrears",
    "nps_deduction_arrears",
    "loan_deduction",
    "lwf",
    "other_deduction",
    "total_deductions",
    "net_salary",
    "custom_components",
    "pdf_path",
    "updated_at",
]


class EmailLog(models.Model):
    payslip_record = models.ForeignKey(PayslipRecord, on_delete=models.PROTECT, related_name="email_logs")
    sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payslip_email_logs")
    recipient_email = models.EmailField()
    cc_email = models.EmailField(null=True, blank=True)
    subject = models.CharField(max_length=500)
    success = models.BooleanField()
    error_message = models.TextField(null=True, blank=True)
    attempt_number = models.IntegerField(default=1)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_email_logs"
        ordering = ["-sent_at"]

    def __str__(self) -> str:
        return f"{self.recipient_email} attempt {self.attempt_number}"

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

class EmployeeSalaryStructure(models.Model):
    """
    Versioned CTC/salary structure for an employee, used to compute each
    month's PayslipRecord (see calculations.py). This model does not exist
    anywhere else in the project, so it lives here in the payroll module
    (new feature requirement: any new model needed by payroll is created
    inside the payroll app only).

    Multiple rows per employee are allowed (effective_from-dated history);
    calculations.py / views.py always resolve the latest one as-of a given
    date via get_latest_salary_structure() below.
    """

    employee = models.ForeignKey(
        "payroll.Employee",
        on_delete=models.PROTECT,
        related_name="salary_structures",
    )
    effective_from = models.DateField()

    ctc_annual = models.DecimalField(max_digits=12, decimal_places=2)

    original_basic_da = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    original_hra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    original_special_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    original_lta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    nps_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fbp = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    monthly_gross = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vpf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pf_opted = models.BooleanField(default=True)
    employer_pf = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Employer's PF contribution (12% of Basic, capped at Rs 1,800). "
                  "Computed automatically when the structure is built from CTC "
                  "(build_from_ctc) — informational on the payslip, never part of net pay.",
    )
    pf_calculation_rule = models.CharField(
        max_length=30, default="CAPPED_1800",
        help_text="CAPPED_1800 (flat Rs 1,800), UNCAPPED_12_PERCENT (12% of actual Basic), or NOT_OPTED (0)"
    )
    employer_pf_in_ctc = models.BooleanField(
        default=True,
        help_text="If True, Employer PF is carved out of the CTC pool. If False, paid on top of CTC."
    )
    custom_components = models.JSONField(
        default=dict, blank=True,
        help_text="Contracted baseline values for dynamic custom salary components"
    )

    @property
    def esi_opted(self) -> bool:
        """True if ESI applies to this employee structure."""
        if isinstance(self.custom_components, dict) and "esi_opted" in self.custom_components:
            return bool(self.custom_components["esi_opted"])
        # Statutory ceiling check: monthly_gross <= Rs 21,000 and client has ESI enabled
        try:
            profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
            if profile and getattr(profile, "esi_enabled", False):
                return bool((self.monthly_gross or Decimal("0")) <= Decimal("21000"))
        except Exception:
            pass
        return False

    @esi_opted.setter
    def esi_opted(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["esi_opted"] = bool(value)

    @property
    def employer_esi(self) -> Decimal:
        """Employer ESI contribution (3.25% of gross wages)."""
        if isinstance(self.custom_components, dict) and "employer_esi" in self.custom_components:
            try:
                return Decimal(str(self.custom_components["employer_esi"]))
            except Exception:
                pass
        if self.esi_opted:
            return (self.monthly_gross * Decimal("0.0325")).quantize(Decimal("0.01"))
        return Decimal("0.00")

    @employer_esi.setter
    def employer_esi(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["employer_esi"] = str(value)

    @property
    def employer_esi_in_ctc(self) -> bool:
        """True if Employer ESI contribution is carved out of the CTC pool."""
        if isinstance(self.custom_components, dict) and "employer_esi_in_ctc" in self.custom_components:
            return bool(self.custom_components["employer_esi_in_ctc"])
        try:
            profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
            if profile:
                return bool(profile.employer_esi_in_ctc)
        except Exception:
            pass
        return True

    @employer_esi_in_ctc.setter
    def employer_esi_in_ctc(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["employer_esi_in_ctc"] = bool(value)

    @property
    def is_intern(self) -> bool:
        """True if this salary structure represents an internship stipend."""
        if isinstance(self.custom_components, dict):
            if self.custom_components.get("is_intern") is not None:
                return bool(self.custom_components.get("is_intern"))
            if self.custom_components.get("employment_type"):
                return self.custom_components.get("employment_type") == "INTERN"
        try:
            return bool(getattr(self.employee, "is_intern", False))
        except Exception:
            return False

    @property
    def employment_type(self) -> str:
        """Employment type: REGULAR, INTERN, or CONSULTANT."""
        if isinstance(self.custom_components, dict):
            et = self.custom_components.get("employment_type")
            if et in ("REGULAR", "INTERN", "CONSULTANT"):
                return et
            if self.custom_components.get("is_intern"):
                return "INTERN"
        try:
            return getattr(self.employee, "employment_type", "REGULAR")
        except Exception:
            return "REGULAR"

    @employment_type.setter
    def employment_type(self, value: str):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        clean_val = str(value or "REGULAR").strip().upper()
        if clean_val not in ("REGULAR", "INTERN", "CONSULTANT"):
            clean_val = "REGULAR"
        self.custom_components["employment_type"] = clean_val
        self.custom_components["is_intern"] = (clean_val == "INTERN")

    @property
    def gratuity_in_ctc(self) -> bool:
        """True if Statutory Gratuity is carved out of the CTC pool."""
        if isinstance(self.custom_components, dict) and "gratuity_in_ctc" in self.custom_components:
            return bool(self.custom_components["gratuity_in_ctc"])
        try:
            profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
            if profile:
                return bool(profile.gratuity_in_ctc)
        except Exception:
            pass
        return False

    @gratuity_in_ctc.setter
    def gratuity_in_ctc(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["gratuity_in_ctc"] = bool(value)

    @property
    def gratuity(self) -> Decimal:
        """Monthly gratuity accrual reserve carved out of CTC (e.g. 4.81% of Basic)."""
        if isinstance(self.custom_components, dict) and "gratuity" in self.custom_components:
            try:
                return Decimal(str(self.custom_components["gratuity"])).quantize(Decimal("0.01"))
            except Exception:
                pass
        if self.gratuity_in_ctc and self.original_basic_da:
            try:
                profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
                grat_pct = getattr(profile, "gratuity_pct", Decimal("4.81")) if profile else Decimal("4.81")
                return (self.original_basic_da * (Decimal(str(grat_pct)) / Decimal("100"))).quantize(Decimal("0.01"))
            except Exception:
                pass
        return Decimal("0.00")

    @gratuity.setter
    def gratuity(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["gratuity"] = str(value)

    @property
    def carve_out_fbp_in_ctc(self) -> bool:
        """True if FBP is carved out upfront from annual CTC."""
        if isinstance(self.custom_components, dict) and "carve_out_fbp_in_ctc" in self.custom_components:
            return bool(self.custom_components["carve_out_fbp_in_ctc"])
        try:
            profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
            if profile:
                return bool(profile.carve_out_fbp_in_ctc)
        except Exception:
            pass
        return False

    @carve_out_fbp_in_ctc.setter
    def carve_out_fbp_in_ctc(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["carve_out_fbp_in_ctc"] = bool(value)

    @property
    def carve_out_custom_in_ctc(self) -> bool:
        """True if non-cash/custom allowances are carved out upfront from annual CTC."""
        if isinstance(self.custom_components, dict) and "carve_out_custom_in_ctc" in self.custom_components:
            return bool(self.custom_components["carve_out_custom_in_ctc"])
        try:
            profile = getattr(self.employee.client, "payroll_profile", None) if self.employee_id else None
            if profile:
                return bool(profile.carve_out_custom_in_ctc)
        except Exception:
            pass
        return False

    @carve_out_custom_in_ctc.setter
    def carve_out_custom_in_ctc(self, value):
        if not isinstance(self.custom_components, dict):
            self.custom_components = {}
        self.custom_components["carve_out_custom_in_ctc"] = bool(value)

    change_reason = models.CharField(max_length=255, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="salary_structures_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_employee_salary_structures"
        ordering = ["-effective_from", "-created_at"]

    def __str__(self) -> str:
        return f"{self.employee} — structure effective {self.effective_from}"

    def __init__(self, *args, **kwargs):
        # Decouple transient calculation advisories (e.g. min_wage_warning, shortfall) and
        # client-policy metadata from database fields so dictionary unpacking (**build_from_ctc)
        # succeeds safely across all model creation call sites.
        self.min_wage_warning = kwargs.pop("min_wage_warning", False)
        self.shortfall = kwargs.pop("shortfall", Decimal("0"))
        fbp_in_ctc = kwargs.pop("carve_out_fbp_in_ctc", None)
        custom_in_ctc = kwargs.pop("carve_out_custom_in_ctc", None)
        grat_val = kwargs.pop("gratuity", None)
        grat_in_ctc = kwargs.pop("gratuity_in_ctc", None)
        kwargs.pop("employer_esi", None)
        esi_in_ctc = kwargs.pop("employer_esi_in_ctc", None)
        super().__init__(*args, **kwargs)
        if esi_in_ctc is not None:
            self.employer_esi_in_ctc = esi_in_ctc
        if fbp_in_ctc is not None:
            self.carve_out_fbp_in_ctc = fbp_in_ctc
        if custom_in_ctc is not None:
            self.carve_out_custom_in_ctc = custom_in_ctc
        if grat_in_ctc is not None:
            self.gratuity_in_ctc = grat_in_ctc
        if grat_val is not None:
            self.gratuity = grat_val

    @classmethod
    def build_from_ctc(
        cls,
        ctc_annual: Decimal,
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
    ):
        """
        Auto-derives Basic+DA, HRA, Special Allowance and Monthly Gross
        from annual CTC using client-specific structuring policies.
        Delegates to the canonical pure calculation engine in `payroll.calculations`.
        """
        from .calculations import build_from_ctc as _build_from_ctc
        return _build_from_ctc(
            cls=cls,
            ctc_annual=ctc_annual,
            pf_opted=pf_opted,
            current_lta=current_lta,
            nps_allowance=nps_allowance,
            fbp=fbp,
            vpf=vpf,
            policy=policy,
            custom_components=custom_components,
            client=client,
            employee=employee,
            **kwargs,
        )

def get_latest_salary_structure(employee, as_of=None):
    """
    Resolves the salary structure that was in effect for `employee` as of
    `as_of` (defaults to today). Returns None if none exists yet.
    Local replacement for the missing `employee.latest_salary_structure`
    property referenced by the original payroll views.py.
    """
    from django.utils import timezone

    as_of = as_of or timezone.now().date()
    return (
        employee.salary_structures.filter(effective_from__lte=as_of)
        .order_by("-effective_from", "-created_at")
        .first()
    )


def get_effective_salary_structures_for_month(employee, year: int, month: int, days_in_month: int = None):
    """
    Resolves the effective salary structure for `employee` during `month/year`.
    If an employee received an appraisal/increment mid-month (effective_from.day > 1)
    and a prior structure existed, returns a blended synthetic structure prorating
    both rates by their active calendar day proportions:
        (Days 1..Split-1 @ Old Rate) + (Days Split..MonthEnd @ New Rate).
    Otherwise returns get_latest_salary_structure(employee, as_of=month_end).
    """
    import calendar
    from datetime import date
    from decimal import Decimal

    q = Decimal("0.01")
    days_in_month = days_in_month or calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, days_in_month)

    structures = list(
        employee.salary_structures.filter(effective_from__lte=month_end)
        .order_by("-effective_from", "-created_at")
    )
    if not structures:
        return None

    latest_structure = structures[0]

    # Check for mid-month structure transition
    if (
        latest_structure.effective_from.year == year
        and latest_structure.effective_from.month == month
        and latest_structure.effective_from.day > 1
        and len(structures) > 1
    ):
        prior_structure = structures[1]
        split_day = latest_structure.effective_from.day
        dim_dec = Decimal(str(days_in_month))
        days_old = Decimal(str(split_day - 1))
        days_new = Decimal(str(days_in_month - split_day + 1))
        w1 = days_old / dim_dec
        w2 = days_new / dim_dec

        def _blend(f1, f2):
            v1 = Decimal(str(getattr(prior_structure, f1, 0) or 0))
            v2 = Decimal(str(getattr(latest_structure, f2, 0) or 0))
            return ((v1 * w1) + (v2 * w2)).quantize(q)

        prior_cc = getattr(prior_structure, "custom_components", {}) or {}
        if not isinstance(prior_cc, dict):
            prior_cc = {}
        latest_cc = getattr(latest_structure, "custom_components", {}) or {}
        if not isinstance(latest_cc, dict):
            latest_cc = {}

        blended_cc = {}
        METADATA_KEYS = {
            "esi_opted", "employer_esi", "employer_esi_in_ctc",
            "esi_number", "uan_number", "employer_pf", "employer_pf_in_ctc",
            "is_senior_citizen", "non_eps",
        }
        all_cc_keys = set(prior_cc.keys()) | set(latest_cc.keys())
        for k in all_cc_keys:
            if k in METADATA_KEYS:
                if k in latest_cc:
                    blended_cc[k] = latest_cc[k]
                elif k in prior_cc:
                    blended_cc[k] = prior_cc[k]
                continue
            c_old = prior_cc.get(k)
            c_new = latest_cc.get(k)
            base_meta = dict(c_new if isinstance(c_new, dict) else (c_old if isinstance(c_old, dict) else {"name": k, "type": "EARNING"}))
            if base_meta.get("is_monthly_variable") or str(base_meta.get("formula") or "").upper() == "VARIABLE":
                blended_cc[k] = base_meta
                continue
            try:
                amt_old = Decimal(str(c_old.get("amount", 0) if isinstance(c_old, dict) else (c_old or 0)))
            except Exception:
                amt_old = Decimal("0")
            try:
                amt_new = Decimal(str(c_new.get("amount", 0) if isinstance(c_new, dict) else (c_new or 0)))
            except Exception:
                amt_new = Decimal("0")
            blended_amt = ((amt_old * w1) + (amt_new * w2)).quantize(q)
            base_meta["amount"] = str(blended_amt)
            blended_cc[k] = base_meta

        blended = EmployeeSalaryStructure(
            employee=employee,
            effective_from=latest_structure.effective_from,
            change_reason=(
                f"Blended Mid-Month Rate: {days_old}d @ ₹{prior_structure.monthly_gross:,.2f} + "
                f"{days_new}d @ ₹{latest_structure.monthly_gross:,.2f}"
            ),
            ctc_annual=_blend("ctc_annual", "ctc_annual"),
            monthly_gross=_blend("monthly_gross", "monthly_gross"),
            original_basic_da=_blend("original_basic_da", "original_basic_da"),
            original_hra=_blend("original_hra", "original_hra"),
            original_special_allowance=_blend("original_special_allowance", "original_special_allowance"),
            original_lta=_blend("original_lta", "original_lta"),
            nps_allowance=_blend("nps_allowance", "nps_allowance"),
            fbp=_blend("fbp", "fbp"),
            vpf=latest_structure.vpf,
            pf_opted=latest_structure.pf_opted,
            pf_calculation_rule=latest_structure.pf_calculation_rule,
            employer_pf_in_ctc=latest_structure.employer_pf_in_ctc,
            employer_pf=_blend("employer_pf", "employer_pf"),
            custom_components=blended_cc,
        )
        blended._persisted_structure = latest_structure
        return blended

    return latest_structure




class PayrollJob(AuditableMixin, models.Model):
    """
    Downstream execution job provisioned when an STT Record (Task) is created
    under a sub-service with job_category='payroll'.

    Tracks the client, task, period, due date, status, assigned makers/checkers,
    and links to the underlying PayrollBatch once computation starts.
    """

    AUDIT_ACTION_CREATE = "PAYROLL_JOB_CREATED"
    AUDIT_ACTION_UPDATE = "PAYROLL_JOB_UPDATED"

    STATUS_TODO = "To Do"
    STATUS_IN_PROGRESS = "In Progress"
    STATUS_CLIENT_DOCS_PENDING = "Client Docs Pending"
    STATUS_UNDER_REVIEW = "Under Review"
    STATUS_APPROVED = "Approved"
    STATUS_REWORK = "Rework"
    STATUS_DONE = "Done"
    STATUS_OVERDUE = "Over Due"

    STATUS_CHOICES = [
        (STATUS_TODO, "To Do"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_CLIENT_DOCS_PENDING, "Client Docs Pending"),
        (STATUS_UNDER_REVIEW, "Under Review"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REWORK, "Rework"),
        (STATUS_DONE, "Done"),
        (STATUS_OVERDUE, "Over Due"),
    ]

    AUDIT_TRACKED_FIELDS = [
        "status", "task_id", "period", "due_date", "batch_id",
    ]

    task = models.ForeignKey(
        "clients.Task",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="payroll_jobs",
    )
    stt_task_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.CASCADE,
        related_name="payroll_jobs",
    )
    sub_service = models.ForeignKey(
        "clients.SubService",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payroll_jobs",
    )
    period = models.CharField(max_length=100, blank=True, null=True)
    month = models.PositiveSmallIntegerField(null=True, blank=True)
    year = models.PositiveSmallIntegerField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_TODO, db_index=True)
    rework_notes = models.TextField(blank=True, default="")

    makers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="payroll_jobs_as_maker",
        blank=True,
    )
    checkers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="payroll_jobs_as_checker",
        blank=True,
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_payroll_jobs",
    )
    assigned_at = models.DateTimeField(null=True, blank=True)

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="submitted_payroll_jobs",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_payroll_jobs",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    batch = models.ForeignKey(
        "payroll.PayrollBatch",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="jobs",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_payroll_jobs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_jobs"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.client.name} — {self.period or self.task_id or self.id} ({self.status})"


class PayrollJobEvent(models.Model):
    """
    Audit log / event timeline for Maker-Checker transitions on a PayrollJob.
    """
    EVENT_CREATED = "CREATED"
    EVENT_ASSIGNED = "ASSIGNED"
    EVENT_STARTED = "STARTED"
    EVENT_SUBMITTED = "SUBMITTED"
    EVENT_REWORK = "REWORK"
    EVENT_APPROVED = "APPROVED"
    EVENT_SENT_TO_APPROVER = "SENT_TO_APPROVER"
    EVENT_APPROVER_APPROVED = "APPROVER_APPROVED"
    EVENT_APPROVER_SKIPPED = "APPROVER_SKIPPED"
    EVENT_APPROVER_REJECTED = "APPROVER_REJECTED"

    job = models.ForeignKey(PayrollJob, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=40)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_job_events",
    )
    performed_by_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_job_events"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Job #{self.job_id} - {self.event_type} by {self.performed_by_name or 'System'}"


class PayrollJobDocument(models.Model):
    """Documents on a payroll job. Client uploads accepted from Request documents land here."""
    job = models.ForeignKey(PayrollJob, on_delete=models.CASCADE, related_name="documents")
    doc_key = models.CharField(max_length=100)
    label = models.CharField(max_length=200, blank=True)
    file = models.FileField(upload_to="payroll_job_docs/%Y/%m/", null=True, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    is_uploaded = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="payroll_job_documents")
    uploaded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payroll_job_documents"
        unique_together = ("job", "doc_key")
        ordering = ["doc_key"]


# ─────────────────────────────────────────────────────────────────────────────
# CLIENT PORTAL MODELS (Consolidated Pillar 1)
# ─────────────────────────────────────────────────────────────────────────────

class PortalUser(models.Model):
    """
    Client-side portal login, owned entirely by the payroll module.

    The main project's AUTH_USER_MODEL (account.User) is for internal staff
    only. Client portal credentials live here so they never touch — and can
    never log into — the internal app. Passwords are stored hashed via
    Django's make_password(); a login issues a random token whose SHA-256
    digest is kept in auth_token_hash (see payroll.portal.auth).
    """

    ROLE_EDITOR = "editor"
    ROLE_CLIENT_ADMIN = "client_admin"
    ROLE_CHOICES = [
        (ROLE_EDITOR, "Editor"),
        (ROLE_CLIENT_ADMIN, "Client Admin"),
    ]

    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.CASCADE,
        related_name="portal_users",
    )
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=128)  # hashed via make_password()
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_EDITOR)
    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=True)
    auth_token_hash = models.CharField(max_length=64, blank=True, default="")
    # Recoverable copy of the password so payroll staff — who set these
    # credentials on the client's behalf and have to hand them over — can
    # read the current password back in the admin UI. `password` above stays
    # the authoritative hash and is what logins check; this is stored
    # Fernet-encrypted (same scheme as clients.Client's financial fields) and
    # is only ever exposed through the internal admin serializer, never to
    # the portal itself.
    _password_plain = models.TextField(blank=True, default="", db_column="password_plain")
    last_login = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_users_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_users"
        ordering = ["email"]

    @property
    def password_plain(self) -> str:
        """The current password in clear text, or "" if it predates this field."""
        if not self._password_plain:
            return ""
        try:
            return decrypt_text(self._password_plain) or ""
        except Exception:
            # Key rotated or corrupt ciphertext — behave like "unknown".
            return ""

    def set_password(self, raw_password: str) -> None:
        self.password = make_password(raw_password)
        self._password_plain = encrypt_text(raw_password) if raw_password else ""

    def check_password(self, raw_password: str) -> bool:
        return check_password(raw_password, self.password)

    def __str__(self) -> str:
        return f"{self.email} ({self.client_id})"


class PortalSubmission(AuditableMixin, models.Model):
    """
    One client's monthly payroll input, staged in the portal.

    The portal writes nothing straight into payroll tables; the client's HR
    records this month's changes as PortalSubmissionItems against a draft
    submission. Submitting locks the month for admin review; approving
    applies the items (see payroll.portal.services.apply_submission).
    Unique per (client, month, year) — the portal twin of a PayrollBatch.
    """

    STATUS_DRAFT = "DRAFT"
    STATUS_SUBMITTED = "SUBMITTED"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]
    # A month is editable while DRAFT or REJECTED. APPROVED is also listed
    # for backwards-compatibility with months approved before the
    # multi-round behaviour (approval now reopens to DRAFT); treating it as
    # editable lets clients add more to those older months too.
    EDITABLE_STATUSES = (STATUS_DRAFT, STATUS_REJECTED, "APPROVED")

    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.PROTECT,
        related_name="portal_submissions",
    )
    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    notes = models.TextField(blank=True)
    rejection_reason = models.TextField(blank=True)
    submitted_by = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submitted_submissions",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_portal_submissions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_submissions"
        unique_together = [("client", "month", "year")]
        ordering = ["-year", "-month"]

    def __str__(self) -> str:
        return f"{self.client_id} {self.month:02d}/{self.year} ({self.status})"


class PortalSubmissionItem(AuditableMixin, models.Model):
    """
    A single change recorded inside a PortalSubmission.

    `payload` is a JSON dict whose shape depends on `item_type`; the apply
    step validates and turns each item into real payroll rows (Employee /
    EmployeeSalaryStructure / SalaryAdvance / PortalAdjustment). Keeping the
    staged data here means a client can draft, edit and re-submit a month
    without the approved payroll data being touched until you approve.
    """

    TYPE_NEW_EMPLOYEE = "NEW_EMPLOYEE"
    TYPE_REVISION = "REVISION"
    TYPE_EXIT = "EXIT"
    TYPE_SALARY_HOLD = "SALARY_HOLD"
    TYPE_ADVANCE = "ADVANCE"
    TYPE_ONE_TIME_EARNING = "ONE_TIME_EARNING"
    TYPE_ONE_TIME_DEDUCTION = "ONE_TIME_DEDUCTION"
    TYPE_NOTE = "NOTE"
    TYPE_TDS = "TDS"
    TYPE_LOP = "LOP"
    TYPE_ARREARS = "ARREARS"
    TYPE_REIMBURSEMENT = "REIMBURSEMENT"
    TYPE_CUSTOM_COMPONENT = "CUSTOM_COMPONENT"
    TYPE_CHOICES = [
        (TYPE_NEW_EMPLOYEE, "New employee"),
        (TYPE_REVISION, "Salary revision"),
        (TYPE_EXIT, "Exit / resignation"),
        (TYPE_SALARY_HOLD, "Salary hold"),
        (TYPE_ADVANCE, "Advance / loan"),
        (TYPE_ONE_TIME_EARNING, "One-time earning"),
        (TYPE_ONE_TIME_DEDUCTION, "One-time deduction"),
        (TYPE_NOTE, "Note / instruction"),
        (TYPE_TDS, "TDS deduction"),
        (TYPE_LOP, "Loss of pay (LOP)"),
        (TYPE_ARREARS, "Salary arrears"),
        (TYPE_REIMBURSEMENT, "Expense reimbursement"),
        (TYPE_CUSTOM_COMPONENT, "Custom salary component"),
    ]

    STATUS_PENDING = "PENDING"
    STATUS_APPLIED = "APPLIED"
    STATUS_SKIPPED = "SKIPPED"
    STATUS_FAILED = "FAILED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPLIED, "Applied"),
        (STATUS_SKIPPED, "Skipped"),
        (STATUS_FAILED, "Failed"),
    ]

    submission = models.ForeignKey(
        PortalSubmission,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item_type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    error = models.TextField(blank=True)
    sort = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_submission_items",
    )

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_submission_items"
        ordering = ["sort", "id"]

    def __str__(self) -> str:
        return f"{self.submission} — {self.item_type}"


class PortalSubmissionEvent(models.Model):
    """One lifecycle event in a month's submission — the round history a
    client sees in the portal.

    PortalSubmission is unique per (client, month, year) and its `status`
    only ever holds the *current* state (it reopens as DRAFT after every
    approval), so without this log the submitted/approved rounds would be
    lost. Each submit / approve / reject appends a row here.
    """

    TYPE_SUBMITTED = "SUBMITTED"
    TYPE_APPROVED = "APPROVED"
    TYPE_REJECTED = "REJECTED"
    TYPE_CHOICES = [
        (TYPE_SUBMITTED, "Submitted"),
        (TYPE_APPROVED, "Approved"),
        (TYPE_REJECTED, "Rejected"),
    ]

    submission = models.ForeignKey(
        PortalSubmission,
        on_delete=models.CASCADE,
        related_name="history",
    )
    event_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    item_count = models.PositiveIntegerField(default=0)
    note = models.TextField(blank=True)  # rejection reason / summary
    actor_portal = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_events",
    )
    actor_staff = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_review_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_events"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.submission} — {self.event_type}"


class PortalAdjustment(models.Model):
    """
    A one-time earning or deduction approved from the portal, materialized
    so the batch/payslip step can pick it up later.

    One-time items (retention bonus, other allowance, loan installment
    recovery, etc.) don't fit an existing payroll table, so approve-time
    writes them here — one row per employee per month per item. The
    batch-generation step reads rows where applied_in_record is null for
    the month and folds them into the payslip (then sets applied_in_record).
    """

    DIRECTION_EARNING = "earning"
    DIRECTION_DEDUCTION = "deduction"
    DIRECTION_CHOICES = [
        (DIRECTION_EARNING, "Earning"),
        (DIRECTION_DEDUCTION, "Deduction"),
    ]

    employee = models.ForeignKey(
        "payroll.Employee",
        on_delete=models.CASCADE,
        related_name="portal_adjustments",
    )
    item = models.ForeignKey(
        PortalSubmissionItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_adjustments",
    )
    direction = models.CharField(max_length=20, choices=DIRECTION_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=255, blank=True)
    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    applied_in_record = models.ForeignKey(
        "payroll.PayslipRecord",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_adjustments_applied",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_adjustments"
        ordering = ["year", "month", "id"]

    def __str__(self) -> str:
        return f"{self.employee} — {self.direction} {self.amount} ({self.month:02d}/{self.year})"


class PortalHold(models.Model):
    """
    A salary amount put on hold from the portal, scheduled to auto-release
    in a month the client chooses.

    Approving a SALARY_HOLD item writes two things:
      * hold_adjustment — a positive OnHoldAdjustment, folded into the NEXT
        batch generated for the employee (normally the submitted month) as
        `on_hold_deducted`, so the amount reduces that month's net pay and
        parks in the on-hold closing balance.
      * this PortalHold row, which remembers the release month.

    When a batch is generated for the release month (Excel upload or
    Proceed → generate-from-portal), materialize_due_hold_releases() creates
    the matching negative OnHoldAdjustment (release_adjustment) so the held
    amount is paid back in that month. Splitting EXIT (resignation → inactive)
    from SALARY_HOLD (money held, released later) keeps the two concepts
    independent.
    """

    item = models.ForeignKey(
        PortalSubmissionItem,
        on_delete=models.CASCADE,
        related_name="portal_holds",
    )
    employee = models.ForeignKey(
        "payroll.Employee",
        on_delete=models.CASCADE,
        related_name="portal_holds",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True)
    release_month = models.PositiveSmallIntegerField()
    release_year = models.PositiveSmallIntegerField()
    hold_adjustment = models.ForeignKey(
        "payroll.OnHoldAdjustment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_holds_held",
    )
    release_adjustment = models.ForeignKey(
        "payroll.OnHoldAdjustment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="portal_holds_released",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "payroll"
        db_table = "payroll_portal_holds"
        ordering = ["release_year", "release_month", "id"]

    @property
    def is_released(self) -> bool:
        return self.release_adjustment_id is not None

    def __str__(self) -> str:
        return (
            f"{self.employee} — hold {self.amount} "
            f"(release {self.release_month:02d}/{self.release_year})"
        )

