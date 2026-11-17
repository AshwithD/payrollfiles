# 🚇 The Omnipresent Employee & Salary Structuring Pipeline Specification

> **Project:** CAOAS — Practice Management, HRMS & Client Payroll Portal  
> **Target App:** `hrms_backend/payroll/` & `frontend/src/pages/payroll/`  
> **Governing Rules:** `AGENTS.md` (Rules 0, 1, 3, 5, 8, 14, 15, 16, and **Rule 17**)  
> **Audience:** Core Engineers, System Architects, and AI Coding Agents  

---

## 🧭 1. Executive Summary: The Central Metro Hub Principle

In enterprise payroll architecture, **there is no such thing as an isolated salary structure or employee change**.

An employee record or salary figure does not enter the system through a single door. It enters through multiple operational channels (workspaces, Excel workbooks, staff job tickets, client self-service portals). If an engineer or AI modifies a formula or adds a field in one file (e.g. `SalaryStructureModal.jsx`) without updating the corresponding parsers, templates, and staging services, the pipeline suffers **State Desynchronization (Split-Brain Pipeline)**.

```
[ SURFACE 1: Staff Workspace (Add/Edit Modal) ] ──────────┐
[ SURFACE 2: Roster Excel Import (Bulk Onboarding) ] ─────┤
[ SURFACE 3: Job Dashboard (Monthly Inputs Modal) ] ──────┤
[ SURFACE 4: Client Portal (12 Action Buttons) ] ─────────┼──▶ 🚆 THE CENTRAL CORE 🚆 ──▶ 🏁 DOWNSTREAM OUTPUTS 🏁
[ SURFACE 5: Client Portal (Multi-Sheet Excel) ] ─────────┤    (build_from_ctc &           (Register detailed.xlsx,
[ SURFACE 6: Staging Service (apply_item) ] ──────────────┤     calculate_payslip)          Bank NEFT, EPFO ECR,
[ SURFACE 7: Batch Review & Smart Filter ] ───────────────┘                                 Payslip PDFs)
```

### The 1st-Year Engineering Analogy
Think of the system like a **Metro transit network**:
* **The Destination** is the final monthly salary slip, bank NEFT transfer file, and EPFO/ESIC government return.
* **The Engine** is `build_from_ctc()` and `calculate_payslip_fields()`.
* **The Passengers (Data)** board the train from **6 distinct Metro stations**:
  1. *Station 1 (The Ticket Counter):* Staff Workspace Add/Edit Employee Form.
  2. *Station 2 (The Bulk Turnstile):* Staff Roster Excel Template & Ingestion Parser.
  3. *Station 3 (The Staff Dispatcher Desk):* Job Dashboard Monthly Inputs & Staged Drawer.
  4. *Station 4 (The Mobile App):* Client Portal 12 Action Buttons / Manual Forms.
  5. *Station 5 (The Corporate Upload Portal):* Client Portal Multi-Sheet Excel Template & Parser.
  6. *Station 6 (The Policy Terminal):* 2x2 Salary Structuring Policy Grid, Presets, and Re-application with Effective Date Selection.

If you add a new passenger ticket requirement (such as a new allowance, an `employment_type` like Intern, or an statutory exemption) at Station 1, but fail to install the scanner at Stations 2, 3, 4, and 5, **passengers will get stuck, rejected, or enter with missing information**.

---

## 🗺️ 2. The 8 Operational Ingestion Surfaces (File & Function Topology)

Every employee attribute and salary component flows through these 8 concrete code surfaces:

