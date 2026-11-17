"""payroll/portal/views.py — consolidated client portal endpoints."""

import hashlib
import json
import secrets
import logging
import re

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import authentication, exceptions, generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from payroll.models import Employee, EmployeeSalaryStructure, SalaryAdvance, SalaryComponent
from payroll.serializers import SalaryComponentSerializer


from ..excel_parser import generate_portal_template, parse_portal_excel

from ..models import (
    PortalSubmission,
    PortalSubmissionEvent,
    PortalSubmissionItem,
    PortalUser,
)
from .serializers import (
    PortalAdvanceSerializer,
    PortalChangePasswordSerializer,
    PortalEmployeeSerializer,
    PortalLoginSerializer,
    PortalStructureSerializer,
    PortalSubmissionItemSerializer,
    PortalSubmissionSerializer,
    PortalUserAdminSerializer,
    PortalUserSelfSerializer,
    submission_lock,
)
from .services import (
    apply_item,
    apply_submission,
    record_event,
    refresh_batch_after_apply,
    revert_item,
)
from ..serializers import required_keys

logger = logging.getLogger(__name__)


# ── Portal Authentication & Permissions (Inlined from auth.py) ──────────────
def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def issue_token(user: PortalUser) -> str:
    """Generates a fresh login token for `user` and returns the raw value."""
    raw = secrets.token_hex(32)
    user.auth_token_hash = _hash_token(raw)
    user.save(update_fields=["auth_token_hash", "updated_at"])
    return raw


def revoke_token(user: PortalUser) -> None:
    """Logs `user` out by clearing the stored token hash."""
    user.auth_token_hash = ""
    user.save(update_fields=["auth_token_hash", "updated_at"])


class PortalUserAuthentication(authentication.BaseAuthentication):
    """Resolves a PortalUser from ``Authorization: Token <token>``."""

    keyword = "Token"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None

        if len(header) == 1:
            raise exceptions.AuthenticationFailed("Invalid token header. No credentials provided.")
        if len(header) > 2:
            raise exceptions.AuthenticationFailed(
                "Invalid token header. Token string should not contain spaces."
            )

        raw_token = header[1].decode()
        if not raw_token:
            raise exceptions.AuthenticationFailed("Empty token.")

        digest = _hash_token(raw_token)
        try:
            user = PortalUser.objects.select_related("client").get(
                auth_token_hash=digest, is_active=True
            )
        except PortalUser.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid or expired token.")

        if not user.client:
            raise exceptions.AuthenticationFailed("This portal account is not linked to a client.")

        return (user, None)

    def authenticate_header(self, request):
        return self.keyword


class IsPortalUser(permissions.BasePermission):
    """Grants access only to authenticated PortalUser requests."""

    message = "Portal authentication required."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return isinstance(user, PortalUser) and user.is_active


class PortalScopeBase:
    """Base for all client-facing portal views: portal auth + client scoping."""

    authentication_classes = [PortalUserAuthentication]
    permission_classes = [IsPortalUser]

    def get_client(self):
        return self.request.user.client


# ── Auth Views ─────────────────────────────────────────────────────────────
class PortalLoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PortalLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        password = serializer.validated_data["password"]

        user = (
            PortalUser.objects.select_related("client")
            .filter(email__iexact=email, is_active=True)
            .first()
        )
        if user is None or not user.check_password(password):
            raise ValidationError({"detail": "Invalid email or password."})

        token = issue_token(user)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])

        return Response(
            {
                "token": token,
                "user": PortalUserSelfSerializer(user, context={"request": request}).data,
            }
        )


class PortalLogoutView(PortalScopeBase, APIView):
    def post(self, request):
        revoke_token(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PortalMeView(PortalScopeBase, APIView):
    def get(self, request):
        return Response(
            PortalUserSelfSerializer(request.user, context={"request": request}).data
        )


class PortalChangePasswordView(PortalScopeBase, APIView):
    def post(self, request):
        serializer = PortalChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            raise ValidationError({"old_password": "Current password is incorrect."})
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])
        # Rotate the token so sessions logged in under the old password end.
        token = issue_token(user)
        return Response(
            {"detail": "Password changed.", "token": token,
             "user": PortalUserSelfSerializer(user, context={"request": request}).data}
        )



# ── Read-Only Client Payroll Data Views ────────────────────────────────────
class PortalEmployeeListView(PortalScopeBase, generics.ListAPIView):
    serializer_class = PortalEmployeeSerializer

    def get_queryset(self):
        return Employee.objects.filter(client=self.get_client()).order_by("employee_code")


class PortalEmployeeDetailView(PortalScopeBase, generics.RetrieveAPIView):
    serializer_class = PortalEmployeeSerializer

    def get_queryset(self):
        return Employee.objects.filter(client=self.get_client())


class PortalStructureListView(PortalScopeBase, generics.ListAPIView):
    serializer_class = PortalStructureSerializer

    def get_queryset(self):
        return (
            EmployeeSalaryStructure.objects.filter(employee__client=self.get_client())
            .select_related("employee")
            .order_by("-effective_from", "-created_at")
        )


class PortalAdvanceListView(PortalScopeBase, generics.ListAPIView):
    serializer_class = PortalAdvanceSerializer

    def get_queryset(self):
        return (
            SalaryAdvance.objects.filter(employee__client=self.get_client())
            .select_related("employee")
            .order_by("-created_at")
        )


