# payroll/tests/tests_calculations.py
"""
Tests for apps.payroll.calculations: is_in_probation() and
calculate_payslip_fields().

calculate_payslip_fields() is a pure function — no DB access, per its own
docstring — so `structure` is stood in here with a plain object rather
than a real EmployeeSalaryStructure, and comp_off/leave opening balances
are passed directly instead of being looked up. This deliberately does
NOT test the caller code that resolves those balances/probation status
from the DB (that lives in views.py / the batch-processing code, not
here) — only the calculation itself.

Run with: python manage.py test apps.payroll
"""

import datetime
from decimal import Decimal

from django.test import SimpleTestCase

from payroll.calculations import (
    calculate_payslip_fields,
    is_in_probation,
    PayrollContext,
    settle_attendance_and_proration,
    compute_contracted_and_dynamic_earnings,
    compute_statutory_deductions,
    compute_internal_adjustments_and_hold,
    settle_net_salary_and_ledgers,
    build_from_ctc,
)


class FakeStructure:
    """Stand-in for EmployeeSalaryStructure — only the attributes
    calculate_payslip_fields() actually reads."""

    def __init__(
        self,
        original_basic_da=Decimal("20000"),
        original_hra=Decimal("10000"),
        original_special_allowance=Decimal("0"),
        original_lta=Decimal("0"),
        nps_allowance=Decimal("0"),
        monthly_gross=Decimal("40000"),
        vpf=Decimal("0"),
        pf_opted=True,
    ):
        self.original_basic_da = original_basic_da
        self.original_hra = original_hra
        self.original_special_allowance = original_special_allowance
        self.original_lta = original_lta
        self.nps_allowance = nps_allowance
        self.monthly_gross = monthly_gross
        self.vpf = vpf
        self.pf_opted = pf_opted


class IsInProbationTests(SimpleTestCase):
    def test_none_date_of_joining_is_not_probation(self):
        self.assertFalse(is_in_probation(None, 2026, 6))

    def test_well_within_probation(self):
        # Joined 1 Jan 2026 — 2 months in, still on probation.
        self.assertTrue(is_in_probation(datetime.date(2026, 1, 1), 2026, 3))

    def test_well_past_probation(self):
        # Joined 1 Jan 2026 — 10 months in, long past 6-month mark.
        self.assertFalse(is_in_probation(datetime.date(2026, 1, 1), 2026, 11))

    def test_probation_ends_exactly_on_boundary_month(self):
        # Joined 1 Jan 2026 -> 6-month mark is 1 Jul 2026. The payroll
        # month whose 1st falls exactly on that date counts as
        # POST-probation (per the "on/before" rule in the docstring).
        self.assertFalse(is_in_probation(datetime.date(2026, 1, 1), 2026, 7))

    def test_month_immediately_before_boundary_is_still_probation(self):
        self.assertTrue(is_in_probation(datetime.date(2026, 1, 1), 2026, 6))

    def test_joining_day_31_rolls_into_shorter_month_correctly(self):
        # Joined 31 Jan 2026 -> +6 months = 31 Jul 2026 (Jul has 31 days,
        # no clamping needed here, but this guards the calendar.monthrange
        # clamp logic doesn't break a normal case).
        self.assertTrue(is_in_probation(datetime.date(2026, 1, 31), 2026, 7))
        self.assertFalse(is_in_probation(datetime.date(2026, 1, 31), 2026, 8))

    def test_joining_day_31_clamps_in_shorter_target_month(self):
        # Joined 31 Aug 2026 -> +6 months lands in February 2027, which
        # only has 28 days — end_day must clamp to 28, not raise.
        self.assertFalse(is_in_probation(datetime.date(2026, 8, 31), 2027, 3))
        self.assertTrue(is_in_probation(datetime.date(2026, 8, 31), 2027, 2))


