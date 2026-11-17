# CAOAS — Payroll Module — Context & Change-Playbook for AI

> **What this file is:** a self-contained "context primer + rules" you can paste to
> another AI (together with the files you want changed) so it works on this codebase
> correctly without you re-explaining everything every time.
>
> **How to use it:** copy this whole file as the opening context, then add your task
> (e.g. *"Fix X in the client portal"*), then attach the specific files. Tell the AI:
> *"Make the change in only these files, follow the rules below, and reply with the
> changed files plus short replacement instructions."*

---

## 0. One-line orientation

This is **CAOAS**, a Django + React HRMS. You are only ever asked to work on the
**Payroll module**. Treat everything else as a black box you must not touch.

> ⚠️ **The repo is a reference copy, not the live deployment.** It mirrors the real
> project's paths, structure, models and page layouts — but the live project is
> "the same but not exactly identical" (extra files, minor drift). So:
> - Always anchor edits to the **file paths below**; describe changes as drop-in
>   file replacements relative to those paths.
> - Never assume hidden differences you can't see; if something you need is missing,
>   say so instead of inventing it.

---

## 1. Hard scope — what you may and may not touch

### ✅ May touch (the payroll module only)

| Area | Path |
|---|---|
| Payroll backend app | `hrms_backend/payroll/**` |
| Payroll frontend pages | `frontend/src/pages/payroll/**` |
| Portal (client-facing) — backend | `hrms_backend/payroll/portal/**` |
| Portal (client-facing) — frontend | `frontend/src/pages/payroll/portal/**` |

### ❌ Never touch (unless the user explicitly asks)

- `hrms_backend/account/**`, `hrms_backend/employee/**`, `hrms_backend/clients/**` (other apps)
- `hrms_backend/hrms_backend/settings.py` (project settings)
- Celery / Redis configuration (`celery.py`, broker/result backend) — **it already works in prod; do not change it**
- Project-wide email settings (`settings.EMAIL_*`, `settings.DEFAULT_FROM_EMAIL`)
- `AUTH_USER_MODEL` / the staff login system (`account.User`)
- Anything outside `frontend/src/pages/payroll/**` (the only accepted pre-wired
  exceptions are the already-existing routes: `frontend/src/App.js` mounts
  `/portal/*` → `ClientPortal` and `/payroll/*` → `PayrollRoutes`)

**Rule of thumb:** if a fix feels like it needs a change outside `payroll/**`,
stop and ask — there is almost always a payroll-local way to do it.

---

## 2. Stack & environment

| Thing | Value |
|---|---|
| Backend | Django **5.1.14** (5.0.6 crashes on `clients.models.TaskTimeEntry` — use 5.1.x), Python 3.13, Django REST Framework, `django_filters` |
| DB | MySQL in prod (`hrms_db`); **`mysqlclient` is not installed in the sandbox** → use temporary SQLite settings for migrations/tests (see §8) |
| Auth (staff) | `account.User` (custom, `AUTH_USER_MODEL`), DRF Token auth |
| Auth (portal client) | `payroll.models.PortalUser` — **separate**, portal tokens never touch staff auth |
| Frontend | React + react-router-dom, axios; staff payroll UI uses self-contained scoped tokens (`.payroll-scope`) in `PayrollRoutes.jsx` without Ant Design; Client Portal is styled with native **Tailwind CSS v3** |
| API base | `/api` → prod `https://api.ckpsca.in/api`, local `http://localhost:8000/api` |

---

## 3. Backend layout — where everything lives