| Surface | Operational Role | File Path | Key Functions & Schema Objects |
| :--- | :--- | :--- | :--- |
| **Surface 1: Staff Master Hub** | Manual client onboarding & structure preview | `frontend/src/pages/payroll/pages/PayrollWorkspace.jsx` | • `EmployeeFormModal` (line ~6365)<br>• `SalaryStructureModal` (line ~7316)<br>• 2x2 Policy Grid (`ClientWorkspace`) |
| **Surface 2: Staff Bulk Roster Import** | Initial bulk onboarding of client workforce | • Generator: `hrms_backend/payroll/views.py`<br>• Parser: `hrms_backend/payroll/excel_parser.py`<br>• UI: `PayrollWorkspace.jsx` | • `PayrollTemplateViewSet.employee_template` (line ~4746)<br>• `parse_employee_master_excel` (line ~212)<br>• `ImportEmployeesModal` (line ~5742) |
| **Surface 3: Staff Monthly Inputs Workbench** | Staff Maker/Checker adjustments on active job | `frontend/src/pages/payroll/pages/PayrollJobDashboard.jsx` | • `PayrollJobUnifiedInputsView` (line ~777)<br>• `DEFAULT_PAYLOAD` (line ~470)<br>• `normalizeInputPayload` (line ~509)<br>• `PayrollJobExcelUploadModal` |
| **Surface 4: Client Portal Monthly Changes** | Client self-service change requests | `frontend/src/pages/payroll/portal/ClientPortal.jsx` | • 12 Action Buttons (`ITEM_TYPES`, `EMOJI_DOCK`)<br>• `ManualItemForm` (Joiner, Revision, LOP, etc.)<br>• `portalApi` client & validation |
| **Surface 5: Canonical Multi-Sheet Excel Engine** | Bulk monthly Excel ingestion for clients & jobs | `hrms_backend/payroll/excel_parser.py` | • `generate_portal_template`<br>• `SHEET_CONFIGS`<br>• `parse_portal_excel` |
| **Surface 6: Staging Application Service** | Translating staged changes into live entities | `hrms_backend/payroll/portal/services.py` | • `_HANDLERS` dictionary (line ~566)<br>• `_apply_new_employee` & `_apply_revision`<br>• `_make_structure` & `apply_item` |
| **Surface 7: Batch Review & Calculation Engine** | Pure math evaluation & visual register review | • `hrms_backend/payroll/calculations.py`<br>• `frontend/src/pages/payroll/pages/PayrollJobBatchReview.jsx` | • `calculate_payslip_fields`<br>• `extractCustomColumns` & `isMetadataCode`<br>• `⚡ Smart Filter Active` zero-suppression |
| **Surface 8: Downstream Financial Artifacts** | Formal outputs for banks, EPFO, and audit | • `hrms_backend/payroll/pdf_generator.py`<br>• `hrms_backend/payroll/excel_parser.py`<br>• `hrms_backend/payroll/views.py` | • ReportLab PDFs (Designs 1–8)<br>• `detailed.xlsx` (canonical register engine)<br>• EPFO ECR, ESIC, PT, Bank NEFT, JV |

---

## 🔄 3. Complete Data Flow Diagram: From Ingestion to Disbursal

```
                                      [ INGESTION PHASE ]
   Staff Workspace            Staff Bulk Roster         Staff Monthly Inputs         Client Portal Web / Excel
  EmployeeFormModal          parse_employee_master     PayrollJobUnifiedInputs       parse_portal_excel / Manual
 (PayrollWorkspace)             (excel_parser)          (PayrollJobDashboard)            (ClientPortal)
        │                             │                         │                             │
        │ Direct                      │ Bulk                    │ Maker                       │ Client
        │ POST/PATCH                  │ Auto-Derive             │ Stage                       │ Stage
        ▼                             ▼                         ▼                             ▼
┌──────────────────┐           ┌──────────────┐         ┌─────────────────────────────────────────────────────┐
│ payroll_employee │           │ Employee &   │         │               payroll_portal_items                  │
│  database row    │           │ SalaryStruct │         │             (PortalSubmissionItem)                  │
└────────┬─────────┘           └──────┬───────┘         └──────────────────────────┬──────────────────────────┘
         │                            │                                            │
         │                            │                                            │ Checker Signs Off
         │                            │                                            ▼
         │                            │                         ┌─────────────────────────────────────┐
         │                            │                         │  hrms_backend/payroll/portal/       │
         │                            │                         │  services.py: apply_submission()    │
         │                            │                         │  - _apply_new_employee()            │
         │                            │                         │  - _apply_revision()                │
         │                            │                         │  - _make_structure()                │
         │                            │                         └──────────────────┬──────────────────┘
         │                            │                                            │
         └────────────────────────────┼────────────────────────────────────────────┘
                                      ▼
                        [ CORE SALARY STRUCTURING ]
                 EmployeeSalaryStructure.build_from_ctc()
                 - Client 2x2 Salary Structuring Policy
                 - Basic / HRA / PF Capped or Uncapped
                 - Carve-Outs: Employer PF, ESI, Gratuity, FBP
                 - Custom Component Catalog JSON
                                      │
                                      ▼
                        [ MONTHLY RUNTIME CALCULATION ]
                     calculations.py: calculate_payslip_fields()
                     - Attendance & LOP Proration Factor
                     - Statutory Taxes: EPF, ESI, VPF, PT, LWF, TDS
                     - Earned Gross Salary & Total Deductions
                     - Net Pay & Balance Tracking
                                      │
                                      ▼
                        [ REGISTER REVIEW & AUDIT ]
                     PayrollJobBatchReview.jsx
                     - Canonical Column Flow (Earned terminates Earnings)
                     - isMetadataCode Guard (blocks CARVE_ and GRATUI leaks)
                     - ⚡ Smart Filter Active (auto-hides zero-sum columns)
                                      │
                                      ▼
                        [ DOWNSTREAM DELIVERY ]
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
  ReportLab PDFs              Bank NEFT Payout            Government Compliance
 (STIPEND / SALARY)          Corporate CSV / XLSX         EPFO ECR / ESIC / PT / JV
```