class PortalComponentListView(PortalScopeBase, generics.ListAPIView):
    """Returns active custom salary components (allowances & deductions) for this client."""
    serializer_class = SalaryComponentSerializer

    def get_queryset(self):
        client = self.get_client()
        return (
            SalaryComponent.objects.filter(
                client=client,
                is_active=True,
                component_type__in=[SalaryComponent.TYPE_EARNING, SalaryComponent.TYPE_DEDUCTION],
            )
            .exclude(code__startswith="__")
            .exclude(statistical_component=True)
            .order_by("component_type", "display_order", "name")
        )



# ── Submission & Item Lifecycle Views ──────────────────────────────────────
def assert_month_open(submission):
    """Block every client-side write once payslips exist for the month.

    A generated payslip is already in the employee's hands, so a change added
    afterwards could never be reflected in it — staging one would only make
    the portal disagree with the payslip. Staff can still correct the month
    and regenerate the batch from Batch Review.
    """
    lock = submission_lock(submission)
    if lock["locked"]:
        raise ValidationError({"detail": lock["reason"], "payroll_lock": lock})
    return lock


class PortalSubmissionListCreateView(PortalScopeBase, generics.ListCreateAPIView):
    serializer_class = PortalSubmissionSerializer

    def get_queryset(self):
        qs = (
            PortalSubmission.objects.filter(client=self.get_client())
            .prefetch_related("items", "history")
            .order_by("-year", "-month")
        )
        for sub in qs:
            # Self-healing: if month is marked SUBMITTED but has no PENDING items, auto-reopen to DRAFT
            if sub.status == PortalSubmission.STATUS_SUBMITTED:
                if not sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists():
                    sub.status = PortalSubmission.STATUS_DRAFT
                    sub.save(update_fields=["status", "updated_at"])
        return qs

    def create(self, request, *args, **kwargs):
        """Open (or reopen) a month for the client. Idempotent."""
        month = request.data.get("month")
        year = request.data.get("year")
        if month in (None, "") or year in (None, ""):
            raise ValidationError({"detail": "month and year are required."})
        try:
            month = int(month)
            year = int(year)
        except (TypeError, ValueError):
            raise ValidationError({"detail": "month and year must be integers."})
        if not (1 <= month <= 12):
            raise ValidationError({"detail": "month must be between 1 and 12."})

        submission, _ = PortalSubmission.objects.get_or_create(
            client=self.get_client(), month=month, year=year
        )
        # Self-healing: if month is marked SUBMITTED but has no PENDING items, auto-reopen to DRAFT
        if submission.status == PortalSubmission.STATUS_SUBMITTED:
            if not submission.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists():
                submission.status = PortalSubmission.STATUS_DRAFT
                submission.save(update_fields=["status", "updated_at"])

        return Response(
            PortalSubmissionSerializer(submission, context=self.get_serializer_context()).data,
            status=status.HTTP_200_OK,
        )


class PortalSubmissionSubmitView(PortalScopeBase, APIView):
    def post(self, request, pk):
        submission = self._get_submission(pk)
        assert_month_open(submission)
        if submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "Only draft or rejected submissions can be submitted."}
            )
        submission.status = PortalSubmission.STATUS_SUBMITTED
        submission.rejection_reason = ""
        submission.submitted_by = request.user
        submission.submitted_at = timezone.now()
        submission.save(
            update_fields=[
                "status", "rejection_reason", "submitted_by", "submitted_at", "updated_at",
            ]
        )
        # Count only the items being submitted THIS round (everything not yet
        # applied) — matching what the approver's summary will report, so the
        # "Submitted for review" and "Approved and applied" entries for a round
        # always agree. Using items.count() would include items already applied
        # in earlier rounds and made the approved count look like it "fell back".
        pending_count = submission.items.exclude(
            status=PortalSubmissionItem.STATUS_APPLIED
        ).count()
        record_event(
            submission,
            PortalSubmissionEvent.TYPE_SUBMITTED,
            item_count=pending_count,
            actor_portal=request.user,
        )
        return Response(PortalSubmissionSerializer(submission).data)

    def _get_submission(self, pk):
        submission = PortalSubmission.objects.filter(
            pk=pk, client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")
        # Self-healing: if month is marked SUBMITTED but has no PENDING items, auto-reopen to DRAFT
        if submission.status == PortalSubmission.STATUS_SUBMITTED:
            if not submission.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists():
                submission.status = PortalSubmission.STATUS_DRAFT
                submission.save(update_fields=["status", "updated_at"])
        return submission


class PortalSubmissionNotesView(PortalScopeBase, APIView):
    """Client writes/clears the month-level note for the payroll team."""

    def post(self, request, pk):
        submission = PortalSubmission.objects.filter(
            pk=pk, client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")
        assert_month_open(submission)
        if submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "This submission is locked and its notes can't be changed."}
            )
        submission.notes = (request.data.get("notes") or "").strip()
        submission.save(update_fields=["notes", "updated_at"])
        return Response(PortalSubmissionSerializer(submission).data)