```
hrms_backend/payroll/
├── models.py                  # Unified Model Headquarters: Employee, PayrollBatch, PayslipRecord,
│                              #   EmployeeSalaryStructure, SalaryComponent, ledgers, AuditableMixin,
│                              #   & all Portal models (PortalUser, PortalSubmission, etc.) + bulk_update fields
├── views.py                   # Lean ViewSets + generate-from-portal + _build_record_for_employee() + IsAdminOrManagerRole
├── serializers.py             # Universal payroll serializers & REQUIRED_KEYS validation mapping
├── urls.py                    # /api/payroll/... router (see endpoint table)
├── calculations.py            # 100% pure math engine: 5-stage calculate_payslip_fields(), 4-tier water bucket build_from_ctc()
├── excel_parser.py            # Canonical Excel engine: master roster import + multi-sheet portal templates/parser + 16 statutory/bank/JV reports
├── tasks.py                   # Celery bulk payslip email worker & consolidated email dispatcher (.env)
├── pdf_generator.py          # Consolidated payslip PDFs (designs 1–8)
├── fonts/                     # TrueType fonts (DejaVuSans, DejaVuSans-Bold)
├── portal/                    # ★ client portal (dedicated sub-app adapters, registered under 'payroll')
│   ├── services.py            # apply_item(), apply_submission(), refresh_batch_after_apply() (vectorized bulk_update)
│   ├── serializers.py         # consolidated portal serializers (auth, admin, data, submissions) + month locks (locks_for, submission_lock)
│   ├── urls.py                # /api/payroll-portal/...
│   └── views.py               # consolidated views + portal token auth (PortalUserAuthentication, IsPortalUser)
└── migrations/                # 0001 … 0014+ (sequential payroll migrations)
```

**All portal models are unified directly in `payroll/models.py`** (each `Meta` retains
`app_label = "payroll"` and a `payroll_portal_*` `db_table`). There is no separate `portal/models.py`.
New models follow the same unified pattern in `payroll/models.py`.

### API surface (memorise these prefixes)

| Prefix | Who | Auth |
|---|---|---|
| `/api/payroll/...` | staff UI | staff token |
| `/api/payroll-portal/...` | client portal | portal token |

Key staff endpoints (router in `payroll/urls.py`):
`batches`, `records`, `email-logs`, `template`, `comp-off-adjustments`,
`leave-adjustments`, `on-hold-adjustments`, `salary-advance-adjustments`,
`salary-advances`, `clients`, `employees`, `salary-structures`,
`portal-users`, `portal-submissions`.

Key portal endpoints (`payroll/portal/urls.py`):
`login/`, `logout/`, `me/`, `change-password/`, `employees/`, `salary-structures/`,
`advances/`, `submissions/` (GET/POST), `submissions/<id>/submit/`,
`submissions/<id>/notes/`, `submissions/<id>/items/`, `submissions/<id>/items/<item_pk>/`,
`submissions/<id>/bulk-delete/`.

Staff-side portal actions (on `portal-submissions`):
`<id>/items/` (GET), `<id>/add-item/` (POST), `<id>/approve/` (POST),
`<id>/reject/` (POST).

---

## 4. Frontend layout — where everything lives

The payroll frontend is deliberately consolidated into 5 cohesive, self-contained files (no fragmented multi-file sprawl, zero circular import hazards, and fast compile times):

```
frontend/src/pages/payroll/
├── PayrollRoutes.jsx          # Master staff sub-router (/payroll/*) + scoped theme tokens & primitives
├── pages/
│   ├── PayrollJobDashboard.jsx # Job list, status filters, checklists, upload modals & assignment drawers
│   ├── PayrollJobBatchReview.jsx # Batch review workbench, register grid, cell edit drawers & workflow modals
│   └── PayrollWorkspace.jsx    # Client Master Hub, 2x2 Salary Policy grid, employee rosters, ledgers, & design picker
└── portal/
    └── ClientPortal.jsx       # Complete Client Portal (Token auth, animated SVG emblem, monthly inputs & API client)
```

---

## 5. Domain model — the concepts you must know cold

