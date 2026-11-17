"""payroll/portal/serializers.py — consolidated portal serializers."""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count
from rest_framework import serializers

from payroll.models import (
    Employee,
    EmployeeSalaryStructure,
    PayrollBatch,
    PayrollJob,
    PayslipRecord,
    SalaryAdvance,
    get_latest_salary_structure,
)

from ..models import (
    PortalSubmission,
    PortalSubmissionItem,
    PortalUser,
)
from ..serializers import REQUIRED_KEYS, required_keys


# ── Month Lock Guards & Helpers (Inlined from locks.py) ───────────────────
MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# Batch states that mean payslips have left (or are leaving) the building,
# even if a pdf_path row hasn't been counted yet.
SENDING_STATUSES = (PayrollBatch.STATUS_SENDING, PayrollBatch.STATUS_COMPLETED)

UNLOCKED = {
    "locked": False,
    "reason": None,
    "batch_id": None,
    "batch_status": None,
    "payslips_generated": 0,
    "payslips_emailed": 0,
}


def _month_label(month, year):
    try:
        return f"{MONTH_NAMES[int(month) - 1]} {int(year)}"
    except (TypeError, ValueError, IndexError):
        return f"{month}/{year}"


def _build(batch, generated, emailed, is_job_done=False):
    # Locked if emails have been dispatched, or batch is sending/completed, or PayrollJob is marked Done
    locked = emailed > 0 or batch.status in SENDING_STATUSES or is_job_done
    if not locked:
        return {
            **UNLOCKED,
            "batch_id": batch.id,
            "batch_status": batch.status,
            "payslips_generated": generated,
            "payslips_emailed": emailed,
        }

    label = _month_label(batch.month, batch.year)
    if emailed:
        reason = (
            f"Payslips for {label} have already been generated and emailed "
            f"({emailed} sent). This month is closed for new changes."
        )
    elif is_job_done or batch.status == PayrollBatch.STATUS_COMPLETED:
        reason = (
            f"Payroll processing for {label} has been finalized and closed. "
            "This month is closed for new changes."
        )
    elif generated:
        reason = (
            f"Payslips for {label} have already been generated "
            f"({generated} payslip{'' if generated == 1 else 's'}). "
            "This month is closed for new changes."
        )
    else:
        reason = f"Payslips for {label} are being sent out. This month is closed for new changes."

    return {
        "locked": True,
        "reason": reason,
        "batch_id": batch.id,
        "batch_status": batch.status,
        "payslips_generated": generated,
        "payslips_emailed": emailed,
    }


def locks_for(submissions):
    """Bulk version: {(client_id, month, year): lock_dict} in two queries.

    Used by the serializers so a list of months doesn't fire a query per row.
    """
    keys = {(s.client_id, int(s.month), int(s.year)) for s in submissions}
    if not keys:
        return {}

    batches = list(
        PayrollBatch.objects.filter(
            client_id__in={k[0] for k in keys},
            month__in={k[1] for k in keys},
            year__in={k[2] for k in keys},
        ).only("id", "client_id", "month", "year", "status", "email_sent")
    )
    batches = [b for b in batches if (b.client_id, b.month, b.year) in keys]

    jobs = list(
        PayrollJob.objects.filter(
            client_id__in={k[0] for k in keys},
            month__in={k[1] for k in keys},
            year__in={k[2] for k in keys},
        ).only("client_id", "month", "year", "status")
    )
    done_jobs = {(j.client_id, j.month, j.year) for j in jobs if getattr(j, "status", None) == "Done"}

    generated_by_batch = {}
    if batches:
        rows = (
            PayslipRecord.objects.filter(batch_id__in=[b.id for b in batches])
            .exclude(pdf_path__isnull=True)
            .exclude(pdf_path="")
            .values("batch_id")
            .annotate(n=Count("id"))
        )
        generated_by_batch = {r["batch_id"]: r["n"] for r in rows}

    result = {key: dict(UNLOCKED) for key in keys}
    for batch in batches:
        is_done = (batch.client_id, batch.month, batch.year) in done_jobs
        result[(batch.client_id, batch.month, batch.year)] = _build(
            batch,
            generated_by_batch.get(batch.id, 0),
            batch.email_sent or 0,
            is_job_done=is_done,
        )
    return result


def month_lock(client_id, month, year):
    """Single lookup — {"locked": bool, "reason": str|None, ...}."""
    batch = (
        PayrollBatch.objects.filter(client_id=client_id, month=month, year=year)
        .only("id", "client_id", "month", "year", "status", "email_sent")
        .first()
    )
    if batch is None:
        return dict(UNLOCKED)

    generated = (
        PayslipRecord.objects.filter(batch=batch)
        .exclude(pdf_path__isnull=True)
        .exclude(pdf_path="")
        .count()
    )
    job_done = PayrollJob.objects.filter(client_id=client_id, month=month, year=year, status="Done").exists()
    return _build(batch, generated, batch.email_sent or 0, is_job_done=job_done)