class CalculatePayslipFieldsTests(SimpleTestCase):
    def _row(self, **overrides):
        base = {
            "actual_working_days": Decimal("30"),
            "lop_days": Decimal("0"),
            "extra_working_days": Decimal("0"),
            "paid_leave_days": Decimal("0"),
        }
        base.update(overrides)
        return base

    def test_full_attendance_no_lop_prorates_to_full_amount(self):
        result = calculate_payslip_fields(
            FakeStructure(), self._row(), month=5, days_in_month=30,
        )
        self.assertEqual(result["basic_da"], Decimal("20000.00"))
        self.assertEqual(result["hra"], Decimal("10000.00"))
        self.assertEqual(result["leave_closing_balance"], Decimal("22") / Decimal("12"))
        self.assertEqual(result["comp_off_closing_balance"], Decimal("0"))

    def test_structure_none_zeroes_derived_fields(self):
        result = calculate_payslip_fields(
            None, self._row(), month=5, days_in_month=30,
        )
        self.assertEqual(result["basic_da"], Decimal("0.00"))
        self.assertEqual(result["hra"], Decimal("0.00"))
        self.assertEqual(result["gross_salary"], Decimal("0"))

    # ---- Probation: every LOP/paid-leave day is a REAL deduction ----

    def test_probation_lop_reduces_effective_present_days(self):
        # 2 LOP days out of a 30-day month, probation -> actual_working_days
        # only (28), no leave/comp-off offset at all.
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(actual_working_days=Decimal("28"), lop_days=Decimal("2")),
            month=5, days_in_month=30, is_probation=True,
        )
        # 28/30 of basic_da 20000 = 18666.666... -> 18666.67
        self.assertEqual(result["basic_da"], Decimal("18666.67"))
        self.assertEqual(result["leave_accrued"], Decimal("0"))
        self.assertEqual(result["comp_off_closing_balance"], Decimal("0"))

    def test_probation_discards_extra_working_days_instead_of_banking(self):
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(extra_working_days=Decimal("3")),
            month=5, days_in_month=30, is_probation=True,
            comp_off_opening_balance=Decimal("1"),
        )
        # Frozen at opening balance — the 3 extra days are NOT banked.
        self.assertEqual(result["comp_off_closing_balance"], Decimal("1"))

    # ---- Non-probation: LOP is unconditionally paid, ledger absorbs it ----

    def test_non_probation_lop_covered_by_leave_balance_no_pay_cut(self):
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(actual_working_days=Decimal("29"), lop_days=Decimal("1")),
            month=5, days_in_month=30,
            leave_opening_balance=Decimal("5"),
        )
        # Full pay despite 1 LOP day — leave balance absorbs it.
        self.assertEqual(result["basic_da"], Decimal("20000.00"))
        self.assertEqual(result["leave_used"], Decimal("1"))
        # 5 opening + 22/12 accrued - 1 used
        expected_closing = Decimal("5") + (Decimal("22") / Decimal("12")) - Decimal("1")
        self.assertEqual(result["leave_closing_balance"], expected_closing)

    def test_lop_exceeding_leave_falls_through_to_comp_off(self):
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(actual_working_days=Decimal("25"), lop_days=Decimal("5")),
            month=5, days_in_month=30,
            leave_opening_balance=Decimal("2"),
            comp_off_opening_balance=Decimal("10"),
        )
        # leave_available = 2 + 22/12 ≈ 3.833; leave_used = min(5, 3.833) = 3.833
        # remaining_after_leave ≈ 1.1667, comp_off covers it fully (10 available)
        self.assertEqual(result["basic_da"], Decimal("20000.00"))  # still fully paid
        self.assertEqual(result["comp_off_days_used"], Decimal("5") - result["leave_used"])
        self.assertEqual(result["comp_off_closing_balance"], Decimal("10") - result["comp_off_days_used"])

    def test_lop_exceeding_both_ledgers_becomes_negative_leave_balance(self):
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(actual_working_days=Decimal("20"), lop_days=Decimal("10")),
            month=5, days_in_month=30,
            leave_opening_balance=Decimal("0"),
            comp_off_opening_balance=Decimal("0"),
        )
        # Almost nothing to draw on — most of the 10 LOP days become debt.
        self.assertLess(result["leave_closing_balance"], Decimal("0"))
        self.assertEqual(result["comp_off_closing_balance"], Decimal("0"))
        # Still fully paid — non-probation LOP is never a real deduction.
        self.assertEqual(result["basic_da"], Decimal("20000.00"))

    def test_automatic_settlement_spare_comp_off_pays_down_leave_debt(self):
        # Prior month already left leave at -3 (carried in via opening
        # balance). This month has ample spare comp-off and no new LOP —
        # settlement should fire and clear/reduce the debt automatically.
        result = calculate_payslip_fields(
            FakeStructure(),
            self._row(actual_working_days=Decimal("30")),
            month=5, days_in_month=30,
            leave_opening_balance=Decimal("-3"),
            comp_off_opening_balance=Decimal("10"),
        )
        # leave_available = -3 + 22/12; used=0 (no LOP/paid leave this month)
        # leave_closing before settlement = leave_available (still negative)
        # settlement = min(comp_off=10, -leave_closing) -> clears it fully
        self.assertGreaterEqual(result["leave_closing_balance"], Decimal("0"))
        self.assertLess(result["comp_off_closing_balance"], Decimal("10"))

    # ---- Professional tax bracket ----

    def test_pt_zero_below_threshold(self):
        result = calculate_payslip_fields(
            FakeStructure(monthly_gross=Decimal("24999")),
            self._row(), month=4, days_in_month=30,
        )
        self.assertEqual(result["professional_tax"], Decimal("0"))

    def test_pt_february_charges_high_rate(self):
        result = calculate_payslip_fields(
            FakeStructure(monthly_gross=Decimal("30000")),
            self._row(), month=2, days_in_month=28,
        )
        self.assertEqual(result["professional_tax"], Decimal("300"))

    def test_pt_other_months_charge_low_rate(self):
        result = calculate_payslip_fields(
            FakeStructure(monthly_gross=Decimal("30000")),
            self._row(), month=4, days_in_month=30,
        )
        self.assertEqual(result["professional_tax"], Decimal("200"))

    def test_pt_uses_contracted_gross_not_lop_reduced_payout(self):
        # Gross is above threshold on paper, even though this month's LOP
        # would reduce actual payout — PT bracket must NOT flip because of
        # LOP (per docstring: contracted/unprorated salary decides).
        result = calculate_payslip_fields(
            FakeStructure(monthly_gross=Decimal("30000")),
            self._row(actual_working_days=Decimal("10"), lop_days=Decimal("20")),
            month=4, days_in_month=30,
            leave_opening_balance=Decimal("0"), comp_off_opening_balance=Decimal("0"),
        )
        self.assertEqual(result["professional_tax"], Decimal("200"))

    # ---- EPF ----

    def test_epf_opted_out_is_zero(self):
        result = calculate_payslip_fields(
            FakeStructure(pf_opted=False), self._row(), month=5, days_in_month=30,
        )
        self.assertEqual(result["epf"], Decimal("0"))

    def test_epf_capped_at_ceiling_rate_even_with_high_basic_da(self):
        result = calculate_payslip_fields(
            FakeStructure(original_basic_da=Decimal("50000"), pf_opted=True),
            self._row(), month=5, days_in_month=30,
        )
        # 12% of 15000 ceiling = 1800, not 12% of 50000 = 6000
        self.assertEqual(result["epf"], Decimal("1800.00"))

    def test_epf_uses_contracted_basic_da_not_prorated(self):
        # Half attendance still charges EPF on the full contracted basic_da
        # (per docstring: "CONTRACTED (unprorated) basic_da").
        result = calculate_payslip_fields(
            FakeStructure(original_basic_da=Decimal("10000"), pf_opted=True),
            self._row(actual_working_days=Decimal("15")),
            month=5, days_in_month=30,
        )
        self.assertEqual(result["epf"], Decimal("1200.00"))  # 12% of 10000, unprorated

    # ---- Special allowance / LTA / NPS: baseline + excel top-up, additive ----

    def test_special_allowance_baseline_and_excel_topup_are_additive(self):
        result = calculate_payslip_fields(
            FakeStructure(original_special_allowance=Decimal("2000")),
            self._row(special_allowance=Decimal("500")),
            month=5, days_in_month=30,
        )
        self.assertEqual(result["special_allowance"], Decimal("2500.00"))

    # ---- Commercial Client Policy: LOP directly reduces salary ----

    def test_commercial_client_lop_policy_reduces_salary_directly(self):
        # 10 LOP days out of 30 days, non-probation, but client policy is REDUCE_SALARY
        # With 0 available leave balance, uncovered LOP is 10 days -> effective present days = 20
        result = calculate_payslip_fields(
            FakeStructure(original_basic_da=Decimal("30000.00"), monthly_gross=Decimal("60000.00")),
            self._row(actual_working_days=Decimal("20"), lop_days=Decimal("10")),
            month=5, days_in_month=30, is_probation=False,
            lop_policy="REDUCE_SALARY",
        )
        # 20/30 of basic_da 30000 = 20000.00
        self.assertEqual(result["basic_da"], Decimal("20000.00"))
        # Leave closing balance does NOT drop negative into debt
        self.assertGreaterEqual(result["leave_closing_balance"], Decimal("0"))


