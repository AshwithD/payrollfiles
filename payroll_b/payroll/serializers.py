"""hrms_backend /payroll/serializers.py"""

import datetime
import json
from decimal import Decimal

from rest_framework import serializers

from .calculations import is_in_probation
from clients.models import Client as MasterClient
from .models import (
    ClientProfile, CompOffAdjustment, EmailLog, Employee, EmployeeSalaryStructure, LeaveAdjustment, SalaryComponent,
    OnHoldAdjustment, PayrollBatch, PayrollJob, PayrollJobEvent, PayslipRecord, PayslipRecordEdit, SalaryAdvance,
    SalaryAdvanceAdjustment, get_latest_salary_structure,
)


PAYSLIP_EDITABLE_FIELDS = [
    "days_in_month", "actual_working_days", "extra_working_days", "paid_leave_days", "lop_days",
    "basic_da", "basic_for_pf", "hra", "lta", "special_allowance",
    "nps_allowance_earned", "gross_salary", "variable_pay", "commission_other",
    "arrears", "reimbursements", "earned_salary", "tds", "epf", "vpf", "professional_tax",
    "nps_deduction", "vpf_arrears", "nps_deduction_arrears", "loan_deduction",
    "lwf", "other_deduction", "custom_components",
]

# Required payload keys per portal submission item type.
REQUIRED_KEYS = {
    "NEW_EMPLOYEE": ["employee_code", "first_name", "ctc_annual"],
    "REVISION": ["employee_id", "effective_from", "ctc_annual"],
    "EXIT": ["employee_id", "last_working_date"],
    "SALARY_HOLD": ["employee_id", "amount", "release_month", "release_year"],
    "ADVANCE": ["employee_id", "total_amount", "tenure_months"],
    "ONE_TIME_EARNING": ["employee_id", "amount"],
    "ONE_TIME_DEDUCTION": ["employee_id", "amount"],
    "NOTE": ["text"],
    "TDS": ["employee_id", "amount"],
    "LOP": ["employee_id", "days"],
    "ARREARS": ["employee_id", "amount"],
    "REIMBURSEMENT": ["employee_id", "amount"],
    "CUSTOM_COMPONENT": ["employee_id", "component_code", "amount"],
}


def required_keys(item_type: str) -> list:
    """Returns required payload keys for a portal submission item type."""
    return REQUIRED_KEYS.get(item_type, [])



class SalaryComponentSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    is_monthly_variable = serializers.BooleanField(required=False)
    carve_out_from_ctc = serializers.BooleanField(required=False)
    payout_frequency = serializers.CharField(required=False)
    payout_month = serializers.IntegerField(required=False)
    prorate_for_mid_year_joiners = serializers.BooleanField(required=False)

    class Meta:
        model = SalaryComponent
        fields = [
            "id", "client", "client_name", "name", "code", "abbr",
            "component_type", "calculation_type", "formula", "default_value",
            "is_monthly_variable", "carve_out_from_ctc",
            "payout_frequency", "payout_month", "prorate_for_mid_year_joiners",
            "depends_on_payment_days", "do_not_include_in_total", "statistical_component",
            "remove_if_zero_valued", "round_to_nearest_integer",
            "is_taxable", "is_part_of_pf_wages", "is_part_of_esi_wages", "is_statutory",
            "display_order", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        is_var = validated_data.pop("is_monthly_variable", None)
        is_carve = validated_data.pop("carve_out_from_ctc", None)
        p_freq = validated_data.pop("payout_frequency", None)
        p_month = validated_data.pop("payout_month", None)
        prorate_joiner = validated_data.pop("prorate_for_mid_year_joiners", None)
        instance = super().create(validated_data)
        save_fields = []
        if is_var is not None:
            instance.is_monthly_variable = is_var
            save_fields.append("formula")
        if is_carve is not None:
            instance.carve_out_from_ctc = is_carve
            if "formula" not in save_fields:
                save_fields.append("formula")
        if p_month is not None:
            instance.payout_month = p_month
            if "formula" not in save_fields:
                save_fields.append("formula")
        if p_freq is not None:
            instance.payout_frequency = p_freq
            if "formula" not in save_fields:
                save_fields.append("formula")
        if prorate_joiner is not None:
            instance.prorate_for_mid_year_joiners = prorate_joiner
            if "formula" not in save_fields:
                save_fields.append("formula")
        if save_fields:
            instance.save(update_fields=save_fields)
        return instance

    def update(self, instance, validated_data):
        is_var = validated_data.pop("is_monthly_variable", None)
        is_carve = validated_data.pop("carve_out_from_ctc", None)
        p_freq = validated_data.pop("payout_frequency", None)
        p_month = validated_data.pop("payout_month", None)
        prorate_joiner = validated_data.pop("prorate_for_mid_year_joiners", None)
        instance = super().update(instance, validated_data)
        save_fields = []
        if is_var is not None:
            instance.is_monthly_variable = is_var
            save_fields.append("formula")
        if is_carve is not None:
            instance.carve_out_from_ctc = is_carve
            if "formula" not in save_fields:
                save_fields.append("formula")
        if p_month is not None:
            instance.payout_month = p_month
            if "formula" not in save_fields:
                save_fields.append("formula")
        if p_freq is not None:
            instance.payout_frequency = p_freq
            if "formula" not in save_fields:
                save_fields.append("formula")
        if prorate_joiner is not None:
            instance.prorate_for_mid_year_joiners = prorate_joiner
            if "formula" not in save_fields:
                save_fields.append("formula")
        if save_fields:
            instance.save(update_fields=save_fields)
        return instance

    def validate_code(self, value):
        return (value or "").strip().upper()

    def validate_abbr(self, value):
        return (value or "").strip().upper()


class PayrollBatchSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    uploaded_by_display = serializers.SerializerMethodField()
    reviewed_by_display = serializers.SerializerMethodField()
    sent_by_display = serializers.SerializerMethodField()
    job_id = serializers.SerializerMethodField()
    job_status = serializers.SerializerMethodField()
    pay_cycle_start = serializers.SerializerMethodField()
    pay_cycle_end = serializers.SerializerMethodField()
    pay_cycle_days = serializers.SerializerMethodField()
    # Firm-wide (not client-scoped) cash collected within the CURRENT
    # FirmBudgetPeriod — same single source of truth as the Company
    # Detail revenue card (apps.budget.services.get_budget_period_revenue).
    # Shown for context alongside payroll cost during batch review.
    budget_period_revenue = serializers.SerializerMethodField()
    budget_period_revenue_label = serializers.SerializerMethodField()

    class Meta:
        model = PayrollBatch
        fields = [
            "id", "client", "client_name", "month", "year", "status",
            "source_file", "total_records", "email_sent", "email_failed",
            "error_log", "uploaded_by", "uploaded_by_display", "reviewed_by",
            "reviewed_by_display", "reviewed_at", "sent_by", "sent_by_display",
            "sent_at", "created_at", "updated_at",
            "budget_period_revenue", "budget_period_revenue_label",
            "job_id", "job_status",
            "pay_cycle_start", "pay_cycle_end", "pay_cycle_days",
        ]
        read_only_fields = [
            "id", "status", "total_records", "email_sent", "email_failed",
            "error_log", "uploaded_by", "uploaded_by_display", "reviewed_by",
            "reviewed_by_display", "reviewed_at", "sent_by", "sent_by_display",
            "sent_at", "created_at", "updated_at",
            "budget_period_revenue", "budget_period_revenue_label",
            "job_id", "job_status",
            "pay_cycle_start", "pay_cycle_end", "pay_cycle_days",
        ]

    def get_pay_cycle_start(self, obj):
        try:
            start_d, _, _ = obj.get_cycle_dates()
            return start_d.isoformat()
        except Exception:
            return None

    def get_pay_cycle_end(self, obj):
        try:
            _, end_d, _ = obj.get_cycle_dates()
            return end_d.isoformat()
        except Exception:
            return None

    def get_pay_cycle_days(self, obj):
        try:
            _, _, total_days = obj.get_cycle_dates()
            return total_days
        except Exception:
            return None

    def get_job_id(self, obj):
        job = obj.jobs.first()
        return job.id if job else None

    def get_job_status(self, obj):
        job = obj.jobs.first()
        return job.status if job else None

    def _current_budget_period_revenue(self, obj):
        # Cached on the instance for the duration of this serialization —
        # both method fields need it and it involves a DB aggregate.
        if not hasattr(obj, "_budget_period_revenue_cache"):
            # Inlined from budget_stub
            get_budget_period_revenue = _get_budget_period_revenue
            obj._budget_period_revenue_cache = get_budget_period_revenue()
        return obj._budget_period_revenue_cache

    def get_budget_period_revenue(self, obj):
        _period, revenue = self._current_budget_period_revenue(obj)
        return revenue

    def get_budget_period_revenue_label(self, obj):
        period, _revenue = self._current_budget_period_revenue(obj)
        return period.revenue_label if period else None

    def validate_client(self, client):
        # Multi-client now — nothing to validate beyond the FK itself
        # resolving to a real Client row (handled by the FK field).
        return client

    def _display_user(self, user) -> str | None:
        if not user:
            return None
        return getattr(user, "full_name", "") or user.get_username()

    def get_uploaded_by_display(self, obj):
        return self._display_user(obj.uploaded_by)

    def get_reviewed_by_display(self, obj):
        return self._display_user(obj.reviewed_by)

    def get_sent_by_display(self, obj):
        return self._display_user(obj.sent_by)


class PayrollBatchListSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    job_id = serializers.SerializerMethodField()
    job_status = serializers.SerializerMethodField()

    class Meta:
        model = PayrollBatch
        fields = [
            "id", "client", "client_name", "month", "year", "status",
            "total_records", "email_sent", "email_failed", "created_at",
            "reviewed_at", "sent_at", "job_id", "job_status",
        ]

    def get_job_id(self, obj):
        job = obj.jobs.first()
        return job.id if job else None

    def get_job_status(self, obj):
        job = obj.jobs.first()
        return job.status if job else None


class CompOffAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = CompOffAdjustment
        fields = [
            "id", "employee", "amount", "reason",
            "applied_in_record", "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = ["id", "applied_in_record", "created_by", "created_by_name", "created_at"]

    def create(self, validated_data: dict) -> CompOffAdjustment:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class LeaveAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = LeaveAdjustment
        fields = [
            "id", "employee", "amount", "reason",
            "applied_in_record", "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = ["id", "applied_in_record", "created_by", "created_by_name", "created_at"]

    def create(self, validated_data: dict) -> LeaveAdjustment:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class SalaryAdvanceAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    # Which payroll batch (if any) this row's rupee movement actually landed
    # in — this is the true "month" a disbursement/recovery took effect,
    # since a row can sit pending for a while before a batch picks it up.
    applied_month = serializers.IntegerField(source="applied_in_record.batch.month", read_only=True, default=None)
    applied_year = serializers.IntegerField(source="applied_in_record.batch.year", read_only=True, default=None)
    # Plan tenure/EMI context for rows generated by a SalaryAdvance EMI
    # plan (disbursement or auto-recovery) — null for ordinary manual
    # one-off advances/recoveries, exactly matching SalaryAdvanceAdjustment.advance.
    advance_tenure_months = serializers.IntegerField(source="advance.tenure_months", read_only=True, default=None)
    advance_emi_amount = serializers.DecimalField(source="advance.emi_amount", max_digits=12, decimal_places=2, read_only=True, default=None)

    class Meta:
        model = SalaryAdvanceAdjustment
        fields = [
            "id", "employee", "amount", "reason", "advance",
            "advance_tenure_months", "advance_emi_amount",
            "applied_in_record", "applied_month", "applied_year",
            "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = [
            "id", "advance", "advance_tenure_months", "advance_emi_amount",
            "applied_in_record", "applied_month", "applied_year",
            "created_by", "created_by_name", "created_at",
        ]

    def create(self, validated_data: dict) -> SalaryAdvanceAdjustment:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class SalaryAdvanceSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    months_remaining = serializers.SerializerMethodField()
    # The month this plan's lump-sum actually landed in a payslip — null
    # until the disbursement adjustment is applied to a batch, in which
    # case the plan is shown as "pending since created_at" on the frontend.
    disbursement_month = serializers.IntegerField(
        source="disbursement_adjustment.applied_in_record.batch.month", read_only=True, default=None,
    )
    disbursement_year = serializers.IntegerField(
        source="disbursement_adjustment.applied_in_record.batch.year", read_only=True, default=None,
    )

    class Meta:
        model = SalaryAdvance
        fields = [
            "id", "employee", "total_amount", "tenure_months", "emi_amount",
            "months_recovered", "months_remaining", "reason",
            "disbursement_adjustment", "disbursement_month", "disbursement_year",
            "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = [
            "id", "emi_amount", "months_recovered", "months_remaining",
            "disbursement_adjustment", "disbursement_month", "disbursement_year",
            "created_by", "created_by_name", "created_at",
        ]

    def get_months_remaining(self, obj: SalaryAdvance) -> int:
        return obj.tenure_months - obj.months_recovered

    def validate_tenure_months(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("tenure_months must be at least 1.")
        return value

    def validate_total_amount(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("total_amount must be greater than 0.")
        return value

    def create(self, validated_data: dict) -> SalaryAdvance:
        """
        A SalaryAdvance plan always creates its lump-sum disbursement as an
        ordinary SalaryAdvanceAdjustment (amount=+total_amount) — the same
        row type/mechanism a manual one-off advance uses — so it folds into
        salary_advance_disbursed via the exact same existing code path in
        PayrollUploadView / _current_open_record, with no special-casing
        needed there for disbursement. Only the auto-recovery installments
        (created later, in PayrollUploadView) are specific to this plan.

        disbursement_adjustment is a required (non-null) OneToOneField on
        SalaryAdvance, but SalaryAdvanceAdjustment.advance is nullable — so
        the adjustment has to exist first (created with advance=None), then
        the plan is created referencing it, then the adjustment is updated
        to point back at the plan.
        """
        employee = validated_data["employee"]
        total_amount = validated_data["total_amount"]
        tenure_months = validated_data["tenure_months"]
        reason = validated_data["reason"]
        created_by = validated_data["created_by"]

        emi_amount = (total_amount / tenure_months).quantize(Decimal("0.01"))

        disbursement_adjustment = SalaryAdvanceAdjustment.objects.create(
            employee=employee,
            amount=total_amount,
            reason=f"Salary advance disbursement ({tenure_months}-month EMI plan): {reason}",
            created_by=created_by,
        )
        advance = SalaryAdvance.objects.create(
            employee=employee,
            total_amount=total_amount,
            tenure_months=tenure_months,
            emi_amount=emi_amount,
            reason=reason,
            disbursement_adjustment=disbursement_adjustment,
            created_by=created_by,
        )
        disbursement_adjustment.advance = advance
        disbursement_adjustment.save(update_fields=["advance"])
        return advance


class OnHoldAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    # Which payroll batch (if any) this row's amount actually landed in —
    # null while still pending (see applied_in_record docstring).
    applied_month = serializers.IntegerField(source="applied_in_record.batch.month", read_only=True, default=None)
    applied_year = serializers.IntegerField(source="applied_in_record.batch.year", read_only=True, default=None)

    class Meta:
        model = OnHoldAdjustment
        fields = [
            "id", "employee", "amount", "reason",
            "applied_in_record", "applied_month", "applied_year",
            "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = [
            "id", "applied_in_record", "applied_month", "applied_year",
            "created_by", "created_by_name", "created_at",
        ]

    def create(self, validated_data: dict) -> OnHoldAdjustment:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class PayslipRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee.email", read_only=True, default=None)
    employee_designation = serializers.CharField(source="employee.position", read_only=True, default=None)
    pan_number = serializers.CharField(source="employee.pan_number", read_only=True, default="")
    payment_mode = serializers.CharField(source="employee.payment_mode", read_only=True, default=None)
    payment_mode_display = serializers.SerializerMethodField()
    bank_name = serializers.CharField(source="employee.bank_name", read_only=True, default="")
    bank_account_number = serializers.CharField(source="employee.bank_account_number", read_only=True, default="")
    bank_account_masked = serializers.SerializerMethodField()
    bank_ifsc_code = serializers.CharField(source="employee.bank_ifsc_code", read_only=True, default="")
    employer_pf = serializers.SerializerMethodField()
    employer_esi = serializers.SerializerMethodField()
    esi = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    esi_number = serializers.CharField(source="employee.esi_number", read_only=True, default="")
    uan_number = serializers.CharField(source="employee.uan_number", read_only=True, default="")
    esi_applicable = serializers.SerializerMethodField()
    show_payment_mode_in_payslip = serializers.SerializerMethodField()
    show_employer_contribution_in_payslip = serializers.SerializerMethodField()
    show_uan_in_payslip = serializers.SerializerMethodField()
    cycle_period_display = serializers.SerializerMethodField()
    hire_date = serializers.DateField(source="employee.hire_date", read_only=True, default=None)
    last_working_date = serializers.DateField(source="employee.last_working_date", read_only=True, default=None)
    batch_month = serializers.IntegerField(source="batch.month", read_only=True)
    batch_year = serializers.IntegerField(source="batch.year", read_only=True)
    ctc_annual = serializers.SerializerMethodField()
    # Derived, not stored — this payslip's own figures are the ground truth
    # for whether PF/PT actually applied this month, rather than a separate
    # flag on Employee/EmployeeSalaryStructure that could drift out of sync.
    pf_applicable = serializers.SerializerMethodField()
    pt_applicable = serializers.SerializerMethodField()
    # Anchored to THIS payslip's own batch month/year, not today — a
    # payslip is a historical record, so it must reflect whether the
    # employee was on probation in that specific month, not now.
    is_probation = serializers.SerializerMethodField()
    is_intern = serializers.SerializerMethodField()
    employment_type = serializers.SerializerMethodField()
    contracted_basic_da = serializers.SerializerMethodField()
    contracted_hra = serializers.SerializerMethodField()
    contracted_lta = serializers.SerializerMethodField()
    contracted_special_allowance = serializers.SerializerMethodField()
    contracted_fbp = serializers.SerializerMethodField()
    fbp = serializers.SerializerMethodField()
    contracted_monthly_gross = serializers.SerializerMethodField()
    monthly_ctc = serializers.SerializerMethodField()
    employer_pf_carveout = serializers.SerializerMethodField()
    employer_pf_in_ctc = serializers.SerializerMethodField()
    employer_esi_carveout = serializers.SerializerMethodField()
    employer_esi_in_ctc = serializers.SerializerMethodField()
    gratuity_carveout = serializers.SerializerMethodField()
    gratuity_in_ctc = serializers.SerializerMethodField()
    fbp_carveout = serializers.SerializerMethodField()
    carve_out_fbp_in_ctc = serializers.SerializerMethodField()
    custom_carveouts_total = serializers.SerializerMethodField()
    total_carveouts = serializers.SerializerMethodField()
    edit_count = serializers.SerializerMethodField()

    class Meta:
        model = PayslipRecord
        fields = [
            "id", "batch", "batch_month", "batch_year", "employee", "employee_code",
            "employee_name", "employee_email", "employee_designation", "pan_number", "esi_number", "uan_number",
            "payment_mode", "payment_mode_display", "bank_name", "bank_account_number",
            "bank_account_masked", "bank_ifsc_code", "employer_pf", "employer_esi",
            "show_payment_mode_in_payslip", "show_employer_contribution_in_payslip", "show_uan_in_payslip", "cycle_period_display",
            "hire_date", "last_working_date",
            "salary_structure_snapshot", "ctc_annual", "monthly_ctc",
            "employer_pf_carveout", "employer_pf_in_ctc", "employer_esi_carveout", "employer_esi_in_ctc",
            "gratuity_carveout", "gratuity_in_ctc", "fbp_carveout", "carve_out_fbp_in_ctc",
            "custom_carveouts_total", "total_carveouts",
            "pf_applicable", "pt_applicable", "esi_applicable",
            "is_probation", "is_intern", "employment_type",
            "contracted_basic_da", "contracted_hra", "contracted_lta", "contracted_special_allowance", "contracted_fbp", "contracted_monthly_gross",
            "days_in_month", "actual_working_days", "extra_working_days",
            "comp_off_opening_balance", "comp_off_days_used", "comp_off_closing_balance",
            "leave_opening_balance", "leave_accrued", "leave_used", "leave_closing_balance",
            "salary_advance_opening_balance", "salary_advance_disbursed", "salary_advance_recovered",
            "salary_advance_closing_balance",
            "on_hold_opening_balance", "on_hold_deducted", "on_hold_released", "on_hold_closing_balance",
            "paid_leave_days", "lop_days",
            "basic_da", "basic_for_pf", "hra", "lta", "special_allowance", "fbp",
            "nps_allowance_earned", "gross_salary", "variable_pay", "commission_other",
            "arrears", "reimbursements", "earned_salary", "tds", "epf", "esi", "vpf", "professional_tax",
            "nps_deduction", "vpf_arrears", "nps_deduction_arrears", "loan_deduction",
            "lwf", "other_deduction", "total_deductions", "net_salary", "pdf_path",
            "status", "raw_row_data", "custom_components", "edit_count", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "batch", "employee", "employee_code", "employee_name",
            "employee_email", "employee_designation", "pan_number", "esi_number", "uan_number",
            "payment_mode", "payment_mode_display", "bank_name", "bank_account_number",
            "bank_account_masked", "bank_ifsc_code", "employer_pf", "employer_esi",
            "show_payment_mode_in_payslip", "show_employer_contribution_in_payslip", "show_uan_in_payslip", "cycle_period_display",
            "hire_date", "last_working_date", "salary_structure_snapshot",
            "ctc_annual", "monthly_ctc",
            "employer_pf_carveout", "employer_pf_in_ctc", "employer_esi_carveout", "employer_esi_in_ctc",
            "gratuity_carveout", "gratuity_in_ctc", "fbp_carveout", "carve_out_fbp_in_ctc",
            "custom_carveouts_total", "total_carveouts",
            "pf_applicable", "pt_applicable", "esi_applicable", "is_probation", "is_intern", "employment_type",
            "contracted_basic_da", "contracted_hra", "contracted_lta", "contracted_special_allowance", "contracted_fbp", "contracted_monthly_gross",
            "fbp", "total_deductions",
            "net_salary", "pdf_path", "raw_row_data", "edit_count", "created_at",
            "updated_at", "batch_month", "batch_year",
            "comp_off_opening_balance", "comp_off_days_used", "comp_off_closing_balance",
            "leave_opening_balance", "leave_accrued", "leave_used", "leave_closing_balance",
            "salary_advance_opening_balance", "salary_advance_disbursed", "salary_advance_recovered",
            "salary_advance_closing_balance",
            "on_hold_opening_balance", "on_hold_deducted", "on_hold_released", "on_hold_closing_balance",
        ]

    def get_ctc_annual(self, obj):
        return obj.salary_structure_snapshot.ctc_annual if obj.salary_structure_snapshot_id else None

    def get_pf_applicable(self, obj) -> bool:
        # NOT bool(obj.epf or obj.basic_for_pf) — basic_for_pf is computed
        # unconditionally (min(basic_da, PF_WAGE_CEILING)) regardless of
        # whether the employee opted into PF at all, so it's always
        # truthy whenever basic_da > 0. That made this always show True.
        # The real source of truth is the snapshot's pf_opted flag;
        # epf > 0 is only a fallback for records with no snapshot linked.
        if obj.salary_structure_snapshot_id:
            return bool(obj.salary_structure_snapshot.pf_opted)
        return bool(obj.epf)

    def get_pt_applicable(self, obj) -> bool:
        return bool(obj.professional_tax)

    def get_esi_applicable(self, obj) -> bool:
        if (getattr(obj, "esi", 0) or 0) > 0:
            return True
        snap = getattr(obj, "salary_structure_snapshot", None)
        return bool(getattr(snap, "esi_opted", False)) if snap else False

    def get_is_probation(self, obj) -> bool:
        if not obj.employee_id or not obj.employee.hire_date:
            return False
        return is_in_probation(obj.employee.hire_date, obj.batch.year, obj.batch.month)

    def get_employment_type(self, obj) -> str:
        emp = getattr(obj, "employee", None)
        if emp and getattr(emp, "employment_type", None):
            return str(emp.employment_type)
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and getattr(snap, "employment_type", None):
            return str(snap.employment_type)
        cc = getattr(obj, "custom_components", None)
        if isinstance(cc, dict) and cc.get("employment_type"):
            return str(cc.get("employment_type"))
        return "REGULAR"

    def get_is_intern(self, obj) -> bool:
        emp = getattr(obj, "employee", None)
        if emp and getattr(emp, "is_intern", None):
            return bool(emp.is_intern)
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and getattr(snap, "is_intern", None):
            return bool(snap.is_intern)
        cc = getattr(obj, "custom_components", None)
        if isinstance(cc, dict):
            if cc.get("is_intern"):
                return True
            if cc.get("employment_type") == "INTERN":
                return True
        return False

    def get_contracted_basic_da(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return float(snap.original_basic_da) if (snap and getattr(snap, "original_basic_da", None) is not None) else 0.0

    def get_contracted_hra(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return float(snap.original_hra) if (snap and getattr(snap, "original_hra", None) is not None) else 0.0

    def get_contracted_lta(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return float(snap.original_lta) if (snap and getattr(snap, "original_lta", None) is not None) else 0.0

    def get_contracted_special_allowance(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return float(snap.original_special_allowance) if (snap and getattr(snap, "original_special_allowance", None) is not None) else 0.0

    def get_contracted_fbp(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return float(snap.fbp) if (snap and getattr(snap, "fbp", None) is not None) else 0.0

    def get_fbp(self, obj):
        cc = getattr(obj, "custom_components", None)
        if isinstance(cc, dict) and isinstance(cc.get("earnings"), list):
            for item in cc["earnings"]:
                if isinstance(item, dict) and str(item.get("code", "")).strip().upper() == "FBP":
                    try:
                        amt = item.get("amount") if item.get("amount") is not None else item.get("total_amount", 0.0)
                        return float(amt or 0.0)
                    except Exception:
                        pass
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and getattr(snap, "fbp", None) is not None and float(snap.fbp) > 0:
            try:
                base = float(snap.fbp)
                total_days = float(getattr(obj, "days_in_month", None) or getattr(obj, "total_working_days", None) or 30)
                paid_days = float(getattr(obj, "actual_working_days", None) or getattr(obj, "payment_days", None) or 0)
                if total_days > 0 and paid_days > 0:
                    return round((base * paid_days) / total_days, 2)
            except Exception:
                pass
        return 0.0

    def get_contracted_monthly_gross(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and getattr(snap, "monthly_gross", None) is not None:
            return float(snap.monthly_gross)
        return float(obj.gross_salary) if (obj and getattr(obj, "gross_salary", None) is not None) else 0.0

    def get_monthly_ctc(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and getattr(snap, "ctc_annual", None) is not None:
            try:
                return round(float(snap.ctc_annual) / 12.0, 2)
            except Exception:
                pass
        return 0.0

    def get_employer_pf_in_ctc(self, obj) -> bool:
        snap = getattr(obj, "salary_structure_snapshot", None)
        return bool(getattr(snap, "employer_pf_in_ctc", True)) if snap else True

    def get_employer_pf_carveout(self, obj) -> float:
        snap = getattr(obj, "salary_structure_snapshot", None)
        if not snap or not getattr(snap, "employer_pf_in_ctc", True):
            return 0.0
        try:
            return float(snap.employer_pf or 0.0)
        except Exception:
            return 0.0

    def get_employer_esi_in_ctc(self, obj) -> bool:
        snap = getattr(obj, "salary_structure_snapshot", None)
        return bool(getattr(snap, "employer_esi_in_ctc", False)) if snap else False

    def get_employer_esi_carveout(self, obj) -> float:
        snap = getattr(obj, "salary_structure_snapshot", None)
        if not snap or not getattr(snap, "employer_esi_in_ctc", False):
            return 0.0
        try:
            return float(snap.employer_esi or 0.0)
        except Exception:
            return 0.0

    def get_gratuity_in_ctc(self, obj) -> bool:
        snap = getattr(obj, "salary_structure_snapshot", None)
        return bool(getattr(snap, "gratuity_in_ctc", False)) if snap else False

    def get_gratuity_carveout(self, obj) -> float:
        snap = getattr(obj, "salary_structure_snapshot", None)
        if not snap or not getattr(snap, "gratuity_in_ctc", False):
            return 0.0
        try:
            return float(snap.gratuity or 0.0)
        except Exception:
            return 0.0

    def get_carve_out_fbp_in_ctc(self, obj) -> bool:
        snap = getattr(obj, "salary_structure_snapshot", None)
        if snap and hasattr(snap, "carve_out_fbp_in_ctc"):
            return bool(snap.carve_out_fbp_in_ctc)
        client = getattr(getattr(obj, "batch", None), "client", None)
        prof = getattr(client, "payroll_profile", None)
        if prof and hasattr(prof, "carve_out_fbp_in_ctc"):
            return bool(prof.carve_out_fbp_in_ctc)
        return False

    def get_fbp_carveout(self, obj) -> float:
        snap = getattr(obj, "salary_structure_snapshot", None)
        carve = self.get_carve_out_fbp_in_ctc(obj)
        if not carve:
            return 0.0
        try:
            return float(snap.fbp or 0.0) if snap else 0.0
        except Exception:
            return 0.0

    def get_custom_carveouts_total(self, obj) -> float:
        snap = getattr(obj, "salary_structure_snapshot", None)
        if not snap or not isinstance(snap.custom_components, dict):
            return 0.0
        total = 0.0
        for comp in snap.custom_components.values():
            if isinstance(comp, dict) and comp.get("carve_out_from_ctc"):
                try:
                    c_amt = float(comp.get("amount", 0) or 0)
                    c_freq = str(comp.get("payout_frequency", "MONTHLY")).upper()
                    if c_freq == "ANNUAL":
                        total += c_amt / 12.0
                    elif c_freq == "QUARTERLY":
                        total += c_amt / 3.0
                    else:
                        total += c_amt
                except Exception:
                    pass
        return round(total, 2)

    def get_total_carveouts(self, obj) -> float:
        return round(
            self.get_employer_pf_carveout(obj)
            + self.get_employer_esi_carveout(obj)
            + self.get_gratuity_carveout(obj)
            + self.get_fbp_carveout(obj)
            + self.get_custom_carveouts_total(obj),
            2
        )

    def get_edit_count(self, obj) -> int:
        return obj.edits.count()

    def get_payment_mode_display(self, obj) -> str:
        emp = getattr(obj, "employee", None)
        return emp.effective_payment_mode_display if emp else "Wire Transfer"

    def get_bank_account_masked(self, obj) -> str:
        emp = getattr(obj, "employee", None)
        acc = getattr(emp, "bank_account_number", "") if emp else ""
        if not acc:
            return ""
        return f"••••{acc[-4:]}" if len(acc) > 4 else acc

    def get_employer_pf(self, obj):
        snap = getattr(obj, "salary_structure_snapshot", None)
        return str(snap.employer_pf) if snap and getattr(snap, "employer_pf", None) else "0.00"

    def get_employer_esi(self, obj):
        return str(getattr(obj, "employer_esi", "0.00") or "0.00")

    def get_show_payment_mode_in_payslip(self, obj) -> bool:
        client = getattr(obj.batch, "client", None) if getattr(obj, "batch", None) else None
        profile = getattr(client, "payroll_profile", None) if client else None
        return getattr(profile, "show_payment_mode_in_payslip", True) if profile else True

    def get_show_employer_contribution_in_payslip(self, obj) -> bool:
        client = getattr(obj.batch, "client", None) if getattr(obj, "batch", None) else None
        profile = getattr(client, "payroll_profile", None) if client else None
        return getattr(profile, "show_employer_contribution_in_payslip", True) if profile else True

    def get_show_uan_in_payslip(self, obj):
        client = getattr(obj.batch, "client", None) if getattr(obj, "batch", None) else None
        profile = getattr(client, "payroll_profile", None) if client else None
        return getattr(profile, "show_uan_in_payslip", True) if profile else True

    def get_cycle_period_display(self, obj):
        batch = getattr(obj, "batch", None)
        if not batch:
            return None
        client = getattr(batch, "client", None)
        profile = getattr(client, "payroll_profile", None) if client else None
        if not profile:
            return None
        start = getattr(profile, "cycle_start_day", 1) or 1
        end = getattr(profile, "cycle_end_day", 0) or 0
        if start == 1 and end == 0:
            return None
        import datetime
        import calendar
        y, m = batch.year, batch.month
        prev_y, prev_m = (y - 1, 12) if m == 1 else (y, m - 1)
        max_prev = calendar.monthrange(prev_y, prev_m)[1]
        clamped_start = min(start, max_prev)
        max_curr = calendar.monthrange(y, m)[1]
        clamped_end = max_curr if end == 0 else min(end, max_curr)
        try:
            d1 = datetime.date(prev_y, prev_m, clamped_start)
            d2 = datetime.date(y, m, clamped_end)
            return f"{d1.strftime('%d %b %Y')} – {d2.strftime('%d %b %Y')}"
        except Exception:
            return None

    def validate(self, attrs):
        for field_name, value in attrs.items():
            if field_name in PAYSLIP_EDITABLE_FIELDS and value < Decimal("0"):
                raise serializers.ValidationError({field_name: "Value must be greater than or equal to 0."})
        return attrs

    def update(self, instance, validated_data):
        esi_val = validated_data.pop("esi", None)
        instance = super().update(instance, validated_data)
        if esi_val is not None:
            instance.esi = esi_val
            instance.save()
        return instance


class PayslipRecordEditSerializer(serializers.ModelSerializer):
    edited_by_display = serializers.SerializerMethodField()

    class Meta:
        model = PayslipRecordEdit
        fields = [
            "id", "payslip_record", "edited_by", "edited_by_display",
            "field_name", "old_value", "new_value", "created_at",
        ]
        read_only_fields = fields

    def get_edited_by_display(self, obj):
        if not obj.edited_by:
            return None
        return getattr(obj.edited_by, "full_name", "") or obj.edited_by.get_username()


class EmailLogSerializer(serializers.ModelSerializer):
    sent_by_display = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="payslip_record.employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="payslip_record.employee.full_name", read_only=True)
    client_name = serializers.CharField(source="payslip_record.batch.client.name", read_only=True)
    batch_month = serializers.IntegerField(source="payslip_record.batch.month", read_only=True)
    batch_year = serializers.IntegerField(source="payslip_record.batch.year", read_only=True)

    class Meta:
        model = EmailLog
        fields = [
            "id", "payslip_record", "sent_by", "sent_by_display", "recipient_email",
            "cc_email", "subject", "success", "error_message", "attempt_number",
            "sent_at", "employee_code", "employee_name", "client_name", "batch_month",
            "batch_year",
        ]
        read_only_fields = fields

    def get_sent_by_display(self, obj):
        if not obj.sent_by:
            return None
        return getattr(obj.sent_by, "full_name", "") or obj.sent_by.get_username()

# ── Ledger adjustments (Comp-Off / Leave) ─────────────────────────────────
# CompOffAdjustmentSerializer / LeaveAdjustmentSerializer (with
# created_by_name) are defined earlier in this file, alongside the other
# ledger adjustment serializers — see SalaryAdvanceAdjustmentSerializer /
# OnHoldAdjustmentSerializer above.

# ── Client profile ─────────────────────────────────────────────────────────

class ClientSerializer(serializers.ModelSerializer):
    """
    Payroll "client" as the frontend knows it — a flat object that merges
    the master identity (clients.Client) with the payroll-only extension
    (ClientProfile). The JSON shape is unchanged (name/email/phone/pan/tan/
    gstin/address/logo/pdf_design/is_active), so the existing payroll
    frontend keeps working without modification.

    IMPORTANT: the serializer's model is the MASTER client (that's also
    what ClientViewSet.queryset returns), so identity fields map 1:1 onto
    clients.Client while the payroll-only fields read/write through the
    related ClientProfile via dotted ``payroll_profile.*`` sources. `id`
    is therefore the master client id — the same id Employee.client and
    PayrollBatch.client now reference.
    """

    # ── Identity (master clients.Client) — direct model fields ──
    name = serializers.CharField(max_length=255, required=True)
    email = serializers.EmailField(required=False, allow_null=True, allow_blank=True)
    phone = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")
    address = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")
    pan = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")
    tan = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")
    gstin = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")

    # ── Logo: the client's own logo (clients.Client.logo) — the same one Client Management
    # shows and edits. Uploading it here (Payroll settings) changes it there too.
    logo = serializers.ImageField(required=False, allow_null=True)

    # ── Payroll-only (ClientProfile), via the reverse OneToOne ──
    payroll_email = serializers.EmailField(source="payroll_profile.payroll_email", required=False, allow_null=True, allow_blank=True)
    # default=False so a create that omits is_active enrolls the client as
    # INACTIVE — payroll is switched on explicitly in Firm Details.
    is_active = serializers.BooleanField(source="payroll_profile.payroll_is_active", required=False, default=False)
    pdf_design = serializers.IntegerField(source="payroll_profile.pdf_design", required=False, default=1)
    pf_establishment_code = serializers.CharField(source="payroll_profile.pf_establishment_code", required=False, allow_null=True, allow_blank=True, default="")

    # ── Client Salary Policy & Structuring Defaults ────────────────────
    basic_calculation_type = serializers.CharField(source="payroll_profile.basic_calculation_type", required=False, default="PERCENT_GROSS")
    basic_percentage = serializers.DecimalField(source="payroll_profile.basic_percentage", max_digits=5, decimal_places=2, required=False, default=Decimal("50.00"))
    basic_flat_amount = serializers.DecimalField(source="payroll_profile.basic_flat_amount", max_digits=12, decimal_places=2, required=False, default=Decimal("0.00"))
    hra_calculation_type = serializers.CharField(source="payroll_profile.hra_calculation_type", required=False, default="PERCENT_BASIC")
    hra_percentage = serializers.DecimalField(source="payroll_profile.hra_percentage", max_digits=5, decimal_places=2, required=False, default=Decimal("50.00"))
    hra_flat_amount = serializers.DecimalField(source="payroll_profile.hra_flat_amount", max_digits=12, decimal_places=2, required=False, default=Decimal("0.00"))
    pf_calculation_rule = serializers.CharField(source="payroll_profile.pf_calculation_rule", required=False, default="CAPPED_1800")
    employer_pf_in_ctc = serializers.BooleanField(source="payroll_profile.employer_pf_in_ctc", required=False, default=True)
    default_payment_mode = serializers.CharField(source="payroll_profile.default_payment_mode", required=False, default="WIRE_TRANSFER")
    show_payment_mode_in_payslip = serializers.BooleanField(source="payroll_profile.show_payment_mode_in_payslip", required=False, default=True)
    show_employer_contribution_in_payslip = serializers.BooleanField(source="payroll_profile.show_employer_contribution_in_payslip", required=False, default=True)
    cycle_start_day = serializers.IntegerField(source="payroll_profile.cycle_start_day", required=False, default=1)
    cycle_end_day = serializers.IntegerField(source="payroll_profile.cycle_end_day", required=False, default=0)
    lop_policy = serializers.CharField(source="payroll_profile.lop_policy", required=False, default="ACCRUE_LEAVE_DEBT")
    pt_state = serializers.CharField(source="payroll_profile.pt_state", required=False, default="KARNATAKA")
    pt_amount = serializers.DecimalField(source="payroll_profile.pt_amount", max_digits=10, decimal_places=2, required=False, default=Decimal("0.00"))
    annual_leave_days = serializers.DecimalField(source="payroll_profile.annual_leave_days", max_digits=5, decimal_places=2, required=False, default=Decimal("22.00"))
    probation_months = serializers.IntegerField(source="payroll_profile.probation_months", required=False, default=6)
    track_leave_ledger = serializers.BooleanField(source="payroll_profile.track_leave_ledger", required=False, default=True)
    track_comp_off = serializers.BooleanField(source="payroll_profile.track_comp_off", required=False, default=True)
    esi_enabled = serializers.BooleanField(source="payroll_profile.esi_enabled", required=False, default=False)
    esi_establishment_code = serializers.CharField(source="payroll_profile.esi_establishment_code", required=False, allow_null=True, allow_blank=True, default="")
    employer_esi_in_ctc = serializers.BooleanField(source="payroll_profile.employer_esi_in_ctc", required=False, default=True)
    show_employer_esi_in_payslip = serializers.BooleanField(source="payroll_profile.show_employer_esi_in_payslip", required=False, default=True)
    show_uan_in_payslip = serializers.BooleanField(source="payroll_profile.show_uan_in_payslip", required=False, default=True)
    pf_custom_pct = serializers.DecimalField(source="payroll_profile.pf_custom_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("12.00"))
    pf_custom_base = serializers.CharField(source="payroll_profile.pf_custom_base", required=False, default="BASIC")
    pf_custom_capped = serializers.BooleanField(source="payroll_profile.pf_custom_capped", required=False, default=True)
    pf_wage_ceiling = serializers.DecimalField(source="payroll_profile.pf_wage_ceiling", max_digits=12, decimal_places=2, required=False, default=Decimal("15000.00"))
    pt_custom_pct = serializers.DecimalField(source="payroll_profile.pt_custom_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("0.00"))
    pt_custom_base = serializers.CharField(source="payroll_profile.pt_custom_base", required=False, default="GROSS")
    pt_custom_cap = serializers.DecimalField(source="payroll_profile.pt_custom_cap", max_digits=10, decimal_places=2, required=False, default=Decimal("200.00"))
    carve_out_fbp_in_ctc = serializers.BooleanField(source="payroll_profile.carve_out_fbp_in_ctc", required=False, default=False)
    carve_out_custom_in_ctc = serializers.BooleanField(source="payroll_profile.carve_out_custom_in_ctc", required=False, default=False)
    esi_calculation_rule = serializers.CharField(source="payroll_profile.esi_calculation_rule", required=False, default="STATUTORY_21K")
    esi_wage_ceiling = serializers.DecimalField(source="payroll_profile.esi_wage_ceiling", max_digits=12, decimal_places=2, required=False, default=Decimal("21000.00"))
    esi_employee_pct = serializers.DecimalField(source="payroll_profile.esi_employee_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("0.75"))
    esi_employer_pct = serializers.DecimalField(source="payroll_profile.esi_employer_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("3.25"))
    esi_custom_base = serializers.CharField(source="payroll_profile.esi_custom_base", required=False, default="GROSS")
    esi_period_continuity = serializers.BooleanField(source="payroll_profile.esi_period_continuity", required=False, default=True)
    mid_month_proration_rule = serializers.CharField(source="payroll_profile.mid_month_proration_rule", required=False, default="ACTUAL_CALENDAR_DAYS")
    auto_prorate_mid_month = serializers.BooleanField(source="payroll_profile.auto_prorate_mid_month", required=False, default=True)
    lwf_state = serializers.CharField(source="payroll_profile.lwf_state", required=False, default="EXEMPT_ZERO")
    lwf_employee_amount = serializers.DecimalField(source="payroll_profile.lwf_employee_amount", max_digits=10, decimal_places=2, required=False, default=Decimal("20.00"))
    lwf_employer_amount = serializers.DecimalField(source="payroll_profile.lwf_employer_amount", max_digits=10, decimal_places=2, required=False, default=Decimal("40.00"))
    statutory_bonus_pct = serializers.DecimalField(source="payroll_profile.statutory_bonus_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("0.00"))
    esi_rounding_mode = serializers.CharField(source="payroll_profile.esi_rounding_mode", required=False, default="CEIL_RUPEE")
    net_pay_rounding_mode = serializers.CharField(source="payroll_profile.net_pay_rounding_mode", required=False, default="EXACT_PAISA")
    gratuity_in_ctc = serializers.BooleanField(source="payroll_profile.gratuity_in_ctc", required=False, default=False)
    gratuity_pct = serializers.DecimalField(source="payroll_profile.gratuity_pct", max_digits=5, decimal_places=2, required=False, default=Decimal("4.81"))
    leave_encashment_base = serializers.CharField(source="payroll_profile.leave_encashment_base", required=False, default="BASIC")
    leave_encashment_divisor = serializers.CharField(source="payroll_profile.leave_encashment_divisor", required=False, default="30")
    lta_calculation_type = serializers.CharField(source="payroll_profile.lta_calculation_type", required=False, default="OFF")
    lta_percentage = serializers.DecimalField(source="payroll_profile.lta_percentage", max_digits=5, decimal_places=2, required=False, default=Decimal("0.00"))
    lta_flat_amount = serializers.DecimalField(source="payroll_profile.lta_flat_amount", max_digits=10, decimal_places=2, required=False, default=Decimal("0.00"))

    # ── Effective payroll-active state ──────────────────────────────────
    # `is_active` above is ONLY the payroll toggle (ClientProfile.
    # payroll_is_active). The master `clients.Client.is_active` is a hard
    # kill-switch on top of it (see ClientProfile.is_effectively_active):
    # a client deactivated in the Client module must NOT count as an active
    # payroll client even if payroll was switched on earlier. Both are
    # exposed so the UI can filter on the effective value and still explain
    # *why* a client is inactive.
    master_is_active = serializers.BooleanField(source="is_active", read_only=True)
    is_effectively_active = serializers.SerializerMethodField()
    has_payroll_service = serializers.BooleanField(read_only=True, default=False)
    activation_source = serializers.CharField(read_only=True, default="NONE")

    class Meta:
        model = MasterClient
        fields = [
            "id", "name", "logo", "payroll_email", "address", "email", "phone",
            "pan", "tan", "gstin", "pf_establishment_code", "is_active",
            "master_is_active", "is_effectively_active", "has_payroll_service", "activation_source",
            "pdf_design", "basic_calculation_type", "basic_percentage", "basic_flat_amount",
            "hra_calculation_type", "hra_percentage", "hra_flat_amount",
            "pf_calculation_rule", "employer_pf_in_ctc",
            "default_payment_mode", "show_payment_mode_in_payslip", "show_employer_contribution_in_payslip",
            "cycle_start_day", "cycle_end_day", "lop_policy", "pt_state", "pt_amount", "annual_leave_days", "probation_months",
            "track_leave_ledger", "track_comp_off",
            "esi_enabled", "esi_establishment_code", "employer_esi_in_ctc", "show_employer_esi_in_payslip", "show_uan_in_payslip",
            "esi_calculation_rule", "esi_wage_ceiling", "esi_employee_pct", "esi_employer_pct", "esi_custom_base", "esi_period_continuity",
            "mid_month_proration_rule", "auto_prorate_mid_month",
            "lwf_state", "lwf_employee_amount", "lwf_employer_amount", "statutory_bonus_pct",
            "esi_rounding_mode", "net_pay_rounding_mode", "gratuity_in_ctc", "gratuity_pct", "leave_encashment_base", "leave_encashment_divisor",
            "lta_calculation_type", "lta_percentage", "lta_flat_amount",
            "pf_custom_pct", "pf_custom_base", "pf_custom_capped", "pf_wage_ceiling",
            "pt_custom_pct", "pt_custom_base", "pt_custom_cap",
            "carve_out_fbp_in_ctc", "carve_out_custom_in_ctc",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "master_is_active", "is_effectively_active", "has_payroll_service", "activation_source",
                            "created_at", "updated_at"]

    def get_is_effectively_active(self, obj) -> bool:
        """Master client active AND client has active payroll service in Client Management or manual payroll active."""
        if not obj.is_active:
            return False
        has_service = getattr(obj, "has_payroll_service", None)
        if has_service is None:
            from clients.models import ClientGroupService
            has_service = ClientGroupService.objects.filter(
                client_id=obj.id,
                is_active=True,
                sub_service__job_category__iexact="payroll",
            ).exists()
        profile = getattr(obj, "payroll_profile", None)
        profile_active = bool(profile.payroll_is_active) if profile else None
        if profile_active is True:
            return True
        if profile_active is False and not has_service:
            return False
        return bool(has_service or profile_active)

    @staticmethod
    def _split(validated_data):
        """Split validated_data into {master identity fields} and {profile fields}.

        Payroll fields use dotted ``source="payroll_profile.*"``, so DRF
        nests them under a ``payroll_profile`` key in validated_data;
        identity fields stay flat on the master client.
        """
        identity = {}
        for field in ("name", "email", "phone", "address", "pan", "tan", "gstin"):
            if field in validated_data:
                identity[field] = validated_data[field]
        profile = dict(validated_data.get("payroll_profile") or {})
        return identity, profile

    @staticmethod
    def _save_logo(client, validated_data):
        """Write an uploaded / cleared logo onto the master client (clients.Client.logo)."""
        if "logo" not in validated_data:
            return
        new = validated_data["logo"]
        old_name = client.logo.name if client.logo else ""
        client.logo = new or None
        client.save(update_fields=["logo", "updated_at"])
        if old_name and old_name != (client.logo.name if client.logo else ""):
            try:
                client.logo.storage.delete(old_name)
            except Exception:
                pass

    @staticmethod
    def _norm_email(value):
        return (value or "").strip() or None

    def to_representation(self, instance):
        """Normalise payroll-only fields for clients that have no profile yet
        (a client added in the Client module): the reverse OneToOne raises
        RelatedObjectDoesNotExist, which DRF swallows to None before the
        field defaults run — so fill the sane defaults here instead."""
        data = super().to_representation(instance)
        has_service = getattr(instance, "has_payroll_service", None)
        if has_service is None:
            from clients.models import ClientGroupService
            has_service = ClientGroupService.objects.filter(
                client_id=instance.id,
                is_active=True,
                sub_service__job_category__iexact="payroll",
            ).exists()
        data["has_payroll_service"] = bool(has_service)

        profile = getattr(instance, "payroll_profile", None)
        if profile is not None and profile.payroll_is_active is True:
            # Explicit firm payroll activation takes precedence
            data["is_active"] = True
            data["activation_source"] = "CONTRACT" if has_service else "FIRM_OVERRIDE"
        elif has_service:
            # Active payroll contract in Client Management
            data["is_active"] = True
            data["activation_source"] = "CONTRACT"
        elif profile is None:
            data["is_active"] = False
            data["activation_source"] = "NONE"
        else:
            data["is_active"] = bool(profile.payroll_is_active)
            data["activation_source"] = "NONE"

        data["is_effectively_active"] = bool(instance.is_active and data["is_active"])
        if not data.get("logo") and profile is not None and getattr(profile, "payroll_logo", None):
            # Not moved to the client yet (see `manage.py copy_payroll_logos`) — show the old payroll copy.
            try:
                url = profile.payroll_logo.url
                request = self.context.get("request")
                data["logo"] = request.build_absolute_uri(url) if request else url
            except Exception:
                pass
        if data.get("is_active") is None:
            # No ClientProfile row = never enrolled in payroll, so report it
            # as INACTIVE. (This is what used to make every client in the
            # Client module show up as an active payroll client on a fresh
            # deploy.) Switch it on per client in Firm Details.
            data["is_active"] = False
        if data.get("pdf_design") is None:
            data["pdf_design"] = 1
        if data.get("payroll_email") is None:
            data["payroll_email"] = ""
        if data.get("pf_establishment_code") is None:
            data["pf_establishment_code"] = ""
        if data.get("lop_policy") is None:
            data["lop_policy"] = "ACCRUE_LEAVE_DEBT"
        if data.get("pt_state") is None:
            data["pt_state"] = "KARNATAKA"
        if data.get("pt_amount") is None:
            data["pt_amount"] = "0.00"
        if data.get("annual_leave_days") is None:
            data["annual_leave_days"] = "22.00"
        if data.get("probation_months") is None:
            data["probation_months"] = 6
        if data.get("track_leave_ledger") is None:
            data["track_leave_ledger"] = True
        if data.get("track_comp_off") is None:
            data["track_comp_off"] = True
        if data.get("esi_enabled") is None:
            data["esi_enabled"] = False
        if data.get("esi_establishment_code") is None:
            data["esi_establishment_code"] = ""
        if data.get("employer_esi_in_ctc") is None:
            data["employer_esi_in_ctc"] = True
        if data.get("show_employer_esi_in_payslip") is None:
            data["show_employer_esi_in_payslip"] = True
        if data.get("show_uan_in_payslip") is None:
            data["show_uan_in_payslip"] = True
        if data.get("pf_wage_ceiling") is None:
            data["pf_wage_ceiling"] = "25000.00" if data.get("pf_calculation_rule") == "CAPPED_3000" else "15000.00"
        if data.get("esi_calculation_rule") is None:
            data["esi_calculation_rule"] = "STATUTORY_21K"
        if data.get("esi_wage_ceiling") is None:
            data["esi_wage_ceiling"] = "25000.00" if data.get("esi_calculation_rule") == "STATUTORY_25K" else "21000.00"
        if data.get("esi_employee_pct") is None:
            data["esi_employee_pct"] = "0.75"
        if data.get("esi_employer_pct") is None:
            data["esi_employer_pct"] = "3.25"
        if data.get("esi_custom_base") is None:
            data["esi_custom_base"] = "GROSS"
        if data.get("esi_period_continuity") is None:
            data["esi_period_continuity"] = True
        if data.get("mid_month_proration_rule") is None:
            data["mid_month_proration_rule"] = "ACTUAL_CALENDAR_DAYS"
        if data.get("auto_prorate_mid_month") is None:
            data["auto_prorate_mid_month"] = True
        if data.get("lwf_state") is None:
            data["lwf_state"] = "EXEMPT_ZERO"
        if data.get("lwf_employee_amount") is None:
            data["lwf_employee_amount"] = "20.00"
        if data.get("lwf_employer_amount") is None:
            data["lwf_employer_amount"] = "40.00"
        if data.get("statutory_bonus_pct") is None:
            data["statutory_bonus_pct"] = "0.00"
        if data.get("esi_rounding_mode") is None:
            data["esi_rounding_mode"] = "CEIL_RUPEE"
        if data.get("net_pay_rounding_mode") is None:
            data["net_pay_rounding_mode"] = "EXACT_PAISA"
        if data.get("gratuity_in_ctc") is None:
            data["gratuity_in_ctc"] = False
        if data.get("gratuity_pct") is None:
            data["gratuity_pct"] = "4.81"
        if data.get("leave_encashment_base") is None:
            data["leave_encashment_base"] = "BASIC"
        if data.get("leave_encashment_divisor") is None:
            data["leave_encashment_divisor"] = "30"
        if data.get("lta_calculation_type") is None:
            data["lta_calculation_type"] = "OFF"
        if data.get("lta_percentage") is None:
            data["lta_percentage"] = "0.00"
        if data.get("lta_flat_amount") is None:
            data["lta_flat_amount"] = "0.00"
        return data

    def create(self, validated_data):
        identity, profile = self._split(validated_data)
        name = (identity.get("name") or "").strip()
        # If the master client already exists (e.g. it was added in the
        # Client module), reuse it instead of violating the unique name
        # constraint — just create/update its payroll profile.
        existing = MasterClient.objects.filter(name__iexact=name).first() if name else None
        if existing:
            prof, _ = ClientProfile.objects.get_or_create(
                client=existing,
                defaults={"payroll_is_active": True}
            )
            for field, value in profile.items():
                setattr(prof, field, value)
            prof.save()
            self._save_logo(existing, validated_data)
            return existing
        client = MasterClient.objects.create(
            name=name,
            email=self._norm_email(identity.get("email")),
            phone=(identity.get("phone") or "")[:30],
            address=identity.get("address") or "",
            pan=(identity.get("pan") or "")[:10],
            tan=(identity.get("tan") or "")[:10],
            gstin=(identity.get("gstin") or "")[:15],
        )
        if "payroll_is_active" not in profile:
            profile["payroll_is_active"] = True
        ClientProfile.objects.create(client=client, **profile)
        self._save_logo(client, validated_data)
        # Return the MASTER client so serializer.data can re-serialize it
        # (identity fields are direct attributes on the master model).
        return client

    def update(self, instance, validated_data):
        """Payroll may only edit the payroll-owned ClientProfile fields.

        Client identity (name/email/phone/address/PAN/TAN/GSTIN) belongs to
        the Client module's master `clients.Client` row — payroll inherits
        it read-only (README §7.10). Any identity keys that arrive on an
        update are therefore deliberately ignored rather than written, so
        the payroll UI can never overwrite the Client module's master data.
        """
        _identity_ignored, profile = self._split(validated_data)
        if profile:
            # Lazily create the profile on first payroll-settings save — a
            # client added in the Client module has none yet. Default to active.
            prof, _ = ClientProfile.objects.get_or_create(
                client=instance,
                defaults={"payroll_is_active": True}
            )
            for field, value in profile.items():
                setattr(prof, field, value)
            prof.save()
        self._save_logo(instance, validated_data)
        return instance


class EmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    effective_payment_mode = serializers.CharField(read_only=True)
    effective_payment_mode_display = serializers.CharField(read_only=True)
    esi_number = serializers.CharField(required=False, allow_blank=True, default="")
    uan_number = serializers.CharField(required=False, allow_blank=True, default="")
    employment_type = serializers.CharField(required=False, allow_blank=True, default="REGULAR")
    is_intern = serializers.BooleanField(read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id", "employee_code", "first_name", "last_name", "full_name",
            "email", "pan_number", "esi_number", "uan_number", "department", "position",
            "employment_type", "is_intern", "hire_date",
            "last_working_date", "payment_mode", "effective_payment_mode",
            "effective_payment_mode_display", "bank_name", "bank_account_number",
            "bank_ifsc_code", "ctc", "status", "client", "client_name", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "full_name", "client_name", "effective_payment_mode",
            "effective_payment_mode_display", "is_intern", "created_at", "updated_at"
        ]

    def create(self, validated_data):
        esi_num = validated_data.pop("esi_number", "")
        uan_num = validated_data.pop("uan_number", "")
        emp_type = validated_data.pop("employment_type", "REGULAR")
        instance = super().create(validated_data)
        if esi_num:
            instance.esi_number = esi_num
        if uan_num:
            instance.uan_number = uan_num
        if emp_type:
            struct = instance.salary_structures.first()
            if struct:
                struct.employment_type = emp_type
                struct.save(update_fields=["custom_components"])
        return instance

    def update(self, instance, validated_data):
        if "esi_number" in validated_data:
            instance.esi_number = validated_data.pop("esi_number")
        if "uan_number" in validated_data:
            instance.uan_number = validated_data.pop("uan_number")
        if "employment_type" in validated_data:
            emp_type = validated_data.pop("employment_type")
            struct = instance.salary_structures.first()
            if struct:
                struct.employment_type = emp_type
                struct.save(update_fields=["custom_components"])
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret["employment_type"] = getattr(instance, "employment_type", "REGULAR")
        ret["is_intern"] = getattr(instance, "is_intern", False)
        return ret


# ── Salary structure ───────────────────────────────────────────────────────

class EmployeeSalaryStructureSerializer(serializers.ModelSerializer):
    employer_pf = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    employer_esi = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    esi_opted = serializers.BooleanField(required=False, default=False)
    employer_esi_in_ctc = serializers.BooleanField(required=False, default=True)
    employment_type = serializers.CharField(required=False, default="REGULAR")
    is_intern = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = EmployeeSalaryStructure
        fields = [
            "id", "employee", "effective_from", "ctc_annual", "monthly_gross",
            "original_basic_da", "original_hra", "original_special_allowance",
            "original_lta", "nps_allowance", "fbp", "vpf", "pf_opted", "employer_pf",
            "esi_opted", "employer_esi", "employer_esi_in_ctc",
            "pf_calculation_rule", "employer_pf_in_ctc", "custom_components",
            "employment_type", "is_intern",
            "change_reason", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "employer_pf", "employer_esi", "created_by", "created_at", "updated_at"]

    @staticmethod
    def _derive_employer_pf(basic_da, pf_opted, employee=None, pf_rule=None, monthly_gross=None):
        """Derives Employer PF respecting client PF rule (CAPPED_1800, CAPPED_3000,
        UNCAPPED_12_PERCENT, CUSTOM_PERCENT) and configurable pf_wage_ceiling."""
        from decimal import Decimal as D, ROUND_HALF_UP
        if not pf_opted:
            return D("0.00")
        basic = D(str(basic_da or 0))
        gross = D(str(monthly_gross or 0))

        profile = None
        if employee is not None:
            client_obj = getattr(employee, "client", None)
            profile = getattr(client_obj, "payroll_profile", None) if client_obj else None

        rule = pf_rule or (getattr(profile, "pf_calculation_rule", "CAPPED_1800") if profile else "CAPPED_1800")
        if rule == "NOT_OPTED":
            return D("0.00")

        default_ceil = D("25000") if rule == "CAPPED_3000" else D("15000")
        ceiling = D(str(getattr(profile, "pf_wage_ceiling", default_ceil))) if profile else default_ceil
        if rule == "CAPPED_3000" and ceiling == D("15000"):
            ceiling = D("25000")
        if ceiling <= 0:
            ceiling = default_ceil

        if rule == "UNCAPPED_12_PERCENT":
            return (basic * D("0.12")).quantize(D("0.01"), rounding=ROUND_HALF_UP)

        if rule == "CUSTOM_PERCENT":
            pct = D(str(getattr(profile, "pf_custom_pct", "12.00") if profile else "12.00")) / D("100")
            base_mode = str(getattr(profile, "pf_custom_base", "BASIC") if profile else "BASIC").upper()
            capped = bool(getattr(profile, "pf_custom_capped", True) if profile else True)
            base_val = gross if (base_mode == "GROSS" and gross > 0) else basic
            effective_base = min(base_val, ceiling) if capped else base_val
            return (effective_base * pct).quantize(D("0.01"), rounding=ROUND_HALF_UP)

        # Standard statutory capped (CAPPED_1800 / CAPPED_3000 / custom ceiling at 12%)
        return (min(basic, ceiling) * D("0.12")).quantize(D("0.01"), rounding=ROUND_HALF_UP)

    def create(self, validated_data):
        emp_type = validated_data.pop("employment_type", None)
        is_intern_val = validated_data.pop("is_intern", None)
        custom_comps = validated_data.get("custom_components") or {}
        if not isinstance(custom_comps, dict):
            custom_comps = {}
        if emp_type:
            custom_comps["employment_type"] = emp_type
            custom_comps["is_intern"] = (emp_type == "INTERN")
        elif is_intern_val is not None:
            custom_comps["is_intern"] = bool(is_intern_val)
            if is_intern_val:
                custom_comps["employment_type"] = "INTERN"
        validated_data["custom_components"] = custom_comps

        emp = validated_data.get("employee")
        prof = getattr(getattr(emp, "client", None), "payroll_profile", None) if emp else None
        if not validated_data.get("pf_calculation_rule") and prof:
            validated_data["pf_calculation_rule"] = prof.pf_calculation_rule
        if "employer_pf_in_ctc" not in validated_data and prof:
            validated_data["employer_pf_in_ctc"] = prof.employer_pf_in_ctc
        if "employer_esi_in_ctc" not in validated_data and prof:
            validated_data["employer_esi_in_ctc"] = prof.employer_esi_in_ctc
        validated_data["employer_pf"] = self._derive_employer_pf(
            validated_data.get("original_basic_da"),
            validated_data.get("pf_opted", True),
            employee=emp,
            pf_rule=validated_data.get("pf_calculation_rule"),
            monthly_gross=validated_data.get("monthly_gross"),
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        emp_type = validated_data.pop("employment_type", None)
        is_intern_val = validated_data.pop("is_intern", None)
        custom_comps = validated_data.get("custom_components", instance.custom_components) or {}
        if not isinstance(custom_comps, dict):
            custom_comps = {}
        if emp_type:
            custom_comps["employment_type"] = emp_type
            custom_comps["is_intern"] = (emp_type == "INTERN")
        elif is_intern_val is not None:
            custom_comps["is_intern"] = bool(is_intern_val)
            if is_intern_val:
                custom_comps["employment_type"] = "INTERN"
        validated_data["custom_components"] = custom_comps

        if any(k in validated_data for k in ("original_basic_da", "pf_opted", "pf_calculation_rule", "monthly_gross")):
            emp = validated_data.get("employee", instance.employee)
            pf_rule = validated_data.get("pf_calculation_rule", instance.pf_calculation_rule)
            validated_data["employer_pf"] = self._derive_employer_pf(
                validated_data.get("original_basic_da", instance.original_basic_da),
                validated_data.get("pf_opted", instance.pf_opted),
                employee=emp,
                pf_rule=pf_rule,
                monthly_gross=validated_data.get("monthly_gross", instance.monthly_gross),
            )
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret["employment_type"] = getattr(instance, "employment_type", "REGULAR")
        ret["is_intern"] = getattr(instance, "is_intern", False)
        return ret


class EmployeeSalaryStructureAutoCalcSerializer(serializers.Serializer):
    """POST body for the /salary-structures/auto-calc/ helper endpoint."""
    ctc_annual = serializers.DecimalField(max_digits=12, decimal_places=2)
    pf_opted = serializers.BooleanField(default=True)
    esi_opted = serializers.BooleanField(required=False, default=False)
    current_lta = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    nps_allowance = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"), required=False)
    fbp = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"), required=False)
    vpf = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"), required=False)
    policy = serializers.JSONField(required=False, default=dict)
    custom_components = serializers.JSONField(required=False, default=dict)


# ── Employee (read-only, payroll's own view of employee + structure) ──────

class EmployeeWithStructureSerializer(serializers.Serializer):
    """
    Read-only combined view of a payroll.Employee row and their latest
    EmployeeSalaryStructure, for the payroll "Employees" screen. Not a
    ModelSerializer since it spans two models — see
    views.EmployeeSalaryStructureViewSet.list_employees().
    """
    id = serializers.IntegerField()
    employee_code = serializers.CharField(allow_null=True)
    first_name = serializers.CharField(allow_null=True)
    last_name = serializers.CharField(allow_null=True)
    full_name = serializers.CharField()
    email = serializers.EmailField(allow_null=True)
    pan_number = serializers.CharField(allow_null=True)
    esi_number = serializers.CharField(allow_null=True, required=False)
    uan_number = serializers.CharField(allow_null=True, required=False)
    department = serializers.CharField(allow_null=True)
    position = serializers.CharField(allow_null=True)
    employment_type = serializers.CharField(required=False, default="REGULAR")
    is_intern = serializers.BooleanField(required=False, default=False)
    hire_date = serializers.DateField(allow_null=True)
    status = serializers.CharField()
    ctc = serializers.DecimalField(max_digits=10, decimal_places=2)
    client = serializers.IntegerField(allow_null=True)
    client_name = serializers.CharField(read_only=True, required=False, allow_null=True)
    salary_structure = EmployeeSalaryStructureSerializer(allow_null=True)


# ── Payroll Job & Maker-Checker ──────────────────────────────────────────

class PayrollJobEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollJobEvent
        fields = [
            "id", "job", "event_type", "performed_by", "performed_by_name", "notes", "created_at",
        ]


class PayrollJobSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    sub_service_name = serializers.CharField(source="sub_service.name", read_only=True, default="")
    task_id = serializers.CharField(source="stt_task_id", read_only=True)
    makers_list = serializers.SerializerMethodField()
    checkers_list = serializers.SerializerMethodField()
    assigned_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    client_details = serializers.SerializerMethodField()
    events = PayrollJobEventSerializer(many=True, read_only=True)
    batch_details = serializers.SerializerMethodField()
    uploaded_excels = serializers.SerializerMethodField()
    pending_portal_items_count = serializers.SerializerMethodField()
    pending_excel_items_count = serializers.SerializerMethodField()
    pending_monthly_inputs_count = serializers.SerializerMethodField()
    portal_submission_info = serializers.SerializerMethodField()
    approver_status = serializers.SerializerMethodField()
    spoc_name = serializers.SerializerMethodField()

    class Meta:
        model = PayrollJob
        fields = [
            "id", "task", "task_id", "stt_task_id", "client", "client_name", "sub_service",
            "sub_service_name", "period", "month", "year", "due_date",
            "status", "rework_notes", "makers", "checkers", "makers_list", "checkers_list",
            "assigned_by", "assigned_by_name", "assigned_at",
            "submitted_by", "submitted_by_name", "submitted_at",
            "reviewed_by", "reviewed_by_name", "reviewed_at",
            "batch", "batch_details", "uploaded_excels", "pending_portal_items_count",
            "pending_excel_items_count", "pending_monthly_inputs_count", "portal_submission_info", "events",
            "approver_status", "client_details", "spoc_name", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def _user_dict(self, u):
        if not u:
            return None
        emp = getattr(u, "employee", None)
        emp_obj = emp.first() if hasattr(emp, "first") else emp
        name = ""
        if emp_obj:
            name = f"{getattr(emp_obj, 'first_name', '')} {getattr(emp_obj, 'last_name', '')}".strip()
        if not name:
            name = getattr(u, "full_name", "") or u.get_username()
        return {
            "id": u.id,
            "username": u.get_username(),
            "full_name": name,
            "email": u.email,
        }

    def get_makers_list(self, obj):
        return [self._user_dict(u) for u in obj.makers.all()]

    def get_checkers_list(self, obj):
        return [self._user_dict(u) for u in obj.checkers.all()]

    def get_assigned_by_name(self, obj):
        if not obj.assigned_by:
            return None
        return getattr(obj.assigned_by, "full_name", "") or obj.assigned_by.get_username()

    def get_submitted_by_name(self, obj):
        if not obj.submitted_by:
            return None
        return getattr(obj.submitted_by, "full_name", "") or obj.submitted_by.get_username()

    def get_reviewed_by_name(self, obj):
        if not obj.reviewed_by:
            return None
        return getattr(obj.reviewed_by, "full_name", "") or obj.reviewed_by.get_username()

    def get_client_details(self, obj):
        c = obj.client
        if not c:
            return {}

        # Comprehensive 4-tier SPOC resolution hierarchy:
        spoc = None

        # 1. Direct primary ClientSPOC mapping
        spoc_obj = c.spocs.filter(is_primary=True).select_related("spoc").first()
        if spoc_obj and spoc_obj.spoc:
            spoc = spoc_obj.spoc

        # 2. Any direct ClientSPOC mapping
        if not spoc:
            spoc_obj = c.spocs.select_related("spoc").first()
            if spoc_obj and spoc_obj.spoc:
                spoc = spoc_obj.spoc

        # 3. ClientGroup primary or secondary SPOC (CAOAS Client Management hierarchy)
        if not spoc:
            for grp in c.client_groups_membership.select_related("primary_spoc", "secondary_spoc").all():
                if getattr(grp, "is_active", True):
                    spoc = grp.primary_spoc or grp.secondary_spoc
                    if spoc:
                        break

        # 4. Underlying Task SPOC (Direct Tax / STT task workflow)
        if not spoc and getattr(obj, "task_id", None) and getattr(obj.task, "spoc", None):
            spoc = obj.task.spoc

        profile = getattr(c, "payroll_profile", None)
        track_comp_off = getattr(profile, "track_comp_off", True) if profile else True
        track_leave_ledger = getattr(profile, "track_leave_ledger", True) if profile else True

        return {
            "id": c.id,
            "name": c.name,
            "email": c.email or "",
            "phone": c.phone or "",
            "address": c.address or "",
            "contact_person": c.contact_person or "",
            "gstin": c.gstin or "",
            "pan": c.pan or "",
            "spoc_name": spoc.name if spoc else "",
            "spoc_email": spoc.email if spoc else "",
            "spoc_phone": spoc.phone if spoc else "",
            "track_comp_off": track_comp_off,
            "track_leave_ledger": track_leave_ledger,
        }

    def get_spoc_name(self, obj):
        cd = self.get_client_details(obj)
        return cd.get("spoc_name", "")

    def get_batch_details(self, obj):
        b = obj.batch
        if not b and obj.client and obj.month and obj.year:
            b = PayrollBatch.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()
        if not b:
            return None
        records = b.records.all()
        total_gross = sum((r.gross_salary or Decimal(0)) for r in records)
        total_net = sum((r.net_salary or Decimal(0)) for r in records)
        total_epf = sum((r.epf or Decimal(0)) for r in records)
        total_pt = sum((r.professional_tax or Decimal(0)) for r in records)
        source_name = None
        source_url = None
        if b.source_file:
            try:
                source_name = b.source_file.name.split("/")[-1]
                source_url = b.source_file.url
            except Exception:
                source_name = str(b.source_file)
        return {
            "id": b.id,
            "month": b.month,
            "year": b.year,
            "status": b.status,
            "is_frozen": getattr(b, "is_frozen", b.status in [PayrollBatch.STATUS_REVIEWED, PayrollBatch.STATUS_COMPLETED]),
            "total_employees": records.count(),
            "total_gross": float(total_gross),
            "total_net": float(total_net),
            "total_epf": float(total_epf),
            "total_pt": float(total_pt),
            "source_file_name": source_name,
            "source_file_url": source_url,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "email_sent": b.email_sent,
            "email_failed": b.email_failed,
        }

    def get_uploaded_excels(self, obj):
        excels = []
        # Find events logged for EXCEL_UPLOADED or EXCEL_MERGED
        events = obj.events.filter(event_type__in=["EXCEL_UPLOADED", "EXCEL_MERGED"]).order_by("-created_at")
        for ev in events:
            file_name = "Attendance_Excel.xlsx"
            file_path = ""
            records_count = None
            if ev.notes:
                try:
                    data = json.loads(ev.notes)
                    file_name = data.get("file_name", file_name)
                    file_path = data.get("file_path", "")
                    records_count = data.get("records_count") or data.get("updated_count")
                except Exception:
                    file_name = ev.notes
            excels.append({
                "id": ev.id,
                "event_type": ev.event_type,
                "file_name": file_name,
                "file_path": file_path,
                "uploaded_by": ev.performed_by_name or (ev.performed_by.username if ev.performed_by else "Staff"),
                "created_at": ev.created_at.isoformat() if ev.created_at else None,
                "records_count": records_count,
            })

        # Fallback if no events yet but batch has source_file
        b = obj.batch
        if not b and obj.client and obj.month and obj.year:
            b = PayrollBatch.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()

        if not excels and b and b.source_file:
            source_name = "Attendance_Upload.xlsx"
            try:
                source_name = b.source_file.name.split("/")[-1]
            except Exception:
                pass
            excels.append({
                "id": "primary",
                "event_type": "EXCEL_UPLOADED",
                "file_name": source_name,
                "file_path": b.source_file.name if hasattr(b.source_file, "name") else "",
                "uploaded_by": b.uploaded_by.username if b.uploaded_by else "Staff",
                "created_at": b.created_at.isoformat() if b.created_at else None,
                "records_count": b.total_records,
            })

        return excels

    def get_pending_portal_items_count(self, obj):
        try:
            from payroll.models import PortalSubmission, PortalSubmissionItem
            sub = PortalSubmission.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()
            if sub:
                return sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING, created_by__isnull=False).count()
        except Exception:
            pass
        return 0

    def get_pending_excel_items_count(self, obj):
        try:
            from payroll.models import PortalSubmission, PortalSubmissionItem
            sub = PortalSubmission.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()
            if sub:
                return sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING, created_by__isnull=True, payload___source="excel_upload").count()
        except Exception:
            pass
        return 0

    def get_pending_monthly_inputs_count(self, obj):
        try:
            from payroll.models import PortalSubmission, PortalSubmissionItem
            sub = PortalSubmission.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()
            if sub:
                return sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING, created_by__isnull=True).exclude(payload___source="excel_upload").count()
        except Exception:
            pass
        return 0

    def get_portal_submission_info(self, obj):
        try:
            from payroll.models import PortalSubmission, PortalSubmissionItem
            if not obj.client or not obj.month or not obj.year:
                return None
            sub = PortalSubmission.objects.filter(client=obj.client, month=obj.month, year=obj.year).first()
            if not sub:
                return None
            pending_count = sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING).count()
            portal_pending_count = sub.items.filter(status=PortalSubmissionItem.STATUS_PENDING, created_by__isnull=False).count()
            applied_count = sub.items.filter(status=PortalSubmissionItem.STATUS_APPLIED).count()
            is_submitted = (portal_pending_count > 0) or (sub.status == PortalSubmission.STATUS_SUBMITTED and portal_pending_count > 0)
            return {
                "id": sub.id,
                "status": sub.status,
                "pending_count": pending_count,
                "portal_pending_count": portal_pending_count,
                "applied_count": applied_count,
                "is_submitted": is_submitted,
                "has_pending": pending_count > 0,
                "has_portal_pending": portal_pending_count > 0,
                "has_applied": applied_count > 0,
                "notes": sub.notes or "",
                "last_submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
            }
        except Exception:
            return None

    def get_approver_status(self, obj):
        try:
            # During drafting (In Progress, To Do, Rework), approver status is strictly reset for the new round
            if obj.status in [PayrollJob.STATUS_TODO, PayrollJob.STATUS_IN_PROGRESS, PayrollJob.STATUS_REWORK]:
                return None

            latest_sub = obj.events.filter(event_type=PayrollJobEvent.EVENT_SUBMITTED).order_by("-id").first()
            qs = obj.events.filter(
                event_type__in=[
                    PayrollJobEvent.EVENT_SENT_TO_APPROVER,
                    PayrollJobEvent.EVENT_APPROVER_APPROVED,
                    PayrollJobEvent.EVENT_APPROVER_SKIPPED,
                ]
            )
            if latest_sub:
                qs = qs.filter(id__gt=latest_sub.id)

            latest = qs.order_by("-id").first()
            if latest:
                return {
                    "status": latest.event_type,
                    "performed_by": latest.performed_by_name,
                    "notes": latest.notes,
                    "at": latest.created_at.isoformat() if latest.created_at else None,
                }
        except Exception:
            pass
        return None


class AssignMCSerializer(serializers.Serializer):
    maker_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)
    checker_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)

    def validate_maker_ids(self, value):
        if len(value) > 2:
            raise serializers.ValidationError("Maximum 2 makers allowed per job.")
        return value

    def validate_checker_ids(self, value):
        if len(value) > 2:
            raise serializers.ValidationError("Maximum 2 checkers allowed per job.")
        return value


class TransitionStatusSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=[
        "submit_for_review", "approve", "rework", "start_progress",
        "send_to_approver", "approver_approve", "approver_skip", "approver_reject",
    ])
    notes = serializers.CharField(required=False, allow_blank=True, default="")