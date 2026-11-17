"""hrms_backend/payroll/views.py"""

import csv
import json
import logging
import math
import re
import time
import calendar
from calendar import month_name
from collections import defaultdict

logger = logging.getLogger(__name__)
from io import BytesIO, StringIO
from pathlib import Path
from django.core.files.storage import default_storage

from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from unittest.mock import patch

from django.db import models, transaction
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from openpyxl.utils import get_column_letter
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from django.contrib.auth import get_user_model
User = get_user_model()
from rest_framework.negotiation import DefaultContentNegotiation


class SafeContentNegotiator(DefaultContentNegotiation):
    """
    Prevents DRF from raising NotFound (HTTP 404) when query parameters like
    ?format=txt, ?format=xlsx, or ?format=csv are passed to custom binary/file export actions.
    Falls back gracefully to the viewset's registered renderers if the requested format
    is not a standard API renderer format (like 'json').
    """

    def filter_renderers(self, renderers, format):
        try:
            filtered = super().filter_renderers(renderers, format)
            if filtered:
                return filtered
        except Exception:
            pass
        return renderers


class AuditViewMixin:
    """Audit view mixin stub ensuring standard lifecycle persistence."""
    def perform_create(self, serializer):
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.delete()
ADMIN_MANAGER_ROLES = [
    "Admin", "Founder", "Manager", "Team Lead",
    "admin", "founder", "manager", "team lead",
]


# ── Payroll access — Permissions page → Direct Tax (DT) → Payroll ─────────────
# Until an option has access set there, the `default` rule applies: the same roles this
# module checked before the options existed, so nothing changes until an admin sets access.
# (Also used by payroll/portal/views.py and incometax/views.py.)
PAYROLL_FEATURE = "/payroll"

# The role lists the Payroll module has always used.
LEADS = ("admin", "founder", "manager", "team lead")       # leadership
ADMINS = ("admin", "founder")                               # final approver
EVERYONE = None                                              # anyone signed in


def _role(user):
    return (getattr(user, "role", "") or "").lower().replace("_", " ").strip()


def _default_ok(user, default):
    if not getattr(user, "is_authenticated", False):
        return False
    if default is EVERYONE:
        return True
    if callable(default):
        return bool(default(user))
    return bool(getattr(user, "is_superuser", False)) or _role(user) in default


def payroll_can(user, option, default=LEADS):
    """True when `user` has Payroll option `option` (Permissions page), else the default rule."""
    ok = _default_ok(user, default)
    try:
        from permissions_app.utils import user_can
    except Exception:
        return ok
    try:
        return bool(user_can(user, PAYROLL_FEATURE, option, fallback=lambda u: ok))
    except Exception:
        return ok


def PayrollOption(option, default=LEADS, message=None):
    """DRF permission class for one Payroll option, e.g.
    `return [IsAuthenticated(), PayrollOption("delete_payroll_data")()]`."""

    class _PayrollOption(permissions.BasePermission):
        def has_permission(self, request, view):
            return payroll_can(request.user, option, default)

    _PayrollOption.message = message or "You don't have access to this in Payroll (Permissions page → Direct Tax → Payroll)."
    _PayrollOption.__name__ = f"PayrollOption_{option}"
    return _PayrollOption


class IsAdminOrManagerRole(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_superuser or user.role in ADMIN_MANAGER_ROLES)
        )
from .tasks import send_bulk_payslip_emails, send_payslip_email
from django.core.mail import get_connection
import calendar
import threading
from django.db import close_old_connections

def _dispatch_bulk_payslip_emails_in_thread(batch_id, sent_by_id):
    """
    Failsafe direct thread fallback when Celery/Redis message broker is offline.
    Runs asynchronously in an isolated daemon thread with connection cleanup.
    """
    close_old_connections()
    try:
        send_bulk_payslip_emails(batch_id, sent_by_id)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(
            "Failsafe direct background thread payslip email dispatch failed for batch %s: %s",
            batch_id,
            exc,
            exc_info=True,
        )
    finally:
        close_old_connections()

from .calculations import calculate_payslip_fields, is_in_probation, sanitize_for_json
from .excel_parser import ExcelParseError, parse_employee_master_excel
from .models import (
    ClientProfile, CompOffAdjustment, EmailLog, Employee, EmployeeSalaryStructure, LeaveAdjustment, SalaryComponent,
    OnHoldAdjustment, PayrollBatch, PayrollJob, PayrollJobEvent, PayslipRecord, PayslipRecordEdit, SalaryAdvance,
    SalaryAdvanceAdjustment, get_latest_salary_structure, get_effective_salary_structures_for_month,
    PAYSLIP_ALL_COMPUTED_FIELDS,
)
# Portal models now live in .models directly
from .models import PortalAdjustment, PortalHold, PortalSubmission, PortalSubmissionEvent, PortalSubmissionItem
from .portal.services import (
    apply_submission, materialize_due_hold_releases, record_event, refresh_batch_after_apply, sync_due_employee_exits,
)
from clients.models import Client
from .pdf_generator import DESIGN_MODULES, generate_payslip_pdf
from .serializers import (
    EmailLogSerializer,
    PAYSLIP_EDITABLE_FIELDS,
    PayrollBatchListSerializer,
    PayrollBatchSerializer,
    PayslipRecordEditSerializer,
    PayslipRecordSerializer,
)


def _auto_generate_pending_emi_recoveries(employee, generated_by):
    """
    For every active SalaryAdvance plan belonging to this employee
    (months_recovered < tenure_months), auto-create this month's
    -emi_amount recovery SalaryAdvanceAdjustment if one isn't already
    waiting to be applied — so recovery happens automatically each
    payroll cycle with no manual monthly adjustment required.

    Two guards keep this safe to call every time a batch is generated:
    - Skipped entirely if the plan's own disbursement adjustment hasn't
      been applied to a batch yet (i.e. the advance was just created this
      same cycle) — recovery starts the cycle AFTER disbursement, not the
      same one, so an employee isn't given and docked an advance in the
      same month.
    - Skipped if this plan already has an unapplied (pending) recovery
      adjustment sitting there — prevents double-deducting if batch
      generation is ever re-run for the same month.

    The final installment (months_recovered == tenure_months - 1 going
    in) recovers whatever amount remains rather than another flat
    emi_amount, so the total recovered exactly equals total_amount
    regardless of any rounding in emi_amount.

    Newly created recovery adjustments are left pending (applied_in_record
    left null) here — they get folded into salary_advance_recovered and
    marked applied by the existing pending_advance_adjustments handling
    right below each call site, same as any other pending adjustment.
    months_recovered is only incremented once a recovery adjustment is
    actually applied — see that call site.
    """
    active_advances = (
        SalaryAdvance.objects
        .filter(employee=employee, months_recovered__lt=models.F("tenure_months"))
        .select_related("disbursement_adjustment")
    )
    for advance in active_advances:
        if advance.disbursement_adjustment.applied_in_record_id is None:
            continue
        has_pending_recovery = advance.adjustments.filter(
            applied_in_record__isnull=True, amount__lt=0,
        ).exists()
        if has_pending_recovery:
            continue

        is_exiting = bool(getattr(employee, "last_working_date", None))
        installments_remaining = advance.tenure_months - advance.months_recovered
        if is_exiting or installments_remaining <= 1:
            already_recovered = advance.emi_amount * advance.months_recovered
            recovery_amount = advance.total_amount - already_recovered
            reason_text = (
                f"FnF Full Acceleration: Auto-recovered remaining {installments_remaining} installments "
                f"for salary advance #{advance.id} (LWD: {employee.last_working_date})"
                if is_exiting else
                f"Auto-recovered final EMI installment {advance.months_recovered + 1}/{advance.tenure_months} for salary advance #{advance.id}"
            )
        else:
            recovery_amount = advance.emi_amount
            reason_text = (
                f"Auto-recovered EMI installment {advance.months_recovered + 1}/"
                f"{advance.tenure_months} for salary advance #{advance.id}"
            )

        SalaryAdvanceAdjustment.objects.create(
            employee=employee,
            amount=-recovery_amount,
            reason=reason_text,
            advance=advance,
            created_by=generated_by,
        )


def _current_open_record(employee):
    """
    The one PayslipRecord (if any) a freshly-created ledger adjustment
    should apply to immediately instead of sitting pending until the next
    batch upload — the employee's most recent record whose batch is still
    STATUS_UPLOADED (i.e. not yet reviewed/sent/locked; matches
    BatchReview.jsx's `ledgerLocked = batch.status !== "UPLOADED"`).
    None if there's no such open batch, in which case the adjustment is
    left pending and folds into salary_advance_opening_balance/etc. the
    normal way the next time a batch is uploaded for this employee.
    """
    return (
        PayslipRecord.objects
        .filter(employee=employee, batch__status=PayrollBatch.STATUS_UPLOADED)
        .select_related("batch", "salary_structure_snapshot", "employee")
        .order_by("-batch__year", "-batch__month")
        .first()
    )


def _apply_comp_off_or_leave_adjustment(record, field: str, amount: Decimal):
    """
    Immediately folds a new comp_off/leave adjustment into the currently
    open record: bumps the relevant opening balance, then re-derives every
    field calculate_payslip_fields would produce from it (closing balance,
    days_used, and the attendance-driven pay fields that depend on the
    settlement between the two ledgers) — same recompute this record
    already goes through when an attendance field is edited post-generation
    (see PayslipRecordViewSet.partial_update).
    """
    if field == "comp_off":
        record.comp_off_opening_balance += amount
    else:
        record.leave_opening_balance += amount

    client_profile = getattr(record.batch.client, "payroll_profile", None)
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
    pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
    pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
    annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
    probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
    track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
    track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

    is_probation = is_in_probation(record.employee.hire_date, record.batch.year, record.batch.month, probation_months=probation_months)
    row = {
        "actual_working_days": record.actual_working_days,
        "lop_days": record.lop_days,
        "extra_working_days": record.extra_working_days,
        "paid_leave_days": record.paid_leave_days,
        "lta": record.lta_upload,
        "special_allowance": record.special_allowance_upload,
        "nps_allowance_earned": record.nps_allowance_upload,
        "commission_other": record.commission_other,
        "arrears": record.arrears,
    }
    computed = calculate_payslip_fields(
        record.salary_structure_snapshot, row, record.batch.month, record.days_in_month,
        comp_off_opening_balance=record.comp_off_opening_balance,
        leave_opening_balance=record.leave_opening_balance,
        is_probation=is_probation,
        lop_policy=lop_policy,
        pt_state=pt_state,
        pt_amount=pt_amount,
        annual_leave_days=annual_leave_days,
        employee_gender=getattr(record.employee, "gender", "M"),
        track_leave_ledger=track_leave_ledger,
        track_comp_off=track_comp_off,
    )
    for field_name, value in computed.items():
        if field_name in ("gross_salary", "comp_off_opening_balance", "leave_opening_balance"):
            continue
        setattr(record, field_name, value)
    record.save(update_fields=[
        "comp_off_opening_balance", "leave_opening_balance",
        "basic_da", "hra", "lta", "special_allowance", "nps_allowance_earned",
        "basic_for_pf", "epf", "vpf", "professional_tax",
        "comp_off_days_used", "comp_off_closing_balance",
        "leave_accrued", "leave_used", "leave_closing_balance",
        "custom_components",
        "earned_salary", "total_deductions", "net_salary", "updated_at",
    ])


def _clamp_row_to_employee_tenure(employee, row: dict, year: int, month: int, days_in_month: int) -> dict:
    """
    Ensures that for an employee who joined mid-cycle or exited mid-cycle
    in the given payroll cycle window, their payable attendance window
    (actual_working_days + lop_days + paid_leave_days) never exceeds their
    active calendar tenure span [eff_start .. eff_end], respecting the client's
    configured cycle_start_day and cycle_end_day cut-off window.
    """
    try:
        client_obj = getattr(employee, "client", None)
        profile = getattr(client_obj, "payroll_profile", None) if client_obj else None
        if profile is not None:
            if not getattr(profile, "auto_prorate_mid_month", True):
                return row
            if getattr(profile, "mid_month_proration_rule", "ACTUAL_CALENDAR_DAYS") == "DISABLED":
                return row
    except Exception:
        profile = None

    cycle_start = date(year, month, 1)
    cycle_end = date(year, month, days_in_month)
    cycle_days = days_in_month
    try:
        if profile is not None and hasattr(profile, "get_cycle_dates"):
            cycle_start, cycle_end, cycle_days = profile.get_cycle_dates(year, month)
    except Exception:
        pass

    hire_d = getattr(employee, "hire_date", None)
    lwd_d = getattr(employee, "last_working_date", None)

    eff_start = max(cycle_start, hire_d) if hire_d else cycle_start
    eff_end = min(cycle_end, lwd_d) if lwd_d else cycle_end

    if eff_end < eff_start:
        max_span = Decimal("0")
    else:
        active_days = (eff_end - eff_start).days + 1
        max_span = Decimal(str(max(0, min(cycle_days, active_days))))

    lop_d = Decimal(str(row.get("lop_days", 0) or 0))
    paid_d = Decimal(str(row.get("paid_leave_days", 0) or 0))
    act_d = Decimal(str(row.get("actual_working_days", 0) or 0))
    max_actual_allowed = max(Decimal("0"), max_span - lop_d - paid_d)
    if act_d > max_actual_allowed:
        row["actual_working_days"] = max_actual_allowed
    return row


def _recompute_payslip_record_from_structure(record, struct=None, commit=True):
    """
    Re-evaluates all structure-driven and statutory fields (Basic+DA, HRA,
    Special Allowance, LTA, NPS, PF Wage Base, EPF, ESI, PT, Custom Components,
    Earned Salary, Total Deductions, Net Salary) on an existing PayslipRecord
    via calculate_payslip_fields(), while preserving any monthly input or
    manual drawer overrides on custom components.
    """
    effective_struct = (
        struct
        or get_effective_salary_structures_for_month(
            record.employee, record.batch.year, record.batch.month, record.days_in_month
        )
        or get_latest_salary_structure(record.employee)
        or record.salary_structure_snapshot
    )
    persisted_struct = getattr(effective_struct, "_persisted_structure", effective_struct)
    if persisted_struct:
        record.salary_structure_snapshot = persisted_struct

    client_profile = getattr(record.batch.client, "payroll_profile", None)
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
    pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
    pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
    annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
    probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
    track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
    track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

    is_probation = is_in_probation(
        record.employee.hire_date, record.batch.year, record.batch.month, probation_months=probation_months
    )

    preserved_row_custom = {}
    if isinstance(record.custom_components, dict):
        for section_key, comp_type in (("earnings", "EARNING"), ("deductions", "DEDUCTION")):
            for item in record.custom_components.get(section_key, []) or []:
                if not isinstance(item, dict):
                    continue
                code = item.get("code")
                if not code or code == "ESI":
                    continue
                source = item.get("source", "CONTRACT_MASTER")
                add_amt = Decimal(str(item.get("additional_amount", 0) or 0))
                if source in ("MONTHLY_INPUT", "MANUAL_DRAWER_EDIT"):
                    if add_amt != Decimal("0"):
                        preserved_row_custom[code] = {
                            "additional_amount": add_amt,
                            "type": comp_type,
                            "source": source,
                        }
                    else:
                        preserved_row_custom[code] = {
                            "amount": Decimal(str(item.get("amount", 0) or 0)),
                            "type": comp_type,
                            "source": source,
                        }

        # Also preserve any top-level component keys (Form B or Hybrid keys like "MEDICA")
        METADATA_KEYS = {
            "esi_opted", "employer_esi", "employer_esi_in_ctc",
            "esi_number", "uan_number", "employer_pf", "employer_pf_in_ctc",
            "employer_pf_contribution", "is_senior_citizen", "non_eps",
            "employment_type", "is_intern", "pf_opted",
            "gratuity", "gratuity_in_ctc",
            "carve_out_fbp_in_ctc", "carve_out_custom_in_ctc",
        }
        for code, val in record.custom_components.items():
            code_lower = str(code).strip().lower()
            if (
                code in ("earnings", "deductions")
                or code_lower in METADATA_KEYS
                or code_lower.startswith("__")
                or code_lower.startswith("carve_out_")
            ):
                continue
            clean_code = str(code).strip().upper()
            if clean_code not in preserved_row_custom and code not in preserved_row_custom:
                if isinstance(val, dict):
                    preserved_row_custom[code] = val
                else:
                    preserved_row_custom[code] = {
                        "amount": Decimal(str(val)),
                        "type": "EARNING",
                        "source": "MONTHLY_INPUT",
                    }

    row = {
        "actual_working_days": record.actual_working_days,
        "lop_days": record.lop_days,
        "extra_working_days": record.extra_working_days,
        "paid_leave_days": record.paid_leave_days,
        "lta": record.lta_upload,
        "special_allowance": record.special_allowance_upload,
        "nps_allowance_earned": record.nps_allowance_upload,
        "commission_other": record.commission_other,
        "arrears": record.arrears,
        "variable_pay": record.variable_pay,
        "custom_components": preserved_row_custom,
    }
    _clamp_row_to_employee_tenure(
        record.employee, row, record.batch.year, record.batch.month, record.days_in_month
    )
    record.actual_working_days = row["actual_working_days"]

    computed = calculate_payslip_fields(
        effective_struct,
        row,
        record.batch.month,
        record.days_in_month,
        comp_off_opening_balance=record.comp_off_opening_balance,
        leave_opening_balance=record.leave_opening_balance,
        is_probation=is_probation,
        lop_policy=lop_policy,
        pt_state=pt_state,
        pt_amount=pt_amount,
        annual_leave_days=annual_leave_days,
        employee_gender=getattr(record.employee, "gender", "M"),
        track_leave_ledger=track_leave_ledger,
        track_comp_off=track_comp_off,
        client_profile=client_profile,
        year=record.batch.year,
    )
    computed.pop("comp_off_opening_balance", None)
    computed.pop("leave_opening_balance", None)
    esi_val = computed.pop("esi", None)
    emp_esi_val = computed.pop("employer_esi", None)
    emp_pf_val = computed.pop("employer_pf", None)
    for field_name, value in computed.items():
        setattr(record, field_name, value)
    if esi_val is not None:
        record.esi = esi_val
    if emp_esi_val is not None:
        record.employer_esi = emp_esi_val
    if emp_pf_val is not None:
        record.employer_pf = emp_pf_val

    # Invalidate any stale draft PDF on disk so subsequent downloads re-render fresh figures
    if record.pdf_path:
        try:
            Path(record.pdf_path).unlink(missing_ok=True)
        except Exception:
            pass
        record.pdf_path = None

    if isinstance(record.custom_components, (dict, list)):
        record.custom_components = sanitize_for_json(record.custom_components)

    record.recompute_totals_and_balances()
    if commit:
        record.save()
    return record


def _apply_money_adjustment(record, field: str, amount: Decimal):
    """
    Immediately folds a new salary_advance/on_hold adjustment into the
    currently open record — these two ledgers don't feed back into
    proration/pay fields the way comp-off/leave do (see PayslipRecord.save,
    which is what actually derives *_closing_balance and earned/net salary
    from these fields), so a straight increment + save is enough.
    """
    if field == "salary_advance":
        if amount >= 0:
            record.salary_advance_disbursed += amount
        else:
            record.salary_advance_recovered += -amount
    else:
        if amount >= 0:
            record.on_hold_deducted += amount
        else:
            record.on_hold_released += -amount
    record.save()