> 💡 **Detailed Calculation Guide:** For a comprehensive, non-technical breakdown of every salary formula, attendance proration rule, and deduction with real-world walkthroughs, see [PAYROLL_CALCULATIONS_GUIDE.md](file:///c:/Users/ashwi/Desktop/Replica_caoas_Backup/PAYROLL_CALCULATIONS_GUIDE.md).
> 🚇 **Omnipresent Pipeline Spec:** For the complete 8-surface matrix governing how employee fields, salary structures, Excel templates, and portal inputs interconnect, see [SALARY_AND_EMPLOYEE_PIPELINE_SPEC.md](file:///c:/Users/ashwi/Desktop/Replica_caoas_Backup/SALARY_AND_EMPLOYEE_PIPELINE_SPEC.md).

### 5.1 Payroll side (staff)

- **`Employee`** — payroll's own employee record (`payroll_employees`), deliberately
  self-contained (no FK to other apps' employees). Unique per `(client, employee_code)`.
  `status` ∈ `active` / `inactive`.
- **`EmployeeSalaryStructure`** — versioned by `effective_from`. Built from CTC via
  `build_from_ctc(ctc_annual, pf_opted)` which derives Basic+DA / HRA / Special
  Allowance / LTA / Monthly Gross. Carries `employer_pf` (informational) and `pf_opted`.
  `get_latest_salary_structure(employee, as_of)` resolves the effective version.
- **`PayrollBatch`** — one client's payroll for one month. Unique `(client, month, year)`.
  Statuses: `UPLOADED → REVIEWED → SENDING → COMPLETED` (+ `FAILED`).
- **`PayslipRecord`** — one employee's payslip inside a batch. Unique `(batch, employee)`.
  `save()` **recomputes** `earned_salary`, `total_deductions`, `net_salary`,
  `salary_advance_closing_balance`, `on_hold_closing_balance` — so you never hand-total
  these; you set component fields and re-save.
- **Ledgers** — `CompOffAdjustment`, `LeaveAdjustment`, `SalaryAdvance` +
  `SalaryAdvanceAdjustment`, `OnHoldAdjustment`. All are "pending until the next batch
  generation", which folds them into the record and sets `applied_in_record`.
- **`calculate_payslip_fields(structure, row, month, days_in_month, …)`** — the single
  source of truth for salary math. Pure function, no DB access. `row` = attendance +
  upload extras (`actual_working_days`, `lop_days`, `paid_leave_days`, `extra_working_days`,
  `lta`, `special_allowance`, `nps_allowance_earned`, `commission_other`, `arrears`).
  Probation employees: every LOP/paid-leave day is a real deduction. Non-probation employees follow client lop_policy: ACCRUE_LEAVE_DEBT (unconditionally paid, balances track debt) or REDUCE_SALARY (commercial model: salary directly reduced by uncovered LOP).
  Multi-state Professional Tax in calculations.py supports 6 state statutory regimes (Karnataka 2025 Act, Telangana/AP, Maharashtra, Gujarat, Exempt, Custom Fixed). Bespoke client allowances & deductions are dynamically defined and calculated per client.

### 5.2 Portal side (client ↔ staff)

- **`PortalUser`** — the client's login (owned by payroll, never staff auth).
- **`PortalSubmission`** — one client's monthly input. Unique `(client, month, year)`.
  Statuses: `DRAFT / SUBMITTED / APPROVED / REJECTED`. **It reopens to DRAFT after
  every approval** (multiple rounds per month).
- **`PortalSubmissionItem`** — one staged change with a JSON `payload`.
  Statuses: `PENDING / APPLIED / SKIPPED / FAILED`.
  Types: `NEW_EMPLOYEE`, `REVISION`, `EXIT`, `SALARY_HOLD`, `ADVANCE`,
  `REIMBURSEMENT`, `LOP`, `ARREARS`, `TDS`, `ONE_TIME_EARNING`, `ONE_TIME_DEDUCTION`, `NOTE` (legacy).
- **`PortalSubmissionEvent`** — the month's **round history** (`SUBMITTED / APPROVED /
  REJECTED`). Exists because the submission row's `status` can't hold past rounds.
- **`PortalAdjustment`** — a materialized one-time earning/deduction for an employee,
  month, year; folded into a payslip record and marked `applied_in_record`.
- **`PortalHold`** — a salary hold + its scheduled release month; releasing creates the
  negative `OnHoldAdjustment` in that month's batch.

### 5.3 The apply pipeline (`portal/services.py`)

`apply_submission(submission, approved_by)` applies every **non-APPLIED** item via
`apply_item()` (each inside its own savepoint), then:
1. sets `approved_by/approved_at`, clears `rejection_reason`;
2. reopens the submission to `DRAFT`;
3. records an `APPROVED` `PortalSubmissionEvent`;
4. calls **`refresh_batch_after_apply()`** — if the month's `PayrollBatch` already
   exists, the just-applied changes are folded straight into its payslip records
   (earnings/deductions → `commission_other`/`other_deduction`; hold/release →
   `on_hold_*`; advances → `salary_advance_*`; revisions → re-derive pay; new joiners →
   new record). This is what keeps **2nd-round changes from disappearing**.

Item handlers map:
`NEW_EMPLOYEE → Employee + structure`, `REVISION → new structure version`,
`EXIT → Employee.status=inactive`, `SALARY_HOLD → OnHoldAdjustment + PortalHold`,
`ADVANCE → SalaryAdvance plan + disbursement`, `ONE_TIME_* → PortalAdjustment`,
`NOTE → no-op`.

### 5.5 Employment Type Classifications & Intern/Consultant Invariants

The platform enforces three distinct employment models across both staff dashboards and the client portal:

| Employment Type | Code | Compensation Model | Statutory EPF | Statutory ESI | Professional Tax & TDS | Payslip Document Header |
|---|---|---|---|---|---|---|
| **Regular Staff** | `REGULAR` | Monthly Gross / CTC Structure | ✅ 12% (capped/uncapped) | ✅ 0.75% (if Gross ≤ ₹21k) | ✅ State PT + Sec 192 TDS | `PAYSLIP` |
| **Intern / Apprentice** | `INTERN` | Monthly Learning Stipend | ❌ **100% Exempt** (Sec 2(f) EPF Act) | ❌ **100% Exempt** | Optional PT / No PF-ESI | `STIPEND SLIP` (`🎓 Intern`) |
| **Consultant / Retainer** | `CONSULTANT` | Professional Fees | ❌ Exempt | ❌ Exempt | Sec 194J TDS (10%/2%) | `FEE STATEMENT` (`🤝 Consultant`) |

- **Intern PF/ESI Exemption:** Selecting `INTERN` in manual drawers (`ManualItemForm`) automatically unchecks and disables `pf_opted` and `esi_opted`. In calculation engines, `is_intern = True` forces zero EPF and zero employee/employer ESI liability.
- **Contracted Salary Breakdown on `PayslipRecord`:** Whitelisted in `PayslipRecordSerializer`:
  `contracted_monthly_gross`, `contracted_basic_da`, `contracted_hra`, `contracted_lta`, `contracted_special_allowance`, and `is_intern`.
- **`PayrollBatch.created_by` Property Alias:** `PayrollBatch` models track uploads via `uploaded_by`. A zero-migration `@property def created_by(self): return self.uploaded_by` ensures backward-compatibility with generic audit and export callers.
- **3-Tier Sign-Off in Detailed Excel Register (`detailed.xlsx`):** Below total columns, the register prints 3 formal signature blocks:
  1. `PREPARED BY (MAKER)`: Assigned makers, batch uploader, or job creator.
  2. `CHECKED BY (CHECKER)`: Assigned checkers or reviewer.
  3. `APPROVED BY (PARTNER / CLIENT)`: Stamped with the exact Admin or Founder username who authorized finalization (queried from `PayrollJobEvent.EVENT_APPROVER_APPROVED` or `EVENT_APPROVED`).

### 5.6 The Complete End-to-End Monthly Adjustment Lifecycle (Option 1 Sequence)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. CLIENT PORTAL / EXCEL UPLOAD                                                        │
│    • Client downloads multi-sheet template with DataValidation dropdowns               │
│    • Adds New Joiners (Regular / Intern / Consultant) via Manual Drawer                │
│    • Enters Overtime, LOP, Bonus, Arrears, or Hold items                               │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. STAGED ADJUSTMENTS LEDGER (`PortalSubmissionItem`)                                  │
│    • Items staged as PENDING                                                           │
│    • Badges rendered: 🎓 Intern, 🤝 Consultant, ✨ New Joiner, 🚪 Exit                 │
│    • Client reviews and clicks "Submit to CA Team" ➔ Status: SUBMITTED                 │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. STAFF WORKBENCH & QUALITY AUDIT (`PayrollJobBatchReview.jsx`)                       │
│    • Assigned Maker generates or refreshes PayrollBatch                                │
│    • calculate_payslip_fields() computes earned salary, prorated LOP, PF, ESI, PT, LWF │
│    • Maker fine-tunes inline cell adjustments & submits batch for Review               │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. CHECKER AUDIT & LEADERSHIP SIGN-OFF (`PayrollJobEvent`)                             │
│    • Checker audits financial variance via 7-Stage MoM Waterfall & balanced JV        │
│    • Admin / Founder authorizes finalization (Logged as EVENT_APPROVER_APPROVED)       │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 5. DOWNSTREAM ARTIFACTS & DISBURSAL                                                    │
│    • Detailed Excel Export (`detailed.xlsx`): Stamped with Maker, Checker & Approver   │
│    • Encrypted PDF Payslips / Stipend Slips dispatched via Celery background tasks     │
│    • Bank NEFT Disbursal Sheet & Statutory Returns (EPFO ECR, ESIC, PT) exported       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.7 The 7-Surface Ingestion Parity Checklist (Rule 16 Reference)

Whenever introducing, modifying, or refactoring any business entity classification, status flag, or attribute, verify all 7 operational surfaces:

| Surface | Target Layer | File Location | Requirement |
|---|---|---|---|
| **1** | Database & Models | `hrms_backend/payroll/models.py` | Model field or `custom_components` JSON property/setter |
| **2** | REST API Serializers | `hrms_backend/payroll/serializers.py` | Registration in `Meta.fields` & `read_only_fields` |
| **3** | Excel Download Template | `hrms_backend/payroll/excel_parser.py` | `openpyxl DataValidation` dropdown list + prompt tooltips |
| **4** | Excel Upload Parser | `hrms_backend/payroll/excel_parser.py` | Header mapping dictionary, normalization aliases & fallbacks |
| **5** | Master Hub Web UI | `frontend/src/pages/payroll/pages/PayrollWorkspace.jsx` | Add/Edit modal form fields, status badges, and table views |
| **6** | Monthly Input Drawers | `ClientPortal.jsx` & `PayrollJobBatchReview.jsx` | `ManualItemForm` inputs & `review-item-edit-grid` controls |
| **7** | Downstream Artifacts | `pdf_generator.py` & `views.py` (`detailed.xlsx`) | Dynamic slip headers (`STIPEND SLIP`) & register columns |

Every client's monthly payroll operates on a structured, foolproof 5-step assembly line:

```
  [Step 1] TO DO                [Step 2] IN PROGRESS           [Step 3] WORKBENCH REVIEW
  • Monthly job generated       • Client submits via Portal    • Auto-calculates Math:
  • Period (e.g. Nov 2026)      • Or staff uploads Excel         - PF, ESI, PT, LWF, TDS
  • Maker & Checker assigned    • Staged adjustments table     • Maker reviews grid
             │                             │                              │
             └──────────────┬──────────────┘                              │
                            ▼                                             ▼
                    [Step 5] DONE                                 [Step 4] UNDER REVIEW
                    • Bank NEFT sheet exported                    • Checker inspects batch
                    • Password-protected PDFs sent                • If issue found: ➔ [REWORK]
                    • Job closed for the month                    • If perfect:     ➔ [APPROVED]
```

1. **Step 1: The Job Ticket (`To Do`):** At the start of the monthly cycle, a `PayrollJob` is initialized with assigned **Makers** (staff who prepare data) and **Checkers** (managers/CAs who verify), linked to statutory deadlines.
2. **Step 2: Collect & Stage Monthly Inputs (`In Progress` / `Client Docs Pending`):** Monthly attendance, overtime, incentives, or LOP are ingested either self-service via the **Client Portal** or uploaded via Excel into the **Staged Adjustments Table**.
3. **Step 3: Auto-Calculation & Workbench Review (`Maker Processing`):** Clicking *"Generate Payroll"* runs `calculate_payslip_fields()` across all active employees, combining salary structures, client statutory rules (PF, ESI, PT, December LWF, Statutory Bonus), and attendance. The Maker reviews and fine-tunes on the interactive spreadsheet workbench.
4. **Step 4: Quality Check & Sign-Off (`Under Review` ➔ `Approved` / `Rework`):** The Maker submits the batch. The Checker reviews financial variance and statutory liabilities. If corrections are needed, the Checker sends it to `Rework` with notes; otherwise, they click `Approve Batch`.
5. **Step 5: Delivery & Closure (`Done`):** Generates 1-click bank NEFT disbursal sheets, encrypts payslip PDFs, dispatches bulk emails via Celery background workers, and closes the job.

---

## 6. Page-by-page context (so the AI knows what each screen is)

- **Client portal → `ClientPortal.jsx`** (`/payroll-portal/*`): the unified client portal component containing token auth, interactive animated SVG emblem, and the monthly payroll change-management dashboard built with native **Tailwind CSS v3**:
  - **Left Action Dock (Collapsible Accordions):** Organized into Headcount (`👤 New Employee`, `📕 Exit / Resign`), Salary Changes (`📈 Salary Revision`, `⏱️ Salary Arrears`, `⏸️ Hold Salary`), and Claims & Deductions (`💳 Reimbursement`, `📅 Loss of Pay`, `➕ Extra Payout`, `➖ One-time Deduction`, `💰 Advance / Loan`, `🧾 TDS`), plus a dedicated **Note for CA Team** card.
  - **Horizontal Workflow Stepper Bar:** Visualizes the 5-stage progression (`Draft → Submitted → Review → Approved → Payslips`) with a `Round N` badge and a quick-access button to the **Slide-Over Activity History Drawer**.
  - **Interactive 4-KPI Filter Cards:** `Total Changes`, `Pending`, `Applied`, and `Excluded`. Clicking any card acts as a 1-click filter for the ledger table below, displaying tactile colored outline rings and active badges.
  - **Filter & Search Toolbar:** Live search by employee name/code/type, dropdown filters for Type and Status, active filter dismissal chip, and a **By Changes** vs **By Employee** view switcher toggle.
  - **Bulk Action Strip:** Allows selecting multiple staged changes for one-click bulk deletion.
  - **Flat Ledger Table & Grouped by Employee View:** Features employee initials avatars, semantic type badges, round indicators, status pills, expandable specification drawers, and action edit/delete controls.
  - **Floating Submission Action Bar:** Sticky bottom bar prompting client submission with confirmation modal.
- **Staff → `PayrollJobDashboard.jsx`** (`/payroll/jobs`, `/payroll/jobs/:id`):
  - **Batch List & Upload Modals:** Monthly payroll batches table, status breakdown, search/filter bars, Excel upload wizards, and checklist assignments.
  - **Portal Submissions Review:** Monthly client submissions approval modal with item-by-item actions, staff direct input, and direct batch progression.
  - **Live Draft Document Access:** All 11 generated batch documents (master register, bank schedule, EPFO ECR, ESIC return, PT statement, JV, MoM variance, payslip zip bundle, email logs) are 100% unlocked for download during Review and Processing stages with warm amber `Draft` badges, switching to finalized regulatory pills upon batch completion (`Done`).
- **Staff → `PayrollJobBatchReview.jsx`** (`/payroll/jobs/:id/review` & Review Tab):
  - **Batch Review Payslip Table:** Detail payslip register with inline cell drawers, lock/edit-history features, and dynamic client allowance columns cleanly terminated by `Earned Salary` (redundant gross removed) and statutory taxes grouped first (`EPF`, `ESI`, `VPF`, `PT`, `LWF`, `TDS`).
  - **`⚡ Smart Filter Active` Zero-Sum Suppression:** Non-statutory allowance and deduction columns where all batch employees have ₹0.00 are automatically hidden to prevent horizontal scrolling fatigue, with a 1-click toggle to expand the full 35+ column audit view.
  - **MoM Variance Reconciliation & Statutory Returns:** One-click MoM waterfall modal, balanced Journal Voucher (JV) generator, and EPFO / ESIC / PT return exports.
- **Staff → `PayrollWorkspace.jsx`** (`/payroll/workspace`, `/payroll/workspace/:clientId`, `/payroll/employees`):
  - **Per-Client Payroll Hub:** Client profile overview, active batches, configuration, and natural full-page scrolling via `sticky={false}` on `PayrollWorkspaceShell`.
  - **Employees & Salary Structures:** Master employee list, versioned CTC/salary structures, and ledger balances (comp-off, leave, advance, hold).
  - **Administration & Logs:** Portal user credentials management, payslip email logs, and firm settings.
- **Staff Sub-Router → `PayrollRoutes.jsx`** (`/payroll/*`):
  - Sub-router mounting all staff payroll routes, shared navigation bar, and scoped theme tokens (`.payroll-scope`).

---

## 7. Business rules — non-negotiables (keep these intact)

1. **Portal** lives at `/payroll-portal/*` (existing domain, no new subdomain).
2. **Multiple rounds per month.** Approval reopens the month to DRAFT; the client can
   add more and resubmit. **APPLIED items are never re-applied** in later rounds.
3. **Staff can add input themselves and Proceed without Excel** (portal batch generation).
4. **Single notes channel:** "Notes for payroll team" (`submission.notes` + legacy
   `NOTE` items) is the only notes UI. `NOTE` is no longer in the client's add menu,
   but old NOTE items must still render. Notes must be **visible to staff**.
5. **Exit vs Hold are separate items:** resignation → EXIT (inactive); hold →
   SALARY_HOLD with a specific **amount + release month**. A hold reduces the current
   month's net pay and parks the balance as an **On-Hold payable** (not a plain
   deduction); it auto-releases in the chosen month's batch.
6. **Loan = salary advance** (one recurring-deduction model): `ADVANCE` → plan +
   disbursement; EMIs auto-recovered monthly.
7. **Employer PF** (total ₹3,600): ₹1,800 **employee** PF is a real monthly deduction;
   ₹1,800 **employer** PF is reserved *once* at CTC-structuring time (carved from
   Special Allowance via `build_from_ctc`), **not** a monthly deduction. On the payslip
   it is a small informational note above Net Salary. Always **computed**
   (`min(12% × Basic, ₹1,800)`), **never hardcoded**.
8. **Email** for payroll comes **only** from `hrms_backend/payroll/.env`
   (`PAYROLL_EMAIL_HOST/PORT/USE_TLS/HOST_USER/HOST_PASSWORD/FROM`). Never
   `settings.EMAIL_*` or `settings.DEFAULT_FROM_EMAIL`.
9. **No Celery/Redis changes** — it already works in prod.
10. **Client model:** master `clients.Client` + OneToOne `ClientProfile`;
    payroll-owned fields are prefixed `payroll_`; the payroll-active toggle is a
    profile boolean. Portal API JSON is flat.
11. **Portal credentials** are owned by `payroll` (`PortalUser`), never the main auth.
12. **Structure rule:** keep proper file structure — don't stuff everything in one file
    (models → `payroll/models.py`, logic → `portal/services.py`, validation →
    `payroll/serializers.py`, views split client/staff, serializers split).

---

## 8. How to make a change (the required workflow)

### Backend

1. Edit only inside `hrms_backend/payroll/**`.
2. If you added/renamed fields or models → write the migration yourself
   (or generate with temp SQLite settings, see below).
3. **Test with a throwaway SQLite DB + smoke script, then delete both.** Concretely:

```bash
# create hrms_backend/hrms_backend/settings_sqlite.py (from settings import *; swap
#   DATABASES to sqlite3 at /tmp/ev_check.sqlite3; CELERY eager; locmem email)
cd hrms_backend
rm -f /tmp/ev_check.sqlite3
python manage.py migrate employee 0037 --settings=hrms_backend.settings_sqlite
python manage.py migrate employee 0038 --fake --settings=hrms_backend.settings_sqlite
python manage.py migrate --settings=hrms_backend.settings_sqlite
python smoke_xxx.py   # your throwaway test — must print PASS/FAIL and exit non-zero on fail
```

- `employee 0038` must be **faked** and **never edited** (see §9).
- Delete `settings_sqlite.py` and the smoke script **before delivering**.

### Frontend

- Edit only inside `frontend/src/pages/payroll/**`.
- **Never run a full `npm run build` in the sandbox** (it OOMs). Verify with esbuild:

```bash
# syntax check (no node_modules needed):
npx --yes esbuild frontend/src/pages/payroll/portal/MonthlyInput.jsx --loader:.jsx=jsx --format=esm --outfile=/tmp/chk.js

# full bundle check (needs node_modules — install then delete):
cd frontend && npm install --no-audit --no-fund
npx --yes esbuild src/pages/payroll/portal/ClientPortal.jsx --bundle --format=esm --jsx=automatic \
  --loader:.css=empty --external:react --external:react-dom --external:react/jsx-runtime --outfile=/tmp/b.js
cd .. && rm -rf frontend/node_modules
```

### Delivery

- Provide **only the files that change**, plus a short `HOW_TO_APPLY.md` with:
  1. what changed and why (one line each),
  2. **replace these files** (path list),
  3. migration command if any (`python manage.py migrate payroll`),
  4. rebuild + restart instruction.
- Package as a zip. Don't leave throwaway test files in the workspace.

---

## 9. Known gotchas / pitfalls (learned the hard way — don't repeat)

1. **`api.get()` resolves to the full axios response**, not the payload. In payroll
   pages use an `unwrapList(d)` helper: `d.data` → array → `{ results }`.
2. **`generate-from-portal` refuses to run if a batch already exists** for that
   client/month/year. Later-round changes must be folded into the existing batch via
   `refresh_batch_after_apply()` — never by deleting/regenerating the batch.
3. **Two `@action` routes can't share a URL path** (`items` GET vs `add-item` POST
   collide → 405). Keep distinct `url_path`s.
4. **`PortalSubmission` has no retrieve endpoint** on the portal side
   (`/api/payroll-portal/submissions/<id>/` 404s). Re-fetch by POSTing the create endpoint.
5. **Actor display names:** `first_name`/`last_name` may be null → join non-null parts
   and fall back to email (avoid "Admin None").
6. **Modal z-index:** the payroll `Modal`/`ConfirmDialog` must sit **above** the app
   header's `zIndex: 1001` (use ≥1100) or forms slide under the sticky header.
7. **`**row, **computed` collision:** `lta`, `special_allowance`,
   `nps_allowance_earned` appear in both `row` and `computed` — `pop()` them out of
   `row` first and store as `*_upload` fields (mirror `_build_record_for_employee`).
8. **`apply_submission` only accepts SUBMITTED/APPROVED**; after approval the month is
   DRAFT again, so a later round must first set it back to SUBMITTED.
9. **Applied items must never be re-applied** — `apply_submission` already excludes
   `STATUS_APPLIED`; keep it that way.
10. **Migrations in sandbox:** `makemigrations` fails against MySQL settings
    (`mysqlclient` missing) — use the temp SQLite settings, then remove them.
11. **Django 5.0.6 breaks on `clients.models.TaskTimeEntry`** — pin 5.1.x.
12. **RapidOCR, not pytesseract**, is what's available for OCR in the sandbox (only
    relevant if you're ever asked to read a screenshot).
13. **History timeline** must render from `current.history` (`PortalSubmissionEvent`),
    never from the submission's current `status` — a DRAFT month may already have
    approved rounds.
14. **Maker-Checker Segregation of Duties:** In the monthly inputs workbench, only assigned
    Makers (`isMaker === true`) can upload Excel workbooks, add manual adjustments, or edit
    inline cells. Non-makers operate in View-Only mode. Only assigned Checkers (`isChecker === true`)
    can approve and apply staged inputs directly into the batch.
15. **Statutory ESI & Metadata Isolation:** `custom_components` holds both custom line items
    and reserved statutory metadata (`esi_opted`, `employer_esi`, `esi_number`, `uan_number`).
    The engine excludes `METADATA_KEYS` and guards against non-dict scalars during calculations.

---

## 10. Naming & style conventions

- Payroll-owned client fields: `payroll_` prefix on `ClientProfile`.
- Portal DB tables: `payroll_portal_*`; core payroll tables keep their existing names
  (`payroll_batches`, `payslip_records`, `payroll_employees`, …).
- Money: `DecimalField(max_digits=12, decimal_places=2)`, default 0; format with
  `Intl.NumberFormat("en-IN")` in the UI.
- Item payload validation lives in `payroll/serializers.py` (`REQUIRED_KEYS`) and is
  shared by serializers (client checks) and the apply pipeline (authoritative checks).
- Backend logic → `services.py`; thin views → `views/`; keep docstrings explaining
  *why*, especially around the multi-round / reopen-to-DRAFT behaviour.

---

## 11. Quick answers to the questions every AI asks

- *Where is the client portal?* `frontend/src/pages/payroll/portal/` + `hrms_backend/payroll/portal/`.
- *Where is the staff side?* `frontend/src/pages/payroll/pages/` + `hrms_backend/payroll/`.
- *Can I add a model?* Yes — inside `payroll/models.py` (the unified model headquarters
  for both main payroll and client portal models, `app_label="payroll"`, `payroll_*` table) + a migration.
- *Can I change how payslips email?* Only via `payroll/tasks` + `payroll/.env`.
- *Can I touch Celery/Redis or settings?* No.
- *How do I test?* Temp SQLite + smoke script (backend); esbuild (frontend). Delete
  throwaways before delivering.
- *What do I deliver?* Changed files + `HOW_TO_APPLY.md`, zipped.

---

*End of context primer. Everything after this point should be the task description
and the files to change.*