class PortalItemListCreateView(PortalScopeBase, generics.ListCreateAPIView):
    serializer_class = PortalSubmissionItemSerializer

    def get_submission(self):
        submission = PortalSubmission.objects.filter(
            pk=self.kwargs["pk"], client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")
        return submission

    def get_queryset(self):
        return self.get_submission().items.filter(created_by__isnull=False)

    def perform_create(self, serializer):
        submission = self.get_submission()
        assert_month_open(submission)
        if submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "This submission is locked. Only draft or rejected submissions can be edited."}
            )
        if serializer.validated_data.get("item_type") == PortalSubmissionItem.TYPE_TDS:
            if getattr(self.request.user, "role", None) != PortalUser.ROLE_CLIENT_ADMIN:
                raise PermissionDenied("Only Client Admins can submit TDS adjustments.")
        serializer.save(submission=submission, created_by=self.request.user)


class PortalItemDetailView(PortalScopeBase, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PortalSubmissionItemSerializer

    def get_object(self):
        item = (
            PortalSubmissionItem.objects.filter(
                pk=self.kwargs["item_pk"],
                submission_id=self.kwargs["pk"],
                submission__client=self.get_client(),
                created_by__isnull=False,
            )
            .select_related("submission")
            .first()
        )
        if item is None:
            raise PermissionDenied("Item not found.")
        self.check_object_permissions(self.request, item)
        return item

    def _ensure_editable(self, item):
        assert_month_open(item.submission)
        if item.submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "This submission is locked. Only draft or rejected submissions can be edited."}
            )
        if getattr(item, "created_by_id", None) is None:
            raise PermissionDenied(
                "You cannot modify or remove adjustments entered directly by your payroll team."
            )

    def perform_update(self, serializer):
        self._ensure_editable(serializer.instance)
        if serializer.instance.item_type == PortalSubmissionItem.TYPE_TDS or serializer.validated_data.get("item_type") == PortalSubmissionItem.TYPE_TDS:
            if getattr(self.request.user, "role", None) != PortalUser.ROLE_CLIENT_ADMIN:
                raise PermissionDenied("Only Client Admins can edit TDS adjustments.")
        # If client edited an excluded or failed item to fix it, return status to PENDING
        if serializer.instance.status in (PortalSubmissionItem.STATUS_SKIPPED, PortalSubmissionItem.STATUS_FAILED):
            serializer.save(status=PortalSubmissionItem.STATUS_PENDING, error="")
        else:
            serializer.save()

    def perform_destroy(self, instance):
        self._ensure_editable(instance)
        instance.delete()


