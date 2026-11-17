"""
hrms_backend/payroll/signals.py

Django Signals for Payroll Integration:
1. Auto-creates a PayrollJob when an STT Task is created under a SubService
   with job_category matching 'payroll'.
2. Tracks client master updates to maintain accurate payroll job audit history.
"""

import logging
from datetime import datetime
from django.db import models, transaction
from django.db.models.signals import post_save, pre_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

from clients.models import Client, Task
from .models import PayrollJob, PayrollJobEvent

logger = logging.getLogger(__name__)

PAYROLL_JOB_CATEGORIES = {
    "payroll",
}

TRACKED_CLIENT_FIELDS = [
    "name",
    "email",
    "phone",
    "address",
    "contact_person",
    "nature_of_business",
    "gstin",
    "pan",
    "tan",
]


# ── Capture old Client values BEFORE save ────────────────────────────────────
@receiver(pre_save, sender=Client)
def capture_client_old_values(sender, instance, **kwargs):
    if not instance.pk:
        instance._payroll_old_vals = {}
        return
    try:
        old = Client.objects.get(pk=instance.pk)
        instance._payroll_old_vals = {
            f: str(getattr(old, f, "") or "")
            for f in TRACKED_CLIENT_FIELDS
        }
    except Client.DoesNotExist:
        instance._payroll_old_vals = {}


# ── Log Client info updates to Payroll audit trail ───────────────────────────
@receiver(post_save, sender=Client)
def log_client_info_update(sender, instance, created, **kwargs):
    if created:
        return

    old_vals = getattr(instance, "_payroll_old_vals", {})
    if not old_vals:
        return

    new_vals = {
        f: str(getattr(instance, f, "") or "")
        for f in TRACKED_CLIENT_FIELDS
    }
    changed_old = {k: v for k, v in old_vals.items() if v != new_vals.get(k)}
    if not changed_old:
        return

    # Find open payroll jobs for this client and touch updated timestamp
    try:
        open_jobs = PayrollJob.objects.filter(client=instance).exclude(status="Done")
        for job in open_jobs:
            job.save(update_fields=["updated_at"])
    except Exception as e:
        logger.warning(f"Failed to touch payroll jobs on client update: {e}")


def parse_period_to_month_year(period_raw, fallback_date=None):
    """
    Parses integer month (1-12), year (e.g. 2026), and standardized period string ('Oct-2026')
    from Task.period. Falls back to fallback_date or current date if blank or unparseable.
    """
    if period_raw and isinstance(period_raw, str):
        cleaned = period_raw.strip()
        # Handle ranges like 'Oct-2026 to Dec-2026' by taking the primary cycle
        if " to " in cleaned.lower():
            cleaned = cleaned.split(" to ")[0].strip()
        elif " - " in cleaned:
            cleaned = cleaned.split(" - ")[0].strip()

        # Try standard accounting period patterns
        for fmt in ("%b-%Y", "%b %Y", "%B %Y", "%B-%Y", "%m-%Y", "%Y-%m", "%m/%Y"):
            try:
                dt = datetime.strptime(cleaned, fmt)
                return dt.month, dt.year, dt.strftime("%b-%Y")
            except (ValueError, TypeError):
                continue

    # Graceful Fallback: Use due_date or today's date if period is missing or unparseable
    ref = fallback_date or timezone.now().date()
    return ref.month, ref.year, ref.strftime("%b-%Y")