class PipelineStageTests(SimpleTestCase):
    """
    Unit tests for each stage in the 5-Stage Sequential Pipeline:
      Stage 1: settle_attendance_and_proration
      Stage 2: compute_contracted_and_dynamic_earnings
      Stage 3: compute_statutory_deductions
      Stage 4: compute_internal_adjustments_and_hold
      Stage 5: settle_net_salary_and_ledgers
    Plus end-to-end execution with PayrollContext.
    """

    def _row(self, **overrides):
        base = {
            "actual_working_days": Decimal("30"),
            "lop_days": Decimal("0"),
            "extra_working_days": Decimal("0"),
            "paid_leave_days": Decimal("0"),
        }
        base.update(overrides)
        return base

    def test_stage1_attendance_and_proration(self):
        ctx = PayrollContext(
            structure=FakeStructure(),
            row=self._row(actual_working_days=Decimal("15")),
            month=5,
            days_in_month=30,
        )
        ctx = settle_attendance_and_proration(ctx)
        self.assertEqual(ctx.effective_present_days, Decimal("15"))
        self.assertEqual(ctx.proration_ratio, Decimal("15") / Decimal("30"))
        self.assertIn("stage_1_attendance", ctx.audit_trail)

    def test_stage2_earnings(self):
        ctx = PayrollContext(
            structure=FakeStructure(original_basic_da=Decimal("30000"), original_hra=Decimal("15000")),
            row=self._row(),
            month=5,
            days_in_month=30,
        )
        ctx.effective_present_days = Decimal("30")
        ctx.proration_ratio = Decimal("1")
        ctx = compute_contracted_and_dynamic_earnings(ctx)
        self.assertEqual(ctx.basic_da, Decimal("30000.00"))
        self.assertEqual(ctx.hra, Decimal("15000.00"))
        self.assertEqual(ctx.earned_salary, Decimal("45000.00"))
        self.assertIn("stage_2_earnings", ctx.audit_trail)

    def test_stage3_statutory_deductions(self):
        ctx = PayrollContext(
            structure=FakeStructure(original_basic_da=Decimal("30000"), monthly_gross=Decimal("60000"), pf_opted=True),
            row=self._row(),
            month=5,
            days_in_month=30,
        )
        ctx.pf_opted = True
        ctx.basic_da = Decimal("30000.00")
        ctx.original_basic_da = Decimal("30000.00")
        ctx.monthly_gross = Decimal("60000.00")
        ctx = compute_statutory_deductions(ctx)
        # EPF capped at 15000 * 12% = 1800
        self.assertEqual(ctx.epf, Decimal("1800.00"))
        # Karnataka PT for > 25000 in May is 200
        self.assertEqual(ctx.professional_tax, Decimal("200.00"))
        self.assertIn("stage_3_statutory", ctx.audit_trail)

    def test_stage4_adjustments_and_hold(self):
        ctx = PayrollContext(
            structure=FakeStructure(),
            row=self._row(tds=Decimal("2500"), loan_deduction=Decimal("1500"), salary_advance_recovered=Decimal("1000")),
            month=5,
            days_in_month=30,
        )
        ctx = compute_internal_adjustments_and_hold(ctx)
        self.assertEqual(ctx.tds, Decimal("2500.00"))
        self.assertEqual(ctx.loan_deduction, Decimal("1500.00"))
        self.assertEqual(ctx.salary_advance_recovered, Decimal("1000.00"))
        self.assertIn("stage_4_adjustments", ctx.audit_trail)

    def test_stage5_settle_net_salary(self):
        ctx = PayrollContext(
            structure=FakeStructure(),
            row=self._row(),
            month=5,
            days_in_month=30,
        )
        ctx.earned_salary = Decimal("50000.00")
        ctx.epf = Decimal("1800.00")
        ctx.professional_tax = Decimal("200.00")
        ctx.tds = Decimal("3000.00")
        ctx = settle_net_salary_and_ledgers(ctx)
        self.assertEqual(ctx.total_deductions, Decimal("5000.00"))
        self.assertEqual(ctx.net_salary, Decimal("45000.00"))
        self.assertIn("stage_5_settlement", ctx.audit_trail)

    def test_full_pipeline_via_payroll_context(self):
        ctx = PayrollContext(
            structure=FakeStructure(original_basic_da=Decimal("20000"), original_hra=Decimal("10000"), monthly_gross=Decimal("40000")),
            row=self._row(),
            month=5,
            days_in_month=30,
        )
        result = calculate_payslip_fields(ctx)
        self.assertEqual(result["basic_da"], Decimal("20000.00"))
        self.assertEqual(result["hra"], Decimal("10000.00"))
        self.assertEqual(len(ctx.audit_trail), 5)
        self.assertIn("stage_1_attendance", ctx.audit_trail)
        self.assertIn("stage_5_settlement", ctx.audit_trail)