def submission_lock(submission):
    return month_lock(submission.client_id, submission.month, submission.year)


def client_logo_url(client, request=None):
    """Absolute URL of the client's payroll logo, or None."""
    profile = getattr(client, "payroll_profile", None)
    image = getattr(profile, "payroll_logo", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request is not None else url


# ── Auth Serializers ────────────────────────────────────────────────────────
class PortalLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)


class PortalUserSelfSerializer(serializers.ModelSerializer):
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    client_logo = serializers.SerializerMethodField()

    def get_client_logo(self, obj):
        return client_logo_url(obj.client, self.context.get("request"))

    class Meta:
        model = PortalUser
        fields = [
            "id", "email", "role", "is_active", "must_change_password",
            "client_id", "client_name", "client_logo",
        ]
        read_only_fields = fields


class PortalChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(trim_whitespace=False, write_only=True)
    new_password = serializers.CharField(
        min_length=8, max_length=128, trim_whitespace=False, write_only=True,
        help_text="At least 8 characters.",
    )


# ── Read-Only Payroll Data Serializers ─────────────────────────────────────
class PortalEmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    latest_ctc_annual = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id", "employee_code", "first_name", "last_name", "full_name",
            "email", "pan_number", "department", "position", "hire_date",
            "last_working_date",
            "ctc", "status", "latest_ctc_annual",
        ]

    def get_latest_ctc_annual(self, obj):
        structure = get_latest_salary_structure(obj)
        return structure.ctc_annual if structure else None


class PortalStructureSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = EmployeeSalaryStructure
        fields = [
            "id", "employee", "employee_code", "employee_name", "effective_from",
            "ctc_annual", "monthly_gross", "original_basic_da", "original_hra",
            "original_special_allowance", "original_lta", "nps_allowance", "fbp",
            "vpf", "pf_opted", "employer_pf", "change_reason",
        ]


class PortalAdvanceSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = SalaryAdvance
        fields = [
            "id", "employee", "employee_code", "employee_name",
            "total_amount", "tenure_months", "emi_amount", "reason", "created_at",
        ]