# ── Auto-create / sync PayrollJob when an STT Task is created or updated ─────
@receiver(post_save, sender=Task)
def create_payroll_job_from_task(sender, instance, created, **kwargs):
    """
    Lifecycle handler for STT Tasks linked to Payroll:
    1. On create: Auto-provisions a PayrollJob under a SubService whose job_category
       is 'payroll', prioritizing Task.period for month, year, and period label.
    2. On update: Synchronizes PayrollJob.due_date if the manager rescheduled the deadline.
    """
    sub_service = instance.sub_service
    if not sub_service or not instance.client:
        return

    job_category = (getattr(sub_service, 'job_category', '') or '').strip().lower()
    if job_category != "payroll":
        return

    if created:
        # Avoid duplicate job if one already exists for this exact task
        if PayrollJob.objects.filter(task=instance).exists():
            return

        month, year, period_str = parse_period_to_month_year(
            getattr(instance, "period", None),
            fallback_date=instance.due_date,
        )

        try:
            created_by = getattr(instance, "created_by", None)
            job = PayrollJob.objects.create(
                task=instance,
                stt_task_id=instance.task_id or f"TASK-{instance.id}",
                client=instance.client,
                sub_service=sub_service,
                period=period_str,
                month=month,
                year=year,
                due_date=instance.due_date,
                status=PayrollJob.STATUS_TODO,
                created_by=created_by,
            )
            PayrollJobEvent.objects.create(
                job=job,
                event_type=PayrollJobEvent.EVENT_CREATED,
                performed_by=created_by,
                performed_by_name=getattr(created_by, "full_name", "") or getattr(created_by, "username", "") or "System",
                notes=f"Auto-provisioned from STT Task {job.stt_task_id} (Period: {period_str})",
            )
            logger.info(f"Auto-created PayrollJob #{job.id} for Task {instance.task_id} (Period: {period_str})")

            # ── Maker/Checker Synchronization & Smart Fallback (Option 1 & 4) ──
            def execute_payroll_mc_sync():
                try:
                    sync_payroll_job_mc_from_task(instance, job=job)
                except Exception as err:
                    logger.error(f"Failed Maker/Checker sync for PayrollJob #{job.id}: {err}", exc_info=True)

            transaction.on_commit(execute_payroll_mc_sync)

        except Exception as e:
            logger.error(f"Error creating PayrollJob from Task #{instance.id}: {e}")
    else:
        # Existing Task was updated: keep deadline synchronized
        try:
            job = PayrollJob.objects.filter(task=instance).first()
            if not job:
                return

            if instance.due_date and job.due_date != instance.due_date:
                old_due = job.due_date
                job.due_date = instance.due_date
                job.save(update_fields=["due_date", "updated_at"])

                updated_by = getattr(instance, "marked_done_by", None) or getattr(instance, "created_by", None)
                user_name = getattr(updated_by, "full_name", "") or getattr(updated_by, "username", "") or "System"

                PayrollJobEvent.objects.create(
                    job=job,
                    event_type="DEADLINE_UPDATED",
                    performed_by=updated_by,
                    performed_by_name=user_name,
                    notes=f"Due date synchronized from STT Task: {old_due} → {instance.due_date}",
                )
                logger.info(f"Synchronized due_date for PayrollJob #{job.id}: {old_due} → {instance.due_date}")

            # Option 3: Synchronize any Maker/Checker changes on task update
            transaction.on_commit(lambda: sync_payroll_job_mc_from_task(instance, job=job))

        except Exception as e:
            logger.error(f"Error synchronizing PayrollJob from updated Task #{instance.id}: {e}")


# ════════════════════════════════════════════════════════════
# Maker/Checker Synchronization & Smart Fallback
# ════════════════════════════════════════════════════════════

