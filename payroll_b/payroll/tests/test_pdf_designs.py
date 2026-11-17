"""
payroll/tests/test_pdf_designs.py — Automated verification of all 8 payslip PDF designs.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import SimpleTestCase

from payroll.models import Employee, PayrollBatch, PayslipRecord, EmployeeSalaryStructure
from clients.models import Client
from payroll.pdf_generator import DESIGN_MODULES, DESIGN_BUILDERS, generate_payslip_pdf, resized_logo_bytes


class PDFDesignRenderTests(SimpleTestCase):
    def setUp(self):
        self.today = date.today()
        self.dummy_client = Client(id=999, name="Test Firm Pvt Ltd", address="123 Financial District, Bengaluru")
        self.dummy_client._state.fields_cache["payroll_profile"] = None
        self.dummy_employee = Employee(
            id=888,
            client=self.dummy_client,
            employee_code="TEST001",
            first_name="Jane",
            last_name="Doe",
            email="jane.doe@example.com",
            pan_number="ABCDE1234F",
            department="Taxation",
            position="Senior Consultant",
            hire_date=date(self.today.year, 1, 1),
            ctc=Decimal("1200000.00"),
            status=Employee.STATUS_ACTIVE,
        )
        self.dummy_batch = PayrollBatch(
            id=777,
            client=self.dummy_client,
            month=self.today.month,
            year=self.today.year,
        )
        self.dummy_record = PayslipRecord(
            id=666,
            batch=self.dummy_batch,
            employee=self.dummy_employee,
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
        self.dummy_structure = EmployeeSalaryStructure(
            id=555,
            employee=self.dummy_employee,
            effective_from=date(self.today.year, 1, 1),
            ctc_annual=self.dummy_employee.ctc,
            pf_opted=True,
        )

    def test_all_eight_designs_render_valid_pdf_bytes(self):
        class _FakeQuerySet:
            def order_by(self, *args, **kwargs):
                return self
            def first(inner_self):
                return self.dummy_structure

        with patch.object(EmployeeSalaryStructure.objects, "filter", return_value=_FakeQuerySet()):
            for design_id in range(1, 9):
                adapter = DESIGN_MODULES[design_id]
                pdf_bytes = adapter._build_pdf_bytes(self.dummy_record, encryption=None)
                self.assertIsInstance(pdf_bytes, bytes, f"Design {design_id} must return bytes")
                self.assertGreater(len(pdf_bytes), 1000, f"Design {design_id} output suspiciously small")
                self.assertTrue(pdf_bytes.startswith(b"%PDF"), f"Design {design_id} output missing %PDF header")