---

## 📊 4. The Field Mapping Matrix

When auditing or adding a field, verify its exact representation across all 8 surfaces:

| Field Name | Type | Surface 1 (Workspace) | Surface 2 (Roster Import) | Surface 3 (Job Inputs) | Surface 4 (Portal Web) | Surface 5 (Portal Excel) | Surface 6 (Services) | Surface 7 (Review Grid) | Surface 8 (Outputs) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `employee_code` | `str` | `code` input | `Employee Code *` | `employee_code` | `employee_code` | Col A (`Employee Code *`) | Validated unique | Column `#2` | Shown on slips & ECR |
| `employment_type` | `enum` | Dropdown (Reg/Int/Con) | Col D + DataValidation | `employment_type` | Type selector | Tab 1 Col K dropdown | Sets `is_intern` | Row badge (`🎓 Intern`) | Slip Title (`STIPEND`) |
| `annual_ctc` | `Decimal` | `ctc_annual` input | `Annual CTC *` | `ctc_annual` | `ctc_annual` input | Tab 1 Col D & Tab 2 Col C| Passed to `build_from_ctc` | Column `Annual CTC` | Stated CTC block |
| `hire_date` | `date` | Date picker | `Hire Date (YYYY-MM-DD)`| `hire_date` | Date input | Tab 1 Col F | `employee.hire_date` | Proration check | Joining date field |
| `pf_opted` | `bool` | Checkbox | Col P + DataValidation | `pf_opted` | Checkbox (locked if Int) | Col L dropdown (`Yes/No`)| Passed to `build_from_ctc` | Governs `EPF` | EPFO ECR inclusion |
| `esi_opted` | `bool` | Checkbox | Col R + DataValidation | `esi_opted` | Checkbox (locked if Int) | Col N dropdown (`Yes/No`)| Passed to `build_from_ctc` | Governs `ESI` | ESIC return inclusion |
| `uan_number` | `str(12)` | 12-digit input | Col Q (validated length)| `uan_number` | 12-digit input | Tab 1 Col M (12 Digits) | Stored in metadata | Audit validation | EPFO ECR column |
| `payment_mode` | `enum` | Radio (Wire/Cheque/Cash)| Col L + DataValidation | `payment_mode` | Payment selector | Bank Tab dropdown | `employee.payment_mode` | Column grouping | Bank NEFT inclusion |
| `fbp` | `Decimal` | `fbp` input & policy toggle | Dynamic catalog | Staged payload | Staged custom items | Tab 6 Col C | Staged into structure | `fbp` column / drawer | Payslip item & register |
| `lop_days` | `Decimal` | Attendance policy | Monthly sheet Col E | `lop_days` input | LOP action button | Tab 9 (LOP) | Bidirectional balancing | Auto-adjusts worked days | Prorates earned pay |
| `custom_components`| `JSON` | Dynamic Drawer | Appended columns | Staged payload | Staged custom items | Dynamic tabs / cols | Merged into structure | Dynamic columns | Custom item rows |

---

## 🛠️ 5. Developer's Checklist: How to Add a New Field or Salary Component

Follow this strict **8-Vector Recipe** whenever introducing a new employee field, salary allowance, or monthly adjustment:

