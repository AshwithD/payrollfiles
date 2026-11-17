"""
payroll/portal

The client-facing payroll portal: portal credentials, monthly input
submissions, and the apply-on-approve pipeline. Everything lives inside
the payroll module — portal logins are completely separate from the main
project's users (account.User). All portal database models are unified in
`payroll.models` (Pillar 1).

Layout:
    services.py      apply_submission, apply_item, refresh_batch_after_apply (vectorized)
    serializers.py   auth / data / submissions / admin serializers + month locks
    views.py         auth / data / submissions / admin endpoints + token auth
    urls.py          /api/payroll-portal/* routes
"""

from . import serializers, services, urls, views  # noqa: F401
from .views import IsPortalUser, PortalUserAuthentication  # noqa: F401
auth = views  # Backward compatibility alias
locks = serializers  # Backward compatibility alias for inlined locks.py
from .serializers import locks_for, submission_lock  # noqa: F401
from ..models import (  # noqa: F401
    PortalAdjustment,
    PortalSubmission,
    PortalSubmissionItem,
    PortalUser,
)