def _build_record_for_employee(employee, batch, row, year, month, days_in_month, uploaded_by):
    """
    Creates one PayslipRecord for `employee` in `batch` from `row` (a parsed
    excel row, or a synthetic full-attendance row for portal-generated
    batches), folding in all pending ledgers (comp-off, leave, salary
    advance, on hold) and the month's portal one-time adjustments.
    Returns (record, missing_structure).
    """
    month_end_date = date(year, month, days_in_month)
    latest_structure = get_effective_salary_structures_for_month(employee, year, month, days_in_month)
    if latest_structure is None and getattr(employee, "ctc", None) and employee.ctc > 0:
        from .models import EmployeeSalaryStructure
        effective_from = employee.hire_date or date(year, month, 1)
        latest_structure = EmployeeSalaryStructure.objects.create(
            employee=employee,
            effective_from=effective_from,
            created_by=uploaded_by if getattr(uploaded_by, "is_authenticated", False) else None,
            change_reason=f"Auto-generated from Employee CTC (₹{employee.ctc:,.2f}) for batch {month:02d}/{year}",
            **EmployeeSalaryStructure.build_from_ctc(employee.ctc, pf_opted=True, client=employee.client, employee=employee),
        )
    missing_structure = latest_structure is None

    # Comp-off ledger: this month's opening balance is the
    # closing balance of this employee's most recent PRIOR
    # payslip record (by batch year/month), or 0 if this is
    # their first-ever record, PLUS any manual CompOffAdjustment
    # corrections made since that prior record (e.g. HR grants/
    # deducts days via the Employee Detail page) — see
    # apps.employees.views.EmployeeViewSet.comp_off_adjustments.
    # Read-only from the reviewer's perspective otherwise —
    # never uploaded, never manually set on the payslip itself.
    prior_record = (
        PayslipRecord.objects
        .filter(employee=employee)
        .filter(models.Q(batch__year__lt=year) | models.Q(batch__year=year, batch__month__lt=month))
        .order_by("-batch__year", "-batch__month")
        .first()
    )
    pending_adjustments = list(
        CompOffAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
    )
    pending_adjustment_total = sum((a.amount for a in pending_adjustments), Decimal("0"))
    comp_off_opening_balance = (
        (prior_record.comp_off_closing_balance if prior_record else Decimal("0"))
        + pending_adjustment_total
    )

    # General leave ledger: same "prior closing balance + any
    # pending manual adjustment" pattern as comp-off above —
    # a pending adjustment here is typically a cashout (see
    # apps.employees.views.EmployeeViewSet.leave_adjustments).
    pending_leave_adjustments = list(
        LeaveAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
    )
    pending_leave_adjustment_total = sum((a.amount for a in pending_leave_adjustments), Decimal("0"))
    leave_opening_balance = (
        (prior_record.leave_closing_balance if prior_record else Decimal("0"))
        + pending_leave_adjustment_total
    )
    client_profile = getattr(batch.client, "payroll_profile", None)
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
    pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
    pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
    annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
    probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
    track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
    track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

    is_probation = is_in_probation(employee.hire_date, year, month, probation_months=probation_months)

    # Portal-approved one-time earnings/deductions (retention
    # bonus, other allowance, one-off recoveries, etc.) fold in
    # here exactly like an excel column would: earnings land in
    # commission_other, deductions in other_deduction, and dynamic
    # allowances/deductions land in row["custom_components"].
    # Feeding them to calculate_payslip_fields() ensures earned_salary,
    # dynamic_earnings_total, and custom_components["earnings"] include
    # them natively from the start.
    pending_portal_adjustments = list(
        PortalAdjustment.objects.filter(
            employee=employee, month=month, year=year,
            applied_in_record__isnull=True,
        )
    )
    portal_earnings = Decimal("0")
    portal_deductions = Decimal("0")
    custom_row_inputs = {}
    for a in pending_portal_adjustments:
        if a.description.startswith("CUSTOM:"):
            parts = a.description.split(":", 2)
            c_code = parts[1] if len(parts) > 1 else ""
            if c_code:
                custom_row_inputs[c_code] = {
                    "amount": a.amount,
                    "type": "EARNING" if a.direction == PortalAdjustment.DIRECTION_EARNING else "DEDUCTION",
                    "source": "MONTHLY_INPUT",
                }
        elif a.direction == PortalAdjustment.DIRECTION_EARNING:
            portal_earnings += a.amount
        else:
            portal_deductions += a.amount

    if portal_earnings or portal_deductions:
        row["commission_other"] = Decimal(row.get("commission_other", 0) or 0) + portal_earnings
        row["other_deduction"] = Decimal(row.get("other_deduction", 0) or 0) + portal_deductions

    # Ensure row has custom_components populated before calculate_payslip_fields() runs
    row_custom = row.get("custom_components")
    if not isinstance(row_custom, dict):
        row_custom = {}
    if custom_row_inputs:
        row_custom.update(custom_row_inputs)
    row["custom_components"] = row_custom

    _clamp_row_to_employee_tenure(employee, row, year, month, days_in_month)

    computed = calculate_payslip_fields(
        latest_structure, row, month, days_in_month,
        comp_off_opening_balance=comp_off_opening_balance,
        leave_opening_balance=leave_opening_balance,
        is_probation=is_probation,
        lop_policy=lop_policy,
        pt_state=pt_state,
        pt_amount=pt_amount,
        annual_leave_days=annual_leave_days,
        employee_gender=getattr(employee, "gender", "M"),
        track_leave_ledger=track_leave_ledger,
        track_comp_off=track_comp_off,
        client_profile=client_profile,
        year=year,
    )

    # Salary Advance / On Hold ledgers: opening balance is a
    # plain carry-forward of the prior record's closing balance.
    # Pending adjustments are NOT folded into opening directly —
    # they become this month's real disbursed/recovered (or
    # deducted/released) movement, which both (a) shows up as
    # an actual earning/deduction line on this month's payslip
    # and (b) is what PayslipRecord.save() uses to (re)compute
    # the closing balance. Split by sign so a mix of both types
    # pending at once (e.g. one grant + one recovery) shows
    # correctly as both lines rather than a single net figure.
    # Auto-generate this month's EMI recovery adjustment(s), if
    # any of this employee's SalaryAdvance plans are due one —
    # see _auto_generate_pending_emi_recoveries. Must run before
    # the pending_advance_adjustments query right below so any
    # newly created recovery rows are picked up by it this same
    # cycle, same as a manual adjustment would be.
    _auto_generate_pending_emi_recoveries(employee, generated_by=uploaded_by)

    pending_advance_adjustments = list(
        SalaryAdvanceAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
    )
    salary_advance_opening_balance = (
        max(Decimal("0.00"), abs(prior_record.salary_advance_closing_balance)) if prior_record else Decimal("0")
    )
    salary_advance_disbursed = sum(
        (a.amount for a in pending_advance_adjustments if a.amount >= 0), Decimal("0")
    )
    salary_advance_recovered = sum(
        (-a.amount for a in pending_advance_adjustments if a.amount < 0), Decimal("0")
    )

    pending_on_hold_adjustments = list(
        OnHoldAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
    )
    on_hold_opening_balance = (
        max(Decimal("0.00"), abs(prior_record.on_hold_closing_balance)) if prior_record else Decimal("0")
    )
    on_hold_deducted = sum(
        (a.amount for a in pending_on_hold_adjustments if a.amount >= 0), Decimal("0")
    )
    on_hold_released = sum(
        (-a.amount for a in pending_on_hold_adjustments if a.amount < 0), Decimal("0")
    )

    # lta_upload/special_allowance_upload/nps_allowance_upload
    # store the RAW excel figure alone (used later to
    # reconstruct `row` for the attendance-edit recompute path
    # — see the PayslipRecordEdit handling below). Captured
    # here, before the pops, since row.get(...) below would
    # otherwise see them already removed.
    lta_upload = row.get("lta", Decimal("0"))
    special_allowance_upload = row.get("special_allowance", Decimal("0"))
    nps_allowance_upload = row.get("nps_allowance_earned", Decimal("0"))

    # `computed` already carries the combined (prorated
    # structure baseline + this raw upload figure) value for
    # each of these three fields — see calculate_payslip_fields.
    # They must be popped out of `row` before the **row/**computed
    # spread below, or Python raises "got multiple values for
    # keyword argument" since both dicts would supply the same key.
    row.pop("lta", None)
    row.pop("special_allowance", None)
    row.pop("nps_allowance_earned", None)
    row.pop("esi", None)
    row.pop("employer_esi", None)
    row.pop("employer_pf", None)
    computed.pop("esi", None)
    computed.pop("employer_esi", None)
    emp_pf_val = computed.pop("employer_pf", None)

    # 1. Pop custom_components from row so row NEVER passes duplicate 'custom_components'
    row_custom = row.pop("custom_components", {})

    # 2. Merge employer_pf and ensure computed["custom_components"] is clean
    computed_custom = computed.get("custom_components")
    if not isinstance(computed_custom, dict):
        computed_custom = {"earnings": [], "deductions": []}
    if emp_pf_val is not None:
        computed_custom["employer_pf"] = str(emp_pf_val)
    computed["custom_components"] = computed_custom

    persisted_structure = getattr(latest_structure, "_persisted_structure", latest_structure)
    valid_record_fields = {f.name for f in PayslipRecord._meta.get_fields()}
    safe_row = {k: v for k, v in row.items() if k in valid_record_fields}
    safe_computed = {k: v for k, v in computed.items() if k in valid_record_fields}
    record_kwargs = {**safe_row, **safe_computed}
    new_record = PayslipRecord.objects.create(
        batch=batch,
        employee=employee,
        salary_structure_snapshot=persisted_structure,
        days_in_month=days_in_month,
        salary_advance_opening_balance=salary_advance_opening_balance,
        salary_advance_disbursed=salary_advance_disbursed,
        salary_advance_recovered=salary_advance_recovered,
        on_hold_opening_balance=on_hold_opening_balance,
        on_hold_deducted=on_hold_deducted,
        on_hold_released=on_hold_released,
        lta_upload=lta_upload,
        special_allowance_upload=special_allowance_upload,
        nps_allowance_upload=nps_allowance_upload,
        **record_kwargs,
    )
    if emp_pf_val is not None:
        new_record.employer_pf = emp_pf_val
    if pending_adjustments:
        CompOffAdjustment.objects.filter(
            id__in=[a.id for a in pending_adjustments]
        ).update(applied_in_record=new_record)
    if pending_leave_adjustments:
        LeaveAdjustment.objects.filter(
            id__in=[a.id for a in pending_leave_adjustments]
        ).update(applied_in_record=new_record)
    if pending_advance_adjustments:
        SalaryAdvanceAdjustment.objects.filter(
            id__in=[a.id for a in pending_advance_adjustments]
        ).update(applied_in_record=new_record)
        # Recovery installments (amount < 0) tied to a
        # SalaryAdvance plan have now been applied — advance
        # months_recovered so the next batch knows this
        # installment is done. The disbursement adjustment
        # (amount >= 0) is excluded — it doesn't count as a
        # recovered installment.
        recovered_advance_ids = [
            a.advance_id for a in pending_advance_adjustments
            if a.advance_id is not None and a.amount < 0
        ]
        if recovered_advance_ids:
            SalaryAdvance.objects.filter(id__in=recovered_advance_ids).update(
                months_recovered=models.F("months_recovered") + 1
            )
    if pending_on_hold_adjustments:
        OnHoldAdjustment.objects.filter(
            id__in=[a.id for a in pending_on_hold_adjustments]
        ).update(applied_in_record=new_record)
    if pending_portal_adjustments:
        PortalAdjustment.objects.filter(
            id__in=[a.id for a in pending_portal_adjustments]
        ).update(applied_in_record=new_record)

    return new_record, missing_structure



# ── Canonical Statutory, Compliance & Financial Accounting Report Engine ────────
# Relocated to Pillar 4 (payroll/excel_parser.py) for separation of concerns
from .excel_parser import (
    REPORT_REGISTRY,
    generate_batch_detailed_excel_response,
    generate_epfo_ecr_txt_response,
    generate_epfo_ecr_xlsx_response,
    generate_esic_monthly_xlsx_response,
    generate_pt_statement_xlsx_response,
    validate_statutory_identifiers,
    validate_bank_details,
    generate_bank_payout_xlsx_response,
    generate_bank_payout_csv_response,
    generate_bank_payout_hdfc_response,
    build_mom_variance_data,
    generate_mom_variance_xlsx_response,
    build_journal_voucher_data,
    generate_journal_voucher_xlsx_response,
    generate_tally_xml_response,
    generate_journal_voucher_csv_response,
)

def get_hold_records_summary(batch):
    """
    Returns all records in the batch that have on-hold activity or balances:
    - on_hold_opening_balance > 0, on_hold_deducted > 0, on_hold_released > 0, or on_hold_closing_balance > 0.
    - Includes audit history of adjustments [Option 7.C].
    - Includes any active PortalHold entries.
    """
    records = batch.records.filter(
        models.Q(on_hold_opening_balance__gt=0) |
        models.Q(on_hold_deducted__gt=0) |
        models.Q(on_hold_released__gt=0) |
        models.Q(on_hold_closing_balance__gt=0)
    ).select_related("employee").order_by("employee__employee_code")

    items = []
    for r in records:
        emp = r.employee
        adjs = OnHoldAdjustment.objects.filter(employee=emp).order_by("-created_at")[:5]
        adj_history = [
            {
                "id": a.id,
                "amount": float(a.amount),
                "type": "HOLD" if a.amount > 0 else "RELEASE",
                "reason": a.reason,
                "created_at": a.created_at.strftime("%d/%m/%Y %H:%M"),
                "applied": bool(a.applied_in_record_id),
            }
            for a in adjs
        ]

        portal_holds = PortalHold.objects.filter(employee=emp, release_adjustment__isnull=True)
        scheduled_releases = [
            {
                "id": ph.id,
                "amount": float(ph.amount),
                "scheduled_period": f"{ph.release_month:02d}/{ph.release_year}",
                "reason": ph.reason,
            }
            for ph in portal_holds
        ]

        items.append({
            "record_id": r.id,
            "employee_id": emp.id,
            "employee_code": emp.employee_code,
            "employee_name": emp.full_name,
            "on_hold_opening_balance": float(r.on_hold_opening_balance or 0),
            "on_hold_deducted": float(r.on_hold_deducted or 0),
            "on_hold_released": float(r.on_hold_released or 0),
            "on_hold_closing_balance": float(r.on_hold_closing_balance or 0),
            "net_salary": float(r.net_salary or 0),
            "earned_salary": float(r.earned_salary or 0),
            "total_deductions": float(r.total_deductions or 0),
            "adjustment_history": adj_history,
            "scheduled_releases": scheduled_releases,
        })

    return {
        "batch_id": batch.id,
        "total_on_hold_count": len(items),
        "total_closing_hold_amount": sum((i["on_hold_closing_balance"] for i in items), 0.0),
        "total_released_amount": sum((i["on_hold_released"] for i in items), 0.0),
        "records": items,
    }


def apply_batch_hold_release(batch, employee, release_amount, reason, user):
    """
    Releases salary on hold for an employee into the active batch:
    - Creates negative OnHoldAdjustment
    - Increases record.on_hold_released
    - Recomputes and updates record
    - Marks matching PortalHold as satisfied
    """
    record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
    if not record:
        raise ValueError(f"No payslip record found for {employee.full_name} in batch #{batch.id}")

    rel_amt = Decimal(str(release_amount or 0)).quantize(Decimal("0.01"))
    if rel_amt <= Decimal("0.00"):
        raise ValueError("Release amount must be greater than zero.")

    max_releasable = (record.on_hold_opening_balance or Decimal("0.00")) + (record.on_hold_deducted or Decimal("0.00")) - (record.on_hold_released or Decimal("0.00"))
    if rel_amt > max_releasable:
        raise ValueError(f"Cannot release ₹{rel_amt:,.2f}; maximum available on-hold balance is ₹{max_releasable:,.2f}")

    adj = OnHoldAdjustment.objects.create(
        employee=employee,
        amount=-rel_amt,
        reason=f"Manual batch release ({batch.month:02d}/{batch.year}): {reason or 'Salary released by staff'}",
        applied_in_record=record,
        created_by=user,
    )

    record.on_hold_released = (record.on_hold_released or Decimal("0.00")) + rel_amt
    record.save()

    ph = PortalHold.objects.filter(employee=employee, release_adjustment__isnull=True).first()
    if ph:
        ph.release_adjustment = adj
        ph.save(update_fields=["release_adjustment"])

    return record, adj


def apply_batch_salary_hold(batch, employee, hold_amount, reason, release_month, release_year, user):
    """
    Puts salary on hold for an employee in the active batch:
    - Creates positive OnHoldAdjustment
    - Increases record.on_hold_deducted
    - Recomputes and updates record
    - Optionally creates PortalHold if release_month/year specified
    """
    record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
    if not record:
        raise ValueError(f"No payslip record found for {employee.full_name} in batch #{batch.id}")

    h_amt = Decimal(str(hold_amount or 0)).quantize(Decimal("0.01"))
    if h_amt <= Decimal("0.00"):
        raise ValueError("Hold amount must be greater than zero.")

    adj = OnHoldAdjustment.objects.create(
        employee=employee,
        amount=h_amt,
        reason=f"Batch salary hold ({batch.month:02d}/{batch.year}): {reason or 'Salary put on hold by staff'}",
        applied_in_record=record,
        created_by=user,
    )

    record.on_hold_deducted = (record.on_hold_deducted or Decimal("0.00")) + h_amt
    record.save()

    if release_month and release_year:
        try:
            rm = int(release_month)
            ry = int(release_year)
            if 1 <= rm <= 12 and ry >= batch.year:
                sub = PortalSubmission.objects.filter(client=batch.client, month=batch.month, year=batch.year).first()
                if sub:
                    item = PortalSubmissionItem.objects.create(
                        submission=sub,
                        item_type=PortalSubmissionItem.TYPE_SALARY_HOLD,
                        status=PortalSubmissionItem.STATUS_APPLIED,
                        sort=99,
                        payload={
                            "employee_id": employee.id,
                            "amount": str(h_amt),
                            "reason": reason,
                            "release_month": rm,
                            "release_year": ry,
                        }
                    )
                    PortalHold.objects.create(
                        item=item,
                        employee=employee,
                        amount=h_amt,
                        reason=reason,
                        release_month=rm,
                        release_year=ry,
                        hold_adjustment=adj,
                    )
        except Exception:
            pass

    return record, adj


def delete_batch_records_leaf_first(batch, purge_pdf_files=True):
    """
    Safely delete all PayslipRecords in a PayrollBatch by walking protected
    foreign-key dependencies leaf-first (EmailLog, PayslipRecordEdit) and
    optionally unlinking generated PDF files from disk.
    Prevents ProtectedError when resetting or discarding batches.
    """
    if not batch:
        return
    records = list(batch.records.all())
    if not records:
        return
    record_ids = [r.id for r in records]

    if purge_pdf_files:
        for r in records:
            if r.pdf_path:
                try:
                    Path(r.pdf_path).unlink(missing_ok=True)
                except Exception as exc:
                    logger.warning("Could not unlink payslip PDF %s: %s", r.pdf_path, exc)

    # Roll back months_recovered counter on any SalaryAdvance recovered in this batch
    recovered_adjustments = SalaryAdvanceAdjustment.objects.filter(
        applied_in_record_id__in=record_ids,
        amount__lt=0,
        advance__isnull=False,
    )
    for adj in recovered_adjustments:
        if adj.advance_id:
            SalaryAdvance.objects.filter(id=adj.advance_id, months_recovered__gt=0).update(
                months_recovered=models.F("months_recovered") - 1
            )

    # Detach all adjustments cleanly from deleted records so they become pending again
    SalaryAdvanceAdjustment.objects.filter(applied_in_record_id__in=record_ids).update(applied_in_record=None)
    OnHoldAdjustment.objects.filter(applied_in_record_id__in=record_ids).update(applied_in_record=None)
    CompOffAdjustment.objects.filter(applied_in_record_id__in=record_ids).update(applied_in_record=None)
    LeaveAdjustment.objects.filter(applied_in_record_id__in=record_ids).update(applied_in_record=None)
    try:
        from payroll.models import PortalAdjustment
        PortalAdjustment.objects.filter(applied_in_record_id__in=record_ids).update(applied_in_record=None)
    except Exception as exc:
        logger.warning("Could not detach PortalAdjustment from batch records: %s", exc)

    EmailLog.objects.filter(payslip_record_id__in=record_ids).delete()
    PayslipRecordEdit.objects.filter(payslip_record_id__in=record_ids).delete()
    batch.records.all().delete()