- [ ] **Step 1: Database Model & Serializers (Surface 1 Base)**
  - Add field to `Employee`, `EmployeeSalaryStructure`, or `SalaryComponent` in `hrms_backend/payroll/models.py`.
  - Whitelist the field in `EmployeeSerializer` or `PayslipRecordSerializer` (`fields` and `read_only_fields` in `serializers.py`).
- [ ] **Step 2: Staff Master UI (Surface 1)**
  - Add the form control to `EmployeeFormModal` or `SalaryStructureModal` in `frontend/src/pages/payroll/pages/PayrollWorkspace.jsx`.
- [ ] **Step 3: Staff Roster Import Template & Parser (Surface 2)**
  - In `hrms_backend/payroll/views.py:PayrollTemplateViewSet.employee_template`: add header definition, sample row value, and in-cell DataValidation dropdown if applicable.
  - In `hrms_backend/payroll/excel_parser.py:parse_employee_master_excel`: add alias to `EMPLOYEE_MASTER_COLUMN_MAPPING` and extract/validate the cell in the row loop.
- [ ] **Step 4: Staff Monthly Inputs Workbench (Surface 3)**
  - In `frontend/src/pages/payroll/pages/PayrollJobDashboard.jsx`: add default key to `DEFAULT_PAYLOAD`, add type coercion to `normalizeInputPayload`, and add field to manual modal.
- [ ] **Step 5: Client Portal Manual Forms (Surface 4)**
  - In `frontend/src/pages/payroll/portal/ClientPortal.jsx`: add input field to `ManualItemForm` with validation rules.
- [ ] **Step 6: Canonical Multi-Sheet Excel Engine (Surface 5)**
  - In `hrms_backend/payroll/excel_parser.py`: add header to `SHEET_CONFIGS`, add sample value, add DataValidation dropdown in `generate_portal_template`, and parse the column in `parse_portal_excel`.
- [ ] **Step 7: Staging Application Service (Surface 6)**
  - In `hrms_backend/payroll/portal/services.py`: update `_apply_new_employee`, `_apply_revision`, or `_make_structure` to unpack the payload field and pass it to model persistence or `build_from_ctc`.
- [ ] **Step 8: Review Grid, Calculations & Downstream Artifacts (Surfaces 7 & 8)**
  - In `hrms_backend/payroll/calculations.py`: incorporate into `calculate_payslip_fields` or add to `METADATA_KEYS` if it is a non-monetary flag.
  - In `PayrollJobBatchReview.jsx`: ensure column renders in correct group with `isMetadataCode` guard and `⚡ Smart Filter Active` compatibility.
  - In `pdf_generator.py` and `excel_parser.py:detailed.xlsx`: verify line item prints on payslips and exports to register workbooks.

---

## 🚫 6. Common Anti-Patterns to Reject in Code Review

1. **The "Single-Modal Trap":**  
   *Anti-pattern:* Adding a new salary allowance input in `SalaryStructureModal.jsx` and stopping there.  
   *Result:* Clients cannot upload it in their monthly portal Excel workbook, and staff cannot import it via bulk roster spreadsheets.
2. **The "Orphaned Payload" Crash:**  
   *Anti-pattern:* Adding a field in `ClientPortal.jsx` manual form without updating `hrms_backend/payroll/portal/services.py:apply_item()`.  
   *Result:* The client types the value into the portal, but when staff clicks "Approve & Apply to Batch", the value is completely dropped from the live employee record!
3. **The "Missing Dropdown" Flaw:**  
   *Anti-pattern:* Allowing open-ended text input in Excel templates for an enumerated field (e.g. typing `"Contract"` instead of `"Consultant"`).  
   *Result:* Parser rejects the row or silently misclassifies the employee. Always attach `openpyxl.worksheet.datavalidation.DataValidation` dropdowns in template generators.
4. **The "Metadata Leak" Glitch:**  
   *Anti-pattern:* Passing an internal calculation carve-out (e.g. `carve_out_custom_in_ctc`) into `custom_components` without adding it to `METADATA_KEYS` and `isMetadataCode`.  
   *Result:* The review grid renders duplicate fake allowance columns like `CARVE_ ✨` and `GRATUI ✨`.

---
*End of Specification Document.*