def sync_payroll_job_mc_from_task(task, job=None):
    """
    Synchronizes Maker and Checker assignments from clients.Task (or ClientGroupService fallback)
    onto the linked PayrollJob(s).
    """
    if task is None:
        return

    from clients.models import TaskAssignment, ClientGroupService

    jobs = [job] if job else list(PayrollJob.objects.filter(task=task))
    if not jobs:
        return

    active_qs = TaskAssignment.objects.filter(
        task=task, is_active=True, user__is_active=True,
    )
    maker_ids = set(active_qs.filter(role=TaskAssignment.ROLE_MAKER).values_list("user_id", flat=True))
    checker_ids = set(active_qs.filter(role=TaskAssignment.ROLE_CHECKER).values_list("user_id", flat=True))

    # Smart Fallback: If no role assignments on task, fetch defaults from ClientGroupService
    if not maker_ids and not checker_ids:
        sub_service = getattr(task, "sub_service", None)
        cgs = ClientGroupService.objects.filter(
            client=task.client,
            is_active=True,
        ).filter(
            models.Q(sub_service=sub_service) | models.Q(sub_service__job_category="payroll")
        ).distinct().first()

        if cgs:
            maker_ids = set(cgs.makers.filter(is_active=True).values_list("id", flat=True))
            checker_ids = set(cgs.checkers.filter(is_active=True).values_list("id", flat=True))

            # Auto-assign back onto Task so the Task in STT table displays them as well
            creator = getattr(task, "created_by", None)
            for uid in maker_ids:
                TaskAssignment.objects.get_or_create(
                    task=task, user_id=uid, role=TaskAssignment.ROLE_MAKER,
                    defaults={"is_active": True, "assigned_by": creator},
                )
            for uid in checker_ids:
                TaskAssignment.objects.get_or_create(
                    task=task, user_id=uid, role=TaskAssignment.ROLE_CHECKER,
                    defaults={"is_active": True, "assigned_by": creator},
                )

    for pjob in jobs:
        current_makers = set(pjob.makers.values_list("id", flat=True))
        current_checkers = set(pjob.checkers.values_list("id", flat=True))

        changed = False
        if maker_ids != current_makers:
            pjob.makers.set(maker_ids)
            changed = True
        if checker_ids != current_checkers:
            pjob.checkers.set(checker_ids)
            changed = True

        if changed:
            actor = getattr(task, "created_by", None)
            actor_name = getattr(actor, "full_name", "") or getattr(actor, "username", "") or "System"

            maker_names = ", ".join(pjob.makers.values_list("first_name", flat=True)) or (f"{len(maker_ids)} makers" if maker_ids else "None")
            checker_names = ", ".join(pjob.checkers.values_list("first_name", flat=True)) or (f"{len(checker_ids)} checkers" if checker_ids else "None")

            PayrollJobEvent.objects.create(
                job=pjob,
                event_type=PayrollJobEvent.EVENT_ASSIGNED,
                performed_by=actor,
                performed_by_name=actor_name,
                notes=f"Maker/Checker synchronized from STT Task: Makers=[{maker_names}], Checkers=[{checker_names}]",
            )
            logger.info(f"Synchronized Maker/Checker for PayrollJob #{pjob.id}: makers={maker_ids}, checkers={checker_ids}")


@receiver(post_save, sender='clients.TaskAssignment')
def sync_payroll_job_on_task_assignment_save(sender, instance, **kwargs):
    """Real-time forward sync when a TaskAssignment is added/updated."""
    if instance.task_id:
        task = getattr(instance, 'task', None) or Task.objects.filter(pk=instance.task_id).first()
        if task:
            sub = getattr(task, 'sub_service', None)
            if sub and (getattr(sub, 'job_category', '') or '').strip().lower() == 'payroll':
                transaction.on_commit(lambda: sync_payroll_job_mc_from_task(task))


@receiver(post_delete, sender='clients.TaskAssignment')
def sync_payroll_job_on_task_assignment_delete(sender, instance, **kwargs):
    """Real-time forward sync when a TaskAssignment is removed."""
    if instance.task_id:
        task = Task.objects.filter(pk=instance.task_id).first()
        if task:
            sub = getattr(task, 'sub_service', None)
            if sub and (getattr(sub, 'job_category', '') or '').strip().lower() == 'payroll':
                transaction.on_commit(lambda: sync_payroll_job_mc_from_task(task))


# ── Auto-sync ClientProfile.payroll_is_active on ClientGroupService changes ──
@receiver(post_save, sender='clients.ClientGroupService')
def sync_client_profile_on_client_group_service_save(sender, instance, **kwargs):
    """
    Real-time forward synchronization from Client Management to Payroll:
    When a ClientGroupService with job_category == 'payroll' is created or toggled:
      - If active: sets ClientProfile.payroll_is_active = True
      - If inactive: checks if the client has any remaining active payroll service.
        If none, sets ClientProfile.payroll_is_active = False!
    """
    sub = getattr(instance, 'sub_service', None)
    if not sub:
        return
    job_category = (getattr(sub, 'job_category', '') or '').strip().lower()
    if job_category != "payroll":
        return

    client = getattr(instance, 'client', None)
    if not client:
        return

    from clients.models import ClientGroupService
    from payroll.models import ClientProfile

    has_active_payroll = ClientGroupService.objects.filter(
        client=client,
        is_active=True,
        sub_service__job_category__iexact="payroll",
    ).exists()

    profile, _ = ClientProfile.objects.get_or_create(client=client, defaults={"payroll_is_active": True})
    if profile.payroll_is_active != has_active_payroll:
        profile.payroll_is_active = has_active_payroll
        profile.save(update_fields=["payroll_is_active", "updated_at"])
        logger.info(
            f"Auto-synchronized ClientProfile.payroll_is_active={has_active_payroll} for client {client.name} (id={client.id})"
        )


