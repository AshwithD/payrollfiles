"""
payroll/portal/services.py

apply-on-approve pipeline. Approving a submitted month turns each pending
PortalSubmissionItem into real payroll rows:

    NEW_EMPLOYEE        → Employee + EmployeeSalaryStructure (build_from_ctc)
    REVISION            → a new EmployeeSalaryStructure version (effective_from)
    EXIT                → Employee.status = inactive
    SALARY_HOLD         → OnHoldAdjustment (+amount, folds into this month's
                          pay) + PortalHold (scheduled auto-release)
    ADVANCE             → SalaryAdvance plan + its lump-sum disbursement
    ONE_TIME_EARNING    → PortalAdjustment (earning)
    ONE_TIME_DEDUCTION  → PortalAdjustment (deduction)
    NOTE                → no-op (informational for the approver)

Each item is applied inside its own savepoint, so a failing item rolls back
its own partial writes and is marked FAILED while the rest proceed. The
submission flips to APPROVED only when nothing failed; otherwise it stays
SUBMITTED so the admin can fix and re-approve (re-approval retries PENDING
and FAILED items and skips APPLIED ones).
"""

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import json
import logging
import time

logger = logging.getLogger(__name__)

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from payroll.calculations import calculate_payslip_fields, is_in_probation, sanitize_for_json
from payroll.models import (
    ClientProfile,
    Employee,
    EmployeeSalaryStructure,
    OnHoldAdjustment,
    PayrollBatch,
    PayslipRecord,
    SalaryAdvance,
    SalaryAdvanceAdjustment,
    get_latest_salary_structure,
    get_effective_salary_structures_for_month,
    PAYSLIP_ALL_COMPUTED_FIELDS,
)

from ..models import (
    PortalAdjustment,
    PortalHold,
    PortalSubmission,
    PortalSubmissionEvent,
    PortalSubmissionItem,
)
from ..excel_parser import parse_date, to_decimal, to_positive_int

# Structure fields the portal may set explicitly on top of build_from_ctc.
_STRUCTURE_OVERRIDES = ("nps_allowance", "fbp", "vpf")


def record_event(submission, event_type, item_count=0, actor_portal=None, actor_staff=None, note=""):
    """Appends one row to the submission's round history."""
    return PortalSubmissionEvent.objects.create(
        submission=submission,
        event_type=event_type,
        item_count=item_count,
        actor_portal=actor_portal,
        actor_staff=actor_staff,
        note=(note or "")[:1000],
    )


def _first_of_month(submission) -> date:
    return date(submission.year, submission.month, 1)


def _get_employee(submission, employee_id):
    employee = Employee.objects.filter(id=employee_id, client=submission.client).first()
    if employee is None:
        raise ValueError(f"Employee id {employee_id} was not found for this client.")
    return employee


def _make_structure(employee, submission, payload, approved_by, reason):
    """Builds an EmployeeSalaryStructure from a payload's CTC, then applies
    any explicit nps/fbp/vpf overrides. Returns the saved structure."""
    ctc_annual = to_decimal(payload["ctc_annual"], "ctc_annual")
    if ctc_annual <= 0:
        raise ValueError("ctc_annual must be greater than 0.")

    is_intern = payload.get("employment_type") == "INTERN" or payload.get("is_intern")
    if is_intern and "pf_opted" not in payload:
        pf_opted_val = False
    else:
        pf_opted_val = payload.get("pf_opted", True)

    struct_dict = EmployeeSalaryStructure.build_from_ctc(
        ctc_annual,
        pf_opted=pf_opted_val,
        esi_opted=payload.get("esi_opted"),
        current_lta=payload.get("original_lta") or payload.get("lta") or Decimal("0"),
        nps_allowance=payload.get("nps_allowance") or Decimal("0"),
        fbp=payload.get("fbp") or Decimal("0"),
        vpf=payload.get("vpf") or Decimal("0"),
        client=submission.client,
        employee=employee,
    )
    struct_dict.pop("min_wage_warning", None)
    struct_dict.pop("shortfall", None)
    struct_dict.pop("esi_opted", None)
    struct_dict.pop("employer_esi", None)
    struct_dict.pop("employer_esi_in_ctc", None)
    structure = EmployeeSalaryStructure(
        employee=employee,
        effective_from=parse_date(payload["effective_from"]),
        created_by=approved_by,
        change_reason=reason,
        **struct_dict,
    )
    for field in _STRUCTURE_OVERRIDES:
        if payload.get(field) is not None:
            setattr(structure, field, to_decimal(payload[field], field))
    merged = dict(struct_dict.get("custom_components") or {})
    if payload.get("custom_components"):
        # Safely merge uploaded flat overrides with the auto-calculated percentage components
        merged.update(payload["custom_components"])
    emp_type = payload.get("employment_type")
    if not emp_type and (payload.get("is_intern") or getattr(employee, "is_intern", False)):
        emp_type = "INTERN"
    if emp_type:
        merged["employment_type"] = emp_type
        merged["is_intern"] = (emp_type == "INTERN")
    structure.custom_components = merged
    structure.save()
    return structure


def _apply_new_employee(item, submission, approved_by):
    payload = item.payload
    code = str(payload["employee_code"]).strip()
    if not code:
        raise ValueError("employee_code is required.")
    if Employee.objects.filter(client=submission.client, employee_code=code).exists():
        raise ValueError(f"Employee code {code!r} already exists for this client.")

    hire_date = parse_date(payload["hire_date"]) if payload.get("hire_date") else None
    raw_acc = str(payload.get("bank_account_number") or payload.get("bank_account_no") or "").strip()
    clean_acc = "".join(filter(str.isdigit, raw_acc)) if raw_acc else ""
    raw_ifsc = str(payload.get("bank_ifsc_code") or payload.get("bank_ifsc") or payload.get("ifsc") or "").strip().upper()
    clean_ifsc = "".join(ch for ch in raw_ifsc if ch.isalnum())[:11] if raw_ifsc else ""

    pay_mode = payload.get("payment_mode")
    if pay_mode and pay_mode not in dict(ClientProfile.PAYMENT_MODE_CHOICES):
        pay_mode = None

    employee = Employee.objects.create(
        client=submission.client,
        employee_code=code,
        first_name=str(payload["first_name"]).strip(),
        last_name=str(payload.get("last_name") or "").strip(),
        email=str(payload.get("email") or "").strip(),
        pan_number=str(payload.get("pan_number") or "").strip(),
        department=str(payload.get("department") or "").strip(),
        position=str(payload.get("position") or "").strip(),
        hire_date=hire_date,
        ctc=to_decimal(payload["ctc_annual"], "ctc_annual"),
        bank_name=str(payload.get("bank_name") or "").strip(),
        bank_account_number=clean_acc,
        bank_ifsc_code=clean_ifsc,
        payment_mode=pay_mode or ClientProfile.PAYMENT_MODE_WIRE,
    )

    if payload.get("esi_number"):
        employee.esi_number = str(payload["esi_number"]).strip()

    effective_from = (
        parse_date(payload["effective_from"])
        if payload.get("effective_from")
        else (hire_date or _first_of_month(submission))
    )
    _make_structure(
        employee,
        submission,
        {**payload, "effective_from": effective_from.isoformat()},
        approved_by,
        f"Portal new joiner — {submission.month:02d}/{submission.year}",
    )
    if payload.get("uan_number"):
        employee.uan_number = str(payload["uan_number"]).strip()
    return employee