class WaterBucketCTCTests(SimpleTestCase):
    """
    Unit tests for the 4-Tier Water Bucket CTC Structuring Engine (build_from_ctc).
    Validates:
      - Tier 1: Upfront non-cash & FBP carve-outs
      - Tier 2: Simultaneous statutory reserves & base gross derivation
      - Tier 3: Top-down waterfall allocation (Basic -> LTA -> HRA -> Special Allowance)
      - Tier 4: Zero-rupee rounding precision (Option 1.A) & telemetry (Option 1.C)
    """

    def test_standard_ctc_tier_6lpa(self):
        # ₹6,00,000 annual CTC = ₹50,000 monthly pool
        res = build_from_ctc(None, Decimal("600000"), pf_opted=True)
        # Capped EPF ceiling: 12% of 15,000 = 1,800
        self.assertEqual(res["employer_pf"], Decimal("1800.00"))
        # Monthly Gross = 50,000 - 1,800 = 48,200
        self.assertEqual(res["monthly_gross"], Decimal("48200.00"))
        # Basic = 50% of 48,200 = 24,100
        self.assertEqual(res["original_basic_da"], Decimal("24100.00"))
        # HRA = 50% of 24,100 = 12,050
        self.assertEqual(res["original_hra"], Decimal("12050.00"))
        # Special Allowance balances exactly: 48,200 - 24,100 - 12,050 = 12,050
        self.assertEqual(res["original_special_allowance"], Decimal("12050.00"))
        # Shortfall is 0
        self.assertEqual(res["shortfall"], Decimal("0.00"))
        # Option 1.C: Telemetry exists
        self.assertIn("__waterfall_audit__", res["custom_components"])
        audit = res["custom_components"]["__waterfall_audit__"]
        self.assertEqual(audit["tier_2_reserves"]["employer_pf"], 1800.0)
        self.assertEqual(audit["tier_3_monthly_gross"], 48200.0)

    def test_universal_caller_signatures(self):
        # Both build_from_ctc(cls, ctc) and build_from_ctc(ctc) must yield identical values
        res_with_cls = build_from_ctc(None, Decimal("600000"), pf_opted=True)
        res_without_cls = build_from_ctc(Decimal("600000"), pf_opted=True)
        self.assertEqual(res_with_cls["monthly_gross"], res_without_cls["monthly_gross"])
        self.assertEqual(res_with_cls["original_basic_da"], res_without_cls["original_basic_da"])
        self.assertEqual(res_with_cls["original_hra"], res_without_cls["original_hra"])
        self.assertEqual(res_with_cls["original_special_allowance"], res_without_cls["original_special_allowance"])

    def test_low_bracket_ctc_with_esi_2lpa(self):
        # ₹2,40,000 annual CTC = ₹20,000 monthly pool
        # Below ESI wage ceiling (₹21,000) with esi_enabled -> ESI applies
        res = build_from_ctc(
            Decimal("240000"),
            pf_opted=True,
            policy={"esi_enabled": True},
        )
        self.assertTrue(res["esi_opted"])
        self.assertGreater(res["employer_esi"], Decimal("0.00"))
        self.assertGreater(res["employer_pf"], Decimal("0.00"))
        self.assertEqual(res["shortfall"], Decimal("0.00"))
        # Total sum of gross + employer reserves equals monthly pool (Option 1.A zero-rupee rounding precision)
        total_monthly = res["monthly_gross"] + res["employer_pf"] + res["employer_esi"]
        self.assertEqual(total_monthly, Decimal("20000.00"))

    def test_high_bracket_ctc_with_gratuity_and_fbp_carveout(self):
        # ₹18,00,000 annual CTC = ₹1,50,000 monthly pool
        res = build_from_ctc(
            Decimal("1800000"),
            pf_opted=True,
            fbp=Decimal("10000.00"),
            policy={
                "gratuity_in_ctc": True,
                "gratuity_pct": "4.81",
                "carve_out_fbp_in_ctc": True,
            },
        )
        self.assertEqual(res["fbp"], Decimal("10000.00"))
        self.assertTrue(res["gratuity_in_ctc"])
        self.assertGreater(res["gratuity"], Decimal("0.00"))
        self.assertEqual(res["employer_pf"], Decimal("1800.00"))
        self.assertEqual(res["shortfall"], Decimal("0.00"))
        # Zero-rupee precision check: Monthly gross + reserves + FBP == monthly pool
        total_reconciled = res["monthly_gross"] + res["employer_pf"] + res["gratuity"] + res["fbp"]
        self.assertEqual(total_reconciled, Decimal("150000.00"))

