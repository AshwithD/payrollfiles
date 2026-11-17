"""apps/payroll/apps.py"""

from django.apps import AppConfig


class PayrollConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "payroll"
    label = "payroll"
    verbose_name = "Payroll"

    def ready(self):
        import payroll.signals  # noqa: F401