@receiver(post_delete, sender='clients.ClientGroupService')
def sync_client_profile_on_client_group_service_delete(sender, instance, **kwargs):
    """Real-time sync when a ClientGroupService is removed/deleted."""
    sub = getattr(instance, 'sub_service', None)
    if not sub:
        return
    job_category = (getattr(sub, 'job_category', '') or '').strip().lower()
    if job_category != "payroll":
        return

    client = getattr(instance, 'client', None)
    if not client:
        return

    from clients.models import ClientGroupService
    from payroll.models import ClientProfile

    has_active_payroll = ClientGroupService.objects.filter(
        client=client,
        is_active=True,
        sub_service__job_category__iexact="payroll",
    ).exists()

    profile = ClientProfile.objects.filter(client=client).first()
    if profile and profile.payroll_is_active != has_active_payroll:
        profile.payroll_is_active = has_active_payroll
        profile.save(update_fields=["payroll_is_active", "updated_at"])
        logger.info(
            f"Auto-synchronized ClientProfile.payroll_is_active={has_active_payroll} after service deletion for client {client.name}"
        )


# ── Client logo lives on clients.Client.logo. Some payroll code (the client portal's client_logo)
# still reads ClientProfile.payroll_logo, so keep that pointing at the same file.
from django.db.models.signals import post_save
from django.dispatch import receiver
from clients.models import Client as _MasterClient


@receiver(post_save, sender=_MasterClient, dispatch_uid="payroll_mirror_client_logo")
def mirror_client_logo_to_payroll(sender, instance, update_fields=None, **kwargs):
    from .models import ClientProfile
    name = instance.logo.name if getattr(instance, "logo", None) else ""
    changed_logo = update_fields is not None and "logo" in update_fields
    # A save that didn't touch the logo and has none (e.g. before copy_payroll_logos ran)
    # must not wipe the payroll copy.
    if not name and not changed_logo:
        return
    ClientProfile.objects.filter(client=instance).exclude(payroll_logo=name).update(payroll_logo=name)


# ── Auto-sync open payroll batch when Employee last_working_date or hire_date changes ──
@receiver(post_save, sender='payroll.Employee', dispatch_uid="payroll_sync_employee_exit_to_open_batch")
def sync_open_batch_on_employee_tenure_change(sender, instance, created, **kwargs):
    """
    Real-time forward synchronization from Employee Master to active/open PayrollBatches:
    If an employee's last_working_date or hire_date falls into an open/under-review
    batch's period, ensure their actual_working_days and salary are prorated.
    """
    if created:
        return

    from decimal import Decimal
    from .models import PayrollBatch, PayslipRecord
    from .portal.services import recompute_record_structure

    try:
        open_batches = PayrollBatch.objects.filter(
            client=instance.client,
            status__in=[PayrollBatch.STATUS_UPLOADED, PayrollBatch.STATUS_REVIEWED],
        )
        for batch in open_batches:
            record = PayslipRecord.objects.filter(batch=batch, employee=instance).first()
            if not record:
                continue

            year, month = batch.year, batch.month
            start_day = 1
            if instance.hire_date and instance.hire_date.year == year and instance.hire_date.month == month:
                start_day = instance.hire_date.day

            end_day = record.days_in_month
            if instance.last_working_date and instance.last_working_date.year == year and instance.last_working_date.month == month:
                end_day = instance.last_working_date.day

            max_span = max(0, min(record.days_in_month, end_day) - max(1, start_day) + 1)
            prorated_days = Decimal(str(max_span))

            is_bounded = (end_day < record.days_in_month) or (start_day > 1)
            if is_bounded and (record.actual_working_days > prorated_days or record.actual_working_days == 0):
                record.actual_working_days = prorated_days
                recompute_record_structure(record, instance, instance.client, month, year)
                record.save()
                logger.info(
                    f"Auto-synchronized PayslipRecord #{record.id} for exited/joined employee {instance.employee_code} to {prorated_days} days."
                )
    except Exception as e:
        logger.warning(f"Failed to auto-sync open batch for employee tenure change: {e}")