class PortalSubmissionTemplateDownloadView(PortalScopeBase, APIView):
    """Generates and streams the multi-sheet .xlsx input template for the submission."""

    def get(self, request, pk):
        submission = PortalSubmission.objects.filter(
            pk=pk, client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")

        is_admin = getattr(request.user, "role", None) == PortalUser.ROLE_CLIENT_ADMIN
        file_io = generate_portal_template(self.get_client(), is_admin=is_admin)
        client_name_clean = re.sub(r"[^\w\s-]", "", self.get_client().name or "Client").strip().replace(" ", "_")
        filename = f"Payroll_Template_{client_name_clean[:20]}_{submission.month:02d}_{submission.year}.xlsx"

        response = HttpResponse(
            file_io.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class PortalSubmissionParseExcelView(PortalScopeBase, APIView):
    """
    Parses an uploaded multi-sheet Excel workbook in RAM.
    Does NOT write to the database — returns a structured JSON payload of
    detected items, employee resolutions, and any warnings for the client
    to review and interactively edit before approving.
    """

    def post(self, request, pk):
        submission = PortalSubmission.objects.filter(
            pk=pk, client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")
        assert_month_open(submission)
        if submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "This submission is locked. Only draft or rejected submissions can be edited."}
            )

        excel_file = request.FILES.get("file")
        if not excel_file:
            raise ValidationError({"detail": "No file uploaded. Please select an Excel (.xlsx) file."})

        try:
            result = parse_portal_excel(excel_file, self.get_client())
        except Exception as e:
            raise ValidationError({"detail": f"Failed to parse Excel workbook: {str(e)}"})

        # Save uploaded file to default_storage for persistence and CA firm audit visibility
        clean_name = getattr(excel_file, "name", "Payroll_Template_Upload.xlsx")
        try:
            from payroll.models import get_payroll_storage_rel_path
            excel_file.seek(0)
            rel_path = get_payroll_storage_rel_path(
                client=submission.client,
                year=submission.year,
                month=submission.month,
                category="excel",
                filename=clean_name,
            )
            saved_path = default_storage.save(rel_path, excel_file)
            result["file_path"] = saved_path
            result["file_name"] = clean_name
        except Exception as e:
            logger.warning(f"Could not persist portal excel file: {e}")
            result["file_path"] = None
            result["file_name"] = clean_name

        return Response(result, status=status.HTTP_200_OK)


class PortalSubmissionCommitExcelView(PortalScopeBase, APIView):
    """
    Commits the reviewed (and potentially edited) items and notes from the
    Excel Review UI into the database as PortalSubmissionItem records.
    """

    def post(self, request, pk):
        submission = PortalSubmission.objects.filter(
            pk=pk, client=self.get_client()
        ).first()
        if submission is None:
            raise PermissionDenied("Submission not found.")
        assert_month_open(submission)
        if submission.status not in PortalSubmission.EDITABLE_STATUSES:
            raise ValidationError(
                {"detail": "This submission is locked. Only draft or rejected submissions can be edited."}
            )

        items_data = request.data.get("items") or []
        notes = request.data.get("notes")
        file_path = request.data.get("file_path")
        file_name = request.data.get("file_name")

        if not items_data and not (notes and str(notes).strip()):
            raise ValidationError({"detail": "No items or notes to commit."})

        created_items = []
        errors = []

        with transaction.atomic():
            if notes and isinstance(notes, str) and notes.strip():
                existing = submission.notes.strip() if submission.notes else ""
                new_note = notes.strip()
                if existing and new_note not in existing:
                    submission.notes = f"{existing}\n{new_note}"
                elif not existing:
                    submission.notes = new_note
                submission.save(update_fields=["notes", "updated_at"])

            for idx, raw_item in enumerate(items_data):
                item_type = raw_item.get("item_type")
                payload = raw_item.get("payload") or {}
                if not item_type or not isinstance(payload, dict):
                    errors.append(f"Row #{idx+1}: Invalid item structure.")
                    continue
                missing = [k for k in required_keys(item_type) if not payload.get(k)]
                if missing:
                    errors.append(f"Row #{idx+1} ({item_type}): Missing required field(s): {', '.join(missing)}.")
                    continue
                if item_type == PortalSubmissionItem.TYPE_TDS and getattr(request.user, "role", None) != PortalUser.ROLE_CLIENT_ADMIN:
                    errors.append(f"Row #{idx+1} (TDS): Only Client Admins are authorized to submit TDS adjustments.")
                    continue

                payload["_source"] = "portal_excel_upload"
                item = PortalSubmissionItem.objects.create(
                    submission=submission,
                    item_type=item_type,
                    payload=payload,
                    created_by=request.user,
                )
                created_items.append(item.id)

            if errors:
                raise ValidationError({"detail": "Some rows could not be saved.", "errors": errors})

        # Register in matching PayrollJob events so Documents tab lists this Excel
        try:
            from payroll.models import PayrollJob, PayrollJobEvent, PayrollBatch
            jobs = PayrollJob.objects.filter(client=submission.client, month=submission.month, year=submission.year)
            uploader_label = f"Client Portal ({request.user.email if hasattr(request.user, 'email') else 'Client'})"
            for j in jobs:
                if file_path:
                    if j.batch and not j.batch.source_file:
                        j.batch.source_file = file_path
                        j.batch.save(update_fields=["source_file", "updated_at"])
                    PayrollJobEvent.objects.create(
                        job=j,
                        event_type="EXCEL_UPLOADED",
                        performed_by=None,
                        performed_by_name=uploader_label,
                        notes=json.dumps({
                            "file_name": file_name or "Payroll_MultiSheet_Inputs.xlsx",
                            "file_path": file_path,
                            "records_count": len(created_items),
                            "source": "client_portal",
                        }),
                    )
            if file_path:
                batch = PayrollBatch.objects.filter(client=submission.client, month=submission.month, year=submission.year).first()
                if batch and not batch.source_file:
                    batch.source_file = file_path
                    batch.save(update_fields=["source_file", "updated_at"])
        except Exception as e:
            logger.warning(f"Could not register PayrollJobEvent for portal excel: {e}")

        return Response(
            {
                "success": True,
                "created_count": len(created_items),
                "item_ids": created_items,
                "notes": submission.notes,
            },
            status=status.HTTP_201_CREATED,
        )




# ── Staff Admin Views ──────────────────────────────────────────────────────
class PortalUserAdminViewSet(viewsets.ModelViewSet):
    """Staff-only management of client portal logins (payroll module)."""

    queryset = PortalUser.objects.select_related("client").all().order_by("email")
    serializer_class = PortalUserAdminSerializer

    def get_permissions(self):
        from payroll.views import EVERYONE, PayrollOption
        # Permissions page → Direct Tax → Payroll → "Client portal — add, edit and switch off
        # client portal logins". Until access is set there, everyone signed in (as before).
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [permissions.IsAuthenticated(), PayrollOption("manage_portal_users", EVERYONE)()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset()
        client_param = self.request.query_params.get("client") or self.request.query_params.get("client_id")
        if client_param:
            qs = qs.filter(client_id=client_param)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save()


class PortalSubmissionAdminViewSet(viewsets.ReadOnlyModelViewSet):
    """Staff view of every client's monthly submissions + approve/reject."""

    serializer_class = PortalSubmissionSerializer

    # Deciding on what the client submitted. Permissions page → Direct Tax → Payroll →
    # "Client portal — approve, return, apply, skip or revert". Until set, everyone signed in.
    REVIEW_ACTIONS = {
        "approve", "reject", "apply_pending", "apply_single_item", "skip_single_item",
        "revert_single_item", "delete_single_item", "delete_single_item_alt",
    }

    def get_permissions(self):
        from payroll.views import EVERYONE, PayrollOption
        if self.action in self.REVIEW_ACTIONS:
            return [permissions.IsAuthenticated(), PayrollOption("review_portal_submissions", EVERYONE)()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        queryset = (
            PortalSubmission.objects.select_related(
                "client", "client__payroll_profile", "submitted_by", "approved_by"
            )
            .prefetch_related("items", "history")
            .order_by("-year", "-month")
        )
        if client_param := (self.request.query_params.get("client") or self.request.query_params.get("client_id")):
            queryset = queryset.filter(client_id=client_param)
        if month_param := self.request.query_params.get("month"):
            if str(month_param).isdigit():
                queryset = queryset.filter(month=int(month_param))
        if year_param := self.request.query_params.get("year"):
            if str(year_param).isdigit():
                queryset = queryset.filter(year=int(year_param))
        return queryset

    @action(detail=False, methods=["post"], url_path="ensure")
    def ensure(self, request):
        """
        Gets or creates a PortalSubmission for (client, month, year).
        Allows staff to immediately open and record monthly inputs
        for any client and month, even if the client never opened the portal.
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
            return Response({"detail": "month and year must be integers."}, status=status.HTTP_400_BAD_REQUEST)

        from clients.models import Client
        try:
            client = Client.objects.get(pk=client_id)
        except (Client.DoesNotExist, ValueError):
            return Response({"detail": "Client not found."}, status=status.HTTP_404_NOT_FOUND)

        submission, _ = PortalSubmission.objects.get_or_create(
            client=client, month=month, year=year
        )
        serializer = self.get_serializer(submission)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """Tiny counter for the Payroll dashboard badge.

        Deliberately does NOT serialize submissions — the dashboard only needs
        to know "did anyone submit something I haven't looked at yet", and it
        polls, so this stays two aggregate queries.
        """
        agg = PortalSubmission.objects.aggregate(
            awaiting_review=Count("id", filter=Q(status=PortalSubmission.STATUS_SUBMITTED)),
            last_submitted_at=Max("submitted_at", filter=Q(status=PortalSubmission.STATUS_SUBMITTED)),
            total=Count("id"),
        )
        pending_items = (
            PortalSubmissionItem.objects.exclude(status=PortalSubmissionItem.STATUS_APPLIED).count()
        )
        return Response(
            {
                "awaiting_review": agg["awaiting_review"] or 0,
                "pending_items": pending_items,
                "total": agg["total"] or 0,
                "last_submitted_at": agg["last_submitted_at"],
            }
        )

    def _get_item(self, submission, item_pk):
        return submission.items.filter(pk=item_pk).first()

    @action(detail=True, methods=["post"], url_path="items/(?P<item_pk>[^/.]+)/apply")
    def apply_single_item(self, request, pk=None, item_pk=None):
        """Apply ONE staged change instead of the whole month.

        Safer than the bulk button when a month holds a mix of good and bad
        input: you apply what is correct and skip what isn't, without
        approving the rest by accident.
        """
        submission = self.get_object()
        if submission.status == PortalSubmission.STATUS_REJECTED:
            return Response(
                {
                    "detail": (
                        "This month was returned to the client — its items can't be applied "
                        "until they resubmit. Skip the ones that should never apply."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        item = self._get_item(submission, item_pk)
        if item is None:
            return Response({"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.status == PortalSubmissionItem.STATUS_APPLIED:
            return Response(
                {"detail": "This change is already applied."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        applied = apply_item(item, approved_by=request.user)
        submission.approved_by = request.user
        submission.approved_at = timezone.now()

        # If all items in this submitted month are now resolved (applied or skipped),
        # reopen to DRAFT for subsequent rounds per the multi-round lifecycle
        has_pending = submission.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists()
        update_fields = ["approved_by", "approved_at", "updated_at"]
        if not has_pending and submission.status == PortalSubmission.STATUS_SUBMITTED:
            submission.status = PortalSubmission.STATUS_DRAFT
            update_fields.append("status")

        submission.save(update_fields=update_fields)
        record_event(
            submission,
            PortalSubmissionEvent.TYPE_APPROVED,
            item_count=1 if applied else 0,
            actor_staff=request.user,
            note=f"Applied one change ({item.item_type})." if applied else None,
        )
        if applied:
            refresh_batch_after_apply(submission, request.user, [item])
        item.refresh_from_db()
        submission.refresh_from_db()
        return Response(
            {
                "detail": "Change applied." if applied else (item.error or "The change could not be applied."),
                "applied": applied,
                "item": PortalSubmissionItemSerializer(item).data,
                "submission": PortalSubmissionSerializer(
                    submission, context=self.get_serializer_context()
                ).data,
            },
            status=status.HTTP_200_OK if applied else status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=["post"], url_path="items/(?P<item_pk>[^/.]+)/skip")
    def skip_single_item(self, request, pk=None, item_pk=None):
        """Dismiss a staged change so it stops queueing for application.

        Used for input that should never reach payroll (wrong month, duplicate,
        already handled offline) — especially on a month you returned, where
        the items would otherwise sit PENDING forever.
        """
        submission = self.get_object()
        item = self._get_item(submission, item_pk)
        if item is None:
            return Response({"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.status == PortalSubmissionItem.STATUS_APPLIED:
            return Response(
                {"detail": "This change is already applied and can't be skipped."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (request.data.get("reason") or "").strip()
        item.status = PortalSubmissionItem.STATUS_SKIPPED
        item.error = reason or "Skipped by the payroll team."
        item.save(update_fields=["status", "error", "updated_at"])

        # If all items are resolved and month was submitted, auto-reopen to DRAFT
        has_pending = submission.items.filter(status=PortalSubmissionItem.STATUS_PENDING).exists()
        if not has_pending and submission.status == PortalSubmission.STATUS_SUBMITTED:
            submission.status = PortalSubmission.STATUS_DRAFT
            submission.save(update_fields=["status", "updated_at"])

        return Response(
            {
                "detail": "Change skipped.",
                "item": PortalSubmissionItemSerializer(item).data,
            }
        )

    def _do_delete_item(self, request, pk, item_pk):
        submission = self.get_object()
        item = self._get_item(submission, item_pk)
        if item is None:
            return Response({"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.status == PortalSubmissionItem.STATUS_APPLIED:
            return Response(
                {"detail": "Cannot delete an already applied change. Please revert it first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        item.delete()
        return Response({"detail": "Item deleted."}, status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["delete", "post"], url_path="items/(?P<item_pk>[^/.]+)/delete")
    def delete_single_item_alt(self, request, pk=None, item_pk=None):
        return self._do_delete_item(request, pk, item_pk)

    @action(detail=True, methods=["delete"], url_path="items/(?P<item_pk>[^/.]+)")
    def delete_single_item(self, request, pk=None, item_pk=None):
        return self._do_delete_item(request, pk, item_pk)

    @action(detail=True, methods=["patch", "put", "post"], url_path="items/(?P<item_pk>[^/.]+)/update")
    def update_single_item(self, request, pk=None, item_pk=None):
        """Update an existing item's payload and reset status to PENDING if it was excluded or failed."""
        submission = self.get_object()
        item = self._get_item(submission, item_pk)
        if item is None:
            return Response({"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.status == PortalSubmissionItem.STATUS_APPLIED:
            return Response({"detail": "Cannot modify an already applied change. Please revert it first."}, status=status.HTTP_400_BAD_REQUEST)

        incoming_payload = request.data.get("payload") if isinstance(request.data.get("payload"), dict) else request.data
        if isinstance(incoming_payload, dict):
            new_payload = dict(item.payload or {})
            for k, v in incoming_payload.items():
                if v is not None and v != "":
                    if k in ("amount", "total_amount", "ctc_annual", "days"):
                        try:
                            v = float(v)
                        except (ValueError, TypeError):
                            pass
                    new_payload[k] = v
            item.payload = new_payload

        if "item_type" in request.data and request.data["item_type"]:
            item.item_type = request.data["item_type"]

        # When Maker modifies an excluded or failed item, return status to PENDING so Checker can review it!
        if item.status in (PortalSubmissionItem.STATUS_SKIPPED, PortalSubmissionItem.STATUS_FAILED):
            item.status = PortalSubmissionItem.STATUS_PENDING
            item.error = ""

        item.save()
        return Response(
            {
                "detail": "Adjustment updated and resubmitted to Pending.",
                "item": PortalSubmissionItemSerializer(item).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="items/(?P<item_pk>[^/.]+)/revert")
    def revert_single_item(self, request, pk=None, item_pk=None):
        """Revert a single applied item back to PENDING and rollback its calculations."""
        submission = self.get_object()
        item = self._get_item(submission, item_pk)
        if item is None:
            return Response({"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.status != PortalSubmissionItem.STATUS_APPLIED:
            return Response(
                {"detail": "Only applied changes can be reverted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        success = revert_item(item, request.user)
        if not success:
            return Response({"detail": "Failed to revert item."}, status=status.HTTP_400_BAD_REQUEST)

        item.refresh_from_db()
        submission.refresh_from_db()
        return Response(
            {
                "detail": "Change reverted and rolled back from batch calculations.",
                "item": PortalSubmissionItemSerializer(item).data,
                "submission": PortalSubmissionSerializer(submission, context=self.get_serializer_context()).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        submission = self.get_object()
        source = request.query_params.get("source")
        qs = submission.items.all()
        if source == "portal":
            qs = qs.filter(created_by__isnull=False)
        elif source == "excel":
            qs = qs.filter(created_by__isnull=True, payload___source="excel_upload")
        elif source == "monthly_input":
            qs = qs.filter(created_by__isnull=True).exclude(payload___source="excel_upload")
        elif source == "internal":
            qs = qs.filter(created_by__isnull=True)
        return Response(
            PortalSubmissionItemSerializer(qs, many=True).data
        )

    @action(detail=True, methods=["post"], url_path="add-item")
    def add_item(self, request, pk=None):
        """Staff adds input directly to a month. If auto_apply=True (default),
        item applies immediately. If auto_apply=False (e.g. Maker creating a draft
        for Checker audit), the item is saved with status=PENDING for later review."""
        submission = self.get_object()
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        payload = data.get("payload") or {}
        if isinstance(payload, dict):
            payload["_source"] = "monthly_input"
        data["payload"] = payload

        serializer = PortalSubmissionItemSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        auto_apply = request.data.get("auto_apply", True)
        if isinstance(auto_apply, str):
            auto_apply = auto_apply.lower() in ("true", "1")

        if auto_apply:
            item = serializer.save(submission=submission)  # created_by null (staff)
            applied = apply_item(item, approved_by=request.user)
            submission.approved_by = request.user
            submission.approved_at = timezone.now()
            submission.save(update_fields=["approved_by", "approved_at", "updated_at"])
            if applied:
                record_event(
                    submission,
                    PortalSubmissionEvent.TYPE_APPROVED,
                    item_count=1,
                    actor_staff=request.user,
                )
                # Push the change straight into the month's batch if it already
                # exists (the staff member IS the approver here — no later
                # submit/approve round-trip will re-apply it).
                refresh_batch_after_apply(submission, request.user, [item])
        else:
            item = serializer.save(submission=submission, status=PortalSubmissionItem.STATUS_PENDING)
            applied = False

        return Response(
            {
                "item": PortalSubmissionItemSerializer(item).data,
                "applied": applied,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="template")
    def template(self, request, pk=None):
        """Generates and streams the multi-sheet .xlsx input template for the submission."""
        submission = self.get_object()
        file_io = generate_portal_template(submission.client, is_admin=True)
        client_name_clean = re.sub(r"[^\w\s-]", "", submission.client.name or "Client").strip().replace(" ", "_")
        filename = f"Payroll_Template_{client_name_clean[:20]}_{submission.month:02d}_{submission.year}.xlsx"

        response = HttpResponse(
            file_io.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="parse-excel")
    def parse_excel(self, request, pk=None):
        """Parses an uploaded multi-sheet Excel workbook in RAM and returns structured preview items."""
        submission = self.get_object()
        excel_file = request.FILES.get("file")
        if not excel_file:
            return Response(
                {"detail": "No file uploaded. Please select an Excel (.xlsx) file."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = parse_portal_excel(excel_file, submission.client)
        except Exception as e:
            return Response(
                {"detail": f"Failed to parse Excel workbook: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Save uploaded file to default_storage for persistence and audit documents
        clean_name = getattr(excel_file, "name", "Payroll_Template_Upload.xlsx")
        try:
            from payroll.models import get_payroll_storage_rel_path
            excel_file.seek(0)
            rel_path = get_payroll_storage_rel_path(
                client=submission.client,
                year=submission.year,
                month=submission.month,
                category="excel",
                filename=clean_name,
            )
            saved_path = default_storage.save(rel_path, excel_file)
            result["file_path"] = saved_path
            result["file_name"] = clean_name
        except Exception as e:
            logger.warning(f"Could not persist multi-sheet excel file: {e}")
            result["file_path"] = None
            result["file_name"] = clean_name

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="commit-excel")
    def commit_excel(self, request, pk=None):
        """Commits the reviewed multi-sheet items into the database as pending PortalSubmissionItem records,
        associates the file with the PayrollJob and optionally applies items immediately if requested by Checker."""
        submission = self.get_object()
        items_data = request.data.get("items") or []
        notes = request.data.get("notes")
        file_path = request.data.get("file_path")
        file_name = request.data.get("file_name")
        auto_apply = bool(request.data.get("auto_apply"))

        if not items_data and not (notes and str(notes).strip()):
            return Response(
                {"detail": "No items or notes to commit."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_items = []
        errors = []

        with transaction.atomic():
            if notes and isinstance(notes, str) and notes.strip():
                existing = submission.notes.strip() if submission.notes else ""
                new_note = notes.strip()
                if existing and new_note not in existing:
                    submission.notes = f"{existing}\n{new_note}"
                elif not existing:
                    submission.notes = new_note
                submission.save(update_fields=["notes", "updated_at"])

            for idx, raw_item in enumerate(items_data):
                item_type = raw_item.get("item_type")
                payload = raw_item.get("payload") or {}
                if not item_type or not isinstance(payload, dict):
                    errors.append(f"Row #{idx+1}: Invalid item structure.")
                    continue
                missing = [k for k in required_keys(item_type) if not payload.get(k)]
                if missing:
                    errors.append(f"Row #{idx+1} ({item_type}): Missing required field(s): {', '.join(missing)}.")
                    continue

                item_source = raw_item.get("source") or payload.get("_source")
                if item_source in ["manual", "monthly_input"]:
                    payload["_source"] = "monthly_input"
                else:
                    payload["_source"] = "excel_upload"
                item = PortalSubmissionItem.objects.create(
                    submission=submission,
                    item_type=item_type,
                    payload=payload,
                    created_by=None,
                    status=PortalSubmissionItem.STATUS_PENDING,
                )
                created_items.append(item.id)

            if errors:
                return Response(
                    {"detail": "Some rows could not be saved.", "errors": errors},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Register in matching PayrollJob events so Documents tab lists this Excel
        try:
            from payroll.models import PayrollJob, PayrollJobEvent, PayrollBatch
            jobs = PayrollJob.objects.filter(client=submission.client, month=submission.month, year=submission.year)
            for j in jobs:
                if file_path:
                    if j.batch and not j.batch.source_file:
                        j.batch.source_file = file_path
                        j.batch.save(update_fields=["source_file", "updated_at"])
                    PayrollJobEvent.objects.create(
                        job=j,
                        event_type="EXCEL_UPLOADED",
                        performed_by=request.user if request.user.is_authenticated else None,
                        performed_by_name=request.user.get_full_name() or request.user.username if request.user.is_authenticated else "Staff",
                        notes=json.dumps({
                            "file_name": file_name or "Payroll_MultiSheet_Inputs.xlsx",
                            "file_path": file_path,
                            "records_count": len(created_items),
                        }),
                    )
            if file_path:
                batch = PayrollBatch.objects.filter(client=submission.client, month=submission.month, year=submission.year).first()
                if batch and not batch.source_file:
                    batch.source_file = file_path
                    batch.save(update_fields=["source_file", "updated_at"])
        except Exception as e:
            logger.warning(f"Could not register PayrollJobEvent for multi-sheet excel: {e}")

        # If Checker opted to directly approve & apply to batch
        applied_summary = None
        if auto_apply:
            try:
                applied_summary = apply_submission(
                    submission, approved_by=request.user, allow_unsubmitted=True
                )
                submission.refresh_from_db()
            except Exception as e:
                logger.error(f"Failed to auto-apply submission items: {e}")
                return Response(
                    {"detail": f"Items were staged, but auto-apply failed: {str(e)}", "item_ids": created_items},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        return Response(
            {
                "success": True,
                "created_count": len(created_items),
                "item_ids": created_items,
                "notes": submission.notes,
                "auto_applied": auto_apply,
                "applied_summary": applied_summary,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        submission = self.get_object()
        if submission.status != PortalSubmission.STATUS_SUBMITTED:
            return Response(
                {"detail": "Only submitted submissions can be approved."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        summary = apply_submission(submission, approved_by=request.user)
        submission.refresh_from_db()
        return Response(
            {
                "detail": "Approved and applied. The month is open again for any further changes.",
                "submission": PortalSubmissionSerializer(submission).data,
                "summary": summary,
            }
        )

    @action(detail=True, methods=["post"], url_path="apply-pending")
    def apply_pending(self, request, pk=None):
        """Apply the items of a month the client has NOT (re)submitted.

        A month reopens to DRAFT after every approval, so anything the client
        adds afterwards — or a change they emailed while the month was already
        approved — sits PENDING with no Approve button available (approve/
        reject only accept SUBMITTED). Staff are the approvers, so this
        applies those leftover items directly, records the APPROVED round and
        folds the result into an already-generated batch.
        """
        submission = self.get_object()
        if submission.status == PortalSubmission.STATUS_SUBMITTED:
            return Response(
                {"detail": "This month is submitted — use Approve & Apply instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # You returned this month because the values were wrong; applying the
        # very same items in bulk afterwards would push that wrong data into
        # payroll. Wait for the corrected resubmission, or handle the items
        # one by one (apply/skip below).
        if submission.status == PortalSubmission.STATUS_REJECTED:
            return Response(
                {
                    "detail": (
                        "This month was returned to the client. Wait for their corrected "
                        "resubmission, or apply/skip the individual items."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        source = (request.data.get("source") if hasattr(request, "data") else None) or request.query_params.get("source")
        qs = submission.items.exclude(status="APPLIED")
        if source == "portal":
            qs = qs.filter(created_by__isnull=False)
        elif source == "excel":
            qs = qs.filter(created_by__isnull=True, payload___source="excel_upload")
        elif source == "monthly_input":
            qs = qs.filter(created_by__isnull=True).exclude(payload___source="excel_upload")
        elif source == "internal":
            qs = qs.filter(created_by__isnull=True)

        if not qs.exists():
            return Response(
                {"detail": "Nothing to apply — no unapplied items found for this filter."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        summary = apply_submission(
            submission, approved_by=request.user, allow_unsubmitted=True, items_qs=qs
        )
        submission.refresh_from_db()
        summary_payload = {
            **summary,
            "applied": summary.get("applied", 0),
            "applied_count": summary.get("applied", 0),
            "failed_count": summary.get("failed", 0),
            "skipped_count": summary.get("skipped", 0),
        }
        return Response(
            {
                "detail": "Pending changes applied. The month stays open for further changes.",
                "submission": PortalSubmissionSerializer(submission).data,
                "summary": summary_payload,
            }
        )

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        submission = self.get_object()
        if submission.status != PortalSubmission.STATUS_SUBMITTED:
            return Response(
                {"detail": "Only submitted submissions can be rejected."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        submission.status = PortalSubmission.STATUS_REJECTED
        submission.rejection_reason = (request.data.get("reason") or "").strip()
        submission.save(update_fields=["status", "rejection_reason", "updated_at"])
        # Count only unapplied items returned in THIS round (matching submissions.py)
        # Using items.count() included already-applied items from previous rounds
        # and made the returned count inaccurately inflate.
        pending_count = submission.items.exclude(
            status=PortalSubmissionItem.STATUS_APPLIED
        ).count()
        record_event(
            submission,
            PortalSubmissionEvent.TYPE_REJECTED,
            item_count=pending_count,
            actor_staff=request.user,
            note=submission.rejection_reason,
        )
        return Response(PortalSubmissionSerializer(submission).data)



__all__ = [
    "PortalScopeBase",
    "PortalLoginView",
    "PortalLogoutView",
    "PortalMeView",
    "PortalChangePasswordView",
    "PortalEmployeeListView",
    "PortalEmployeeDetailView",
    "PortalStructureListView",
    "PortalAdvanceListView",
    "PortalComponentListView",
    "assert_month_open",
    "PortalSubmissionListCreateView",
    "PortalSubmissionSubmitView",
    "PortalSubmissionNotesView",
    "PortalItemListCreateView",
    "PortalItemDetailView",
    "PortalSubmissionTemplateDownloadView",
    "PortalSubmissionParseExcelView",
    "PortalSubmissionCommitExcelView",
    "PortalUserAdminViewSet",
    "PortalSubmissionAdminViewSet",
]