class PayrollBatchViewSet(AuditViewMixin, viewsets.ModelViewSet):
    content_negotiation_class = SafeContentNegotiator
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        # Destructive deletions remain restricted to leadership,
        # but upload, merge, and review are accessible to authenticated staff (makers/checkers)
        if self.action in ("destroy", "discard"):
            return [IsAuthenticated(), PayrollOption("delete_payroll_data", LEADS)()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = (
            PayrollBatch.objects.select_related("client", "uploaded_by", "reviewed_by", "sent_by")
            .prefetch_related("records", "jobs")
            .order_by("-year", "-month", "-created_at")
        )
        if client_param := (self.request.query_params.get("client") or self.request.query_params.get("client_id")):
            queryset = queryset.filter(client_id=client_param)
        if month_param := self.request.query_params.get("month"):
            if str(month_param).isdigit():
                queryset = queryset.filter(month=int(month_param))
        if status_param := self.request.query_params.get("status"):
            queryset = queryset.filter(status=status_param)
        if year_param := self.request.query_params.get("year"):
            # Guard against partial/non-numeric input while the user is
            # still typing (e.g. "2" or "20") — .filter(year="20") would
            # otherwise raise a ValueError from the PositiveSmallIntegerField
            # lookup and 500 the request instead of just narrowing results.
            if year_param.isdigit():
                queryset = queryset.filter(year=int(year_param))
        return queryset

    def get_serializer_class(self):
        if self.action == "list":
            return PayrollBatchListSerializer
        return PayrollBatchSerializer

    def perform_destroy(self, instance):
        # An UPLOADED batch was never reviewed or sent — nothing about it
        # has audit value, so cancelling it should actually remove it
        # instead of leaving a "FAILED" husk behind. Anything past that
        # point (REVIEWED / SENDING / COMPLETED / already FAILED) keeps
        # the soft-delete so the audit trail survives.
        if instance.status == PayrollBatch.STATUS_UPLOADED:
            self._hard_delete(instance)
        else:
            instance.status = PayrollBatch.STATUS_FAILED
            instance.error_log = "Batch cancelled by user."
            instance.save(update_fields=["status", "error_log", "updated_at"])

    @staticmethod
    def _hard_delete(instance):
        # PayslipRecord/PayslipRecordEdit/EmailLog all use on_delete=PROTECT,
        # not CASCADE, so instance.delete() would raise ProtectedError.
        # Walk the dependency chain manually, leaf-first.
        delete_batch_records_leaf_first(instance, purge_pdf_files=True)
        instance.delete()

    @action(detail=True, methods=["post"], url_path="discard")
    def discard(self, request, pk=None):
        """
        Hard-delete cleanup for batches already stuck in FAILED from
        before this fix (or from a genuine row-processing error where
        soft-delete is still correct behaviour going forward, but the
        user wants this specific orphan gone). Only allowed on FAILED
        batches — anything REVIEWED/SENDING/COMPLETED keeps PROTECT.
        """
        batch = self.get_object()
        if batch.status != PayrollBatch.STATUS_FAILED:
            return Response(
                {"detail": "Only FAILED batches can be discarded."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._hard_delete(batch)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # Note: Legacy standalone upload and merge_excel actions have been removed.
    # Batch inputs now flow via portal-submissions multi-sheet staging and Jobs workflow.

    @action(detail=False, methods=["post"], url_path="generate-from-portal")
    def generate_from_portal(self, request):
        """
        Generate the payroll batch directly from the client's portal data —
        no Excel upload. Every ACTIVE employee of the client gets a
        PayslipRecord with full-month attendance (actual_working_days =
        days_in_month, no LOP) so the client's approved portal items — new
        joiners, revisions, advances, one-time earnings/deductions — flow
        straight into the payslip. Attendance/LOP can still be edited in
        Batch Review afterward.
        """
        client_id = request.data.get("client_id") or request.data.get("client")
        month = request.data.get("month")
        year = request.data.get("year")

        if not all([client_id, month, year]):
            return Response(
                {"detail": "client_id, month, and year are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            month = int(month)
            year = int(year)
        except (TypeError, ValueError):
            return Response(
                {"detail": "month and year must be integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if month < 1 or month > 12:
            return Response(
                {"detail": "month must be between 1 and 12."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client = Client.objects.get(pk=client_id)
        except (Client.DoesNotExist, ValueError, TypeError):
            return Response(
                {"detail": "client_id does not match a known client."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if PayrollBatch.objects.filter(client=client, month=month, year=year).exists():
            return Response(
                {"detail": "Payroll batch already exists for this client, month, and year."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sync_due_employee_exits(client=client)
        days_in_month = calendar.monthrange(year, month)[1]
        profile = getattr(client, "payroll_profile", None)
        if profile and hasattr(profile, "get_cycle_dates"):
            cycle_start, cycle_end, _ = profile.get_cycle_dates(year, month)
        else:
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, days_in_month)

        employees = list(
            Employee.objects.filter(client=client)
            .filter(
                models.Q(status=Employee.STATUS_ACTIVE)
                | models.Q(last_working_date__gte=cycle_start)
            )
            .exclude(hire_date__gt=cycle_end)
            .order_by("employee_code")
        )

        with transaction.atomic():
            batch = PayrollBatch.objects.create(
                client=client,
                month=month,
                year=year,
                total_records=0,
                uploaded_by=request.user,
            )
            # Same as the Excel path: materialize any portal salary holds
            # whose release month is this batch's month.
            materialize_due_hold_releases(client, month, year, request.user)
            missing_structure_employees = []
            for employee in employees:
                # Compute exact calendar working span for this month (prorate if joined or exited this month)
                start_day = 1
                if (
                    employee.hire_date
                    and employee.hire_date.year == year
                    and employee.hire_date.month == month
                ):
                    start_day = employee.hire_date.day
                end_day = days_in_month
                if (
                    employee.last_working_date
                    and employee.last_working_date.year == year
                    and employee.last_working_date.month == month
                ):
                    end_day = employee.last_working_date.day
                working_span = max(0, min(days_in_month, end_day) - max(1, start_day) + 1)
                actual_days = Decimal(str(working_span))

                row = {
                    "actual_working_days": actual_days,
                    "extra_working_days": Decimal("0"),
                    "paid_leave_days": Decimal("0"),
                    "lop_days": Decimal("0"),
                    "lta": Decimal("0"),
                    "special_allowance": Decimal("0"),
                    "nps_allowance_earned": Decimal("0"),
                    "commission_other": Decimal("0"),
                    "arrears": Decimal("0"),
                    "reimbursements": Decimal("0"),
                    "tds": Decimal("0"),
                    "vpf_arrears": Decimal("0"),
                    "nps_deduction_arrears": Decimal("0"),
                    "loan_deduction": Decimal("0"),
                    "lwf": Decimal("0"),
                    "other_deduction": Decimal("0"),
                }
                _record, missing = _build_record_for_employee(
                    employee, batch, row, year, month, days_in_month, request.user
                )
                if missing:
                    missing_structure_employees.append(employee)

            batch.total_records = len(employees)
            batch.save(update_fields=["total_records", "updated_at"])

            if missing_structure_employees:
                codes = ", ".join(e.employee_code for e in missing_structure_employees)
                logger.warning(
                    "%s payroll for %02d/%d: %d employee(s) have no salary structure set up (%s) — their pay will calculate as 0 until fixed.",
                    client.name, month, year, len(missing_structure_employees), codes,
                )

            # If a portal submission exists for this month, fold any already-applied items
            sub = PortalSubmission.objects.filter(client=client, month=month, year=year).first()
            if sub:
                applied_items = list(sub.items.filter(status=PortalSubmissionItem.STATUS_APPLIED))
                if applied_items:
                    refresh_batch_after_apply(sub, request.user, applied_items)

            job = PayrollJob.objects.filter(client=client, month=month, year=year).first()
            if job:
                fields_to_update = []
                if not job.batch:
                    job.batch = batch
                    fields_to_update.append("batch")
                if job.status == PayrollJob.STATUS_TODO:
                    job.status = PayrollJob.STATUS_IN_PROGRESS
                    fields_to_update.append("status")
                if fields_to_update:
                    job.save(update_fields=fields_to_update)

        serializer = PayrollBatchSerializer(batch, context={"request": request})
        return Response({"batch": serializer.data, "warnings": []}, status=status.HTTP_201_CREATED)



    @action(detail=True, methods=["post"], url_path="send-emails")
    def send_emails(self, request, pk=None):
        batch = self.get_object()
        if batch.status not in [PayrollBatch.STATUS_REVIEWED, PayrollBatch.STATUS_SENDING, PayrollBatch.STATUS_FAILED]:
            return Response(
                {"detail": "Batch must be REVIEWED, SENDING, or FAILED before emails can be sent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The actual sending runs in the background. If Celery is connected,
        # it is queued via Redis. If Celery is offline, we fallback to an isolated
        # daemon background thread so the HTTP request returns immediately without blocking.
        dispatch_mode = "celery"
        task_id = None
        detail_msg = "Payslip emails are being sent in the background via automated enterprise queue service."
        try:
            task = send_bulk_payslip_emails.delay(batch.id, request.user.id)
            task_id = task.id
        except Exception as exc:
            logger.warning("Celery queue unavailable (%s), falling back to direct server dispatch thread.", exc)
            thread = threading.Thread(
                target=_dispatch_bulk_payslip_emails_in_thread,
                args=(batch.id, request.user.id),
                daemon=True,
                name=f"payslip-email-batch-{batch.id}",
            )
            thread.start()
            dispatch_mode = "thread"
            detail_msg = "Payslip emails are being sent in the background via direct server dispatch service (failsafe backup)."

        return Response(
            {
                "detail": detail_msg,
                "task_id": task_id,
                "dispatch_mode": dispatch_mode,
            },
            status=status.HTTP_202_ACCEPTED,
        )



    @action(detail=True, methods=["get"], url_path="export-csv")
    def export_csv(self, request, pk=None):
        batch = self.get_object()
        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Employee Code", "Name", "Email", "Gross Salary", "Net Salary", "Status", "Sent At"])
        for record in batch.records.select_related("employee").prefetch_related("email_logs"):
            latest_log = record.email_logs.order_by("-sent_at").first()
            writer.writerow(
                [
                    record.employee.employee_code,
                    record.employee.full_name,
                    record.employee.email,
                    record.gross_salary,
                    record.net_salary,
                    record.status,
                    latest_log.sent_at.isoformat() if latest_log else "",
                ]
            )
        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="payroll_{batch.client_id}_{batch.year}_{batch.month:02d}.csv"'
        return response

    @action(detail=True, methods=["get"], url_path="export-detailed-xlsx")
    def export_detailed_xlsx(self, request, pk=None):
        batch = self.get_object()
        return generate_batch_detailed_excel_response(batch)

    @action(detail=True, methods=["get"], url_path="export-epfo-ecr")
    def export_epfo_ecr(self, request, pk=None):
        batch = self.get_object()
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "txt").lower()
        if fmt == "xlsx":
            return generate_epfo_ecr_xlsx_response(batch)
        return generate_epfo_ecr_txt_response(batch)

    @action(detail=True, methods=["get"], url_path="export-esic-monthly")
    def export_esic_monthly(self, request, pk=None):
        batch = self.get_object()
        return generate_esic_monthly_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="export-pt-statement")
    def export_pt_statement(self, request, pk=None):
        batch = self.get_object()
        return generate_pt_statement_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="validate-statutory-identifiers")
    def validate_statutory_identifiers(self, request, pk=None):
        batch = self.get_object()
        return Response(validate_statutory_identifiers(batch))

    @action(detail=True, methods=["get"], url_path="export-bank-payout")
    def export_bank_payout(self, request, pk=None):
        batch = self.get_object()
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "xlsx").lower()
        if fmt == "csv":
            return generate_bank_payout_csv_response(batch)
        elif fmt == "hdfc":
            return generate_bank_payout_hdfc_response(batch)
        return generate_bank_payout_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="validate-bank-details")
    def validate_bank_details(self, request, pk=None):
        batch = self.get_object()
        return Response(validate_bank_details(batch))

    @action(detail=True, methods=["get"], url_path="hold-records")
    def hold_records(self, request, pk=None):
        batch = self.get_object()
        return Response(get_hold_records_summary(batch))

    @action(detail=True, methods=["post"], url_path="release-salary-hold")
    def release_salary_hold(self, request, pk=None):
        batch = self.get_object()
        emp_id = request.data.get("employee_id")
        amount = request.data.get("release_amount")
        reason = request.data.get("reason", "")
        if not emp_id or not amount:
            return Response({"error": "employee_id and release_amount are required."}, status=status.HTTP_400_BAD_REQUEST)
        employee = Employee.objects.filter(id=emp_id, client=batch.client).first()
        if not employee:
            return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            record, adj = apply_batch_hold_release(batch, employee, amount, reason, request.user)
            return Response({
                "message": f"Successfully released ₹{abs(adj.amount):,.2f} on-hold salary for {employee.full_name}.",
                "record": PayslipRecordSerializer(record).data,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="place-salary-hold")
    def place_salary_hold(self, request, pk=None):
        batch = self.get_object()
        emp_id = request.data.get("employee_id")
        amount = request.data.get("hold_amount")
        reason = request.data.get("reason", "")
        release_month = request.data.get("release_month")
        release_year = request.data.get("release_year")
        if not emp_id or not amount:
            return Response({"error": "employee_id and hold_amount are required."}, status=status.HTTP_400_BAD_REQUEST)
        employee = Employee.objects.filter(id=emp_id, client=batch.client).first()
        if not employee:
            return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            record, adj = apply_batch_salary_hold(batch, employee, amount, reason, release_month, release_year, request.user)
            return Response({
                "message": f"Successfully placed ₹{adj.amount:,.2f} on hold for {employee.full_name}.",
                "record": PayslipRecordSerializer(record).data,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="mom-variance-summary")
    def mom_variance_summary(self, request, pk=None):
        batch = self.get_object()
        return Response(build_mom_variance_data(batch))

    @action(detail=True, methods=["get"], url_path="export-mom-variance")
    def export_mom_variance(self, request, pk=None):
        batch = self.get_object()
        return generate_mom_variance_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="export-journal-voucher")
    def export_journal_voucher(self, request, pk=None):
        batch = self.get_object()
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "xlsx").lower()
        split_dept = request.query_params.get("split_by_dept", "true").lower() in ("true", "1", "yes")
        if fmt in ("xml", "tally"):
            return generate_tally_xml_response(batch, split_by_department=split_dept)
        elif fmt == "csv":
            return generate_journal_voucher_csv_response(batch, split_by_department=split_dept)
        return generate_journal_voucher_xlsx_response(batch, split_by_department=split_dept)

    @action(detail=True, methods=["get"], url_path="records")
    def records(self, request, pk=None):
        batch = self.get_object()
        queryset = batch.records.select_related("employee", "salary_structure_snapshot", "batch", "batch__client")
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = PayslipRecordSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)
        serializer = PayslipRecordSerializer(queryset, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """
        Firm-wide payroll snapshot for the PayrollWorkspace overview screen
        (status_overview / pending_review / emails_sent / failed_emails).
        This endpoint didn't exist in the original payroll module — added
        here since the overview page depends on this exact shape.
        """
        batches = PayrollBatch.objects.all()
        status_overview = {
            "uploaded": batches.filter(status=PayrollBatch.STATUS_UPLOADED).count(),
            "reviewed": batches.filter(status=PayrollBatch.STATUS_REVIEWED).count(),
            "in_progress": batches.filter(status=PayrollBatch.STATUS_SENDING).count(),
            "completed": batches.filter(status=PayrollBatch.STATUS_COMPLETED).count(),
            "failed": batches.filter(status=PayrollBatch.STATUS_FAILED).count(),
        }
        pending_review = batches.filter(status=PayrollBatch.STATUS_UPLOADED).count()
        emails_sent = EmailLog.objects.filter(success=True).count()
        failed_emails = EmailLog.objects.filter(success=False).count()

        return Response(
            {
                "status_overview": status_overview,
                "pending_review": pending_review,
                "emails_sent": emails_sent,
                "failed_emails": failed_emails,
            }
        )


class PayslipRecordViewSet(AuditViewMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = PayslipRecordSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        queryset = PayslipRecord.objects.select_related("batch", "batch__client", "employee", "salary_structure_snapshot")
        if batch_id := self.request.query_params.get("batch"):
            queryset = queryset.filter(batch_id=batch_id)
        if status_param := self.request.query_params.get("status"):
            queryset = queryset.filter(status=status_param)
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
            return queryset.order_by("-batch__year", "-batch__month")
        return queryset.order_by("employee__employee_code")

    def partial_update(self, request, *args, **kwargs):
        record = self.get_object()

        # Once a batch is COMPLETED, its records have already been emailed
        # out as final payslips — editing after the fact would silently
        # desync what the employee received from what CAOAS shows, with no
        # way to re-notify them. Individual EMAIL_SENT records are blocked
        # too, in case a batch is ever partially sent (SENDING with some
        # records already delivered).
        # ...unless the caller explicitly asks for a POST-SEND CORRECTION
        # (Employee Workspace → Payslips → "Edit Details"). Real payroll
        # runs do produce mistakes that are only spotted after the mail has
        # gone out, and the fix has to be per-employee — not a whole-batch
        # regeneration. In that mode the edit is allowed, every changed
        # field is still written to PayslipRecordEdit (full audit trail),
        # and the record is pushed back to DRAFT so its now-stale PDF must
        # be regenerated and re-sent before it counts as delivered again.
        correction = str(
            request.data.get("post_send_correction")
            or request.query_params.get("post_send_correction")
            or ""
        ).lower() in {"1", "true", "yes"}
        already_sent = (
            record.batch.status == PayrollBatch.STATUS_COMPLETED
        )
        if already_sent and not correction:
            raise PermissionDenied(
                "This payslip has already been emailed and can no longer be edited. "
                "Use a post-send correction from the Employee Workspace if it must be fixed."
            )

        # Strict Segregation of Duties:
        # If this record's batch is linked to a PayrollJob, only assigned Makers
        # can modify payslip figures while the job is active (In Progress / To Do / Rework).
        # Checkers and unassigned Admins/Viewers are strictly blocked from mutating figures.
        linked_job = getattr(record.batch, "jobs", None)
        if not (linked_job and linked_job.exists()):
            linked_job = PayrollJob.objects.filter(client=record.batch.client, month=record.batch.month, year=record.batch.year)
        if linked_job and linked_job.exists():
            job = linked_job.first()
            if job.status == PayrollJob.STATUS_DONE and not correction:
                raise PermissionDenied(
                    "Cannot edit records for a finalized payroll job. Admins must reopen the batch first."
                )
            is_assigned_maker = job.makers.filter(id=request.user.id).exists()
            if not is_assigned_maker and not correction:
                raise PermissionDenied(
                    "Permission denied. Only assigned Makers can edit payslip records while job is In Progress."
                )

        custom_override_code = None
        custom_override_amount = None
        custom_override = request.data.get("custom_component_override")
        if isinstance(custom_override, dict):
            custom_override_code = custom_override.get("code")
            custom_override_amount = custom_override.get("amount")
        elif "custom_component_code" in request.data:
            custom_override_code = request.data.get("custom_component_code")
            custom_override_amount = request.data.get("amount")
        else:
            for k, v in request.data.items():
                if k.startswith("custom_earnings_"):
                    custom_override_code = k.replace("custom_earnings_", "")
                    custom_override_amount = v
                    break
                elif k.startswith("custom_deductions_"):
                    custom_override_code = k.replace("custom_deductions_", "")
                    custom_override_amount = v
                    break
                elif k.startswith("custom_") and k != "custom_components":
                    custom_override_code = k.replace("custom_", "")
                    custom_override_amount = v
                    break

        payload = {
            k: v for k, v in request.data.items()
            if k != "post_send_correction" and not k.startswith("custom_") and k not in ("custom_component_override", "custom_component_code", "amount")
        }
        serializer = self.get_serializer(record, data=payload, partial=True)
        serializer.is_valid(raise_exception=True)

        changed_fields = []
        with transaction.atomic():
            for field_name, new_value in serializer.validated_data.items():
                if field_name not in PAYSLIP_EDITABLE_FIELDS:
                    continue
                old_value = getattr(record, field_name)
                if old_value != new_value:
                    changed_fields.append((field_name, old_value, new_value))

            self.perform_update(serializer)

            update_fields = ["edit_count", "earned_salary", "total_deductions", "net_salary", "updated_at"]

            # Handle Custom Component inline override (Option 2A & 3A)
            if custom_override_code:
                clean_code = str(custom_override_code).strip().upper()
                comp_found = False
                new_amt = float(Decimal(str(custom_override_amount or 0)))
                if not isinstance(record.custom_components, dict):
                    record.custom_components = {"earnings": [], "deductions": []}

                for e in record.custom_components.get("earnings", []):
                    if str(e.get("code", "")).upper() == clean_code or str(e.get("abbr", "")).upper() == clean_code:
                        old_amt = e.get("amount", 0)
                        e["amount"] = new_amt
                        e["source"] = "MANUAL_DRAWER_EDIT"
                        changed_fields.append((f"custom_{clean_code}", old_amt, new_amt))
                        comp_found = True
                        break

                if not comp_found:
                    for d in record.custom_components.get("deductions", []):
                        if str(d.get("code", "")).upper() == clean_code or str(d.get("abbr", "")).upper() == clean_code:
                            old_amt = d.get("amount", 0)
                            d["amount"] = new_amt
                            d["source"] = "MANUAL_DRAWER_EDIT"
                            changed_fields.append((f"custom_{clean_code}", old_amt, new_amt))
                            comp_found = True
                            break

                if not comp_found and clean_code == "FBP":
                    if "earnings" not in record.custom_components or not isinstance(record.custom_components["earnings"], list):
                        record.custom_components["earnings"] = []
                    record.custom_components["earnings"].append({
                        "code": "FBP",
                        "abbr": "FBP",
                        "name": "Flexible Benefit Plan",
                        "component_code": "FBP",
                        "component_name": "Flexible Benefit Plan",
                        "component_type": "EARNING",
                        "type": "EARNING",
                        "amount": new_amt,
                        "total_amount": new_amt,
                        "contracted_amount": new_amt,
                        "earned_prorated": new_amt,
                        "additional_amount": 0.0,
                        "source": "MANUAL_DRAWER_EDIT",
                    })
                    changed_fields.append((f"custom_{clean_code}", 0, new_amt))
                    comp_found = True

                if comp_found:
                    update_fields.append("custom_components")
            changed_field_names = {f for f, _, _ in changed_fields}
            attendance_fields = {"extra_working_days", "lop_days", "actual_working_days", "paid_leave_days"}
            if changed_field_names & attendance_fields:
                profile = getattr(record.batch.client, "payroll_profile", None)
                lop_policy = getattr(profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if profile else "ACCRUE_LEAVE_DEBT"
                pt_state = getattr(profile, "pt_state", "KARNATAKA") if profile else "KARNATAKA"
                pt_amount = getattr(profile, "pt_amount", Decimal("0")) if profile else Decimal("0")
                annual_leave_days = getattr(profile, "annual_leave_days", Decimal("22")) if profile else Decimal("22")
                probation_months = getattr(profile, "probation_months", 6) if profile else 6
                track_leave_ledger = getattr(profile, "track_leave_ledger", True) if profile else True
                track_comp_off = getattr(profile, "track_comp_off", True) if profile else True

                # Options 1, 2, 4: Bidirectional Attendance Balancing under REDUCE_SALARY
                if lop_policy == "REDUCE_SALARY":
                    days_cap = Decimal(str(record.days_in_month or 30))
                    # Check tenure span for mid-month joiner / exit
                    hire_d = getattr(record.employee, "hire_date", None)
                    lwd_d = getattr(record.employee, "last_working_date", None)
                    cycle_start = date(record.batch.year, record.batch.month, 1)
                    cycle_end = date(record.batch.year, record.batch.month, int(days_cap))
                    eff_start = max(cycle_start, hire_d) if hire_d else cycle_start
                    eff_end = min(cycle_end, lwd_d) if lwd_d else cycle_end
                    if eff_end < eff_start:
                        max_span = Decimal("0")
                    else:
                        active_days = (eff_end - eff_start).days + 1
                        max_span = Decimal(str(max(0, min(int(days_cap), active_days))))

                    paid_leave = Decimal(str(record.paid_leave_days or 0))

                    # If lop_days or paid_leave_days was explicitly changed: auto-sync actual_working_days
                    if "lop_days" in changed_field_names or "paid_leave_days" in changed_field_names:
                        current_lop = Decimal(str(record.lop_days or 0))
                        target_act = max(Decimal("0"), max_span - current_lop - paid_leave)
                        if record.actual_working_days != target_act:
                            old_act = record.actual_working_days
                            record.actual_working_days = target_act
                            changed_fields.append(("actual_working_days", old_act, target_act))
                            if "actual_working_days" not in update_fields:
                                update_fields.append("actual_working_days")

                    # Option 2: If actual_working_days was explicitly edited directly (and lop_days was not in payload)
                    elif "actual_working_days" in changed_field_names:
                        current_act = Decimal(str(record.actual_working_days or 0))
                        target_lop = max(Decimal("0"), max_span - paid_leave - current_act)
                        if record.lop_days != target_lop:
                            old_lop = record.lop_days
                            record.lop_days = target_lop
                            changed_fields.append(("lop_days", old_lop, target_lop))
                            if "lop_days" not in update_fields:
                                update_fields.append("lop_days")

                is_probation = is_in_probation(
                    record.employee.hire_date, record.batch.year, record.batch.month, probation_months=probation_months
                )
                row = {
                    "actual_working_days": record.actual_working_days,
                    "lop_days": record.lop_days,
                    "extra_working_days": record.extra_working_days,
                    "paid_leave_days": record.paid_leave_days,
                    "lta": record.lta_upload,
                    "special_allowance": record.special_allowance_upload,
                    "nps_allowance_earned": record.nps_allowance_upload,
                    "commission_other": record.commission_other,
                    "arrears": record.arrears,
                }
                computed = calculate_payslip_fields(
                    record.salary_structure_snapshot, row, record.batch.month, record.days_in_month,
                    comp_off_opening_balance=record.comp_off_opening_balance,
                    leave_opening_balance=record.leave_opening_balance,
                    is_probation=is_probation,
                    lop_policy=lop_policy,
                    pt_state=pt_state,
                    pt_amount=pt_amount,
                    annual_leave_days=annual_leave_days,
                    employee_gender=getattr(record.employee, "gender", "M"),
                    track_leave_ledger=track_leave_ledger,
                    track_comp_off=track_comp_off,
                    client_profile=profile,
                    year=record.batch.year,
                )
                for field_name, value in computed.items():
                    # gross_salary/comp_off_opening_balance/leave_opening_balance
                    # are carried straight through unchanged by design (see
                    # calculate_payslip_fields) — only re-assign the fields
                    # that can actually move from a proration edit.
                    if field_name in ("gross_salary", "comp_off_opening_balance", "leave_opening_balance"):
                        continue
                    setattr(record, field_name, value)
                update_fields += [
                    "actual_working_days", "lop_days",
                    "basic_da", "hra", "lta", "special_allowance", "nps_allowance_earned",
                    "basic_for_pf", "epf", "vpf", "professional_tax",
                    "comp_off_days_used", "comp_off_closing_balance",
                    "leave_accrued", "leave_used", "leave_closing_balance",
                    "custom_components",
                ]
                update_fields = list(set(update_fields))

            if changed_fields:
                PayslipRecordEdit.objects.bulk_create(
                    [
                        PayslipRecordEdit(
                            payslip_record=record,
                            edited_by=request.user,
                            field_name=field_name,
                            old_value=str(old_value),
                            new_value=str(new_value),
                        )
                        for field_name, old_value, new_value in changed_fields
                    ]
                )
                record.edit_count += len(changed_fields)
                if already_sent or record.status == PayslipRecord.STATUS_EMAIL_SENT:
                    # The emailed PDF no longer matches the stored figures —
                    # force the "regenerate PDF → send email" steps again.
                    record.status = PayslipRecord.STATUS_DRAFT
                    update_fields.append("status")
                concrete_fields = {f.name for f in PayslipRecord._meta.concrete_fields}
                safe_update_fields = [f for f in set(update_fields) if f in concrete_fields]
                record.save(update_fields=safe_update_fields)

                # Forward Ledger Cascade: Propagate updated closing balances to subsequent unlocked batches
                if changed_field_names & attendance_fields:
                    subsequent_records = PayslipRecord.objects.filter(
                        employee=record.employee,
                        batch__client=record.batch.client,
                    ).filter(
                        models.Q(batch__year__gt=record.batch.year) |
                        models.Q(batch__year=record.batch.year, batch__month__gt=record.batch.month)
                    ).filter(
                        batch__status__in=[PayrollBatch.STATUS_UPLOADED, PayrollBatch.STATUS_REVIEWED]
                    ).order_by("batch__year", "batch__month")

                    next_record = subsequent_records.first()
                    if next_record:
                        next_record.comp_off_opening_balance = record.comp_off_closing_balance
                        next_record.leave_opening_balance = record.leave_closing_balance
                        next_record.salary_advance_opening_balance = max(Decimal("0.00"), abs(record.salary_advance_closing_balance))
                        next_record.on_hold_opening_balance = max(Decimal("0.00"), abs(record.on_hold_closing_balance))

                        next_row = {
                            "actual_working_days": next_record.actual_working_days,
                            "lop_days": next_record.lop_days,
                            "extra_working_days": next_record.extra_working_days,
                            "paid_leave_days": next_record.paid_leave_days,
                            "lta": next_record.lta_upload,
                            "special_allowance": next_record.special_allowance_upload,
                            "nps_allowance_earned": next_record.nps_allowance_upload,
                            "commission_other": next_record.commission_other,
                            "arrears": next_record.arrears,
                        }
                        next_computed = calculate_payslip_fields(
                            next_record.salary_structure_snapshot,
                            next_row,
                            next_record.batch.month,
                            next_record.days_in_month,
                            comp_off_opening_balance=next_record.comp_off_opening_balance,
                            leave_opening_balance=next_record.leave_opening_balance,
                            is_probation=is_in_probation(next_record.employee.hire_date, next_record.batch.year, next_record.batch.month, probation_months=probation_months),
                            lop_policy=lop_policy,
                            pt_state=pt_state,
                            pt_amount=pt_amount,
                            annual_leave_days=annual_leave_days,
                            employee_gender=getattr(next_record.employee, "gender", "M"),
                            track_leave_ledger=track_leave_ledger,
                            track_comp_off=track_comp_off,
                        )
                        concrete_fields = {f.name for f in PayslipRecord._meta.concrete_fields}
                        for f_name, val in next_computed.items():
                            if f_name not in ("gross_salary", "comp_off_opening_balance", "leave_opening_balance") and f_name in concrete_fields:
                                setattr(next_record, f_name, val)
                        next_record.save()

        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=["get"], url_path="edit-history")
    def edit_history(self, request, pk=None):
        record = self.get_object()
        serializer = PayslipRecordEditSerializer(record.edits.select_related("edited_by"), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="resend")
    def resend(self, request, pk=None):
        """Send (or re-send) THIS employee's payslip only.

        Used both by Batch Review and by the Employee Workspace's
        per-employee "Send Email" step. If the PDF was never generated (or
        was invalidated by a post-send correction) it is rendered first, so
        the mail always carries the current figures rather than a stale
        attachment.
        """
        record = self.get_object()
        linked_job = getattr(record.batch, "jobs", None)
        if not (linked_job and linked_job.exists()):
            linked_job = PayrollJob.objects.filter(client=record.batch.client, month=record.batch.month, year=record.batch.year)
        if linked_job and linked_job.exists():
            job = linked_job.first()
            is_maker_or_checker = (
                job.makers.filter(id=request.user.id).exists() or
                job.checkers.filter(id=request.user.id).exists()
            )
            if not is_maker_or_checker:
                raise PermissionDenied("Permission denied. Only assigned Makers or Checkers can dispatch payslip emails.")

        # Always regenerate the PDF freshly so any post-reopen or inline adjustments are reflected
        generate_payslip_pdf(record)
        record.refresh_from_db()
        success, message = send_payslip_email(record, request.user)
        return Response(
            {"success": success, "message": message, "record": self.get_serializer(record).data}
        )

    @action(detail=True, methods=["get"], url_path="download-pdf")
    def download_pdf(self, request, pk=None):
        record = self.get_object()
        if not record.pdf_path or not Path(record.pdf_path).exists():
            # Automatically generate PDF on demand if missing or not yet generated
            generate_payslip_pdf(record)
            record.refresh_from_db()

        pdf_path = Path(record.pdf_path) if record.pdf_path else None
        if not pdf_path or not pdf_path.exists():
            raise Http404("Payslip PDF could not be generated.")
        employee_name_slug = record.employee.full_name.replace(" ", "")
        m_name = month_name[record.batch.month] if getattr(record, "batch", None) and getattr(record.batch, "month", None) else "Month"
        yr = record.batch.year if getattr(record, "batch", None) and getattr(record.batch, "year", None) else ""
        filename = f"{employee_name_slug}_{m_name}{yr}-payslip.pdf"
        return FileResponse(pdf_path.open("rb"), as_attachment=True, filename=filename, content_type="application/pdf")

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf_alias(self, request, pk=None):
        """Dual-route alias for download-pdf to guarantee backward compatibility for /records/{id}/pdf/ callers."""
        return self.download_pdf(request, pk=pk)

    @action(detail=True, methods=["post"], url_path="regenerate-pdf")
    def regenerate_pdf(self, request, pk=None):
        record = self.get_object()
        pdf_path = generate_payslip_pdf(record)
        return Response({"pdf_path": pdf_path, "record": self.get_serializer(record).data})







class PayrollTemplateViewSet(viewsets.ViewSet):
    # Allow any authenticated staff (makers, checkers, admins) to download blank templates
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="employee-template")
    def employee_template(self, request):
        """
        Template for the bulk employee-master import matching PayrollJobExcelUploadModal (NEW_EMPLOYEE).
        Sheet 1: Employee Roster (Data Sheet with Headers & Sample Row)
        Sheet 2: Instructions & Guidelines (Field definitions, format rules)
        """
        client_id = request.query_params.get("client_id") or request.query_params.get("client")
        client = None
        if client_id:
            try:
                client = Client.objects.filter(pk=client_id).first()
            except Exception:
                client = None

        # Core headers matching SHEET_CONFIGS[0] (Add New Employee)
        header_defs = [
            ("Employee Code *", "Unique employee code (e.g. EMP101)", 18),
            ("First Name *", "Employee given name", 18),
            ("Last Name", "Surname / Family name", 18),
            ("Employment Type", "Regular, Intern, or Consultant (default Regular)", 18),
            ("Annual CTC *", "Total annual CTC in Rupees (e.g. 600000)", 18),
            ("Effective From (YYYY-MM-DD)", "Format: YYYY-MM-DD (defaults to hire date)", 25),
            ("Hire Date (YYYY-MM-DD)", "Format: YYYY-MM-DD date of joining", 22),
            ("Email", "Official or personal email address", 25),
            ("PAN Number", "10-character PAN", 16),
            ("Department", "Department / Team", 18),
            ("Position", "Job title / Designation", 20),
            ("Payment Mode", "Bank Transfer, Cheque, or Cash (default Bank Transfer)", 20),
            ("Bank Name", "Bank Name (e.g. HDFC Bank, SBI)", 20),
            ("Bank Account Number", "Bank account number (digits only)", 22),
            ("Bank IFSC Code", "11-character IFSC code (e.g. HDFC0001234)", 18),
            ("PF Opted", "Yes or No (default Yes)", 14),
            ("UAN Number", "12-digit Universal Account Number (for PF)", 18),
            ("ESI Opted", "Yes or No (defaults to auto if gross <= 21k)", 14),
            ("ESI Number", "10-digit ESIC IP number", 18),
            ("NPS Allowance", "Optional monthly amount", 16),
            ("FBP", "Optional Flexible Benefit Plan amount", 14),
            ("VPF", "Optional Voluntary PF monthly amount", 14),
        ]

        sample_row = [
            "EMP101", "Rahul", "Sharma", "Regular", 600000, "2026-04-01", "2026-04-01",
            "rahul.sharma@example.com", "ABCDE1234F", "Engineering", "Software Engineer",
            "Bank Transfer", "HDFC Bank", "50100234567890", "HDFC0001234",
            "Yes", "100123456789", "No", "", 0, 0, 0
        ]

        # Dynamic client custom components (fixed flat components)
        if client and hasattr(client, "custom_salary_components"):
            try:
                custom_comps = list(
                    client.custom_salary_components.filter(is_active=True)
                    .exclude(code__startswith="__")
                    .order_by("display_order", "name")
                )
                fixed_flat_comps = [
                    c for c in custom_comps
                    if not getattr(c, "is_monthly_variable", False)
                    and (getattr(c, "formula", "") or "").strip().upper() != "VARIABLE"
                    and getattr(c, "calculation_type", "FLAT") == "FLAT"
                ]
                for comp in fixed_flat_comps:
                    header_defs.append((f"{comp.name} [{comp.code}]", f"Optional monthly flat {comp.component_type.lower()} in ₹", 20))
                    sample_row.append(float(comp.default_value) if comp.default_value else 0)
            except Exception:
                pass

        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = "Employee Roster"
        worksheet.views.sheetView[0].showGridLines = True

        header_fill = PatternFill(start_color="001F5B", end_color="001F5B", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        sample_fill = PatternFill(start_color="F0F4F8", end_color="F0F4F8", fill_type="solid")
        sample_font = Font(name="Calibri", size=10, italic=True, color="4A5568")
        thin_border = Border(
            left=Side(style="thin", color="CBD5E0"),
            right=Side(style="thin", color="CBD5E0"),
            top=Side(style="thin", color="CBD5E0"),
            bottom=Side(style="thin", color="CBD5E0"),
        )

        # ── ROW 1: HEADERS ──
        for col_idx, (header_text, _, width) in enumerate(header_defs, start=1):
            cell = worksheet.cell(row=1, column=col_idx, value=header_text)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = thin_border
            worksheet.column_dimensions[get_column_letter(col_idx)].width = max(width, 14)

        # ── ROW 2: SAMPLE DATA ──
        for col_idx, val in enumerate(sample_row, start=1):
            cell = worksheet.cell(row=2, column=col_idx, value=val)
            cell.fill = sample_fill
            cell.font = sample_font
            cell.border = thin_border
            is_center = isinstance(val, (int, float)) or str(val).startswith("EMP") or val in ("Yes", "No", "Regular")
            cell.alignment = Alignment(horizontal="center" if is_center else "left", vertical="center")

        worksheet.row_dimensions[1].height = 28
        worksheet.row_dimensions[2].height = 22
        worksheet.freeze_panes = "A2"

        # ── IN-CELL DATA VALIDATION DROPDOWNS ──
        try:
            from openpyxl.worksheet.datavalidation import DataValidation
            for col_idx, (header_text, _, _) in enumerate(header_defs, start=1):
                h_clean = re.sub(r"[\*\(\)]", "", header_text).strip().lower()
                col_letter = get_column_letter(col_idx)
                if "employment type" in h_clean:
                    dv = DataValidation(type="list", formula1='"Regular,Intern,Consultant"', allow_blank=True)
                    dv.prompt = "Select Employment Type:\n- Regular (Standard PF/ESI)\n- Intern (Stipend / exempt)\n- Consultant (Contractor)"
                    dv.promptTitle = "Employment Type"
                    worksheet.add_data_validation(dv)
                    dv.add(f"{col_letter}2:{col_letter}500")
                elif "payment mode" in h_clean:
                    dv = DataValidation(type="list", formula1='"Bank Transfer,Cheque,Cash"', allow_blank=True)
                    dv.prompt = "Select salary payment method:\n- Bank Transfer (Direct deposit / wire)\n- Cheque\n- Cash"
                    dv.promptTitle = "Payment Mode"
                    worksheet.add_data_validation(dv)
                    dv.add(f"{col_letter}2:{col_letter}500")
                elif h_clean in ("pf opted", "esi opted"):
                    dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True)
                    dv.prompt = "Choose Yes or No."
                    dv.promptTitle = header_text
                    worksheet.add_data_validation(dv)
                    dv.add(f"{col_letter}2:{col_letter}500")
        except Exception:
            pass

        # ── SHEET 2: INSTRUCTIONS & GUIDELINES ──
        guide_ws = workbook.create_sheet(title="Instructions & Guidelines")
        guide_ws.views.sheetView[0].showGridLines = True

        guide_header_fill = PatternFill(start_color="2D3748", end_color="2D3748", fill_type="solid")
        guide_ws.cell(row=1, column=1, value="Field Name").fill = guide_header_fill
        guide_ws.cell(row=1, column=1).font = header_font
        guide_ws.cell(row=1, column=1).alignment = Alignment(horizontal="left", vertical="center")
        guide_ws.cell(row=1, column=2, value="Requirement").fill = guide_header_fill
        guide_ws.cell(row=1, column=2).font = header_font
        guide_ws.cell(row=1, column=2).alignment = Alignment(horizontal="center", vertical="center")
        guide_ws.cell(row=1, column=3, value="Description & Formatting Rules").fill = guide_header_fill
        guide_ws.cell(row=1, column=3).font = header_font
        guide_ws.cell(row=1, column=3).alignment = Alignment(horizontal="left", vertical="center")

        guide_ws.column_dimensions["A"].width = 28
        guide_ws.column_dimensions["B"].width = 16
        guide_ws.column_dimensions["C"].width = 65

        instructions = [
            ("Employee Code", "Mandatory", "Unique employee identifier (e.g. EMP101). Existing records update in-place; new codes create employees."),
            ("First Name", "Mandatory", "Employee first name (e.g. Rahul)."),
            ("Last Name", "Optional", "Employee surname / family name (e.g. Sharma)."),
            ("Employment Type", "Optional", "Regular, Intern, or Consultant (defaults to 'Regular'). Interns are exempt from statutory PF/ESI deductions."),
            ("Annual CTC", "Mandatory*", "Annual Cost to Company in ₹. Initial salary structure (Basic, HRA, EPF, Monthly Gross) auto-computes from this value."),
            ("Effective From", "Optional", "Format: YYYY-MM-DD. Date from which salary structure applies. Defaults to Hire Date or current date if blank."),
            ("Hire Date", "Optional", "Format: YYYY-MM-DD. Official date of joining the company."),
            ("Email", "Optional", "Work or personal email address (e.g. rahul@example.com)."),
            ("PAN Number", "Optional", "10-character Permanent Account Number (e.g. ABCDE1234F)."),
            ("Department", "Optional", "Department or division name (e.g. Engineering, Sales, Accounts)."),
            ("Position", "Optional", "Designation or role title (e.g. Software Engineer, Senior Accountant)."),
            ("Payment Mode", "Optional", "Salary payment mode: 'Bank Transfer', 'Cheque', or 'Cash' (defaults to 'Bank Transfer')."),
            ("Bank Name", "Optional", "Bank institution name (e.g. HDFC Bank, State Bank of India, ICICI Bank)."),
            ("Bank Account Number", "Optional", "Bank account number for salary disbursement (digits only, e.g. 50100234567890)."),
            ("Bank IFSC Code", "Optional", "11-character Indian Financial System Code (e.g. HDFC0001234)."),
            ("PF Opted", "Optional", "'Yes' or 'No' (defaults to 'Yes'). Controls statutory EPF deduction for the auto-created structure."),
            ("UAN Number", "Optional", "12-digit Universal Account Number for Provident Fund (e.g. 100123456789)."),
            ("ESI Opted", "Optional", "'Yes' or 'No'. If blank, auto-applies if client has ESI enabled and Monthly Gross <= ₹21,000."),
            ("ESI Number", "Optional", "10-digit ESIC Insurance Person (IP) number."),
            ("NPS Allowance", "Optional", "Monthly employer NPS contribution amount in ₹ (defaults to 0)."),
            ("FBP", "Optional", "Monthly Flexible Benefit Plan allowance amount in ₹ (defaults to 0)."),
            ("VPF", "Optional", "Monthly Voluntary Provident Fund deduction amount in ₹ (defaults to 0)."),
        ]

        for idx, (field_name, req, desc) in enumerate(instructions, start=2):
            c1 = guide_ws.cell(row=idx, column=1, value=field_name)
            c2 = guide_ws.cell(row=idx, column=2, value=req)
            c3 = guide_ws.cell(row=idx, column=3, value=desc)
            c1.border = thin_border
            c2.border = thin_border
            c3.border = thin_border
            c1.font = Font(name="Calibri", size=10, bold=True)
            c2.font = Font(name="Calibri", size=10, bold=True, color="C00000" if "Mandatory" in req else "047857")
            c2.alignment = Alignment(horizontal="center", vertical="center")
            c3.font = Font(name="Calibri", size=10)
            c3.alignment = Alignment(wrap_text=True, vertical="center")

        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        response = HttpResponse(
            output.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        if client and client.name:
            client_clean = re.sub(r"[^\w\s-]", "", client.name).strip().replace(" ", "_")
            filename = f"Employee_Master_Template_{client_clean}.xlsx"
        else:
            filename = "Employee_Master_Template.xlsx"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

















class EmailLogViewSet(viewsets.ReadOnlyModelViewSet):
    # permission_classes = [IsAuthenticated, IsAdminRole]
    permission_classes = [IsAuthenticated]
    serializer_class = EmailLogSerializer

    def get_queryset(self):
        from .models import EmailLog

        queryset = EmailLog.objects.select_related(
            "payslip_record",
            "payslip_record__employee",
            "payslip_record__batch",
            "payslip_record__batch__client",
            "sent_by",
        )
        if batch_id := self.request.query_params.get("batch"):
            queryset = queryset.filter(payslip_record__batch_id=batch_id)
        if success := self.request.query_params.get("success"):
            if success.lower() in {"true", "1", "sent"}:
                queryset = queryset.filter(success=True)
            elif success.lower() in {"false", "0", "failed"}:
                queryset = queryset.filter(success=False)
        return queryset.order_by("-sent_at")

# ── Ledger adjustments (Comp-Off / Leave) ─────────────────────────────────
# New endpoints, added inside the payroll module only (see note in
# serializers.py above) so BatchReview's ledger-adjustment modal has a
# real API to call. Both are simple create+list; edits/deletes aren't
# exposed since an adjustment is meant to be an immutable ledger entry.

from .serializers import (  # noqa: E402
    CompOffAdjustmentSerializer, LeaveAdjustmentSerializer, OnHoldAdjustmentSerializer,
    SalaryAdvanceAdjustmentSerializer, SalaryAdvanceSerializer,
)


class CompOffAdjustmentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = CompOffAdjustmentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = CompOffAdjustment.objects.select_related("employee", "created_by").order_by("-created_at")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    def perform_create(self, serializer):
        adjustment = serializer.save(created_by=self.request.user)
        open_record = _current_open_record(adjustment.employee)
        if open_record is not None:
            _apply_comp_off_or_leave_adjustment(open_record, "comp_off", adjustment.amount)
            adjustment.applied_in_record = open_record
            adjustment.save(update_fields=["applied_in_record"])


class LeaveAdjustmentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = LeaveAdjustmentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = LeaveAdjustment.objects.select_related("employee", "created_by").order_by("-created_at")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    def perform_create(self, serializer):
        adjustment = serializer.save(created_by=self.request.user)
        open_record = _current_open_record(adjustment.employee)
        if open_record is not None:
            _apply_comp_off_or_leave_adjustment(open_record, "leave", adjustment.amount)
            adjustment.applied_in_record = open_record
            adjustment.save(update_fields=["applied_in_record"])


class OnHoldAdjustmentViewSet(viewsets.ModelViewSet):
    """
    Grant ("put on hold", positive amount) / deduct ("release", negative
    amount) manual corrections to an employee's on-hold balance. Same
    pending-until-next-batch pattern as CompOffAdjustment/LeaveAdjustment
    above — see OnHoldAdjustment model docstring.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = OnHoldAdjustmentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = OnHoldAdjustment.objects.select_related("employee", "created_by").order_by("-created_at")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    def perform_create(self, serializer):
        adjustment = serializer.save(created_by=self.request.user)
        open_record = _current_open_record(adjustment.employee)
        if open_record is not None:
            _apply_money_adjustment(open_record, "on_hold", adjustment.amount)
            adjustment.applied_in_record = open_record
            adjustment.save(update_fields=["applied_in_record"])


class SalaryAdvanceAdjustmentViewSet(viewsets.ModelViewSet):
    """
    One-off (non-EMI) manual grant/recovery against an employee's salary
    advance balance — positive amount to give a new advance, negative to
    record a recovery. For an EMI-style plan, use SalaryAdvanceViewSet
    instead, which creates its own disbursement adjustment automatically.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = SalaryAdvanceAdjustmentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = SalaryAdvanceAdjustment.objects.select_related(
            "employee", "created_by", "advance"
        ).order_by("-created_at")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    def perform_create(self, serializer):
        adjustment = serializer.save(created_by=self.request.user)
        open_record = _current_open_record(adjustment.employee)
        if open_record is not None:
            _apply_money_adjustment(open_record, "salary_advance", adjustment.amount)
            adjustment.applied_in_record = open_record
            adjustment.save(update_fields=["applied_in_record"])


class SalaryAdvanceViewSet(viewsets.ModelViewSet):
    """
    EMI-style salary advance plans. Creating one immediately creates its
    lump-sum disbursement SalaryAdvanceAdjustment too (see
    SalaryAdvanceSerializer.create) — the monthly recovery installments
    are generated automatically by PayrollUploadView on each subsequent
    batch, no further manual action needed.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = SalaryAdvanceSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = SalaryAdvance.objects.select_related("employee", "created_by").order_by("-created_at")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    def perform_create(self, serializer):
        advance = serializer.save(created_by=self.request.user)
        open_record = _current_open_record(advance.employee)
        if open_record is not None:
            # The plan's lump-sum disbursement (created inside
            # SalaryAdvanceSerializer.create) folds in exactly like a
            # manual one-off grant would — recovery installments still
            # wait for a future batch (_auto_generate_pending_emi_recoveries),
            # only the disbursement itself applies immediately here.
            _apply_money_adjustment(open_record, "salary_advance", advance.disbursement_adjustment.amount)
            advance.disbursement_adjustment.applied_in_record = open_record
            advance.disbursement_adjustment.save(update_fields=["applied_in_record"])


# ── Client profile ─────────────────────────────────────────────────────────

from .serializers import (  # noqa: E402
    AssignMCSerializer, ClientSerializer, EmployeeSalaryStructureAutoCalcSerializer, EmployeeSalaryStructureSerializer, SalaryComponentSerializer,
    EmployeeSerializer, EmployeeWithStructureSerializer, PayrollJobSerializer, TransitionStatusSerializer,
)


class ClientViewSet(viewsets.ModelViewSet):
    """
    One row per payroll-service client of the CA firm. Standard
    list/create/retrieve/update — this replaces the old single-row
    Company model now that payroll is multi-client (every payslip is
    issued on behalf of a Client, not the firm itself).
    """

    permission_classes = [IsAuthenticated]
    serializer_class = ClientSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action in ("destroy",):
            return [IsAuthenticated(), PayrollOption("delete_payroll_data", LEADS)()]
        return [IsAuthenticated()]
    # Every master client (clients.Client) is visible to payroll; the
    # ClientProfile row is created lazily on first save of payroll settings
    # (see ClientSerializer.update). A client added in the Client module
    # therefore shows up here immediately.
    queryset = Client.objects.all()

    def get_queryset(self):
        from clients.models import ClientGroupService
        from django.db.models import Exists, OuterRef

        has_service = Exists(
            ClientGroupService.objects.filter(
                client=OuterRef("pk"),
                is_active=True,
                sub_service__job_category__iexact="payroll",
            )
        )
        return (
            Client.objects.select_related("payroll_profile")
            .annotate(has_payroll_service=has_service)
            .order_by("name")
        )

    @action(detail=True, methods=["get"], url_path="pdf-preview")
    def pdf_preview(self, request, pk=None):
        """
        Renders ONE on-demand preview PDF for this client, using the real
        client (name/logo/address/etc.) with dummy employee/salary data —
        for the "Choose Design" modal, so a design can be judged before
        being saved. Nothing is persisted: the Employee/PayrollBatch/
        PayslipRecord below are built in memory and never saved.
        """
        client = self.get_object()
        try:
            _profile = getattr(client, "payroll_profile", None)
            _design = getattr(_profile, "pdf_design", 1) if _profile else 1
            design = int(request.query_params.get("design", _design))
        except (TypeError, ValueError):
            raise PermissionDenied("design must be an integer 1-8")
        module = DESIGN_MODULES.get(design, DESIGN_MODULES[1])

        today = date.today()
        dummy_employee = Employee(
            id=0,
            client=client,
            employee_code="EMP001",
            first_name="John",
            last_name="Doe",
            email="john.doe@example.com",
            pan_number="ABCDE1234F",
            department="Operations",
            position="Associate",
            hire_date=date(today.year, 1, 1),
            ctc=Decimal("1200000.00"),
            status=Employee.STATUS_ACTIVE,
        )
        dummy_batch = PayrollBatch(
            id=0,
            client=client,
            month=today.month,
            year=today.year,
            uploaded_by=request.user,
        )
        dummy_record = PayslipRecord(
            id=0,
            batch=dummy_batch,
            employee=dummy_employee,
            days_in_month=30,
            actual_working_days=30,
            paid_leave_days=Decimal("0"),
            lop_days=Decimal("0"),
            basic_da=Decimal("50000.00"),
            hra=Decimal("20000.00"),
            special_allowance=Decimal("15000.00"),
            gross_salary=Decimal("85000.00"),
            earned_salary=Decimal("85000.00"),
            epf=Decimal("1800.00"),
            professional_tax=Decimal("200.00"),
            tds=Decimal("2000.00"),
            total_deductions=Decimal("4000.00"),
            net_salary=Decimal("81000.00"),
        )

        # CTC on the payslip is NOT read from Employee.ctc — every design's
        # _structure() helper looks it up via a real DB query against
        # EmployeeSalaryStructure.objects.filter(employee=record.employee,
        # ...). dummy_employee has no pk, so that query would always return
        # no match and CTC would render as "—". Stub the lookup's queryset
        # chain (.filter().order_by().first()) to hand back this in-memory
        # structure instead, scoped to just this render call.
        dummy_structure = EmployeeSalaryStructure(
            id=0,
            employee=dummy_employee,
            effective_from=date(today.year, 1, 1),
            ctc_annual=dummy_employee.ctc,
            pf_opted=True,
        )

        class _FakeSalaryStructureQuerySet:
            def order_by(self, *args, **kwargs):
                return self

            def first(self):
                return dummy_structure

        pdf_bytes = self._render_preview_pdf(module, dummy_record, _FakeSalaryStructureQuerySet())
        return HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=preview.pdf"},
        )

    @staticmethod
    def _render_preview_pdf(module, dummy_record, fake_queryset):
        with patch.object(EmployeeSalaryStructure.objects, "filter", return_value=fake_queryset):
            return module._build_pdf_bytes(dummy_record, encryption=None)

    @action(detail=True, methods=["post"], url_path="reapply-salary-policy")
    def reapply_salary_policy(self, request, pk=None):
        """
        Re-applies the client's current Salary Structuring Policy to all active
        employees with contracted CTC. Creates a new version of EmployeeSalaryStructure
        effective from the first of the current month, preserving employee custom components.
        """
        client = self.get_object()
        client.refresh_from_db()
        today = timezone.localdate()
        raw_eff = (getattr(request, "data", {}).get("effective_from") or "").strip()
        if raw_eff:
            try:
                effective_from = date.fromisoformat(raw_eff)
            except (ValueError, TypeError):
                effective_from = date(today.year, today.month, 1)
        else:
            effective_from = date(today.year, today.month, 1)

        active_employees = Employee.objects.filter(client=client, status=Employee.STATUS_ACTIVE)
        total_active = active_employees.count()
        employees = active_employees.exclude(ctc__isnull=True).exclude(ctc__lte=0)
        skipped_count = total_active - employees.count()
        recalculated_count = 0
        updated_structure_ids = []

        dry_run = str(request.query_params.get("dry_run", "")).lower() in ("true", "1") or bool(getattr(request, "data", {}).get("dry_run", False))
        if dry_run:
            return Response({
                "success": True,
                "dry_run": True,
                "recalculated_count": employees.count(),
                "skipped_count": skipped_count,
                "total_active": total_active,
                "effective_from": effective_from.isoformat(),
                "message": f"Dry-run preview: {employees.count()} employee(s) would be recalculated effective from {effective_from.strftime('%d %b %Y')}, {skipped_count} skipped.",
            })

        # Resolve currently active catalog components for this client (case-insensitive)
        from .models import SalaryComponent, RESERVED_METADATA_KEYS
        active_catalog_codes = {
            c.strip().upper() for c in SalaryComponent.objects.filter(
                models.Q(client=client) | models.Q(client__isnull=True),
                is_active=True,
            ).exclude(code__startswith="__").values_list("code", flat=True)
        }

        esi_opted_count = 0
        pf_opted_count = 0
        uan_retained_count = 0

        with transaction.atomic():
            for emp in employees:
                latest = get_latest_salary_structure(emp)
                pf_opted = latest.pf_opted if latest else True
                esi_opted = None
                if latest:
                    if isinstance(latest.custom_components, dict) and "esi_opted" in latest.custom_components:
                        esi_opted = bool(latest.custom_components["esi_opted"])
                    else:
                        esi_opted = bool(getattr(latest, "esi_opted", False))

                nps_allowance = latest.nps_allowance if latest else Decimal("0")
                fbp = latest.fbp if latest else Decimal("0")
                vpf = latest.vpf if latest else Decimal("0")
                raw_custom = dict(latest.custom_components or {}) if latest else {}

                # Purge any components deleted from client catalog while preserving metadata
                custom_components = {}
                for k, v in raw_custom.items():
                    k_str = str(k).strip()
                    k_lower = k_str.lower()
                    if k_lower in RESERVED_METADATA_KEYS or k_str.startswith("__"):
                        custom_components[k_str] = v
                    elif k_str.upper() in active_catalog_codes or k_str in active_catalog_codes:
                        custom_components[k_str] = v

                # Ensure esi_opted is retained in custom_components dict as well
                if esi_opted is not None:
                    custom_components["esi_opted"] = esi_opted

                # Carry forward esi_number and uan_number from Employee model if missing in structure JSON
                if ("esi_number" not in custom_components or not custom_components["esi_number"]) and getattr(emp, "esi_number", None):
                    custom_components["esi_number"] = emp.esi_number
                if ("uan_number" not in custom_components or not custom_components["uan_number"]) and getattr(emp, "uan_number", None):
                    custom_components["uan_number"] = emp.uan_number

                # Option 1: Carry forward employment_type and is_intern from Employee model if missing
                if ("employment_type" not in custom_components or not custom_components["employment_type"]) and getattr(emp, "employment_type", None):
                    custom_components["employment_type"] = emp.employment_type
                if "is_intern" not in custom_components and getattr(emp, "is_intern", None) is not None:
                    custom_components["is_intern"] = bool(emp.is_intern)

                if custom_components.get("uan_number"):
                    uan_retained_count += 1

                struct_dict = EmployeeSalaryStructure.build_from_ctc(
                    emp.ctc,
                    pf_opted=pf_opted,
                    esi_opted=esi_opted,
                    current_lta=Decimal("0"),
                    reapply_policy=True,
                    nps_allowance=nps_allowance,
                    fbp=fbp,
                    vpf=vpf,
                    custom_components=custom_components,
                    client=client,
                    employee=emp,
                )
                struct_dict.pop("min_wage_warning", None)
                struct_dict.pop("shortfall", None)
                struct_dict.pop("employer_esi_in_ctc", None)
                struct_dict.pop("employer_esi", None)
                struct_dict.pop("carve_out_fbp_in_ctc", None)
                struct_dict.pop("carve_out_custom_in_ctc", None)

                new_struct = EmployeeSalaryStructure.objects.create(
                    employee=emp,
                    effective_from=effective_from,
                    created_by=request.user,
                    change_reason=f"Policy re-application (Effective {effective_from.strftime('%d %b %Y')})",
                    **struct_dict,
                )
                updated_structure_ids.append(new_struct.id)
                recalculated_count += 1
                if new_struct.esi_opted:
                    esi_opted_count += 1
                if new_struct.pf_opted:
                    pf_opted_count += 1

                # Option 1: Retroactively refresh active/draft PayslipRecord instances for this employee
                # if an unfinalized batch exists for this client.
                open_records = PayslipRecord.objects.filter(
                    employee=emp,
                ).filter(
                    models.Q(batch__status__in=["UPLOADED", "REVIEWED", "DRAFT", "UNDER_REVIEW", "REWORK"]) |
                    models.Q(batch__jobs__status__in=["To Do", "In Progress", "Under Review", "Rework"])
                ).select_related("batch").distinct()
                open_records_list = list(open_records)
                for rec in open_records_list:
                    _recompute_payslip_record_from_structure(rec, new_struct, commit=False)
                if open_records_list:
                    PayslipRecord.objects.bulk_update(open_records_list, fields=PAYSLIP_ALL_COMPUTED_FIELDS, batch_size=100)

        return Response({
            "success": True,
            "recalculated_count": recalculated_count,
            "skipped_count": skipped_count,
            "esi_opted_count": esi_opted_count,
            "pf_opted_count": pf_opted_count,
            "uan_retained_count": uan_retained_count,
            "effective_from": effective_from.isoformat(),
            "updated_structure_ids": updated_structure_ids,
            "message": f"Successfully re-applied salary policy to {recalculated_count} active employees effective from {effective_from.strftime('%d %b %Y')} ({esi_opted_count} with ESI, {pf_opted_count} with PF).",
        })


# ── Salary structure ───────────────────────────────────────────────────────

class SalaryComponentViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for configurable salary components (earnings/deductions).
    Scoped by client (or global if client is null).
    """
    serializer_class = SalaryComponentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        client_id = self.request.query_params.get("client_id") or self.request.query_params.get("client")
        qs = SalaryComponent.objects.exclude(code__startswith="__")
        if client_id:
            from django.db.models import Q
            qs = qs.filter(Q(client_id=client_id) | Q(client__isnull=True))
        return qs.order_by("display_order", "name")

    def perform_create(self, serializer):
        serializer.save()


class EmployeeSalaryStructureViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = EmployeeSalaryStructureSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("destroy",):
            return [IsAuthenticated(), PayrollOption("delete_payroll_data", LEADS)()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = EmployeeSalaryStructure.objects.select_related("employee", "created_by")
        if employee_id := self.request.query_params.get("employee"):
            queryset = queryset.filter(employee_id=employee_id)
        return queryset.order_by("-effective_from", "-created_at")

    def perform_create(self, serializer):
        struct = serializer.save(created_by=self.request.user)
        # Retroactively refresh active/draft PayslipRecord instances for this employee
        # if an unfinalized batch exists for this client, ensuring new FBP/structure is immediately live.
        try:
            open_records = PayslipRecord.objects.filter(
                employee=struct.employee
            ).filter(
                models.Q(batch__status__in=["UPLOADED", "REVIEWED", "DRAFT", "UNDER_REVIEW", "REWORK"]) |
                models.Q(batch__jobs__status__in=["To Do", "In Progress", "Under Review", "Rework"])
            ).select_related("batch").distinct()
            open_records_list = list(open_records)
            for rec in open_records_list:
                _recompute_payslip_record_from_structure(rec, struct, commit=False)
                if isinstance(rec.custom_components, (dict, list)):
                    rec.custom_components = sanitize_for_json(rec.custom_components)
            if open_records_list:
                PayslipRecord.objects.bulk_update(open_records_list, fields=PAYSLIP_ALL_COMPUTED_FIELDS, batch_size=100)
        except Exception:
            pass

    @action(detail=False, methods=["post"], url_path="auto-calc")
    def auto_calc(self, request):
        """
        Given { ctc_annual, pf_opted }, returns the derived structure
        breakdown (Basic/HRA/Special Allowance/etc.) using the firm's
        standard CTC formula, WITHOUT saving anything — the frontend
        shows this as an editable preview before the user confirms.
        """
        body = EmployeeSalaryStructureAutoCalcSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        breakdown = EmployeeSalaryStructure.build_from_ctc(
            body.validated_data["ctc_annual"],
            body.validated_data["pf_opted"],
            body.validated_data["current_lta"],
            nps_allowance=body.validated_data.get("nps_allowance", Decimal("0")),
            fbp=body.validated_data.get("fbp", Decimal("0")),
            vpf=body.validated_data.get("vpf", Decimal("0")),
            policy=body.validated_data.get("policy"),
            custom_components=body.validated_data.get("custom_components"),
        )
        return Response({k: str(v) if isinstance(v, Decimal) else v for k, v in breakdown.items()})

    @action(detail=False, methods=["get"], url_path="employees")
    def list_employees(self, request):
        """
        Payroll's own "Employees" list: every payroll.Employee row,
        optionally filtered to one client, alongside their latest salary
        structure, if any. Powers the payroll → Employees screen.
        """
        search = request.query_params.get("search", "").strip()
        qs = Employee.objects.select_related("client").prefetch_related("salary_structures")
        if client_id := request.query_params.get("client"):
            qs = qs.filter(client_id=client_id)
        if search:
            qs = qs.filter(
                models.Q(first_name__icontains=search)
                | models.Q(last_name__icontains=search)
                | models.Q(employee_code__icontains=search)
            )

        rows = []
        for employee in qs.order_by("first_name", "last_name"):
            structure = get_latest_salary_structure(employee)
            rows.append(
                {
                    "id": employee.id,
                    "employee_code": employee.employee_code,
                    "first_name": employee.first_name,
                    "last_name": employee.last_name,
                    "full_name": employee.full_name,
                    "email": employee.email,
                    "pan_number": employee.pan_number,
                    "esi_number": getattr(employee, "esi_number", ""),
                    "uan_number": getattr(employee, "uan_number", ""),
                    "department": employee.department,
                    "position": employee.position,
                    "employment_type": employee.employment_type,
                    "is_intern": employee.is_intern,
                    "hire_date": employee.hire_date,
                    "status": employee.status,
                    "ctc": employee.ctc,
                    "client": employee.client_id,
                    "client_name": employee.client.name if employee.client else "",
                    "salary_structure": structure,
                }
            )

        serializer = EmployeeWithStructureSerializer(rows, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path=r"employees/(?P<employee_id>[^/.]+)")
    def employee_detail(self, request, employee_id=None):
        """Single-employee version of list_employees(), for a detail page."""
        try:
            employee = Employee.objects.select_related("client").get(pk=employee_id)
        except Employee.DoesNotExist:
            raise Http404("Employee not found")

        structure = get_latest_salary_structure(employee)
        row = {
            "id": employee.id,
            "employee_code": employee.employee_code,
            "first_name": employee.first_name,
            "last_name": employee.last_name,
            "full_name": employee.full_name,
            "email": employee.email,
            "pan_number": employee.pan_number,
            "esi_number": getattr(employee, "esi_number", ""),
            "uan_number": getattr(employee, "uan_number", ""),
            "department": employee.department,
            "position": employee.position,
            "employment_type": employee.employment_type,
            "is_intern": employee.is_intern,
            "hire_date": employee.hire_date,
            "status": employee.status,
            "ctc": employee.ctc,
            "client": employee.client_id,
            "client_name": employee.client.name if employee.client else "",
            "salary_structure": structure,
        }
        return Response(EmployeeWithStructureSerializer(row).data)


# ── Employee master (payroll-local Employee, per client) ──────────────────

class EmployeeViewSet(viewsets.ModelViewSet):
    """
    CRUD for the payroll-local Employee model, plus the bulk Excel import
    action used to populate/update it per client (see
    excel_parser.parse_employee_master_excel). This is deliberately
    separate from the monthly payroll batch upload — this is the
    "employee master" for a client, updated whenever HR-side details
    change; the monthly batch upload only reads against employees already
    on file here.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = EmployeeSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAuthenticated(), PayrollOption("delete_payroll_data", LEADS)()]
        if self.action == "import_excel":
            return [IsAuthenticated(), PayrollOption("import_payroll_employees", LEADS)()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = Employee.objects.select_related("client").order_by("employee_code")
        if client_id := (self.request.query_params.get("client") or self.request.query_params.get("client_id")):
            queryset = queryset.filter(client_id=client_id)
        return queryset

    @action(detail=False, methods=["post"], url_path="import")
    def import_excel(self, request):
        """
        Bulk create/update Employee rows for one client from an uploaded
        Excel file. Body: client_id (or client), file. Rows are matched
        to existing employees by employee_code WITHIN that client —
        create if new, update if the code already exists for this
        client. Bad rows are rejected with a row-level error, never
        silently skipped (same policy as the monthly batch upload).
        """
        from .excel_parser import EmployeeImportError, parse_employee_master_excel

        client_id = request.data.get("client_id") or request.data.get("client")
        file = request.FILES.get("file")
        if not client_id or not file:
            return Response({"detail": "client_id and file are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            client = Client.objects.get(pk=client_id)
        except (Client.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "client_id does not match a known client."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            created_count, updated_count, warnings = parse_employee_master_excel(
                file, client, created_by=request.user
            )
        except EmployeeImportError as exc:
            return Response(
                {
                    "detail": f"{len(exc.errors)} rows have errors",
                    "errors": exc.errors,
                    "total_errors": len(exc.errors),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response(
            {"created": created_count, "updated": updated_count, "warnings": warnings},
            status=status.HTTP_200_OK,
        )


def get_pending_approver_job_ids(base_qs=None):
    """
    Finds IDs of PayrollJobs currently awaiting Admin / Founder sign-off:
    1. Status is 'Under Review'.
    2. Batch was forwarded to Approver via SENT_TO_APPROVER.
    3. Has not yet been decided via APPROVER_APPROVED, APPROVER_SKIPPED, or APPROVER_REJECTED.
    """
    if base_qs is None:
        base_qs = PayrollJob.objects.all()
    candidate_jobs = base_qs.filter(
        status=PayrollJob.STATUS_UNDER_REVIEW,
        events__event_type=PayrollJobEvent.EVENT_SENT_TO_APPROVER,
    ).prefetch_related("events").distinct()

    pending_ids = []
    for job in candidate_jobs:
        latest_sub = job.events.filter(event_type=PayrollJobEvent.EVENT_SUBMITTED).order_by("-id").first()
        ev_qs = job.events.filter(
            event_type__in=[
                PayrollJobEvent.EVENT_SENT_TO_APPROVER,
                PayrollJobEvent.EVENT_APPROVER_APPROVED,
                PayrollJobEvent.EVENT_APPROVER_SKIPPED,
                PayrollJobEvent.EVENT_APPROVER_REJECTED,
            ]
        )
        if latest_sub:
            ev_qs = ev_qs.filter(id__gt=latest_sub.id)
        latest_ev = ev_qs.order_by("-id").first()
        if latest_ev and latest_ev.event_type == PayrollJobEvent.EVENT_SENT_TO_APPROVER:
            pending_ids.append(job.id)
    return pending_ids


# ── Payroll Job ViewSet (Downstream jobs from STT tasks) ──────────────────

class PayrollJobViewSet(viewsets.ModelViewSet):
    """
    CRUD and actions for PayrollJob (downstream jobs provisioned from STT tasks).
    Supports:
    - filtering by status, client, my_tasks (where user is maker or checker)
    - assign_mc action: assigns makers and checkers (max 2 each)
    - stats action: returns aggregated stats for the 8 metric tiles on the Service Dashboard
    """
    content_negotiation_class = SafeContentNegotiator
    permission_classes = [IsAuthenticated]
    serializer_class = PayrollJobSerializer
    queryset = PayrollJob.objects.select_related("client", "sub_service", "batch", "task").prefetch_related("makers", "checkers").order_by("-created_at")

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        is_admin = payroll_can(user, "view_all_payroll_jobs", LEADS)
        is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)

        # Non-admin staff (employees, article clerks, interns) can ONLY see jobs where they are
        # explicitly assigned as a Maker or Checker. Unassigned jobs are strictly restricted
        # to leadership (Admin, Founder, HR, Manager, Team Lead).
        if not is_admin:
            qs = qs.filter(models.Q(makers=user) | models.Q(checkers=user)).distinct()

        client_id = self.request.query_params.get("client")
        if client_id:
            qs = qs.filter(client_id=client_id)

        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status__iexact=status_param)

        my_tasks = self.request.query_params.get("my_tasks")
        if my_tasks in ("true", "1"):
            maker_pending = models.Q(makers=user, status__in=["To Do", "In Progress", "Client Docs Pending", "Rework"])
            checker_pending = models.Q(checkers=user, status__in=["Under Review", "Approved"])
            try:
                from payroll.models import PortalSubmission
                submitted_subs = list(
                    PortalSubmission.objects.filter(
                        status=PortalSubmission.STATUS_SUBMITTED
                    ).values_list("client_id", "month", "year")
                )
                if submitted_subs:
                    portal_q = models.Q()
                    for cid, m, y in submitted_subs:
                        portal_q |= models.Q(client_id=cid, month=m, year=y)
                    checker_pending |= (models.Q(checkers=user) & portal_q)
            except Exception:
                pass
            query = maker_pending | checker_pending
            if is_admin_or_founder:
                approver_ids = get_pending_approver_job_ids(qs)
                if approver_ids:
                    query = query | models.Q(id__in=approver_ids)
            return qs.filter(query).distinct()

        my_only = self.request.query_params.get("my_only")
        if my_only in ("true", "1"):
            return qs.filter(models.Q(makers=user) | models.Q(checkers=user) | models.Q(created_by=user)).distinct()

        return qs

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        if not instance.batch and instance.client and instance.month and instance.year:
            found_batch = PayrollBatch.objects.filter(
                client=instance.client,
                month=instance.month,
                year=instance.year,
            ).first()
            if found_batch:
                instance.batch = found_batch
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        user = request.user
        is_admin = payroll_can(user, "view_all_payroll_jobs", LEADS + ("hr",))
        is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)
        all_jobs = PayrollJob.objects.all() if is_admin else PayrollJob.objects.filter(
            models.Q(makers=user) | models.Q(checkers=user)
        ).distinct()
        now_date = timezone.now().date()

        total = all_jobs.count()
        active = all_jobs.filter(status__in=["In Progress", "Under Review", "Approved", "Client Docs Pending", "Rework"]).count()
        overdue = all_jobs.filter(due_date__lt=now_date).exclude(status="Done").count()

        maker_pending = models.Q(makers=user, status__in=["To Do", "In Progress", "Client Docs Pending", "Rework"])
        checker_pending = models.Q(checkers=user, status__in=["Under Review", "Approved"])
        try:
            from payroll.models import PortalSubmission
            submitted_subs = list(
                PortalSubmission.objects.filter(
                    status=PortalSubmission.STATUS_SUBMITTED
                ).values_list("client_id", "month", "year")
            )
            if submitted_subs:
                portal_q = models.Q()
                for cid, m, y in submitted_subs:
                    portal_q |= models.Q(client_id=cid, month=m, year=y)
                checker_pending |= (models.Q(checkers=user) & portal_q)
        except Exception:
            pass
        query = maker_pending | checker_pending
        if is_admin_or_founder:
            approver_ids = get_pending_approver_job_ids(all_jobs)
            if approver_ids:
                query = query | models.Q(id__in=approver_ids)
        my_pending = all_jobs.filter(query).distinct().count()

        todo = all_jobs.filter(status="To Do").count()
        in_prog = all_jobs.filter(status="In Progress").count()
        docs_pending = all_jobs.filter(status="Client Docs Pending").count()
        under_review = all_jobs.filter(status="Under Review").count()
        approved_count = all_jobs.filter(status="Approved").count()
        rework_count = all_jobs.filter(status="Rework").count()
        done = all_jobs.filter(status="Done").count()

        return Response({
            "total_jobs": total,
            "active_jobs": active,
            "overdue_jobs": overdue,
            "my_pending_tasks": my_pending,
            "todo": todo,
            "in_progress": in_prog,
            "client_docs_pending": docs_pending,
            "under_review": under_review,
            "approved": approved_count,
            "rework": rework_count,
            "done": done,
        })

    @action(detail=False, methods=["get"], url_path="assignable-users")
    def assignable_users(self, request):
        """
        Returns all active internal users for assigning as Makers/Checkers on payroll jobs.
        Permits access to all authenticated staff (including Team Leads, Managers, HR, Admins).
        """
        User = get_user_model()
        users = User.objects.filter(is_active=True).order_by("first_name", "last_name", "email")
        data = []
        for u in users:
            emp = getattr(u, "employee", None)
            emp_obj = emp.first() if hasattr(emp, "first") else emp
            full_name = ""
            if emp_obj:
                full_name = f"{getattr(emp_obj, 'first_name', '')} {getattr(emp_obj, 'last_name', '')}".strip()
            if not full_name:
                full_name = getattr(u, "full_name", "") or f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
            data.append({
                "id": u.id,
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "full_name": full_name,
                "role": getattr(u, "role", "") or "",
                "email": u.email,
                "is_active": u.is_active,
            })
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="assign-mc")
    def assign_mc(self, request, pk=None):
        user = request.user
        is_leadership = payroll_can(user, "assign_maker_checker_payroll", LEADS)
        if not is_leadership:
            return Response(
                {"error": "Permission denied. You don't have Assign Maker/Checker (Payroll) — Permissions page → Direct Tax → Payroll."},
                status=status.HTTP_403_FORBIDDEN,
            )

        job = self.get_object()
        ser = AssignMCSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        maker_ids = ser.validated_data.get("maker_ids", [])
        checker_ids = ser.validated_data.get("checker_ids", [])

        User = get_user_model()
        makers = User.objects.filter(id__in=maker_ids)
        checkers = User.objects.filter(id__in=checker_ids)

        job.makers.set(makers)
        job.checkers.set(checkers)
        job.assigned_by = request.user
        job.assigned_at = timezone.now()
        job.save()

        # Log event in timeline
        user_name = getattr(request.user, "full_name", "") or request.user.get_username()
        maker_names = ", ".join([getattr(u, "full_name", "") or u.get_username() for u in makers]) or "None"
        checker_names = ", ".join([getattr(u, "full_name", "") or u.get_username() for u in checkers]) or "None"
        PayrollJobEvent.objects.create(
            job=job,
            event_type=PayrollJobEvent.EVENT_ASSIGNED,
            performed_by=request.user,
            performed_by_name=user_name,
            notes=f"Assigned Makers: {maker_names} | Checkers: {checker_names}",
        )

        return Response(PayrollJobSerializer(job).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="transition-status")
    def transition_status(self, request, pk=None):
        """
        Maker-Checker status transitions:
        - start_progress: To Do / Rework -> In Progress (Maker or Admin)
        - submit_for_review: To Do / In Progress / Rework -> Under Review (Maker or Admin)
        - rework: Under Review -> Rework (Checker or Admin, notes required)
        - approve: Under Review -> Done (Checker or Admin)
        """
        job = self.get_object()
        ser = TransitionStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        act = ser.validated_data["action"]
        notes = ser.validated_data.get("notes", "").strip()
        user = request.user
        is_maker = job.makers.filter(id=user.id).exists()
        is_checker = job.checkers.filter(id=user.id).exists()
        user_name = getattr(user, "full_name", "") or user.get_username()

        if act == "start_progress":
            if not is_maker:
                return Response(
                    {"error": "Permission denied. Only assigned Makers can start work on this job. Leadership must assign themselves as Maker first."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            job.status = PayrollJob.STATUS_IN_PROGRESS
            job.save()
            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_STARTED,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes or "Started work on payroll preparation.",
            )

        elif act == "submit_for_review":
            if not is_maker:
                return Response(
                    {"error": "Permission denied. Only assigned Makers can submit this payroll for review. Leadership must assign themselves as Maker first."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            job.status = PayrollJob.STATUS_UNDER_REVIEW
            job.rework_notes = ""
            job.submitted_by = user
            job.submitted_at = timezone.now()
            job.save()

            zero_gross_ack = request.data.get("zero_gross_acknowledged")
            event_notes = notes or "Submitted payroll computation for Checker review."
            if zero_gross_ack:
                event_notes = f"{event_notes} [ZERO_GROSS_ACKNOWLEDGED: {zero_gross_ack}]"

            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_SUBMITTED,
                performed_by=user,
                performed_by_name=user_name,
                notes=event_notes,
            )

        elif act in ("rework", "return_to_maker"):
            if not is_checker:
                return Response(
                    {"error": "Permission denied. Only assigned Checkers can return this payroll for adjustments. Leadership must assign themselves as Checker first."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not notes:
                return Response({"error": "Review notes / feedback are required when returning for adjustments."}, status=status.HTTP_400_BAD_REQUEST)
            job.status = PayrollJob.STATUS_REWORK
            job.rework_notes = notes
            job.reviewed_by = user
            job.reviewed_at = timezone.now()
            job.save()
            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_REWORK,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes,
            )

        elif act == "approve":
            if not is_checker:
                return Response(
                    {"error": "Permission denied. Only assigned Checkers can approve and finalize this payroll. Leadership must assign themselves as Checker first."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            job.status = PayrollJob.STATUS_DONE
            job.rework_notes = ""
            job.reviewed_by = user
            job.reviewed_at = timezone.now()
            job.save()

            if job.batch:
                job.batch.status = PayrollBatch.STATUS_REVIEWED
                job.batch.reviewed_by = user
                job.batch.reviewed_at = timezone.now()
                job.batch.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])

            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_APPROVED,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes or "Approved and finalized monthly payroll.",
            )

        elif act == "send_to_approver":
            is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)
            if not is_checker and not is_admin_or_founder:
                return Response(
                    {"error": "Permission denied. Only assigned Checkers or Leadership can send batch to Approver."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_SENT_TO_APPROVER,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes or "Batch forwarded to Admin / Founder for leadership sign-off.",
            )

        elif act == "approver_approve":
            is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)
            if not is_admin_or_founder:
                return Response(
                    {"error": "Permission denied. Only Admins and Founders can approve this batch at the leadership level."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            job.status = PayrollJob.STATUS_APPROVED
            job.save(update_fields=["status", "updated_at"])

            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_APPROVER_APPROVED,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes or "Batch approved by Leadership (Admin / Founder). Finalization unlocked.",
            )

        elif act == "approver_skip":
            is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)
            if not is_checker and not is_admin_or_founder:
                return Response(
                    {"error": "Permission denied. Only assigned Checkers or Leadership can choose direct finalization."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            job.status = PayrollJob.STATUS_APPROVED
            job.save(update_fields=["status", "updated_at"])

            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_APPROVER_SKIPPED,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes or "Leadership approval skipped. Direct finalization selected.",
            )

        elif act == "approver_reject":
            is_admin_or_founder = payroll_can(user, "approve_payroll", ADMINS)
            if not is_admin_or_founder:
                return Response(
                    {"error": "Permission denied. Only Admins and Founders can reject a batch at the leadership level."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not notes:
                return Response(
                    {"error": "Rejection remarks / feedback are required when returning a batch to the Maker."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            job.status = PayrollJob.STATUS_REWORK
            job.rework_notes = f"[Leadership Rejection by {user_name}]: {notes}"
            job.reviewed_by = user
            job.reviewed_at = timezone.now()
            job.save()

            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_APPROVER_REJECTED,
                performed_by=user,
                performed_by_name=user_name,
                notes=notes,
            )

        return Response(PayrollJobSerializer(job).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reopen")
    def reopen(self, request, pk=None):
        """
        Post-finalization reopening / revoke:
        Can ONLY be performed by Admin or Founder when job is Done.
        Unseals the batch and returns the job to In Progress so amendments can be made.
        """
        job = self.get_object()
        user = request.user
        is_admin_or_founder = payroll_can(user, "reopen_payroll", ADMINS)
        if not is_admin_or_founder:
            return Response(
                {"error": "Permission denied. You don't have Reopen a Done payroll job — Permissions page → Direct Tax → Payroll."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if job.status != PayrollJob.STATUS_DONE:
            return Response(
                {"error": "Only finalized (Done) payroll jobs can be reopened."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        notes = (request.data.get("notes") or request.data.get("reason") or "").strip()
        if not notes:
            return Response(
                {"error": "A reason / justification note is required to reopen a finalized payroll."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            job.status = PayrollJob.STATUS_REWORK
            job.rework_notes = notes
            job.save(update_fields=["status", "rework_notes", "updated_at"])

            if job.batch:
                job.batch.status = "DRAFT"
                job.batch.save(update_fields=["status", "updated_at"])

            user_name = getattr(user, "full_name", "") or user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="JOB_REOPENED",
                performed_by=user,
                performed_by_name=user_name,
                notes=f"Reopened from Done by {user_name} (Admin/Founder): {notes}",
            )

        return Response(PayrollJobSerializer(job).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="apply-inputs")
    def apply_inputs(self, request, pk=None):
        job = self.get_object()
        is_checker = job.checkers.filter(id=request.user.id).exists()
        if not is_checker:
            return Response(
                {"error": "Permission denied. Only assigned Checkers can approve and apply monthly inputs. Leadership must assign themselves as Checker first."},
                status=status.HTTP_403_FORBIDDEN,
            )

        sub = PortalSubmission.objects.filter(client=job.client, month=job.month, year=job.year).first()
        if not sub:
            return Response({"error": "No monthly portal submission found for this client and period."}, status=status.HTTP_404_NOT_FOUND)

        summary = apply_submission(sub, approved_by=request.user, allow_unsubmitted=True)
        found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
        if found_batch:
            job.batch = found_batch
            job.save(update_fields=["batch"])

        applied_num = summary.get("applied", summary.get("applied_count", 0))
        user_name = getattr(request.user, "full_name", "") or request.user.get_username()
        PayrollJobEvent.objects.create(
            job=job,
            event_type="INPUTS_APPLIED",
            performed_by=request.user,
            performed_by_name=user_name,
            notes=f"Approved and applied {applied_num} monthly input items to batch.",
        )

        summary_payload = {
            **summary,
            "applied": applied_num,
            "applied_count": applied_num,
            "failed_count": summary.get("failed", 0),
            "skipped_count": summary.get("skipped", 0),
        }

        return Response({
            "job": PayrollJobSerializer(job).data,
            "summary": summary_payload,
            "message": f"Successfully applied {applied_num} monthly input(s) and refreshed batch calculation."
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="skip-item")
    def skip_item(self, request, pk=None):
        """
        Checker/Maker item-level decision: Exclude/Skip or Re-include an individual staged submission item.
        - action: 'skip' | 'unskip'
        - item_id: int (PortalSubmissionItem.id)
        - reason: str (optional)
        """
        job = self.get_object()
        item_id = request.data.get("item_id")
        action_type = request.data.get("action", "skip").lower()
        reason = (request.data.get("reason") or "").strip()

        if not item_id:
            return Response({"error": "item_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Ensure item belongs to this job's client and period
        sub = PortalSubmission.objects.filter(client=job.client, month=job.month, year=job.year).first()
        if not sub:
            return Response({"error": "No monthly portal submission found for this job."}, status=status.HTTP_404_NOT_FOUND)

        item = PortalSubmissionItem.objects.filter(submission=sub, id=item_id).first()
        if not item:
            return Response({"error": f"Submission item #{item_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        user_name = getattr(request.user, "full_name", "") or request.user.get_username()

        if action_type == "skip":
            if item.status == PortalSubmissionItem.STATUS_APPLIED:
                return Response({"error": "This change has already been applied into the batch and cannot be skipped directly. Revert the adjustment first."}, status=status.HTTP_400_BAD_REQUEST)
            item.status = PortalSubmissionItem.STATUS_SKIPPED
            item.error = reason or "Excluded from batch calculation by Checker"
            item.save(update_fields=["status", "error", "updated_at"])

            # Check if any items remain pending in this submission
            has_pending = sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists()
            reopened = False
            if not has_pending and sub.status == PortalSubmission.STATUS_SUBMITTED:
                sub.status = PortalSubmission.STATUS_DRAFT
                sub.save(update_fields=["status", "updated_at"])
                reopened = True
                record_event(
                    sub,
                    PortalSubmissionEvent.TYPE_APPROVED,
                    item_count=0,
                    actor_staff=request.user,
                    note=f"All staged items reviewed (item #{item.id} excluded). Reopened to DRAFT for next round.",
                )

            PayrollJobEvent.objects.create(
                job=job,
                event_type="ITEM_EXCLUDED",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Excluded item #{item.id} ({item.item_type}) from batch. Reason: {item.error}",
            )
            msg = f"Item #{item.id} marked as Excluded / Don't Apply." + (" All items reviewed; month reopened for client." if reopened else "")

        elif action_type == "unskip":
            if item.status == PortalSubmissionItem.STATUS_SKIPPED:
                item.status = PortalSubmissionItem.STATUS_PENDING
                item.error = ""
                item.save(update_fields=["status", "error", "updated_at"])

                PayrollJobEvent.objects.create(
                    job=job,
                    event_type="ITEM_RESTORED",
                    performed_by=request.user,
                    performed_by_name=user_name,
                    notes=f"Re-included item #{item.id} ({item.item_type}) into pending queue.",
                )
                msg = f"Item #{item.id} restored to Pending queue."
            else:
                msg = f"Item #{item.id} was not in Skipped state."
        else:
            return Response({"error": f"Invalid action '{action_type}'. Use 'skip' or 'unskip'."}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "message": msg,
            "item_id": item.id,
            "status": item.status,
            "error": item.error,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="revert-edit")
    def revert_edit(self, request, pk=None):
        """
        Checker/Maker item-level decision: Revert a manual cell edit on a PayslipRecord back to old_value.
        - edit_id: int (PayslipRecordEdit.id)
        """
        job = self.get_object()
        is_checker = job.checkers.filter(id=request.user.id).exists()
        is_maker = job.makers.filter(id=request.user.id).exists()
        if not (is_checker or is_maker):
            return Response(
                {"error": "Permission denied. Only assigned Makers and Checkers can revert manual cell revisions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if job.status == "Done":
            return Response(
                {"error": "This job is marked as Done and cannot be modified."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        edit_id = request.data.get("edit_id")
        if not edit_id:
            return Response({"error": "edit_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not job.batch:
            return Response({"error": "Job has no associated payroll batch."}, status=status.HTTP_400_BAD_REQUEST)

        ed = PayslipRecordEdit.objects.filter(id=edit_id, payslip_record__batch=job.batch).select_related("payslip_record__employee").first()
        if not ed:
            return Response({"error": f"Edit record #{edit_id} not found in this batch."}, status=status.HTTP_404_NOT_FOUND)

        if ed.field_name == "excel_merge":
            return Response({"error": "Full Excel attendance merges cannot be reverted individually per field. Use 'Reset All Changes' if you wish to wipe and re-upload the attendance workbook."}, status=status.HTTP_400_BAD_REQUEST)

        rec = ed.payslip_record
        field = ed.field_name
        old_val = ed.old_value

        # Restore old value
        if hasattr(rec, field):
            field_obj = rec._meta.get_field(field)
            internal_type = field_obj.get_internal_type()

            if internal_type == "DecimalField":
                try:
                    val_to_set = Decimal(str(old_val)) if old_val is not None and str(old_val).strip() != "" else Decimal("0")
                except Exception:
                    val_to_set = Decimal("0")
            elif internal_type in ("IntegerField", "PositiveSmallIntegerField", "PositiveIntegerField", "SmallIntegerField"):
                try:
                    val_to_set = int(float(old_val)) if old_val is not None and str(old_val).strip() != "" else 0
                except Exception:
                    val_to_set = 0
            elif internal_type in ("FloatField",):
                try:
                    val_to_set = float(old_val) if old_val is not None and str(old_val).strip() != "" else 0.0
                except Exception:
                    val_to_set = 0.0
            elif internal_type == "BooleanField":
                val_to_set = str(old_val).lower() in ("true", "1", "yes")
            else:
                val_to_set = old_val if old_val is not None else ""

            setattr(rec, field, val_to_set)

            # If an attendance or proration input is reverted, re-derive all dependent pay fields
            attendance_fields = {"extra_working_days", "lop_days", "actual_working_days", "paid_leave_days"}
            if field in attendance_fields and rec.salary_structure_snapshot:
                profile = getattr(rec.batch.client, "payroll_profile", None)
                lop_policy = getattr(profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if profile else "ACCRUE_LEAVE_DEBT"
                pt_state = getattr(profile, "pt_state", "KARNATAKA") if profile else "KARNATAKA"
                pt_amount = getattr(profile, "pt_amount", Decimal("0")) if profile else Decimal("0")
                annual_leave_days = getattr(profile, "annual_leave_days", Decimal("22")) if profile else Decimal("22")
                probation_months = getattr(profile, "probation_months", 6) if profile else 6
                track_leave_ledger = getattr(profile, "track_leave_ledger", True) if profile else True
                track_comp_off = getattr(profile, "track_comp_off", True) if profile else True

                is_probation = is_in_probation(
                    rec.employee.hire_date, rec.batch.year, rec.batch.month, probation_months=probation_months
                )
                row = {
                    "actual_working_days": rec.actual_working_days,
                    "lop_days": rec.lop_days,
                    "extra_working_days": rec.extra_working_days,
                    "paid_leave_days": rec.paid_leave_days,
                    "lta": rec.lta_upload,
                    "special_allowance": rec.special_allowance_upload,
                    "nps_allowance_earned": rec.nps_allowance_upload,
                    "commission_other": rec.commission_other,
                    "arrears": rec.arrears,
                }
                computed = calculate_payslip_fields(
                    rec.salary_structure_snapshot, row, rec.batch.month, rec.days_in_month,
                    comp_off_opening_balance=rec.comp_off_opening_balance,
                    leave_opening_balance=rec.leave_opening_balance,
                    is_probation=is_probation,
                    lop_policy=lop_policy,
                    pt_state=pt_state,
                    pt_amount=pt_amount,
                    annual_leave_days=annual_leave_days,
                    employee_gender=getattr(rec.employee, "gender", "M"),
                    track_leave_ledger=track_leave_ledger,
                    track_comp_off=track_comp_off,
                )
                for f_name, value in computed.items():
                    if f_name in ("gross_salary", "comp_off_opening_balance", "leave_opening_balance"):
                        continue
                    setattr(rec, f_name, value)

            rec.save()  # Auto-recalculates earned_salary, total_deductions, net_salary!

        user_name = getattr(request.user, "full_name", "") or request.user.get_username()
        PayrollJobEvent.objects.create(
            job=job,
            event_type="EDIT_REVERTED",
            performed_by=request.user,
            performed_by_name=user_name,
            notes=f"Reverted {field} on {rec.employee.full_name} from '{ed.new_value}' back to '{old_val}'.",
        )

        ed_id = ed.id
        ed.delete()

        # Synchronize edit_count on PayslipRecord to match actual remaining edits
        rec.edit_count = rec.edits.count()
        rec.save(update_fields=["edit_count"])

        return Response({
            "message": f"Successfully reverted {field} to {old_val}.",
            "record_id": rec.id,
            "reverted_edit_id": ed_id,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="finalize-and-send")
    def finalize_and_send(self, request, pk=None):
        job = self.get_object()
        is_checker = job.checkers.filter(id=request.user.id).exists()
        if not is_checker:
            return Response(
                {"error": "Permission denied. Only assigned Checkers can finalize payroll. Leadership must assign themselves as Checker first."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])
            else:
                return Response({"error": "No payroll batch found for this client and period. Please calculate or upload batch first."}, status=status.HTTP_400_BAD_REQUEST)

        batch = job.batch
        for record in batch.records.select_related("employee", "batch__client"):
            # Only render/regenerate PDF if missing on disk or if the record was modified (not already emailed)
            if not record.pdf_path or not Path(record.pdf_path).exists() or record.status != PayslipRecord.STATUS_EMAIL_SENT:
                generate_payslip_pdf(record)

        batch.status = PayrollBatch.STATUS_REVIEWED
        batch.reviewed_by = request.user
        batch.reviewed_at = timezone.now()
        batch.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])

        send_emails = request.data.get("send_emails", True)
        if isinstance(send_emails, str):
            send_emails = send_emails.lower() in ("1", "true", "yes")

        if not send_emails:
            job.status = PayrollJob.STATUS_DONE
            job.reviewed_by = request.user
            job.reviewed_at = timezone.now()
            job.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
        else:
            # When sending emails, the job stays in Approved status while dispatch is underway.
            # It only transitions to "Done" upon Celery worker confirming 0 delivery failures.
            job.status = PayrollJob.STATUS_APPROVED
            job.reviewed_by = request.user
            job.reviewed_at = timezone.now()
            job.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])

        user_name = getattr(request.user, "full_name", "") or request.user.get_username()
        PayrollJobEvent.objects.create(
            job=job,
            event_type=PayrollJobEvent.EVENT_APPROVED,
            performed_by=request.user,
            performed_by_name=user_name,
            notes="Approved and finalized batch." + (" Initiated email distribution." if send_emails else " Email distribution skipped."),
        )

        email_dispatched = False
        dispatch_mode = None
        dispatch_message = "Payroll finalized, batch sealed, and marked Done."
        if send_emails:
            try:
                task = send_bulk_payslip_emails.delay(batch.id, request.user.id)
                email_dispatched = True
                dispatch_mode = "celery"
                dispatch_message = "Payroll finalized, payslips generated, and email distribution queued via automated enterprise dispatch engine."
            except Exception as e:
                logger.warning(f"Could not queue payslip email task via Celery (Redis): {e}. Falling back to direct dispatch thread.")
                thread = threading.Thread(
                    target=_dispatch_bulk_payslip_emails_in_thread,
                    args=(batch.id, request.user.id),
                    daemon=True,
                    name=f"payslip-email-job-{job.id}-batch-{batch.id}",
                )
                thread.start()
                email_dispatched = True
                dispatch_mode = "thread"
                dispatch_message = "Payroll finalized, payslips generated, and email distribution active via direct server dispatch service (failsafe backup)."
        else:
            dispatch_message = "Payroll finalized, batch sealed, and marked Done without re-sending emails."

        return Response({
            "job": PayrollJobSerializer(job).data,
            "email_dispatched": email_dispatched,
            "dispatch_mode": dispatch_mode,
            "message": dispatch_message,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="export-excel")
    def export_excel(self, request, pk=None):
        job = self.get_object()
        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])
            else:
                return Response({"error": "No payroll batch found to export."}, status=status.HTTP_400_BAD_REQUEST)

        job.batch.job = job
        return generate_batch_detailed_excel_response(job.batch)

    @action(detail=True, methods=["get"], url_path="download-payslips-zip")
    def download_payslips_zip(self, request, pk=None):
        import zipfile
        job = self.get_object()
        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])
            else:
                return Response({"error": "No payroll batch found to download payslips."}, status=status.HTTP_400_BAD_REQUEST)

        records = job.batch.records.select_related("employee", "batch__client")
        if not records.exists():
            return Response({"error": "No payslip records available in this batch."}, status=status.HTTP_400_BAD_REQUEST)

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for record in records:
                # Ensure PDF exists on disk; if missing, generate on the fly
                if not record.pdf_path or not Path(record.pdf_path).exists():
                    generate_payslip_pdf(record)
                    record.refresh_from_db()

                if record.pdf_path and Path(record.pdf_path).exists():
                    pdf_path = Path(record.pdf_path)
                    emp_code = (getattr(record.employee, "employee_code", None) or "EMP").replace("/", "-").replace("\\", "-")
                    emp_name = (getattr(record.employee, "full_name", None) or "Staff").replace(" ", "_").replace("/", "-")
                    clean_client = (job.client.name or "Client").replace(" ", "_").replace("/", "-")
                    month_label = month_name[job.month] if job.month and 1 <= job.month <= 12 else str(job.month or "")
                    pdf_filename = f"{clean_client}_{emp_code}_{emp_name}_{month_label}{job.year}_payslip.pdf"
                    zf.write(pdf_path, arcname=pdf_filename)

        zip_buffer.seek(0)
        clean_name = (job.client.name or "Client").replace(" ", "_").replace("/", "-")
        period_label = (job.period or f"{job.month}_{job.year}").replace(" ", "_").replace("/", "-")
        zip_filename = f"{clean_name}_{period_label}_All_Payslips.zip"

        response = HttpResponse(zip_buffer.getvalue(), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{zip_filename}"'
        return response

    @action(detail=True, methods=["get"], url_path="download-attendance-excel")
    def download_attendance_excel(self, request, pk=None):
        import os
        from django.conf import settings
        job = self.get_object()
        file_path = request.query_params.get("path")
        event_id = request.query_params.get("event_id")
        file_name_override = None

        if event_id:
            ev = job.events.filter(pk=event_id).first()
            if ev and ev.notes:
                try:
                    data = json.loads(ev.notes)
                    file_path = data.get("file_path") or file_path
                    file_name_override = data.get("file_name")
                except Exception:
                    pass

        if file_path:
            norm_path = file_path.replace("\\", "/")
            f_handle = None
            if default_storage.exists(norm_path):
                f_handle = default_storage.open(norm_path, "rb")
            elif default_storage.exists(file_path):
                f_handle = default_storage.open(file_path, "rb")
            elif os.path.exists(file_path):
                f_handle = open(file_path, "rb")
            elif hasattr(settings, "MEDIA_ROOT"):
                full_m = os.path.join(settings.MEDIA_ROOT, norm_path)
                if os.path.exists(full_m):
                    f_handle = open(full_m, "rb")

            if f_handle:
                filename = file_name_override or norm_path.split("/")[-1] or "attendance.xlsx"
                response = FileResponse(f_handle, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                response["Content-Disposition"] = f'attachment; filename="{filename}"'
                return response

        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])

        if job.batch and job.batch.source_file:
            try:
                file_handle = job.batch.source_file.open("rb")
                filename = job.batch.source_file.name.split("/")[-1] or f"attendance_{job.client.name}_{job.month}_{job.year}.xlsx"
                response = FileResponse(file_handle, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                response["Content-Disposition"] = f'attachment; filename="{filename}"'
                return response
            except Exception as e:
                logger.error(f"Failed to read source attendance file: {e}")

        # Option 3 & Synthetic Attendance Fallback:
        # If batch was generated directly from Portal submission or Master Roster (no physical Excel uploaded),
        # dynamically generate the audit-ready Attendance Register workbook from the batch records!
        if job.batch and job.batch.records.exists():
            try:
                wb = Workbook()
                ws = wb.active
                ws.title = "Monthly Attendance"
                ws.views.sheetView[0].showGridLines = True

                # Corporate Navy Header
                hdr_fill = PatternFill(start_color="1A2F5A", end_color="1A2F5A", fill_type="solid")
                hdr_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
                hdr_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
                thin_border = Border(
                    left=Side(style="thin", color="CBD5E1"),
                    right=Side(style="thin", color="CBD5E1"),
                    top=Side(style="thin", color="CBD5E1"),
                    bottom=Side(style="thin", color="CBD5E1"),
                )

                headers = [
                    "#",
                    "Employee Code",
                    "Employee Name",
                    "Department",
                    "Designation",
                    "Calendar Days",
                    "Worked Days",
                    "Extra Days",
                    "Paid Leave Days",
                    "LOP Days",
                    "Payable Days",
                    "Base Gross",
                ]
                ws.append(headers)
                ws.row_dimensions[1].height = 26

                for col_idx in range(1, len(headers) + 1):
                    cell = ws.cell(row=1, column=col_idx)
                    cell.fill = hdr_fill
                    cell.font = hdr_font
                    cell.alignment = hdr_align
                    cell.border = thin_border

                records_qs = job.batch.records.select_related("employee").order_by("employee__employee_code")
                row_idx = 2
                zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
                data_font = Font(name="Calibri", size=10)

                for rec in records_qs:
                    emp = rec.employee
                    emp_name = emp.full_name if emp else "Unknown"
                    emp_code = emp.employee_code if emp else "-"
                    dept = emp.department if emp else "-"
                    desig = emp.position if emp else "-"
                    dim = float(rec.days_in_month or 30)
                    lop = float(rec.lop_days or 0)
                    payable_days = max(0.0, dim - lop)

                    row_vals = [
                        row_idx - 1,
                        emp_code,
                        emp_name,
                        dept,
                        desig,
                        dim,
                        float(rec.actual_working_days or 0),
                        float(rec.extra_working_days or 0),
                        float(rec.paid_leave_days or 0),
                        lop,
                        payable_days,
                        float(rec.gross_salary or 0),
                    ]
                    ws.append(row_vals)
                    ws.row_dimensions[row_idx].height = 20

                    for col_idx in range(1, len(row_vals) + 1):
                        cell = ws.cell(row=row_idx, column=col_idx)
                        cell.font = data_font
                        cell.border = thin_border
                        if row_idx % 2 == 1:
                            cell.fill = zebra_fill
                        if col_idx in (1, 2):
                            cell.alignment = Alignment(horizontal="center", vertical="center")
                        elif col_idx in (3, 4, 5):
                            cell.alignment = Alignment(horizontal="left", vertical="center")
                        elif col_idx in (6, 7, 8, 9, 10, 11):
                            cell.alignment = Alignment(horizontal="right", vertical="center")
                            cell.number_format = "#,##0.00"
                        elif col_idx == 12:
                            cell.alignment = Alignment(horizontal="right", vertical="center")
                            cell.number_format = "₹#,##0.00"

                    row_idx += 1

                # Auto-fit column widths
                for col in ws.columns:
                    max_len = 0
                    col_letter = get_column_letter(col[0].column)
                    for cell in col:
                        val_str = str(cell.value or "")
                        if len(val_str) > max_len:
                            max_len = len(val_str)
                    ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

                buf = BytesIO()
                wb.save(buf)
                buf.seek(0)
                clean_client = re.sub(r"[^a-zA-Z0-9_-]", "_", job.client.name)
                filename = f"Attendance_{clean_client}_{job.year}_{job.month:02d}.xlsx"
                response = HttpResponse(
                    buf.getvalue(),
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                response["Content-Disposition"] = f'attachment; filename="{filename}"'
                return response
            except Exception as e:
                logger.error(f"Failed to generate synthetic attendance workbook: {e}")
                return Response({"error": f"Failed to generate attendance sheet: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"error": "No attendance Excel file or batch records found for this payroll job."}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=["get"], url_path="export-email-logs")
    def export_email_logs(self, request, pk=None):
        from openpyxl.styles import Border, Side
        job = self.get_object()
        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])

        if not job.batch:
            return Response({"error": "No payroll batch found for this period."}, status=status.HTTP_400_BAD_REQUEST)

        logs = EmailLog.objects.filter(payslip_record__batch=job.batch).select_related(
            "payslip_record__employee", "sent_by"
        ).order_by("-sent_at")

        wb = Workbook()
        ws = wb.active
        ws.title = "Email Dispatch Logs"

        headers = [
            "SL No", "Employee Code", "Employee Name", "Recipient Email",
            "Subject", "Status", "Attempt", "Sent At", "Error Details"
        ]

        header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1A2F5A", end_color="1A2F5A", fill_type="solid")
        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1"),
        )

        ws.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        data_font = Font(name="Segoe UI", size=9)
        sent_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
        fail_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")

        for idx, log in enumerate(logs, start=1):
            emp = log.payslip_record.employee if log.payslip_record else None
            emp_code = emp.employee_code if emp else "—"
            emp_name = emp.full_name if emp else "—"
            status_text = "Sent" if log.success else "Failed"
            sent_time = log.sent_at.strftime("%d-%m-%Y %H:%M:%S") if log.sent_at else "—"
            row_data = [
                idx, emp_code, emp_name, log.recipient_email,
                log.subject, status_text, log.attempt_number, sent_time, log.error_message or ""
            ]
            ws.append(row_data)
            row_idx = ws.max_row
            status_cell = ws.cell(row=row_idx, column=6)
            status_cell.fill = sent_fill if log.success else fail_fill

            for col_idx in range(1, len(headers) + 1):
                c = ws.cell(row=row_idx, column=col_idx)
                c.font = data_font
                c.border = thin_border

        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = col[0].column_letter
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        out = BytesIO()
        wb.save(out)
        out.seek(0)
        clean_name = (job.client.name or "Payroll").replace(" ", "_")
        filename = f"{clean_name}_Email_Logs_{job.period or job.month}.xlsx"
        response = HttpResponse(
            out.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    def _resolve_job_batch(self, job):
        if job.batch:
            return job.batch
        found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
        if found_batch:
            job.batch = found_batch
            job.save(update_fields=["batch"])
            return found_batch
        return None

    @action(detail=True, methods=["get"], url_path="export-epfo-ecr")
    def export_epfo_ecr(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export EPFO return."}, status=status.HTTP_400_BAD_REQUEST)
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "txt").lower()
        if fmt == "xlsx":
            return generate_epfo_ecr_xlsx_response(batch)
        return generate_epfo_ecr_txt_response(batch)

    @action(detail=True, methods=["get"], url_path="export-esic-monthly")
    def export_esic_monthly(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export ESIC return."}, status=status.HTTP_400_BAD_REQUEST)
        return generate_esic_monthly_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="export-pt-statement")
    def export_pt_statement(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export PT statement."}, status=status.HTTP_400_BAD_REQUEST)
        return generate_pt_statement_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="validate-statutory-identifiers")
    def validate_statutory_identifiers(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to validate statutory identifiers."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(validate_statutory_identifiers(batch))

    @action(detail=True, methods=["get"], url_path="export-bank-payout")
    def export_bank_payout(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export bank payout."}, status=status.HTTP_400_BAD_REQUEST)
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "xlsx").lower()
        if fmt == "csv":
            return generate_bank_payout_csv_response(batch)
        elif fmt == "hdfc":
            return generate_bank_payout_hdfc_response(batch)
        return generate_bank_payout_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="validate-bank-details")
    def validate_bank_details(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to validate bank details."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(validate_bank_details(batch))

    @action(detail=True, methods=["get"], url_path="hold-records")
    def hold_records(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(get_hold_records_summary(batch))

    @action(detail=True, methods=["post"], url_path="release-salary-hold")
    def release_salary_hold(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found."}, status=status.HTTP_400_BAD_REQUEST)
        emp_id = request.data.get("employee_id")
        amount = request.data.get("release_amount")
        reason = request.data.get("reason", "")
        if not emp_id or not amount:
            return Response({"error": "employee_id and release_amount are required."}, status=status.HTTP_400_BAD_REQUEST)
        employee = Employee.objects.filter(id=emp_id, client=job.client).first()
        if not employee:
            return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            record, adj = apply_batch_hold_release(batch, employee, amount, reason, request.user)
            user_name = getattr(request.user, "full_name", "") or request.user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="HOLD_RELEASED",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Released ₹{abs(adj.amount):,.2f} on-hold salary for {employee.full_name}: {reason or 'Staff release'}",
            )
            return Response({
                "message": f"Successfully released ₹{abs(adj.amount):,.2f} on-hold salary for {employee.full_name}.",
                "record": PayslipRecordSerializer(record).data,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="place-salary-hold")
    def place_salary_hold(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found."}, status=status.HTTP_400_BAD_REQUEST)
        emp_id = request.data.get("employee_id")
        amount = request.data.get("hold_amount")
        reason = request.data.get("reason", "")
        release_month = request.data.get("release_month")
        release_year = request.data.get("release_year")
        if not emp_id or not amount:
            return Response({"error": "employee_id and hold_amount are required."}, status=status.HTTP_400_BAD_REQUEST)
        employee = Employee.objects.filter(id=emp_id, client=job.client).first()
        if not employee:
            return Response({"error": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            record, adj = apply_batch_salary_hold(batch, employee, amount, reason, release_month, release_year, request.user)
            user_name = getattr(request.user, "full_name", "") or request.user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="HOLD_PLACED",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Placed ₹{adj.amount:,.2f} salary on hold for {employee.full_name}: {reason or 'Staff hold'}",
            )
            return Response({
                "message": f"Successfully placed ₹{adj.amount:,.2f} on hold for {employee.full_name}.",
                "record": PayslipRecordSerializer(record).data,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="mom-variance-summary")
    def mom_variance_summary(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(build_mom_variance_data(batch))

    @action(detail=True, methods=["get"], url_path="export-mom-variance")
    def export_mom_variance(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export MoM variance."}, status=status.HTTP_400_BAD_REQUEST)
        return generate_mom_variance_xlsx_response(batch)

    @action(detail=True, methods=["get"], url_path="export-journal-voucher")
    def export_journal_voucher(self, request, pk=None):
        job = self.get_object()
        batch = self._resolve_job_batch(job)
        if not batch:
            return Response({"error": "No payroll batch found to export Journal Voucher."}, status=status.HTTP_400_BAD_REQUEST)
        fmt = (request.query_params.get("file_format") or request.query_params.get("format") or "xlsx").lower()
        split_dept = request.query_params.get("split_by_dept", "true").lower() in ("true", "1", "yes")
        if fmt in ("xml", "tally"):
            return generate_tally_xml_response(batch, split_by_department=split_dept)
        elif fmt == "csv":
            return generate_journal_voucher_csv_response(batch, split_by_department=split_dept)
        return generate_journal_voucher_xlsx_response(batch, split_by_department=split_dept)

    @action(detail=True, methods=["post"], url_path="create-or-link-batch")
    def create_or_link_batch(self, request, pk=None):
        """
        Initializes or links a PayrollBatch for this job:
        1. If a batch already exists for (client, month, year), links it directly.
        2. Otherwise, provisions a fresh batch directly from active employees master
           (same logic as generate_from_portal) without requiring an Excel upload,
           folds in any approved portal items, and links it to this job.
        """
        job = self.get_object()
        is_maker = job.makers.filter(id=request.user.id).exists()
        if not is_maker:
            return Response(
                {"error": "Permission denied. Only assigned Makers can initialize or link a batch. Leadership must assign themselves as Maker first."},
                status=status.HTTP_403_FORBIDDEN,
            )
        client = job.client
        month = job.month
        year = job.year

        if not month or not year:
            return Response({"error": "Job month and year must be specified to initialize batch."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Check if a batch already exists for this client, month, year
        existing_batch = PayrollBatch.objects.filter(client=client, month=month, year=year).first()
        if existing_batch:
            job.batch = existing_batch
            if job.status == PayrollJob.STATUS_TODO:
                job.status = PayrollJob.STATUS_IN_PROGRESS
                job.save(update_fields=["batch", "status"])
            else:
                job.save(update_fields=["batch"])
            user_name = getattr(request.user, "full_name", "") or request.user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="BATCH_LINKED",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Linked existing payroll batch #{existing_batch.id} ({existing_batch.total_records} records).",
            )
            return Response({
                "job": PayrollJobSerializer(job).data,
                "message": f"Linked existing payroll batch for {month:02d}/{year}."
            }, status=status.HTTP_200_OK)

        # 2. Otherwise generate batch directly from active employees
        sync_due_employee_exits(client=client)
        days_in_month = calendar.monthrange(year, month)[1]
        profile = getattr(client, "payroll_profile", None)
        if profile and hasattr(profile, "get_cycle_dates"):
            cycle_start, cycle_end, _ = profile.get_cycle_dates(year, month)
        else:
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, days_in_month)

        employees = list(
            Employee.objects.filter(client=client)
            .filter(
                models.Q(status=Employee.STATUS_ACTIVE)
                | models.Q(last_working_date__gte=cycle_start)
            )
            .exclude(hire_date__gt=cycle_end)
            .order_by("employee_code")
        )

        with transaction.atomic():
            batch = PayrollBatch.objects.create(
                client=client,
                month=month,
                year=year,
                total_records=0,
                uploaded_by=request.user,
            )
            materialize_due_hold_releases(client, month, year, request.user)
            missing_structure_employees = []
            for employee in employees:
                actual_days = Decimal(str(days_in_month))
                if (
                    employee.last_working_date
                    and employee.last_working_date.year == year
                    and employee.last_working_date.month == month
                ):
                    actual_days = min(actual_days, Decimal(str(employee.last_working_date.day)))
                if (
                    employee.hire_date
                    and employee.hire_date.year == year
                    and employee.hire_date.month == month
                ):
                    working_span = days_in_month - employee.hire_date.day + 1
                    actual_days = min(actual_days, Decimal(str(max(0, working_span))))

                row = {
                    "actual_working_days": actual_days,
                    "extra_working_days": Decimal("0"),
                    "paid_leave_days": Decimal("0"),
                    "lop_days": Decimal("0"),
                    "lta": Decimal("0"),
                    "special_allowance": Decimal("0"),
                    "nps_allowance_earned": Decimal("0"),
                    "commission_other": Decimal("0"),
                    "arrears": Decimal("0"),
                    "reimbursements": Decimal("0"),
                    "tds": Decimal("0"),
                    "vpf_arrears": Decimal("0"),
                    "nps_deduction_arrears": Decimal("0"),
                    "loan_deduction": Decimal("0"),
                    "lwf": Decimal("0"),
                    "other_deduction": Decimal("0"),
                }
                _record, missing = _build_record_for_employee(
                    employee, batch, row, year, month, days_in_month, request.user
                )
                if missing:
                    missing_structure_employees.append(employee)

            batch.total_records = len(employees)
            batch.save(update_fields=["total_records", "updated_at"])

            job.batch = batch
            if job.status == PayrollJob.STATUS_TODO:
                job.status = PayrollJob.STATUS_IN_PROGRESS
            job.save(update_fields=["batch", "status"])

            sub = PortalSubmission.objects.filter(client=client, month=month, year=year).first()
            if sub:
                applied_items = list(sub.items.filter(status=PortalSubmissionItem.STATUS_APPLIED))
                if applied_items:
                    refresh_batch_after_apply(sub, request.user, applied_items)

            user_name = getattr(request.user, "full_name", "") or request.user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="BATCH_GENERATED",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Generated payroll batch with {len(employees)} active employees for {month:02d}/{year}.",
            )

        return Response({
            "job": PayrollJobSerializer(job).data,
            "message": f"Successfully created and linked payroll batch for {len(employees)} employees."
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="reset-batch")
    def reset_batch(self, request, pk=None):
        """
        Resets and purges all changes applied through Excel, Monthly Key-ins, Portal,
        and in-line edits for this job. Recalculates all payslip records back to clean
        defaults directly from the active employee master contracts so the team can
        start fresh if there are errors.
        """
        job = self.get_object()
        is_maker = job.makers.filter(id=request.user.id).exists()
        is_checker = job.checkers.filter(id=request.user.id).exists()
        user_role = getattr(request.user, "role", "").lower() if hasattr(request.user, "role") else ""
        is_admin = user_role in ("admin", "founder", "manager", "team lead") or request.user.is_superuser
        if not (is_maker or is_checker or is_admin):
            return Response(
                {"error": "Permission denied. Only assigned Makers, Checkers, or Admins can reset a batch."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if job.status == PayrollJob.STATUS_DONE:
            return Response(
                {"error": "Cannot reset a finalized and distributed payroll batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client = job.client
        month = job.month
        year = job.year

        if not month or not year:
            return Response({"error": "Job month and year must be specified to reset batch."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # 1. Clean up Staged and Applied Portal Submission Items
            sub = PortalSubmission.objects.filter(client=client, month=month, year=year).first()
            if sub:
                # 1.1 Purge PortalAdjustments (one-time earnings/deductions)
                PortalAdjustment.objects.filter(item__submission=sub).delete()
                # 1.2 Purge PortalHold and associated OnHoldAdjustment
                holds = PortalHold.objects.filter(item__submission=sub)
                for h in holds:
                    if h.hold_adjustment:
                        h.hold_adjustment.delete()
                holds.delete()
                # 1.3 Purge SalaryAdvances created from this submission
                advances = SalaryAdvance.objects.filter(
                    disbursement_adjustment__reason__icontains=f"Portal salary advance ({month:02d}/{year})"
                )
                for adv in advances:
                    if adv.disbursement_adjustment:
                        adv.disbursement_adjustment.delete()
                    adv.delete()
                # 1.4 Delete all firm-staged items (Excel uploads and manual monthly key-ins)
                sub.items.filter(created_by__isnull=True).delete()
                # 1.5 Revert client portal items back to PENDING so they can be audited anew
                sub.items.filter(created_by__isnull=False).update(
                    status=PortalSubmissionItem.STATUS_PENDING,
                    error="",
                )
                sub.status = PortalSubmission.STATUS_DRAFT
                sub.save(update_fields=["status", "updated_at"])

            # 2. Clean up batch audit, record edit history, email logs, and generated PDFs
            if job.batch:
                delete_batch_records_leaf_first(job.batch, purge_pdf_files=True)

            # 3. Cleanly re-provision payslip records from employee master
            sync_due_employee_exits(client=client)
            days_in_month = calendar.monthrange(year, month)[1]
            month_start = date(year, month, 1)
            month_end = date(year, month, days_in_month)

            employees = list(
                Employee.objects.filter(client=client)
                .filter(
                    models.Q(status=Employee.STATUS_ACTIVE)
                    | models.Q(last_working_date__gte=month_start)
                )
                .exclude(hire_date__gt=month_end)
                .order_by("employee_code")
            )

            batch = job.batch
            if not batch:
                batch = PayrollBatch.objects.create(
                    client=client,
                    month=month,
                    year=year,
                    total_records=0,
                    uploaded_by=request.user,
                )
                job.batch = batch
                job.save(update_fields=["batch"])

            materialize_due_hold_releases(client, month, year, request.user)
            for employee in employees:
                actual_days = Decimal(str(days_in_month))
                if (
                    employee.last_working_date
                    and employee.last_working_date.year == year
                    and employee.last_working_date.month == month
                ):
                    actual_days = min(actual_days, Decimal(str(employee.last_working_date.day)))
                if (
                    employee.hire_date
                    and employee.hire_date.year == year
                    and employee.hire_date.month == month
                ):
                    working_span = days_in_month - employee.hire_date.day + 1
                    actual_days = min(actual_days, Decimal(str(max(0, working_span))))

                row = {
                    "actual_working_days": actual_days,
                    "extra_working_days": Decimal("0"),
                    "paid_leave_days": Decimal("0"),
                    "lop_days": Decimal("0"),
                    "lta": Decimal("0"),
                    "special_allowance": Decimal("0"),
                    "nps_allowance_earned": Decimal("0"),
                    "commission_other": Decimal("0"),
                    "arrears": Decimal("0"),
                    "reimbursements": Decimal("0"),
                    "tds": Decimal("0"),
                    "vpf_arrears": Decimal("0"),
                    "nps_deduction_arrears": Decimal("0"),
                    "loan_deduction": Decimal("0"),
                    "lwf": Decimal("0"),
                    "other_deduction": Decimal("0"),
                }
                _build_record_for_employee(
                    employee, batch, row, year, month, days_in_month, request.user
                )

            batch.total_records = len(employees)
            batch.status = "DRAFT"
            batch.email_sent = 0
            batch.email_failed = 0
            batch.error_log = ""
            batch.save(update_fields=["total_records", "status", "email_sent", "email_failed", "error_log", "updated_at"])

            if job.status in [PayrollJob.STATUS_UNDER_REVIEW, PayrollJob.STATUS_REWORK]:
                job.status = PayrollJob.STATUS_IN_PROGRESS
                job.save(update_fields=["status", "updated_at"])

            user_name = getattr(request.user, "full_name", "") or request.user.get_username()
            PayrollJobEvent.objects.create(
                job=job,
                event_type="BATCH_RESET",
                performed_by=request.user,
                performed_by_name=user_name,
                notes=f"Batch reset: Purged all staged Excel uploads, monthly key-ins, attendance merges, and edit logs. Recomputed {len(employees)} clean employee records from master.",
            )

        return Response({
            "message": f"Successfully reset batch #{batch.id}. All modifications cleared and {len(employees)} payslips cleanly recomputed from master.",
            "job": PayrollJobSerializer(job).data,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="batch-records")
    def batch_records(self, request, pk=None):
        """
        Returns all PayslipRecord instances for the job's linked batch.
        """
        job = self.get_object()
        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])

        if not job.batch:
            return Response([], status=status.HTTP_200_OK)

        records = job.batch.records.select_related(
            "employee", "salary_structure_snapshot", "batch", "batch__client"
        ).order_by("employee__employee_code")
        
        # Auto-repair: Cash earning components in client catalog must never be suppressed by do_not_include_in_total
        SalaryComponent.objects.filter(client=job.client, component_type="EARNING", do_not_include_in_total=True).update(do_not_include_in_total=False)

        # Self-healing synchronization (Option 1): if job is not completed/approved and any record's
        # custom components or earned salary need synchronization with structure/hybrid components, recalculate on save
        if job.status not in [PayrollJob.STATUS_APPROVED, PayrollJob.STATUS_DONE]:
            any_healed = False
            for rec in records:
                old_earned = rec.earned_salary
                old_net = rec.net_salary
                struct = rec.salary_structure_snapshot or get_latest_salary_structure(rec.employee)
                rec_cc = rec.custom_components if isinstance(rec.custom_components, dict) else {}

                # Unset do_not_include_in_total on cash earning entries so they fold into earned_salary
                if "earnings" in rec_cc and isinstance(rec_cc["earnings"], list):
                    for e in rec_cc["earnings"]:
                        if isinstance(e, dict) and e.get("do_not_include_in_total") and not e.get("statistical_component"):
                            e["do_not_include_in_total"] = False
                            rec.custom_components = rec_cc

                if struct and struct.custom_components and isinstance(struct.custom_components, dict):
                    has_nested = "earnings" in rec_cc or "deductions" in rec_cc
                    if not has_nested:
                        for ck, cv in struct.custom_components.items():
                            if ck not in rec_cc:
                                rec_cc[ck] = cv
                                rec.custom_components = rec_cc

                # Run save() to recompute earned_salary, total_deductions, and net_salary under updated hybrid rules
                rec.save()
                if rec.earned_salary != old_earned or rec.net_salary != old_net:
                    any_healed = True

            if any_healed:
                # Option 3: Audit event logging
                try:
                    user_name = getattr(request.user, "full_name", "") or getattr(request.user, "username", "System")
                    PayrollJobEvent.objects.create(
                        job=job,
                        event_type="BATCH_RECALCULATED",
                        performed_by=request.user if getattr(request.user, "is_authenticated", False) else None,
                        performed_by_name=user_name,
                        notes="Self-healing synchronization: folded dynamic custom components into Earned and Net Salary.",
                    )
                except Exception:
                    pass

        serializer = PayslipRecordSerializer(records, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="recalculate-batch")
    def recalculate_batch(self, request, pk=None):
        """
        Recalculates all PayslipRecord rows in this job's batch against their latest salary structures.
        Updates earned_salary, total_deductions, and net_salary without destroying stage history.
        """
        job = self.get_object()
        if job.status == PayrollJob.STATUS_DONE or (job.batch and job.batch.status == PayrollBatch.STATUS_COMPLETED):
            return Response(
                {"error": "This job is marked as Done and cannot be recalculated."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not job.batch:
            found_batch = PayrollBatch.objects.filter(client=job.client, month=job.month, year=job.year).first()
            if found_batch:
                job.batch = found_batch
                job.save(update_fields=["batch"])
        if not job.batch:
            return Response({"error": "No batch linked to this job."}, status=status.HTTP_400_BAD_REQUEST)

        records = list(job.batch.records.select_related("employee", "salary_structure_snapshot", "batch"))
        recomputed_count = 0
        t0 = time.perf_counter()
        with transaction.atomic():
            for rec in records:
                _recompute_payslip_record_from_structure(rec, commit=False)
                if isinstance(rec.custom_components, (dict, list)):
                    rec.custom_components = sanitize_for_json(rec.custom_components)
                recomputed_count += 1
            if records:
                PayslipRecord.objects.bulk_update(records, fields=PAYSLIP_ALL_COMPUTED_FIELDS, batch_size=100)
        elapsed = time.perf_counter() - t0
        logger.info("Vectorized bulk_update finished across %d records in %.3fs", recomputed_count, elapsed)

        # Audit trail event logging
        try:
            user_name = getattr(request.user, "full_name", "") or getattr(request.user, "username", "System")
            PayrollJobEvent.objects.create(
                job=job,
                event_type="BATCH_RECALCULATED",
                performed_by=request.user if getattr(request.user, "is_authenticated", False) else None,
                performed_by_name=user_name,
                notes=f"Vectorized recalculation across {recomputed_count} records finished in {elapsed:.3f}s via bulk_update.",
            )
        except Exception:
            pass

        return Response({
            "success": True,
            "recomputed_count": recomputed_count,
            "message": f"Successfully recalculated {recomputed_count} payslip records.",
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="changes")
    def changes(self, request, pk=None):
        """
        Returns all staged monthly adjustments (from Portal Inputs) and applied
        changes (from Excel merges and input approvals) for this client and month,
        providing the Checker and Maker with full audit visibility into all changes.
        """
        job = self.get_object()
        subs = PortalSubmission.objects.filter(client=job.client, month=job.month, year=job.year)
        items_qs = PortalSubmissionItem.objects.filter(submission__in=subs).select_related("submission", "created_by").order_by("-id")

        emp_ids = set()
        for item in items_qs:
            eid = (item.payload or {}).get("employee_id")
            if eid:
                try:
                    emp_ids.add(int(eid))
                except (ValueError, TypeError):
                    pass

        emp_map = {e.id: e for e in Employee.objects.filter(id__in=emp_ids)}

        items_data = []
        pending_cnt = 0
        applied_cnt = 0
        skipped_cnt = 0

        # 1. Monthly Input items from Portal Submissions
        for it in items_qs:
            p = it.payload or {}
            eid = p.get("employee_id")
            emp = emp_map.get(int(eid)) if (eid and int(eid) in emp_map) else None
            emp_name = emp.full_name if emp else f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or None
            emp_code = emp.employee_code if emp else p.get("employee_code")

            if it.status == PortalSubmissionItem.STATUS_PENDING:
                pending_cnt += 1
            elif it.status == PortalSubmissionItem.STATUS_APPLIED:
                applied_cnt += 1
            elif it.status == PortalSubmissionItem.STATUS_SKIPPED:
                skipped_cnt += 1

            sub_created = it.submission.created_at.isoformat() if getattr(it.submission, "created_at", None) else None
            sub_updated = it.submission.updated_at.isoformat() if getattr(it.submission, "updated_at", None) else None

            if it.created_by_id:
                source_type = "portal_input"
                applied_by = getattr(it.created_by, "email", None) or "Client"
            elif (p.get("_source") == "excel_upload"):
                source_type = "excel_upload"
                applied_by = "Staff (Excel)"
            else:
                source_type = "monthly_input"
                applied_by = "Staff (Monthly Input)"

            if getattr(it, "applied_by", None):
                applied_by = getattr(it.applied_by, "full_name", "") or getattr(it.applied_by, "username", "") or applied_by

            items_data.append({
                "id": f"sub_item_{it.id}",
                "item_id": it.id,
                "source": source_type,
                "item_type": it.item_type,
                "status": it.status,
                "error": it.error or "",
                "payload": p,
                "employee_id": emp.id if emp else (int(eid) if eid and str(eid).isdigit() else None),
                "employee_code": emp_code,
                "employee_name": emp_name,
                "created_at": sub_created,
                "applied_at": sub_updated if it.status == PortalSubmissionItem.STATUS_APPLIED else None,
                "applied_by_name": applied_by,
            })

        # 2. Excel merge & manual revision changes from batch PayslipRecordEdits
        if job.batch:
            all_edits = (
                PayslipRecordEdit.objects.filter(payslip_record__batch=job.batch)
                .select_related("payslip_record__employee", "edited_by")
                .order_by("-created_at")
            )
            seen_emp_merge = set()
            for ed in all_edits:
                rec = ed.payslip_record
                emp = rec.employee
                if ed.field_name == "excel_merge":
                    key = (emp.id, ed.field_name)
                    if key in seen_emp_merge:
                        continue
                    seen_emp_merge.add(key)
                    applied_cnt += 1

                    # Clean up human-readable categories from raw "Merged fields: ..."
                    raw_desc = ed.new_value or ""
                    categories = []
                    if any(k in raw_desc for k in ["actual_working_days", "extra_working_days", "paid_leave_days", "lop_days"]):
                        categories.append(f"Attendance & Leave ({rec.actual_working_days}d worked, {rec.lop_days}d LOP)")
                    if any(k in raw_desc for k in ["lta", "special_allowance", "nps_allowance_earned", "variable_pay", "commission_other", "arrears", "reimbursements"]):
                        categories.append("Allowances & Arrears")
                    if any(k in raw_desc for k in ["tds", "epf", "vpf", "vpf_arrears", "nps_deduction", "loan_deduction", "lwf", "other_deduction"]):
                        categories.append("Deductions & TDS")

                    friendly_desc = " · ".join(categories) if categories else "Attendance & monthly salary components synced"

                    items_data.append({
                        "id": f"edit_{ed.id}",
                        "edit_id": ed.id,
                        "source": "excel_merge",
                        "item_type": "EXCEL_MERGED",
                        "status": "APPLIED",
                        "payload": {
                            "description": friendly_desc,
                            "raw_description": raw_desc,
                            "working_days": rec.actual_working_days,
                            "lop_days": rec.lop_days,
                            "earned_gross": float(rec.earned_salary) if rec.earned_salary is not None else None,
                            "gross": float(rec.gross_salary) if rec.gross_salary is not None else None,
                            "net": float(rec.net_salary) if rec.net_salary is not None else None,
                        },
                        "employee_id": emp.id,
                        "employee_code": emp.employee_code,
                        "employee_name": emp.full_name,
                        "created_at": ed.created_at.isoformat() if ed.created_at else None,
                        "applied_at": ed.created_at.isoformat() if ed.created_at else None,
                        "applied_by_name": ed.edited_by.get_full_name() or ed.edited_by.username if ed.edited_by else "Staff",
                    })
                else:
                    # In-batch manual cell or inspector drawer edit on payslip record
                    applied_cnt += 1
                    field_title = ed.field_name.replace("_", " ").title()
                    friendly_desc = f"{field_title}: {ed.old_value} → {ed.new_value}"
                    items_data.append({
                        "id": f"edit_{ed.id}",
                        "edit_id": ed.id,
                        "source": "manual_edit",
                        "item_type": ed.field_name.upper(),
                        "status": "APPLIED",
                        "payload": {
                            "description": friendly_desc,
                            "field_name": ed.field_name,
                            "old_value": ed.old_value,
                            "new_value": ed.new_value,
                            "amount": float(ed.new_value) if ed.new_value and ed.new_value.replace(".", "", 1).isdigit() else None,
                        },
                        "employee_id": emp.id,
                        "employee_code": emp.employee_code,
                        "employee_name": emp.full_name,
                        "created_at": ed.created_at.isoformat() if ed.created_at else None,
                        "applied_at": ed.created_at.isoformat() if ed.created_at else None,
                        "applied_by_name": ed.edited_by.get_full_name() or ed.edited_by.username if ed.edited_by else "Staff",
                    })

        portal_cnt = sum(1 for x in items_data if x.get("source") == "portal_input")
        excel_upload_cnt = sum(1 for x in items_data if x.get("source") == "excel_upload")
        monthly_input_cnt = sum(1 for x in items_data if x.get("source") == "monthly_input")
        manual_edit_cnt = sum(1 for x in items_data if x.get("source") == "manual_edit")
        excel_merge_cnt = sum(1 for x in items_data if x.get("source") == "excel_merge")

        return Response({
            "items": items_data,
            "summary": {
                "total": len(items_data),
                "pending": pending_cnt,
                "applied": applied_cnt,
                "skipped": skipped_cnt,
                "portal_count": portal_cnt,
                "excel_upload_count": excel_upload_cnt,
                "monthly_input_count": monthly_input_cnt,
                "manual_edit_count": manual_edit_cnt,
                "excel_merge_count": excel_merge_cnt,
            }
        }, status=status.HTTP_200_OK)