# ── Submission & Item Serializers ──────────────────────────────────────────
class PortalSubmissionSerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(source="items.count", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    # Client branding for the staff list / detail header (falls back to
    # initials in the UI when the client has no logo uploaded).
    client_logo = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    # Round history (submit / approve / reject) for the client's History
    # timeline. Callers should prefetch_related("history") to avoid N+1.
    history = serializers.SerializerMethodField()
    # Short, list-friendly preview of the client's notes for this month —
    # submission.notes plus any NOTE item texts — so staff can see what the
    # client wrote without opening the submission. Callers should
    # prefetch_related("items") to avoid N+1 queries.
    note_preview = serializers.SerializerMethodField()
    # How many items still need applying — lets the staff list flag a month
    # that needs attention without opening it. Uses the prefetched items.
    pending_item_count = serializers.SerializerMethodField()
    # Payslips already generated for this month? Then the month is closed for
    # portal edits — see payroll/portal/locks.py.
    payroll_lock = serializers.SerializerMethodField()

    class Meta:
        model = PortalSubmission
        fields = [
            "id", "client", "client_name", "client_logo", "month", "year", "status", "notes",
            "note_preview", "rejection_reason", "submitted_by", "submitted_at",
            "approved_by", "approved_by_name", "approved_at", "item_count",
            "pending_item_count", "payroll_lock",
            "history", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "client", "status", "rejection_reason", "submitted_by",
            "submitted_at", "approved_by", "approved_at", "created_at", "updated_at",
        ]

    def get_client_logo(self, obj):
        return client_logo_url(obj.client, self.context.get("request"))

    @staticmethod
    def _staff_name(user):
        """Best-effort display name for a staff (account.User) actor."""
        if not user:
            return None
        parts = [getattr(user, "first_name", None), getattr(user, "last_name", None)]
        name = " ".join(p for p in parts if p).strip()
        return name or user.email

    def get_approved_by_name(self, obj):
        return self._staff_name(obj.approved_by)

    def get_history(self, obj):
        events = []
        for ev in obj.history.all():
            if ev.event_type == "SUBMITTED":
                actor = ev.actor_portal.email if ev.actor_portal else None
            else:
                actor = self._staff_name(ev.actor_staff)
            events.append(
                {
                    "id": ev.id,
                    "event_type": ev.event_type,
                    "item_count": ev.item_count,
                    "note": ev.note,
                    "actor": actor,
                    "created_at": ev.created_at.isoformat(),
                }
            )
        return events

    def get_payroll_lock(self, obj):
        # Cached on the ListSerializer so a page of months costs two queries
        # in total instead of two per row.
        root = self.parent if isinstance(self.parent, serializers.ListSerializer) else self
        cache = getattr(root, "_payroll_lock_cache", None)
        if cache is None:
            source = root.instance
            if source is None:
                rows = [obj]
            elif isinstance(source, PortalSubmission):
                rows = [source]
            else:
                rows = list(source)
            cache = locks_for(rows)
            root._payroll_lock_cache = cache
        key = (obj.client_id, int(obj.month), int(obj.year))
        if key not in cache:
            cache.update(locks_for([obj]))
        return cache[key]

    def get_pending_item_count(self, obj):
        return sum(1 for item in obj.items.all() if item.status != "APPLIED")

    def get_note_preview(self, obj):
        parts = []
        if obj.notes and obj.notes.strip():
            parts.append(obj.notes.strip())
        for item in obj.items.all():
            if item.item_type == "NOTE":
                text = (item.payload or {}).get("text")
                if text and str(text).strip():
                    parts.append(str(text).strip())
        if not parts:
            return ""
        preview = " · ".join(dict.fromkeys(parts))  # de-dupe, keep order
        return preview if len(preview) <= 160 else preview[:157] + "…"


class PortalSubmissionItemSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()
    is_client_submission = serializers.SerializerMethodField()
    created_by_email = serializers.ReadOnlyField(source="created_by.email")
    created_by_name = serializers.ReadOnlyField(source="created_by.name")

    class Meta:
        model = PortalSubmissionItem
        fields = [
            "id", "submission", "item_type", "payload", "status", "error",
            "sort", "created_at", "updated_at", "source", "is_client_submission",
            "created_by_email", "created_by_name",
        ]
        read_only_fields = [
            "id", "submission", "status", "error", "created_at", "updated_at",
            "source", "is_client_submission", "created_by_email", "created_by_name",
        ]

    def get_source(self, obj):
        return "portal" if getattr(obj, "created_by_id", None) else "internal"

    def get_is_client_submission(self, obj):
        return getattr(obj, "created_by_id", None) is not None

    def validate(self, attrs):
        item_type = attrs.get("item_type")
        payload = attrs.get("payload") or {}
        if not isinstance(payload, dict):
            raise serializers.ValidationError({"payload": "payload must be a JSON object."})
        if item_type:
            missing = [
                key for key in required_keys(item_type)
                if payload.get(key) is None or str(payload.get(key)).strip() == ""
            ]
            if missing:
                raise serializers.ValidationError(
                    {"payload": f"Missing required field(s): {', '.join(missing)}."}
                )
        attrs["payload"] = payload
        return attrs



# ── Internal Admin Serializers ─────────────────────────────────────────────
class PortalUserAdminSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False,
        help_text="Set on create (required) or to reset the password on update.",
    )
    client_name = serializers.CharField(source="client.name", read_only=True)
    # Staff-only: the current password in clear text so it can be read back to
    # the client. Safe here because this serializer is behind the internal
    # admin endpoint; the portal's own serializers never expose it.
    password_plain = serializers.CharField(read_only=True)
    client_logo = serializers.SerializerMethodField()

    class Meta:
        model = PortalUser
        fields = [
            "id", "email", "client", "client_name", "client_logo", "role", "is_active",
            "must_change_password", "password", "password_plain", "last_login", "created_at", "updated_at",
        ]
        read_only_fields = ["password_plain", "last_login", "created_at", "updated_at"]

    def get_client_logo(self, obj):
        return client_logo_url(obj.client, self.context.get("request"))

    def validate_email(self, value):
        return value.strip().lower()

    def validate_password(self, value):
        """Run Django's configured password validators on portal passwords too.

        Staff type these in by hand for a client, so without this a one-
        character password was accepted and silently handed to the client.
        Blank is allowed on update (it means "keep the existing password").
        """
        if not value:
            return value
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data):
        raw = validated_data.pop("password", None)
        if not raw:
            raise serializers.ValidationError(
                {"password": "A password is required when creating a portal user."}
            )
        validated_data.setdefault("must_change_password", True)
        user = PortalUser(**validated_data)
        user.set_password(raw)
        user.save()
        return user

    def update(self, instance, validated_data):
        raw = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if raw:
            instance.set_password(raw)
            instance.must_change_password = True
        instance.save()
        return instance



__all__ = [
    "client_logo_url",
    "PortalLoginSerializer",
    "PortalUserSelfSerializer",
    "PortalChangePasswordSerializer",
    "PortalEmployeeSerializer",
    "PortalStructureSerializer",
    "PortalAdvanceSerializer",
    "PortalSubmissionSerializer",
    "PortalSubmissionItemSerializer",
    "PortalUserAdminSerializer",
]