def _apply_revision(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    prev_ctc = str(employee.ctc or 0)
    structure = _make_structure(
        employee,
        submission,
        payload,
        approved_by,
        str(payload.get("change_reason") or f"Portal revision — {submission.month:02d}/{submission.year}"),
    )
    employee.ctc = structure.ctc_annual
    employee.save(update_fields=["ctc", "updated_at"])

    # Retroactive salary arrears auto-calculation (Option 4.B toggle)
    auto_arrears = payload.get("auto_calculate_arrears", True)
    total_retro = Decimal("0.00")
    breakdown = []
    if auto_arrears:
        total_retro, breakdown = calculate_retroactive_revision_arrears(
            employee, structure, submission.year, submission.month
        )

    # Fold retroactive arrears into active batch if present (Option 4.A)
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch and total_retro > Decimal("0.00"):
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            record.arrears = (record.arrears or Decimal("0.00")) + total_retro
            if not isinstance(record.raw_row_data, dict):
                record.raw_row_data = {}
            record.raw_row_data["retro_arrears_detail"] = breakdown
            record.raw_row_data["retro_arrears_total"] = float(total_retro)
            record.save()

    payload["_prev_state"] = {
        "prev_ctc": prev_ctc,
        "created_structure_id": structure.id,
        "retro_arrears_added": str(total_retro),
        "retro_breakdown": breakdown,
    }
    item.payload = payload
    return structure


def _apply_exit(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    prev_status = employee.status
    prev_lwd = employee.last_working_date.isoformat() if employee.last_working_date else None

    lwd_str = payload.get("last_working_date")
    lwd = parse_date(lwd_str) if lwd_str else None
    today = timezone.localdate()

    employee.last_working_date = lwd
    if lwd and lwd >= today:
        # Notice period: employee is still actively serving their tenure
        employee.status = Employee.STATUS_ACTIVE
    else:
        # LWD has arrived or already passed: mark inactive
        employee.status = Employee.STATUS_INACTIVE

    employee.save(update_fields=["status", "last_working_date", "updated_at"])

    # Locate current month's batch and payslip record to execute FnF settlement
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    record = None
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()

    fnf_data = process_fnf_exit_settlement(employee, record, payload, submission, approved_by)

    payload["_prev_state"] = {
        "prev_status": prev_status,
        "prev_last_working_date": prev_lwd,
        "fnf_settlement": fnf_data,
    }
    item.payload = payload
    return employee


def _apply_hold(item, submission, approved_by):
    """Salary hold: put `amount` on hold this month, auto-release later.

    Creates a positive OnHoldAdjustment (which the batch builder folds into
    this month's payslip as on_hold_deducted, reducing net pay and growing
    the on-hold balance) plus a PortalHold row that remembers when to
    release it. materialize_due_hold_releases() turns that row into the
    negative release adjustment when the release month's batch is generated.
    """
    payload = item.payload
    employee = _get_employee(submission, payload["employee_id"])
    amount = to_decimal(payload["amount"], "amount")
    if amount <= 0:
        raise ValueError("amount must be greater than 0.")

    try:
        release_month = int(payload["release_month"])
        release_year = int(payload["release_year"])
    except (TypeError, ValueError):
        raise ValueError("release_month and release_year must be whole numbers.")
    if not (1 <= release_month <= 12):
        raise ValueError("release_month must be between 1 and 12.")
    if release_year < 2000 or release_year > 2200:
        raise ValueError("release_year is out of range.")
    if (release_year, release_month) <= (submission.year, submission.month):
        raise ValueError("release month must be later than the payroll month.")

    reason = str(payload.get("reason") or "Salary hold").strip() or "Salary hold"

    hold_adjustment = OnHoldAdjustment.objects.create(
        employee=employee,
        amount=amount,
        reason=f"Portal salary hold ({submission.month:02d}/{submission.year}): {reason}",
        created_by=approved_by,
    )
    return PortalHold.objects.create(
        item=item,
        employee=employee,
        amount=amount,
        reason=reason,
        release_month=release_month,
        release_year=release_year,
        hold_adjustment=hold_adjustment,
    )


def _apply_advance(item, submission, approved_by):
    payload = item.payload
    employee = _get_employee(submission, payload["employee_id"])
    total = to_decimal(payload["total_amount"], "total_amount")
    if total <= 0:
        raise ValueError("total_amount must be greater than 0.")
    tenure = to_positive_int(payload["tenure_months"], "tenure_months")
    reason = (
        str(payload.get("reason") or payload.get("label") or "Advance / loan").strip()
        or "Advance / loan"
    )
    emi = (total / tenure).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Mirror SalaryAdvanceSerializer.create: the disbursement adjustment is
    # created first (advance=None), then the plan points back at it.
    disbursement = SalaryAdvanceAdjustment.objects.create(
        employee=employee,
        amount=total,
        reason=f"Salary advance disbursement ({tenure}-month EMI plan): {reason}",
        created_by=approved_by,
    )
    advance = SalaryAdvance.objects.create(
        employee=employee,
        total_amount=total,
        tenure_months=tenure,
        emi_amount=emi,
        reason=reason,
        disbursement_adjustment=disbursement,
        created_by=approved_by,
    )
    disbursement.advance = advance
    disbursement.save(update_fields=["advance"])
    return advance


def _apply_one_time(item, submission, approved_by):
    payload = item.payload
    employee = _get_employee(submission, payload["employee_id"])
    amount = to_decimal(payload["amount"], "amount")
    if amount <= 0:
        raise ValueError("amount must be greater than 0.")
    direction = (
        PortalAdjustment.DIRECTION_EARNING
        if item.item_type == PortalSubmissionItem.TYPE_ONE_TIME_EARNING
        else PortalAdjustment.DIRECTION_DEDUCTION
    )
    return PortalAdjustment.objects.create(
        employee=employee,
        item=item,
        direction=direction,
        amount=amount,
        description=str(payload.get("description") or "").strip(),
        month=submission.month,
        year=submission.year,
    )


def _apply_tds(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    amount = to_decimal(payload["amount"], "amount")
    if amount < 0:
        raise ValueError("TDS amount cannot be negative.")
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            payload["_prev_state"] = {"tds": str(record.tds or 0)}
            item.payload = payload
            record.tds = amount
            record.save()
    return None


def _apply_lop(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    days = to_decimal(payload["days"], "days")
    if days < 0:
        raise ValueError("LOP days cannot be negative.")
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            payload["_prev_state"] = {"lop_days": str(record.lop_days or 0)}
            item.payload = payload
            record.lop_days = days
            client_profile = getattr(submission.client, "payroll_profile", None)
            lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
            if lop_policy == "REDUCE_SALARY":
                record.actual_working_days = max(
                    Decimal("0"),
                    Decimal(str(record.days_in_month)) - days - Decimal(str(record.paid_leave_days or 0))
                )
            latest_structure = (
                get_effective_salary_structures_for_month(
                    employee, submission.year, submission.month, record.days_in_month
                )
                or record.salary_structure_snapshot
                or get_latest_salary_structure(employee)
            )
            row = _attendance_row_for(record)
            row["lop_days"] = days
            row["actual_working_days"] = record.actual_working_days
            pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
            pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
            annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
            probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
            track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
            track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

            computed = calculate_payslip_fields(
                latest_structure,
                row,
                submission.month,
                record.days_in_month,
                comp_off_opening_balance=record.comp_off_opening_balance,
                leave_opening_balance=record.leave_opening_balance,
                is_probation=is_in_probation(employee.hire_date, submission.year, submission.month, probation_months=probation_months),
                lop_policy=lop_policy,
                pt_state=pt_state,
                pt_amount=pt_amount,
                annual_leave_days=annual_leave_days,
                employee_gender=getattr(employee, "gender", "M"),
                track_leave_ledger=track_leave_ledger,
                track_comp_off=track_comp_off,
                client_profile=client_profile,
            )
            computed.pop("gross_salary", None)
            computed.pop("comp_off_opening_balance", None)
            computed.pop("leave_opening_balance", None)
            esi_val = computed.pop("esi", None)
            emp_esi_val = computed.pop("employer_esi", None)
            for field_name, value in computed.items():
                setattr(record, field_name, value)
            if esi_val is not None:
                record.esi = esi_val
            if emp_esi_val is not None:
                record.employer_esi = emp_esi_val
            record.save()
    return None


def _apply_arrears(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    amount = to_decimal(payload["amount"], "amount")
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            payload["_prev_state"] = {"arrears": str(record.arrears or 0)}
            item.payload = payload
            record.arrears = amount
            record.save()
    return None


def _apply_reimbursement(item, submission, approved_by):
    payload = item.payload or {}
    employee = _get_employee(submission, payload["employee_id"])
    amount = to_decimal(payload["amount"], "amount")
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            payload["_prev_state"] = {"reimbursements": str(record.reimbursements or 0)}
            item.payload = payload
            record.reimbursements = amount
            record.save()
    return None


def _apply_note(item, submission, approved_by):
    return None


def _apply_custom_component(item, submission, approved_by):
    payload = item.payload
    employee = _get_employee(submission, payload["employee_id"])
    code = str(payload.get("component_code") or "").strip().upper()
    amount = to_decimal(payload.get("amount", 0), "amount")
    desc = str(payload.get("description") or "").strip()

    comp_type = "EARNING"
    comp = None
    if hasattr(submission.client, "custom_salary_components"):
        comp = submission.client.custom_salary_components.filter(code=code).first()
        if comp and comp.component_type == "DEDUCTION":
            comp_type = "DEDUCTION"
    direction = (
        PortalAdjustment.DIRECTION_EARNING
        if comp_type == "EARNING"
        else PortalAdjustment.DIRECTION_DEDUCTION
    )

    adj = PortalAdjustment.objects.create(
        employee=employee,
        item=item,
        direction=direction,
        amount=amount,
        description=f"CUSTOM:{code}:{desc}",
        month=submission.month,
        year=submission.year,
    )

    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch:
        record = PayslipRecord.objects.filter(batch=batch, employee=employee).first()
        if record:
            adj.applied_in_record = record
            adj.save(update_fields=["applied_in_record"])
            if isinstance(record.custom_components, dict):
                list_key = "earnings" if comp_type == "EARNING" else "deductions"
                found = False
                for c_item in record.custom_components.get(list_key, []):
                    if c_item.get("code") == code or c_item.get("abbr") == code:
                        c_item["amount"] = float(amount)
                        c_item["source"] = "MONTHLY_INPUT"
                        found = True
                        break
                if not found:
                    record.custom_components.setdefault(list_key, []).append({
                        "code": code,
                        "name": comp.name if comp else code,
                        "abbr": comp.abbr if comp else code[:6],
                        "amount": float(amount),
                        "source": "MONTHLY_INPUT",
                        "depends_on_payment_days": comp.depends_on_payment_days if comp else True,
                        "do_not_include_in_total": comp.do_not_include_in_total if comp else False,
                    })
                record.save()
    return adj


_HANDLERS = {
    PortalSubmissionItem.TYPE_NEW_EMPLOYEE: _apply_new_employee,
    PortalSubmissionItem.TYPE_REVISION: _apply_revision,
    PortalSubmissionItem.TYPE_EXIT: _apply_exit,
    PortalSubmissionItem.TYPE_SALARY_HOLD: _apply_hold,
    PortalSubmissionItem.TYPE_ADVANCE: _apply_advance,
    PortalSubmissionItem.TYPE_ONE_TIME_EARNING: _apply_one_time,
    PortalSubmissionItem.TYPE_ONE_TIME_DEDUCTION: _apply_one_time,
    PortalSubmissionItem.TYPE_NOTE: _apply_note,
    PortalSubmissionItem.TYPE_TDS: _apply_tds,
    PortalSubmissionItem.TYPE_LOP: _apply_lop,
    PortalSubmissionItem.TYPE_ARREARS: _apply_arrears,
    PortalSubmissionItem.TYPE_REIMBURSEMENT: _apply_reimbursement,
    PortalSubmissionItem.TYPE_CUSTOM_COMPONENT: _apply_custom_component,
}


def materialize_due_hold_releases(client, month: int, year: int, released_by) -> int:
    """
    Creates the release (negative) OnHoldAdjustment for every portal hold
    whose release month/year matches the batch about to be generated for
    `client`, so the held amount is paid back in that month. Idempotent —
    holds already released (release_adjustment set) are skipped. Returns the
    number of releases materialized.

    Called by PayrollUploadView.upload and generate_from_portal BEFORE they
    build PayslipRecords, so the new adjustments are picked up by
    _build_record_for_employee just like any other pending on-hold row.
    """
    due = PortalHold.objects.filter(
        employee__client=client,
        release_month=month,
        release_year=year,
        release_adjustment__isnull=True,
    ).select_related("employee")
    created = 0
    for hold in due:
        release = OnHoldAdjustment.objects.create(
            employee=hold.employee,
            amount=-hold.amount,
            reason=f"Portal salary hold release ({month:02d}/{year}): {hold.reason or 'Salary hold'}",
            created_by=released_by,
        )
        hold.release_adjustment = release
        hold.save(update_fields=["release_adjustment"])
        created += 1
    return created


def sync_due_employee_exits(client=None) -> int:
    """
    Transitions employees from active to inactive once their last_working_date
    has passed (i.e. today > last_working_date). Idempotent. Returns the count
    of employees deactivated.
    """
    today = timezone.localdate()
    qs = Employee.objects.filter(
        status=Employee.STATUS_ACTIVE,
        last_working_date__isnull=False,
        last_working_date__lt=today,
    )
    if client is not None:
        qs = qs.filter(client=client)
    return qs.update(status=Employee.STATUS_INACTIVE)


def apply_item(item, approved_by):
    """Applies a single item, marking it APPLIED / FAILED / SKIPPED.

    Returns True when the item applied, False when it failed or was skipped.
    Used by the staff "add input" flow (staff items apply immediately — the
    staff member IS the approver) and by apply_submission below.
    """
    if item.status == PortalSubmissionItem.STATUS_SKIPPED:
        return False
    handler = _HANDLERS.get(item.item_type)
    if handler is None:
        item.status = PortalSubmissionItem.STATUS_SKIPPED
        item.error = f"Unsupported item type: {item.item_type}"
        item.save(update_fields=["status", "error", "updated_at"])
        return False
    try:
        # Savepoint: a failing item rolls back its own partial writes.
        with transaction.atomic():
            handler(item, item.submission, approved_by)
    except Exception as exc:  # noqa: BLE001 — record per-item failure, keep going
        item.status = PortalSubmissionItem.STATUS_FAILED
        item.error = str(exc)
        item.save(update_fields=["status", "error", "updated_at"])
        return False
    else:
        item.status = PortalSubmissionItem.STATUS_APPLIED
        item.error = ""
        item.save(update_fields=["status", "error", "payload", "updated_at"])
        return True


def apply_submission(submission, approved_by, allow_unsubmitted=False, items_qs=None):
    """
    Applies every non-applied item of a submitted month.

    Returns {"applied": n, "failed": n, "skipped": n}. Idempotent per item:
    APPLIED items are left alone; PENDING and FAILED items are (re)attempted.

    A month works in ROUNDS: after every approval the submission reopens as
    DRAFT so the client can record further changes in the same month
    (mid-month joiners, revisions, exits…) and submit again. Re-approval
    only ever touches items that aren't applied yet, so repeat rounds are
    safe. Items that failed this round stay FAILED (with the reason) and are
    retried next round after the client fixes them — the submission reopens
    regardless, so the client can correct and resubmit without you having to
    reject first. approved_by/approved_at always record the last approval.
    """
    # `allow_unsubmitted` is used by the staff-side "apply pending changes"
    # action: a month reopens to DRAFT after every approval, so items the
    # client added afterwards (or keyed in by staff) can sit unapplied in a
    # DRAFT month with no way to approve them. Staff members are the
    # approvers, so they may apply those directly.
    #
    # REJECTED is deliberately NOT in that list: you returned the month
    # precisely because the values were wrong, so bulk-applying the same
    # items afterwards would push the rejected data into payroll. A rejected
    # month waits for the client's corrected resubmission (or for staff to
    # skip/fix the individual items).
    allowed = [
        PortalSubmission.STATUS_SUBMITTED,
        PortalSubmission.STATUS_APPROVED,
    ]
    if allow_unsubmitted:
        allowed.append(PortalSubmission.STATUS_DRAFT)
    if submission.status not in allowed:
        raise ValueError("Only submitted submissions can be applied.")

    summary = {"applied": 0, "failed": 0, "skipped": 0}
    if items_qs is not None:
        items = items_qs.exclude(status__in=[PortalSubmissionItem.STATUS_APPLIED, PortalSubmissionItem.STATUS_SKIPPED]).order_by("sort", "id")
    else:
        items = submission.items.exclude(status__in=[PortalSubmissionItem.STATUS_APPLIED, PortalSubmissionItem.STATUS_SKIPPED]).order_by(
            "sort", "id"
        )

    applied_items = []
    with transaction.atomic():
        for item in items:
            if apply_item(item, approved_by):
                summary["applied"] += 1
                applied_items.append(item)
            elif item.status == PortalSubmissionItem.STATUS_SKIPPED:
                summary["skipped"] += 1
            else:
                summary["failed"] += 1

        submission.approved_by = approved_by
        submission.approved_at = timezone.now()
        submission.rejection_reason = ""
        # Reopen the month for the next round — a client may submit several
        # times within the same month. Item-level APPLIED/FAILED statuses
        # preserve the history of what already happened.
        submission.status = PortalSubmission.STATUS_DRAFT
        submission.save(
            update_fields=[
                "status", "approved_by", "approved_at", "rejection_reason", "updated_at",
            ]
        )

        # Record the round so the client's History still shows "Approved and
        # applied" after the month reopens as DRAFT (the submission row's own
        # status can't hold that).
        record_event(
            submission,
            PortalSubmissionEvent.TYPE_APPROVED,
            item_count=summary["applied"],
            actor_staff=approved_by,
        )

        # If this month's payroll batch was already generated (an earlier
        # round), fold the just-applied changes straight into its payslip
        # records — otherwise a second round's money would be marked
        # APPLIED in the portal yet never show up on the payslips.
        if applied_items:
            refresh_batch_after_apply(submission, approved_by, applied_items)

    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Batch sync — fold later-round portal changes into an already-generated batch
# ─────────────────────────────────────────────────────────────────────────────


def _synthetic_row(days_in_month: int) -> dict:
    """The full-attendance, zero-extra row a portal-generated record starts
    from — mirrors the row PayrollUploadView.generate_from_portal builds."""
    return {
        "actual_working_days": days_in_month,
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


def _attendance_row_for(record) -> dict:
    """Rebuild the raw `row` dict used to (re)compute a record — same shape
    the Batch Review attendance-edit path passes to calculate_payslip_fields,
    so a revision recompute can't double-count the structure baseline."""
    return {
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


def calculate_retroactive_revision_arrears(
    employee,
    new_structure,
    current_year: int,
    current_month: int,
) -> tuple[Decimal, list[dict]]:
    """
    Calculates retroactive salary differential arrears between new_structure.effective_from
    and the start of (current_year, current_month).
    Inspects each past closed batch where a PayslipRecord exists for this employee,
    evaluating the difference between the new earned salary and what was originally paid.
    Returns (total_retro_arrears, itemized_breakdown_list).
    """
    if not new_structure or not getattr(new_structure, "effective_from", None):
        return Decimal("0.00"), []

    curr_start = date(current_year, current_month, 1)
    if new_structure.effective_from >= curr_start:
        return Decimal("0.00"), []

    target_months = []
    y, m = new_structure.effective_from.year, new_structure.effective_from.month
    while date(y, m, 1) < curr_start:
        target_months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    total_arrears = Decimal("0.00")
    breakdown_list = []
    client_profile = getattr(employee.client, "payroll_profile", None)

    for past_y, past_m in target_months:
        past_record = PayslipRecord.objects.filter(
            batch__client=employee.client,
            batch__year=past_y,
            batch__month=past_m,
            employee=employee,
        ).first()

        if not past_record:
            continue

        # What was earned base originally (excluding any previously applied arrears)
        old_earned_base = past_record.earned_salary - Decimal(str(past_record.arrears or 0))

        # Rebuild attendance row for this past record, zeroing arrears
        past_row = _attendance_row_for(past_record)
        past_row["arrears"] = Decimal("0.00")

        # Resolve effective structure for this past month (handles mid-month splits)
        effective_past_struct = (
            get_effective_salary_structures_for_month(
                employee, past_y, past_m, past_record.days_in_month
            )
            or new_structure
        )

        try:
            computed = calculate_payslip_fields(
                effective_past_struct,
                past_row,
                past_m,
                past_record.days_in_month,
                comp_off_opening_balance=past_record.comp_off_opening_balance,
                leave_opening_balance=past_record.leave_opening_balance,
                is_probation=is_in_probation(
                    employee.hire_date,
                    past_y,
                    past_m,
                    probation_months=getattr(client_profile, "probation_months", 6) if client_profile else 6,
                ),
                lop_policy=getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT",
                pt_state=getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA",
                pt_amount=getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0"),
                annual_leave_days=getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22"),
                employee_gender=getattr(employee, "gender", "M"),
                track_leave_ledger=getattr(client_profile, "track_leave_ledger", True) if client_profile else True,
                track_comp_off=getattr(client_profile, "track_comp_off", True) if client_profile else True,
                client_profile=client_profile,
            )
            new_earned_base = computed.get("earned_salary", Decimal("0.00"))
            monthly_diff = max(Decimal("0.00"), (new_earned_base - old_earned_base).quantize(Decimal("0.01")))
        except Exception:
            monthly_diff = Decimal("0.00")

        if monthly_diff > Decimal("0.00"):
            total_arrears += monthly_diff
            breakdown_list.append({
                "year": past_y,
                "month": past_m,
                "month_name": f"{calendar.month_name[past_m]} {past_y}",
                "old_earned": float(old_earned_base),
                "new_earned": float(new_earned_base),
                "diff": float(monthly_diff),
            })

    return total_arrears.quantize(Decimal("0.01")), breakdown_list


def process_fnf_exit_settlement(employee, record, payload, submission, approved_by) -> dict:
    """
    Executes the Full & Final (FnF) exit settlement for an exiting employee:
    1. Accelerates any active SalaryAdvance remaining balances into salary_advance_recovered.
    2. Recovers negative leave debt under ACCRUE_LEAVE_DEBT (leave_closing_balance < 0).
    3. Calculates Leave Encashment credit (leave_closing_balance > 0) using ClientProfile policy.
    4. Handles Notice period shortfall recovery or notice pay credits if passed in payload.
    5. Net-pay shortfall guard: caps total deductions to available earnings (Option 5.B).
    6. Returns structured fnf summary dict (Option 5.A).
    """
    fnf_data = {
        "accelerated_advances": 0.0,
        "leave_encashment_days": 0.0,
        "leave_encashment_amount": 0.0,
        "leave_debt_days": 0.0,
        "leave_debt_recovery": 0.0,
        "notice_shortfall_days": 0.0,
        "notice_shortfall_deduction": 0.0,
        "notice_pay_days": 0.0,
        "notice_pay_earning": 0.0,
        "unrecovered_shortfall": 0.0,
    }
    client_profile = getattr(employee.client, "payroll_profile", None)

    # 1. Advance / Loan Acceleration
    active_advances = SalaryAdvance.objects.filter(
        employee=employee, months_recovered__lt=models.F("tenure_months")
    ).select_related("disbursement_adjustment")

    total_accel_advance = Decimal("0.00")
    for adv in active_advances:
        if adv.disbursement_adjustment and adv.disbursement_adjustment.applied_in_record_id is None:
            continue
        already_rec = adv.emi_amount * adv.months_recovered
        rem = max(Decimal("0.00"), adv.total_amount - already_rec)
        if rem > Decimal("0.00"):
            adj = SalaryAdvanceAdjustment.objects.create(
                employee=employee,
                amount=-rem,
                reason=f"FnF Full Acceleration: Advance #{adv.id} remaining balance",
                advance=adv,
                created_by=approved_by,
            )
            if record:
                adj.applied_in_record = record
                adj.save(update_fields=["applied_in_record"])
            total_accel_advance += rem

    fnf_data["accelerated_advances"] = float(total_accel_advance)

    if not record:
        return fnf_data

    # Recompute record structure so attendance and leave balance are up-to-date
    recompute_record_structure(record, employee, submission.client, submission.month, submission.year)

    structure = (
        record.salary_structure_snapshot
        or get_latest_salary_structure(employee)
    )
    basic_val = getattr(structure, "basic_da", Decimal("0.00")) if structure else Decimal("0.00")
    gross_val = getattr(structure, "gross_salary", Decimal("0.00")) if structure else Decimal("0.00")

    leave_base = getattr(client_profile, "leave_encashment_base", "BASIC") if client_profile else "BASIC"
    base_wage = basic_val if leave_base == "BASIC" else gross_val
    divisor_str = getattr(client_profile, "leave_encashment_divisor", "30") if client_profile else "30"
    divisor = Decimal(str(divisor_str or 30))
    daily_rate = (base_wage / divisor).quantize(Decimal("0.01")) if divisor > 0 else Decimal("0.00")

    # 2. Leave Balance Settlement
    leave_bal = Decimal(str(record.leave_closing_balance or 0))
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"

    if leave_bal > Decimal("0.00") and payload.get("encash_leaves", True):
        encash_amt = (leave_bal * daily_rate).quantize(Decimal("0.01"))
        record.commission_other = (record.commission_other or Decimal("0.00")) + encash_amt
        fnf_data["leave_encashment_days"] = float(leave_bal)
        fnf_data["leave_encashment_amount"] = float(encash_amt)
    elif leave_bal < Decimal("0.00") and lop_policy == "ACCRUE_LEAVE_DEBT":
        debt_days = abs(leave_bal)
        debt_rec = (debt_days * daily_rate).quantize(Decimal("0.01"))
        record.other_deduction = (record.other_deduction or Decimal("0.00")) + debt_rec
        fnf_data["leave_debt_days"] = float(debt_days)
        fnf_data["leave_debt_recovery"] = float(debt_rec)

    # 3. Notice Pay / Notice Shortfall
    shortfall_days = Decimal(str(payload.get("notice_shortfall_days") or 0))
    if shortfall_days > Decimal("0.00"):
        sf_ded = (shortfall_days * daily_rate).quantize(Decimal("0.01"))
        record.other_deduction = (record.other_deduction or Decimal("0.00")) + sf_ded
        fnf_data["notice_shortfall_days"] = float(shortfall_days)
        fnf_data["notice_shortfall_deduction"] = float(sf_ded)

    notice_pay_days = Decimal(str(payload.get("notice_pay_days") or 0))
    if notice_pay_days > Decimal("0.00"):
        np_earn = (notice_pay_days * daily_rate).quantize(Decimal("0.01"))
        record.commission_other = (record.commission_other or Decimal("0.00")) + np_earn
        fnf_data["notice_pay_days"] = float(notice_pay_days)
        fnf_data["notice_pay_earning"] = float(np_earn)

    # 4. Fold accelerated advances
    if total_accel_advance > Decimal("0.00"):
        record.salary_advance_recovered = (record.salary_advance_recovered or Decimal("0.00")) + total_accel_advance

    # 5. Net-Pay Shortfall Guard (Option 5.B)
    record.save()
    if record.total_deductions > record.earned_salary:
        excess = record.total_deductions - record.earned_salary
        fnf_data["unrecovered_shortfall"] = float(excess)
        if record.other_deduction and record.other_deduction >= excess:
            record.other_deduction = record.other_deduction - excess
        elif record.salary_advance_recovered and record.salary_advance_recovered >= excess:
            record.salary_advance_recovered = record.salary_advance_recovered - excess
        record.save()

    # Option 5.A: Store structured FnF metadata
    if not isinstance(record.raw_row_data, dict):
        record.raw_row_data = {}
    record.raw_row_data["fnf_settlement"] = fnf_data
    record.save()

    return fnf_data


def _build_record_for_joiner(batch, employee, submission, days_in_month) -> PayslipRecord:
    """Creates the missing payslip record for an employee who joined after the
    batch was generated (a NEW_EMPLOYEE item in a later round)."""
    latest_structure = get_effective_salary_structures_for_month(
        employee, submission.year, submission.month, days_in_month
    )
    if latest_structure is None and getattr(employee, "ctc", None) and employee.ctc > 0:
        effective_from = employee.hire_date or date(submission.year, submission.month, 1)
        latest_structure = EmployeeSalaryStructure.objects.create(
            employee=employee,
            effective_from=effective_from,
            change_reason=f"Auto-generated from Employee CTC (₹{employee.ctc:,.2f}) for batch {submission.month:02d}/{submission.year}",
            **EmployeeSalaryStructure.build_from_ctc(employee.ctc, pf_opted=True, client=submission.client, employee=employee),
        )
    # Prorate actual working days if employee joined or exited within this payroll cycle
    profile = getattr(submission.client, "payroll_profile", None)
    if profile and hasattr(profile, "get_cycle_dates"):
        cycle_start, cycle_end, _ = profile.get_cycle_dates(submission.year, submission.month)
    else:
        cycle_start = date(submission.year, submission.month, 1)
        cycle_end = date(submission.year, submission.month, days_in_month)

    hire_d = getattr(employee, "hire_date", None)
    lwd_d = getattr(employee, "last_working_date", None)
    eff_start = max(cycle_start, hire_d) if hire_d else cycle_start
    eff_end = min(cycle_end, lwd_d) if lwd_d else cycle_end
    if eff_end < eff_start:
        working_span = 0
    else:
        working_span = max(0, min(days_in_month, (eff_end - eff_start).days + 1))
    actual_days = Decimal(str(working_span))

    row = _synthetic_row(days_in_month)
    row["actual_working_days"] = actual_days
    client_profile = getattr(submission.client, "payroll_profile", None)
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
    pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
    pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
    annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
    probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
    track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
    track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

    computed = calculate_payslip_fields(
        latest_structure,
        row,
        submission.month,
        days_in_month,
        comp_off_opening_balance=Decimal("0"),
        leave_opening_balance=Decimal("0"),
        is_probation=is_in_probation(employee.hire_date, submission.year, submission.month, probation_months=probation_months),
        lop_policy=lop_policy,
        pt_state=pt_state,
        pt_amount=pt_amount,
        annual_leave_days=annual_leave_days,
        employee_gender=getattr(employee, "gender", "M"),
        track_leave_ledger=track_leave_ledger,
        track_comp_off=track_comp_off,
        client_profile=client_profile,
    )
    # calculate_payslip_fields() already returns the prorated+upload combined
    # values for these three, so they must come out of `row` before the
    # spread (same pop as _build_record_for_employee); the raw uploads are
    # stored on the *_upload fields instead (all zero for a new joiner).
    lta_upload = row.pop("lta", Decimal("0"))
    special_allowance_upload = row.pop("special_allowance", Decimal("0"))
    nps_allowance_upload = row.pop("nps_allowance_earned", Decimal("0"))
    row.pop("esi", None)
    row.pop("employer_esi", None)
    row.pop("employer_pf", None)
    row_custom = row.pop("custom_components", {})
    computed.pop("esi", None)
    computed.pop("employer_esi", None)
    emp_pf_val = computed.pop("employer_pf", None)
    if "custom_components" not in computed and getattr(latest_structure, "custom_components", None):
        computed["custom_components"] = latest_structure.custom_components
    computed_custom = computed.get("custom_components")
    if not isinstance(computed_custom, dict):
        computed_custom = {}
    if isinstance(row_custom, dict):
        computed_custom.update(row_custom)
    if emp_pf_val is not None:
        computed_custom["employer_pf"] = str(emp_pf_val)
    computed["custom_components"] = computed_custom

    persisted_structure = getattr(latest_structure, "_persisted_structure", latest_structure)
    valid_record_fields = {f.name for f in PayslipRecord._meta.get_fields()}
    safe_row = {k: v for k, v in row.items() if k in valid_record_fields}
    safe_computed = {k: v for k, v in computed.items() if k in valid_record_fields}
    record_kwargs = {**safe_row, **safe_computed}
    rec = PayslipRecord.objects.create(
        batch=batch,
        employee=employee,
        salary_structure_snapshot=persisted_structure,
        days_in_month=days_in_month,
        salary_advance_opening_balance=Decimal("0"),
        on_hold_opening_balance=Decimal("0"),
        lta_upload=lta_upload,
        special_allowance_upload=special_allowance_upload,
        nps_allowance_upload=nps_allowance_upload,
        **record_kwargs,
    )
    if emp_pf_val is not None:
        rec.employer_pf = emp_pf_val
    return rec


def recompute_record_structure(record, employee, client, month: int, year: int):
    """Recomputes a PayslipRecord's salary structure components and recalculates
    payslip fields based on current attendance and tenure boundaries."""
    latest_structure = get_effective_salary_structures_for_month(employee, year, month, record.days_in_month)
    if latest_structure is None and getattr(employee, "ctc", None) and employee.ctc > 0:
        effective_from = employee.hire_date or date(year, month, 1)
        latest_structure = EmployeeSalaryStructure.objects.create(
            employee=employee,
            effective_from=effective_from,
            change_reason=f"Auto-generated from Employee CTC (₹{employee.ctc:,.2f}) for batch {month:02d}/{year}",
            **EmployeeSalaryStructure.build_from_ctc(employee.ctc, pf_opted=True, client=client, employee=employee),
        )
    row = _attendance_row_for(record)
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
        METADATA_KEYS = {"esi_opted", "employer_esi", "employer_esi_in_ctc", "esi_number", "uan_number", "employer_pf"}
        for code, val in record.custom_components.items():
            if code in ("earnings", "deductions") or code in METADATA_KEYS:
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
    if preserved_row_custom:
        row["custom_components"] = preserved_row_custom

    client_profile = getattr(client, "payroll_profile", None)
    lop_policy = getattr(client_profile, "lop_policy", "ACCRUE_LEAVE_DEBT") if client_profile else "ACCRUE_LEAVE_DEBT"
    pt_state = getattr(client_profile, "pt_state", "KARNATAKA") if client_profile else "KARNATAKA"
    pt_amount = getattr(client_profile, "pt_amount", Decimal("0")) if client_profile else Decimal("0")
    annual_leave_days = getattr(client_profile, "annual_leave_days", Decimal("22")) if client_profile else Decimal("22")
    probation_months = getattr(client_profile, "probation_months", 6) if client_profile else 6
    track_leave_ledger = getattr(client_profile, "track_leave_ledger", True) if client_profile else True
    track_comp_off = getattr(client_profile, "track_comp_off", True) if client_profile else True

    computed = calculate_payslip_fields(
        latest_structure,
        row,
        month,
        record.days_in_month,
        comp_off_opening_balance=record.comp_off_opening_balance,
        leave_opening_balance=record.leave_opening_balance,
        is_probation=is_in_probation(employee.hire_date, year, month, probation_months=probation_months),
        lop_policy=lop_policy,
        pt_state=pt_state,
        pt_amount=pt_amount,
        annual_leave_days=annual_leave_days,
        employee_gender=getattr(employee, "gender", "M"),
        track_leave_ledger=track_leave_ledger,
        track_comp_off=track_comp_off,
        client_profile=client_profile,
    )
    persisted_structure = getattr(latest_structure, "_persisted_structure", latest_structure)
    record.salary_structure_snapshot = persisted_structure
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
    return record


def _fold_into_record(record, employee, submission, approved_by, recompute_structure, commit=True, preloaded_adjs=None):
    """Folds this employee's just-created pending adjustments into an existing
    payslip record and (optionally) re-derives structure fields after a
    revision. Marks the adjustments as applied so they are never folded twice.
    """
    month, year = submission.month, submission.year

    if preloaded_adjs and "portal" in preloaded_adjs:
        pending_portal = preloaded_adjs["portal"].get(employee.id, [])
    else:
        pending_portal = list(
            PortalAdjustment.objects.filter(
                employee=employee, month=month, year=year, applied_in_record__isnull=True
            )
        )
    portal_earnings = sum(
        (a.amount for a in pending_portal if a.direction == PortalAdjustment.DIRECTION_EARNING),
        Decimal("0"),
    )
    portal_deductions = sum(
        (a.amount for a in pending_portal if a.direction == PortalAdjustment.DIRECTION_DEDUCTION),
        Decimal("0"),
    )
    if portal_earnings or portal_deductions:
        record.commission_other = Decimal(record.commission_other or 0) + portal_earnings
        record.other_deduction = Decimal(record.other_deduction or 0) + portal_deductions

    if preloaded_adjs and "hold" in preloaded_adjs:
        pending_hold = preloaded_adjs["hold"].get(employee.id, [])
    else:
        pending_hold = list(
            OnHoldAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
        )
    if pending_hold:
        record.on_hold_deducted = Decimal(record.on_hold_deducted or 0) + sum(
            (a.amount for a in pending_hold if a.amount >= 0), Decimal("0")
        )
        record.on_hold_released = Decimal(record.on_hold_released or 0) + sum(
            (-a.amount for a in pending_hold if a.amount < 0), Decimal("0")
        )

    if preloaded_adjs and "advance" in preloaded_adjs:
        pending_advance = preloaded_adjs["advance"].get(employee.id, [])
    else:
        pending_advance = list(
            SalaryAdvanceAdjustment.objects.filter(employee=employee, applied_in_record__isnull=True)
        )
    if pending_advance:
        record.salary_advance_disbursed = Decimal(record.salary_advance_disbursed or 0) + sum(
            (a.amount for a in pending_advance if a.amount >= 0), Decimal("0")
        )
        record.salary_advance_recovered = Decimal(record.salary_advance_recovered or 0) + sum(
            (-a.amount for a in pending_advance if a.amount < 0), Decimal("0")
        )

    # Fold specific field overrides from applied portal items
    if preloaded_adjs and "items_by_emp" in preloaded_adjs:
        emp_items = preloaded_adjs["items_by_emp"].get(employee.id, [])
    else:
        emp_items = [
            it for it in submission.items.filter(status=PortalSubmissionItem.STATUS_APPLIED)
            if str((it.payload or {}).get("employee_id")) == str(employee.id)
        ]
    for it in emp_items:
        p = it.payload or {}
        if it.item_type == PortalSubmissionItem.TYPE_TDS and "amount" in p:
            record.tds = to_decimal(p["amount"], "amount")
        elif it.item_type == PortalSubmissionItem.TYPE_ARREARS and "amount" in p:
            record.arrears = to_decimal(p["amount"], "amount")
        elif it.item_type == PortalSubmissionItem.TYPE_REIMBURSEMENT and "amount" in p:
            record.reimbursements = to_decimal(p["amount"], "amount")
        elif it.item_type == PortalSubmissionItem.TYPE_LOP and "days" in p:
            record.lop_days = to_decimal(p["days"], "days")
            recompute_structure = True
        elif it.item_type == PortalSubmissionItem.TYPE_EXIT:
            recompute_structure = True

    # Auto-prorate actual_working_days if employee joined or exited during this payroll month
    start_day = 1
    if (
        employee.hire_date
        and employee.hire_date.year == year
        and employee.hire_date.month == month
    ):
        start_day = employee.hire_date.day

    end_day = record.days_in_month
    if (
        employee.last_working_date
        and employee.last_working_date.year == year
        and employee.last_working_date.month == month
    ):
        end_day = employee.last_working_date.day

    max_working_span = max(0, min(record.days_in_month, end_day) - max(1, start_day) + 1)
    prorated_days = Decimal(str(max_working_span))
    lop_d = Decimal(str(record.lop_days or 0))
    paid_d = Decimal(str(record.paid_leave_days or 0))
    target_actual_days = max(Decimal("0"), prorated_days - lop_d - paid_d)

    has_exit_item = any(it.item_type == PortalSubmissionItem.TYPE_EXIT for it in emp_items)
    is_tenure_bounded = end_day < record.days_in_month or start_day > 1
    lop_policy = getattr(getattr(submission.client, "payroll_profile", None), "lop_policy", "ACCRUE_LEAVE_DEBT")
    if is_tenure_bounded or has_exit_item or (lop_policy == "REDUCE_SALARY" and lop_d > 0):
        if record.actual_working_days == 0 or record.actual_working_days > target_actual_days or has_exit_item:
            if record.actual_working_days != target_actual_days:
                record.actual_working_days = target_actual_days
                recompute_structure = True

    if recompute_structure:
        recompute_record_structure(record, employee, submission.client, month, year)

    record.recompute_totals_and_balances()

    if commit:
        record.save()

        if pending_portal:
            PortalAdjustment.objects.filter(id__in=[a.id for a in pending_portal]).update(
                applied_in_record=record
            )
        if pending_hold:
            OnHoldAdjustment.objects.filter(id__in=[a.id for a in pending_hold]).update(
                applied_in_record=record
            )
        if pending_advance:
            SalaryAdvanceAdjustment.objects.filter(id__in=[a.id for a in pending_advance]).update(
                applied_in_record=record
            )
            recovered_advance_ids = [
                a.advance_id for a in pending_advance if a.advance_id is not None and a.amount < 0
            ]
            if recovered_advance_ids:
                SalaryAdvance.objects.filter(id__in=recovered_advance_ids).update(
                    months_recovered=F("months_recovered") + 1
                )

    return (record, pending_portal, pending_hold, pending_advance)


def refresh_batch_after_apply(submission, approved_by, applied_items):
    """After a (re-)approval applies items for a month, push those changes into
    the month's payroll batch if it already exists.

    No-op when the batch hasn't been generated yet — generate-from-portal
    builds every active employee's record (and folds pending adjustments) then.
    When it DOES exist, this is what keeps a second (or third…) round's
    money visible on the payslips instead of sitting unapplied forever.
    """
    batch = PayrollBatch.objects.filter(
        client=submission.client, month=submission.month, year=submission.year
    ).first()
    if batch is None:
        return

    employee_ids = set()
    new_employee_codes = []
    revision_employee_ids = set()
    for item in applied_items:
        payload = item.payload or {}
        if item.item_type == PortalSubmissionItem.TYPE_NEW_EMPLOYEE:
            code = str(payload.get("employee_code") or "").strip()
            if code:
                new_employee_codes.append(code)
            continue
        if item.item_type == PortalSubmissionItem.TYPE_NOTE:
            continue
        employee_id = payload.get("employee_id")
        if not employee_id:
            continue
        employee_ids.add(int(employee_id))
        if item.item_type in (
            PortalSubmissionItem.TYPE_REVISION,
            PortalSubmissionItem.TYPE_LOP,
            PortalSubmissionItem.TYPE_EXIT,
        ):
            revision_employee_ids.add(int(employee_id))

    employees = list(
        Employee.objects.filter(client=submission.client, id__in=employee_ids)
    )
    for code in new_employee_codes:
        joiner = Employee.objects.filter(
            client=submission.client, employee_code=code
        ).first()
        if joiner is not None:
            employees.append(joiner)

    if not employees:
        return

    days_in_month = calendar.monthrange(submission.year, submission.month)[1]
    created = 0
    t0 = time.perf_counter()

    emp_ids = [e.id for e in employees]
    portal_adjs_by_emp = defaultdict(list)
    for a in PortalAdjustment.objects.filter(employee_id__in=emp_ids, month=submission.month, year=submission.year, applied_in_record__isnull=True):
        portal_adjs_by_emp[a.employee_id].append(a)

    hold_adjs_by_emp = defaultdict(list)
    for a in OnHoldAdjustment.objects.filter(employee_id__in=emp_ids, applied_in_record__isnull=True):
        hold_adjs_by_emp[a.employee_id].append(a)

    adv_adjs_by_emp = defaultdict(list)
    for a in SalaryAdvanceAdjustment.objects.filter(employee_id__in=emp_ids, applied_in_record__isnull=True):
        adv_adjs_by_emp[a.employee_id].append(a)

    items_by_emp = defaultdict(list)
    for it in submission.items.filter(status=PortalSubmissionItem.STATUS_APPLIED):
        e_id = (it.payload or {}).get("employee_id")
        if e_id:
            try:
                items_by_emp[int(e_id)].append(it)
            except Exception:
                pass

    preloaded_adjs = {
        "portal": portal_adjs_by_emp,
        "hold": hold_adjs_by_emp,
        "advance": adv_adjs_by_emp,
        "items_by_emp": items_by_emp,
    }

    existing_records = {
        r.employee_id: r for r in PayslipRecord.objects.filter(batch=batch, employee__in=employees)
    }

    records_to_bulk_update = []
    applied_portal_map = defaultdict(list)
    applied_hold_map = defaultdict(list)
    applied_adv_map = defaultdict(list)
    recovered_advance_ids_all = set()

    for employee in employees:
        record = existing_records.get(employee.id)
        if record is None:
            record = _build_record_for_joiner(batch, employee, submission, days_in_month)
            created += 1
        rec, p_portal, p_hold, p_adv = _fold_into_record(
            record,
            employee,
            submission,
            approved_by,
            recompute_structure=employee.id in revision_employee_ids,
            commit=False,
            preloaded_adjs=preloaded_adjs,
        )
        records_to_bulk_update.append(rec)

        if p_portal:
            applied_portal_map[rec.id].extend([a.id for a in p_portal])
        if p_hold:
            applied_hold_map[rec.id].extend([a.id for a in p_hold])
        if p_adv:
            applied_adv_map[rec.id].extend([a.id for a in p_adv])
            for a in p_adv:
                if a.advance_id is not None and a.amount < 0:
                    recovered_advance_ids_all.add(a.advance_id)

    if records_to_bulk_update:
        for r_rec in records_to_bulk_update:
            if isinstance(r_rec.custom_components, (dict, list)):
                r_rec.custom_components = sanitize_for_json(r_rec.custom_components)
        PayslipRecord.objects.bulk_update(records_to_bulk_update, fields=PAYSLIP_ALL_COMPUTED_FIELDS, batch_size=100)

    for rec_id, p_ids in applied_portal_map.items():
        PortalAdjustment.objects.filter(id__in=p_ids).update(applied_in_record_id=rec_id)
    for rec_id, h_ids in applied_hold_map.items():
        OnHoldAdjustment.objects.filter(id__in=h_ids).update(applied_in_record_id=rec_id)
    for rec_id, a_ids in applied_adv_map.items():
        SalaryAdvanceAdjustment.objects.filter(id__in=a_ids).update(applied_in_record_id=rec_id)
    if recovered_advance_ids_all:
        SalaryAdvance.objects.filter(id__in=list(recovered_advance_ids_all)).update(
            months_recovered=F("months_recovered") + 1
        )

    elapsed = time.perf_counter() - t0
    logger.info("Vectorized refresh_batch_after_apply completed for %d employees in %.3fs", len(employees), elapsed)

    if created:
        batch.total_records = batch.records.count()
        batch.save(update_fields=["total_records", "updated_at"])

    # Link matching PayrollJob and record event for audit trail
    try:
        from payroll.models import PayrollJob, PayrollJobEvent
        job = PayrollJob.objects.filter(
            client=submission.client, month=submission.month, year=submission.year
        ).first()
        if job:
            if not job.batch:
                job.batch = batch
                job.save(update_fields=["batch", "updated_at"])
            PayrollJobEvent.objects.create(
                job=job,
                event_type="PORTAL_UPDATES_APPLIED",
                performed_by=approved_by if getattr(approved_by, "is_authenticated", False) else None,
                performed_by_name=(
                    approved_by.get_full_name() or approved_by.username
                    if getattr(approved_by, "is_authenticated", False)
                    else "Staff"
                ),
                notes=json.dumps({
                    "applied_items_count": len(applied_items),
                    "new_records_created": created,
                    "batch_id": batch.id,
                }),
            )
    except Exception as e:
        logger.warning(f"Could not register PayrollJob event in refresh_batch_after_apply: {e}")


def revert_item(item, reverted_by) -> bool:
    """Reverts a single APPLIED item, undoing its side effects from the active
    batch and payslip records, and resets the item status back to PENDING."""
    if item.status != PortalSubmissionItem.STATUS_APPLIED:
        return False

    submission = item.submission
    client = submission.client
    month, year = submission.month, submission.year
    payload = item.payload or {}
    emp_id = payload.get("employee_id")

    with transaction.atomic():
        batch = PayrollBatch.objects.filter(client=client, month=month, year=year).first()
        record = None
        if batch and emp_id:
            record = PayslipRecord.objects.filter(batch=batch, employee_id=emp_id).first()

        item_type = item.item_type

        # 1. ONE_TIME_EARNING / ONE_TIME_DEDUCTION / CUSTOM_COMPONENT
        if item_type in (PortalSubmissionItem.TYPE_ONE_TIME_EARNING, PortalSubmissionItem.TYPE_ONE_TIME_DEDUCTION, PortalSubmissionItem.TYPE_CUSTOM_COMPONENT):
            adjs = PortalAdjustment.objects.filter(item=item)
            for adj in adjs:
                if record and adj.description.startswith("CUSTOM:"):
                    parts = adj.description.split(":", 2)
                    c_code = parts[1] if len(parts) > 1 else ""
                    if c_code and isinstance(record.custom_components, dict):
                        for cat in ("earnings", "deductions"):
                            for ci in record.custom_components.get(cat, []):
                                if ci.get("code") == c_code or ci.get("abbr") == c_code:
                                    ci["amount"] = ci.get("default_amount", 0)
                                    ci["source"] = "CONTRACT_MASTER"
                                    break
                        record.save()
                elif record:
                    if adj.direction == PortalAdjustment.DIRECTION_EARNING:
                        record.commission_other = max(Decimal("0"), Decimal(record.commission_other or 0) - adj.amount)
                    else:
                        record.other_deduction = max(Decimal("0"), Decimal(record.other_deduction or 0) - adj.amount)
                    record.save()
            adjs.delete()

        # 2. SALARY_HOLD
        elif item_type == PortalSubmissionItem.TYPE_SALARY_HOLD:
            holds = PortalHold.objects.filter(item=item)
            for hold in holds:
                if hold.hold_adjustment:
                    if record:
                        record.on_hold_deducted = max(Decimal("0"), Decimal(record.on_hold_deducted or 0) - hold.hold_adjustment.amount)
                        record.save()
                    hold.hold_adjustment.delete()
            holds.delete()

        # 3. ADVANCE
        elif item_type == PortalSubmissionItem.TYPE_ADVANCE:
            advs = SalaryAdvance.objects.filter(employee_id=emp_id).filter(
                reason__icontains=str(payload.get("reason") or payload.get("label") or "Advance")
            )
            for adv in advs:
                if adv.disbursement_adjustment:
                    if record:
                        record.salary_advance_disbursed = max(Decimal("0"), Decimal(record.salary_advance_disbursed or 0) - adv.total_amount)
                        record.save()
                    adv.disbursement_adjustment.delete()
                adv.delete()

        # 4. REVISION
        elif item_type == PortalSubmissionItem.TYPE_REVISION:
            emp = Employee.objects.filter(client=client, id=emp_id).first()
            if emp:
                prev_state = payload.get("_prev_state", {})
                prev_ctc_str = prev_state.get("prev_ctc")
                created_struct_id = prev_state.get("created_structure_id")

                # Locate structure created by this revision
                created_struct = None
                if created_struct_id:
                    created_struct = EmployeeSalaryStructure.objects.filter(id=created_struct_id, employee=emp).first()
                if not created_struct:
                    # Fallback for legacy items: find newest structure created for this revision
                    created_struct = emp.salary_structures.filter(
                        change_reason__icontains="Portal revision"
                    ).order_by("-id").first()

                if created_struct:
                    # Option 2.B: Safeguard against deleting structures referenced by older historical/other batches
                    is_referenced = PayslipRecord.objects.filter(
                        salary_structure_snapshot=created_struct
                    ).exclude(batch=batch).exists()
                    if is_referenced:
                        created_struct.change_reason = f"[REVERTED] {created_struct.change_reason}"
                        created_struct.save(update_fields=["change_reason", "updated_at"])
                    else:
                        created_struct.delete()

                # Restore previous CTC
                if prev_ctc_str is not None:
                    emp.ctc = Decimal(str(prev_ctc_str))
                else:
                    # Fallback to current latest remaining structure
                    remaining_struct = emp.salary_structures.order_by("-effective_from", "-id").first()
                    if remaining_struct and remaining_struct.ctc_annual:
                        emp.ctc = remaining_struct.ctc_annual
                emp.save(update_fields=["ctc", "updated_at"])

                # Revert retroactive arrears if they were credited
                retro_added_str = prev_state.get("retro_arrears_added")
                if record and retro_added_str:
                    retro_added = Decimal(str(retro_added_str))
                    record.arrears = max(Decimal("0.00"), (record.arrears or Decimal("0.00")) - retro_added)
                    if isinstance(record.raw_row_data, dict):
                        record.raw_row_data.pop("retro_arrears_detail", None)
                        record.raw_row_data.pop("retro_arrears_total", None)

                # Recalculate payslip record against restored salary structure
                if record:
                    recompute_record_structure(record, emp, client, month, year)
                    record.save()

        # 5. TDS
        elif item_type == PortalSubmissionItem.TYPE_TDS:
            if record:
                prev_val = payload.get("_prev_state", {}).get("tds")
                if prev_val is not None:
                    record.tds = Decimal(str(prev_val))
                else:
                    item_amt = to_decimal(payload.get("amount", 0), "amount")
                    record.tds = max(Decimal("0"), Decimal(record.tds or 0) - item_amt)
                record.save()

        # 6. ARREARS
        elif item_type == PortalSubmissionItem.TYPE_ARREARS:
            if record:
                prev_val = payload.get("_prev_state", {}).get("arrears")
                if prev_val is not None:
                    record.arrears = Decimal(str(prev_val))
                else:
                    item_amt = to_decimal(payload.get("amount", 0), "amount")
                    record.arrears = max(Decimal("0"), Decimal(record.arrears or 0) - item_amt)
                record.save()

        # 7. REIMBURSEMENT
        elif item_type == PortalSubmissionItem.TYPE_REIMBURSEMENT:
            if record:
                prev_val = payload.get("_prev_state", {}).get("reimbursements")
                if prev_val is not None:
                    record.reimbursements = Decimal(str(prev_val))
                else:
                    item_amt = to_decimal(payload.get("amount", 0), "amount")
                    record.reimbursements = max(Decimal("0"), Decimal(record.reimbursements or 0) - item_amt)
                record.save()

        # 8. LOP
        elif item_type == PortalSubmissionItem.TYPE_LOP:
            if record:
                prev_val = payload.get("_prev_state", {}).get("lop_days")
                if prev_val is not None:
                    record.lop_days = Decimal(str(prev_val))
                else:
                    item_days = to_decimal(payload.get("days", 0), "days")
                    record.lop_days = max(Decimal("0"), Decimal(record.lop_days or 0) - item_days)
                recompute_record_structure(record, record.employee, client, month, year)
                record.save()

        # 9. NEW_EMPLOYEE
        elif item_type == PortalSubmissionItem.TYPE_NEW_EMPLOYEE:
            code = payload.get("employee_code")
            emp = Employee.objects.filter(client=client, employee_code=code).first()
            if emp:
                if batch:
                    PayslipRecord.objects.filter(batch=batch, employee=emp).delete()
                    batch.total_records = batch.records.count()
                    batch.save(update_fields=["total_records", "updated_at"])
                if not PayslipRecord.objects.filter(employee=emp).exists():
                    emp.delete()

        # 10. EXIT
        elif item_type == PortalSubmissionItem.TYPE_EXIT:
            emp = Employee.objects.filter(client=client, id=emp_id).first()
            if emp:
                prev_state = payload.get("_prev_state", {})
                emp.status = prev_state.get("prev_status", Employee.STATUS_ACTIVE)
                prev_lwd = prev_state.get("prev_last_working_date")
                emp.last_working_date = parse_date(prev_lwd) if prev_lwd else None
                emp.save(update_fields=["status", "last_working_date"])

                # Roll back accelerated advances
                SalaryAdvanceAdjustment.objects.filter(
                    employee=emp,
                    reason__icontains="FnF Full Acceleration",
                    applied_in_record=record,
                ).delete()

                if record:
                    fnf_prev = prev_state.get("fnf_settlement", {})
                    encash_amt = Decimal(str(fnf_prev.get("leave_encashment_amount", 0) or 0))
                    if encash_amt > Decimal("0.00"):
                        record.commission_other = max(Decimal("0.00"), (record.commission_other or Decimal("0.00")) - encash_amt)

                    notice_earn = Decimal(str(fnf_prev.get("notice_pay_earning", 0) or 0))
                    if notice_earn > Decimal("0.00"):
                        record.commission_other = max(Decimal("0.00"), (record.commission_other or Decimal("0.00")) - notice_earn)

                    debt_rec = Decimal(str(fnf_prev.get("leave_debt_recovery", 0) or 0))
                    if debt_rec > Decimal("0.00"):
                        record.other_deduction = max(Decimal("0.00"), (record.other_deduction or Decimal("0.00")) - debt_rec)

                    sf_ded = Decimal(str(fnf_prev.get("notice_shortfall_deduction", 0) or 0))
                    if sf_ded > Decimal("0.00"):
                        record.other_deduction = max(Decimal("0.00"), (record.other_deduction or Decimal("0.00")) - sf_ded)

                    accel_adv = Decimal(str(fnf_prev.get("accelerated_advances", 0) or 0))
                    if accel_adv > Decimal("0.00"):
                        record.salary_advance_recovered = max(Decimal("0.00"), (record.salary_advance_recovered or Decimal("0.00")) - accel_adv)

                    if isinstance(record.raw_row_data, dict):
                        record.raw_row_data.pop("fnf_settlement", None)

                    # Reset working days to full tenure span
                    profile = getattr(client, "payroll_profile", None)
                    if profile and hasattr(profile, "get_cycle_dates"):
                        _, _, cycle_days = profile.get_cycle_dates(year, month)
                    else:
                        cycle_days = record.days_in_month
                    record.actual_working_days = Decimal(str(cycle_days))
                    recompute_record_structure(record, emp, client, month, year)
                    record.save()

        # Reset item status back to PENDING so it can be re-evaluated or deleted
        item.status = PortalSubmissionItem.STATUS_PENDING
        item.error = ""
        item.save(update_fields=["status", "error", "updated_at"])

        # Option 2.A: Detailed audit log note describing restored state
        revert_note = f"Reverted applied change ({item.item_type})"
        if item_type == PortalSubmissionItem.TYPE_REVISION:
            emp = Employee.objects.filter(client=client, id=emp_id).first()
            if emp:
                revert_note += f": Restored CTC to ₹{emp.ctc:,.2f}"
                retro_str = payload.get("_prev_state", {}).get("retro_arrears_added")
                if retro_str and Decimal(retro_str) > 0:
                    revert_note += f" (reversed ₹{Decimal(retro_str):,.2f} retro arrears)"
        elif item_type == PortalSubmissionItem.TYPE_TDS and record:
            revert_note += f": Restored TDS to ₹{record.tds:,.2f}"
        elif item_type == PortalSubmissionItem.TYPE_ARREARS and record:
            revert_note += f": Restored Arrears to ₹{record.arrears:,.2f}"
        elif item_type == PortalSubmissionItem.TYPE_REIMBURSEMENT and record:
            revert_note += f": Restored Reimbursements to ₹{record.reimbursements:,.2f}"
        elif item_type == PortalSubmissionItem.TYPE_LOP and record:
            revert_note += f": Restored LOP days to {record.lop_days}"
        elif item_type == PortalSubmissionItem.TYPE_EXIT and emp:
            revert_note += f": Restored {emp.employee_code} to Active status and reversed FnF settlement"

        record_event(
            submission,
            PortalSubmissionEvent.TYPE_REJECTED,
            item_count=1,
            actor_staff=reverted_by,
            note=revert_note,
        )

    return True

