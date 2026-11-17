# 🧩 Configurable Salary Component Schema Specification
## Eliminating Hardcoded Salary Columns & Multi-Client Structuring Engine in CAOAS Payroll

> **Status:** Implemented in Production (`phase_9`) — Multi-Client Structuring Engine, Live 2x2 Policy Grid & Dynamic Custom Components  
> **Target App:** `hrms_backend/payroll/` & `frontend/src/pages/payroll/`  
> **Reference Benchmark:** `payroll_process.md` (Frappe HR v16 Engine) & CA Practice Multi-Client Outsource Needs  
> **Governing Rules:** `AGENTS.md` (Rules 0, 1, 2, 3, 5, 8, 14, 15)  

---

## 🧭 1. Executive Summary & Multi-Client Outsource Domain

### 1.1 Outsource Practice Context: Clients Only, Not CA Firm Staff
M/s C K Partha Sarathy & Co (CKPSCA & Co) is a Chartered Accountancy firm that operates **CAOAS** as a multi-tenant practice management and client payroll service platform.
* **Firm Staff (`hrms_backend/employee/`):** The CA firm's own audit and accounts staff are managed in the protected internal employee module.
* **Client Companies (`hrms_backend/payroll/`):** The entire payroll module is dedicated **exclusively to outsourced client companies** (e.g., INFOSYS, technology startups, manufacturing units, retail firms).
* **The Business Reality:** Every client company has its own distinct compensation philosophy:
  * Company A might structure Basic as 50% of CTC, cap PF at ₹1,800, and include Employer PF inside the CTC package.
  * Company B might use a fixed flat Basic of ₹35,000, calculate HRA at 40% (non-metro), deduct uncapped 12% PF on actual Basic, and treat Employer PF as an additional company cost on top of CTC.
  * Company C might provide custom allowances like "Fuel Subsidy" or "Internet Reimbursement" while opting out of PF entirely for consultants.

### 1.2 The Old Excel vs. Modern Portal Evolution Audit
A critical question in designing the schema is how monthly adjustments flow into the system:

1. **The Legacy Single-Sheet Attendance Excel:**
   * In earlier iterations, payroll staff uploaded a single flat Excel sheet where columns like `Special Allowance`, `LTA`, and `NPS Allowance` were entered directly alongside attendance days.
   * In `hrms_backend/payroll/models.py`, `PayslipRecord` still contains `special_allowance_upload`, `lta_upload`, and `nps_allowance_upload` to hold these raw uploaded values so they wouldn't double-add against baseline contracts during recalculations.
2. **The Modern Multi-Sheet Excel Architecture (`payroll/excel_parser.py`):**
   * The system now utilizes a clean 8-tab workbook: `NEW_EMPLOYEE`, `REVISION`, `EXIT`, `SALARY_HOLD`, `ADVANCE`, `ONE_TIME_EARNING`, `ONE_TIME_DEDUCTION`, `REIMBURSEMENT`, `LOP`, `ARREARS`, `TDS`, `NOTE`.
   * **Key Finding:** In the current client portal workflow, **clients do NOT upload a monthly "Special Allowance" column anymore**.
   * Regular salary components (Basic, HRA, Special Allowance, Fuel, etc.) are established at the contract level on `EmployeeSalaryStructure`.
   * Any monthly variable adjustments flow through `ONE_TIME_EARNING` (Bonus, Performance Incentive) or `ARREARS`, while unpaid absence is recorded through `LOP`.

---

## 🏗️ 2. Architectural Lessons Adopted from Frappe HR (`payroll_process.md`)

From studying the 2,940-line Frappe HR v16 engine reference, we adopt 4 battle-tested architectural pillars:

### 2.1 The "Three-Amount Anatomy" on Every Component Line Item
Instead of creating brittle `*_upload` columns whenever monthly Excel data needs to merge with static contracts, every salary component item maintains three explicit figures:

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│         default_amount          │        additional_amount        │             amount              │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ The contracted full-month rate  │ Monthly variable top-up/bonus   │ The final paid amount for this  │
│ from EmployeeSalaryStructure.   │ entered via Excel/Client Portal.│ specific slip after attendance  │
│ (Unprorated, full cycle).       │ (One-off monthly incentive).    │ and LOP proration.              │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

$$\text{amount} = (\text{default\_amount} \times \text{Proration Factor}) + \text{additional\_amount}$$

*This single abstraction completely eliminates the need for separate `*_upload` columns across all future allowances!*

### 2.3 The `METADATA_KEYS` Reserved Namespace & Non-Dict Scalar Guard
In addition to dynamic user-defined components, `custom_components` on `EmployeeSalaryStructure` and `PayslipRecord` also holds statutory flags and configuration scalars:
- **Canonical Reserved Statutory & Structuring Metadata Keys (`METADATA_KEYS`):**
  - `esi_opted`: Boolean indicating if employee is enrolled in statutory ESI.
  - `employer_esi`: Informational employer ESI contribution (3.25%).
  - `employer_esi_in_ctc`: Boolean toggle indicating whether Employer ESI is carved out of CTC upfront.
  - `esi_number`: 10-digit employee Insurance Person (IP) number.
  - `uan_number`: 12-digit Universal Account Number for EPF.
  - `is_intern`: Boolean indicating if employee is an apprentice/intern receiving a stipend.
  - `employment_type`: String classification (`REGULAR`, `INTERN`, `CONSULTANT`).
  - `carve_out_custom_in_ctc`: Boolean toggle indicating custom allowances carved from CTC pool upfront.
  - `carve_out_fbp_in_ctc`: Boolean toggle indicating Flexible Benefit Plan (FBP) carved from CTC upfront.
  - `gratuity`: Gratuity provision calculation scalar.
  - `gratuity_in_ctc`: Boolean toggle indicating whether 4.81% gratuity accrual is carved from CTC upfront.
  - `employer_pf`: Informational employer PF contribution (₹1,800 or 12%).
  - `employer_pf_in_ctc`: Boolean toggle indicating whether Employer PF is carved out of CTC upfront.
  - `EMPLOYER_PF_CONTRIBUTION`: Legacy uppercase key for employer PF reserve.
  - `pf_opted`: Boolean indicating if employee is opted into EPF.
  - `is_senior_citizen`: Senior citizen tax/pension status flag.
  - `non_eps`: Exemption flag for Employees' Pension Scheme (EPS Account 10).

> ⚠️ **The Blanket Prefix Isolation Invariant (`carve_out_*` & `__*`):**  
> In addition to exact membership in `METADATA_KEYS`, the engine enforces a strict blanket prefix rule:  
> Any key in `custom_components` that begins with `carve_out_` or `__` is unconditionally classified as internal metadata. It is **never** treated as an earning or deduction line item, never evaluated in payslip component loops, and never duplicated into `custom_components['earnings']` or `custom_components['deductions']`.

> ⚠️ **The Intern Statutory Suppression Invariant:**  
> When `is_intern = True` or `employment_type = 'INTERN'`, the calculation engine unconditionally suppresses employee PF/ESI deductions and employer liability accruals, regardless of individual component formulas or CTC structure defaults. Dynamic PDF generators render the slip under the title `"STIPEND SLIP"`.

> ⚠️ **The Scalar Parsing Invariant in `calculate_payslip_fields`:**  
> When iterating over `all_custom_codes` or component items to calculate earnings and deductions, the engine must **strictly exclude** keys in `METADATA_KEYS` and keys matching metadata prefixes (`k.startswith('carve_out_')` or `k.startswith('__')`).  
> Furthermore, it must defensively check that any component definition is a dictionary (`isinstance(sc, dict)`) before calling `.get()`. If a scalar number or string is passed, it must be safely normalized or ignored to prevent `AttributeError: 'str' object has no attribute 'get'`.

### 2.4 The `depends_on_payment_days` Flag & The "No Double Proration" Rule
* **Leaf Component Proration:**  
  If `depends_on_payment_days == True`, the component is reduced proportionally by unpaid leave (LOP). If `False` (e.g. fixed Internet Reimbursement), the employee receives 100% of the allowance regardless of attendance.
* **The Golden Rule of Formulas (§2.3 of `payroll_process.md`):**  
  If component B is calculated as a formula of component A (e.g. $\text{HRA} = \text{BASIC} \times 0.5$), and component A is *already* prorated by payment days, component B **must have `depends_on_payment_days = False`**. Otherwise, you would prorate the salary twice!

### 2.3 The Informational `do_not_include_in_total` Flag
Certain line items must appear on the employee's payslip for CTC transparency, but **must never be added to take-home pay**:
* **Employer PF Contribution (₹1,800 or 12%)**: Informational line on the payslip; paid directly to EPFO, not the employee's bank account.
* **Gratuity Accrual / Group Medical Insurance**: Informational employer cost lines.
Setting `do_not_include_in_total = True` keeps them visible on the PDF payslip while excluding them from `gross_pay`, `total_deductions`, and `net_salary`.

### 2.4 Statistical Components (`statistical_component = True`)
A component used strictly as an intermediate mathematical variable (e.g. `PF_WAGE_POOL` or `TAXABLE_GROSS`). It participates in Python formulas and statutory exports, but is **never printed on the physical payslip** and never added to pay totals.

---

## 📐 3. Flexible Multi-Client Salary Structuring Engine

To support external client companies with varying compensation models, the system replaces hardcoded 50% formulas with a parameterized structuring policy.

```
                   CLIENT CTC POOL (e.g. ₹60,000 / month)
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        BASIC + DA CHOICE        │           │        EMPLOYER PF CHOICE       │
│ • % of CTC / Gross (e.g. 40/50%)│           │ • In CTC: Carved out of pool    │
│ • Custom Fixed ₹ (e.g. ₹25,000) │           │ • On top: Extra employer burden │
└────────────────┬────────────────┘           └────────────────┬────────────────┘
                 │                                             │
                 ▼                                             │
┌─────────────────────────────────┐                            │
│           HRA CHOICE            │                            │
│ • % of Basic (e.g. 50% / 40%)   │                            │
│ • Custom Fixed ₹ (e.g. ₹12,000) │                            │
└────────────────┬────────────────┘                            │
                 │                                             │
                 ▼                                             ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                             SPECIAL ALLOWANCE                                 │
│ Balancing remainder = Gross - Basic - HRA - Custom Allowances - Employer PF   │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Basic Salary Configuration Options
Each client (or employee grade) can choose how Basic is derived:
1. **Percentage of Gross/CTC (`PERCENT_GROSS`):**
   * Configurable percentage (e.g., 40% or 50%).
   * Optional statutory floor: e.g., minimum ₹25,000 once Gross reaches ₹25,000, or statutory minimum wage.
2. **Custom Fixed Amount (`CUSTOM_FIXED`):**
   * An exact rupee figure entered per employee (e.g., fixed ₹30,000/month).
   * Unaffected by changes in total CTC.

### 3.2 House Rent Allowance (HRA) Configuration Options
1. **Percentage of Basic (`PERCENT_BASIC`):**
   * Standard Indian tax optimization: 50% of Basic for Metro cities (Bangalore, Mumbai, Delhi, Chennai, Kolkata); 40% for non-metro locations.
2. **Custom Fixed Amount (`CUSTOM_FIXED`):**
   * An exact flat rupee figure (e.g., fixed ₹15,000/month).

### 3.3 Provident Fund (PF / EPF) Configuration Matrix
The system supports 4 distinct PF operating modes:

| PF Configuration Mode | Employee Deduction (EPF) | Employer PF Reserve | CTC Treatment |
| :--- | :--- | :--- | :--- |
| **1. Statutory Capped (Default)** | $12\%$ of Basic capped at statutory ceiling: $\min(\text{Basic}, 15000) \times 12\% = \mathbf{₹1,800}$ | Flat ₹1,800 | Carved out of Special Allowance pool if included in CTC. |
| **2. Uncapped (Actual Basic)** | Flat $12\%$ of actual unprorated Basic (e.g., $₹40,000 \times 12\% = \mathbf{₹4,800}$) | Matching 12% on actual Basic | Carved out of Special Allowance pool if included in CTC. |
| **3. Employer PF "On Top of CTC"** | 12% (capped or uncapped based on setting) | Paid by company over and above CTC | Stated CTC = Gross Salary. Special Allowance is NOT reduced by Employer PF. |
| **4. PF Not Opted (Exempt)** | **₹0** | **₹0** | 100% of CTC pool remains available for salary allowances. |

### 3.4 Custom Allowances & Balancing Remainder (Special Allowance)
* **Custom Allowances (Fuel, Internet, Driver, Food, LTA):** Configured either as a flat rupee amount or a percentage of Basic.
* **Special Allowance (The Plug Figure):**
  $$\text{Special Allowance} = \text{Monthly Gross} - \text{Basic} - \text{HRA} - \sum \text{Custom Allowances} - (\text{Employer PF if in CTC})$$
  Floored at ₹0 to ensure total earnings match the contracted CTC exactly.

---

## 🗄️ 4. Database Schema Design (The Hybrid Bridge Pattern)

Per **`AGENTS.md` Rule 2 (Data Protection)**, we never edit sequential migrations `0001` through `0014`, and we never drop existing columns. We introduce sequential migration `0015` using the **Hybrid Bridge Pattern**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   payroll_salary_components (New Table)                │
│   - client_id (Nullable FK: null = global, set = client-specific)      │
│   - name, code, abbr, component_type, calculation_type, default_value  │
│   - depends_on_payment_days, do_not_include_in_total, is_taxable       │
│   - is_part_of_pf_wages, is_part_of_esi_wages, is_statutory            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│ payroll_employee_salary_struct  │ │ payslip_records                 │
│ (Existing Table)                │ │ (Existing Table)                │
│  - basic_da, hra (legacy)       │ │  - basic_da, hra (legacy)       │
│  - custom_components (JSONField)│ │  - custom_components (JSONField)│
│  - pf_rule, pf_in_ctc flags     │ │                                 │
└─────────────────────────────────┘ └─────────────────────────────────┘
```

### 4.1 Model: `SalaryComponent` (`hrms_backend/payroll/models.py`)

```python
class SalaryComponent(AuditableMixin, models.Model):
    TYPE_EARNING = "EARNING"
    TYPE_DEDUCTION = "DEDUCTION"
    TYPE_EMPLOYER_CONTRIBUTION = "EMPLOYER_CONTRIBUTION"
    TYPE_CHOICES = [
        (TYPE_EARNING, "Earning"),
        (TYPE_DEDUCTION, "Deduction"),
        (TYPE_EMPLOYER_CONTRIBUTION, "Employer Contribution (Off-Slip)"),
    ]

    CALC_FLAT = "FLAT"                   # Fixed monthly ₹ amount
    CALC_PERCENT_BASIC = "PERCENT_BASIC" # % of Basic+DA
    CALC_PERCENT_GROSS = "PERCENT_GROSS" # % of Monthly Gross
    CALC_FORMULA = "FORMULA"             # Python formula using abbrs (e.g. BASIC * 0.4)
    CALC_CHOICES = [
        (CALC_FLAT, "Flat Monthly Amount"),
        (CALC_PERCENT_BASIC, "Percentage of Basic"),
        (CALC_PERCENT_GROSS, "Percentage of Gross"),
        (CALC_FORMULA, "Formula"),
    ]

    # Multi-tenant client scoping: null = global firm standard; set = client-specific allowance
    client = models.ForeignKey(
        "clients.Client",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="custom_salary_components",
        help_text="Leave blank for global firm-wide components; select client for company-specific allowances."
    )

    name = models.CharField(max_length=100)          # e.g., "Fuel Allowance"
    code = models.CharField(max_length=50)          # e.g., "FUEL_ALLOW"
    abbr = models.CharField(
        max_length=20, 
        help_text="Short uppercase formula variable name, e.g. 'FUEL', 'INTERNET', 'UNIFORM'"
    )
    component_type = models.CharField(max_length=30, choices=TYPE_CHOICES, default=TYPE_EARNING)
    calculation_type = models.CharField(max_length=20, choices=CALC_CHOICES, default=CALC_FLAT)
    formula = models.CharField(max_length=255, blank=True, help_text="e.g., 'BASIC * 0.4'")
    default_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # Behavioral & Statutory Flags (Frappe HR Benchmark)
    depends_on_payment_days = models.BooleanField(
        default=True,
        help_text="If True, pro-rated by (payment_days / total_working_days). If False, paid in full."
    )
    do_not_include_in_total = models.BooleanField(
        default=False,
        help_text="Shown on payslip for CTC transparency, but excluded from Net Pay (e.g. Employer PF ₹1,800)."
    )
    statistical_component = models.BooleanField(
        default=False,
        help_text="Used as intermediate math variable in formulas; never printed on payslip and excluded from totals."
    )
    remove_if_zero_valued = models.BooleanField(
        default=True,
        help_text="If amount is 0, do not print this row on the payslip."
    )
    round_to_nearest_integer = models.BooleanField(
        default=True,
        help_text="Round final evaluated amount to nearest whole rupee."
    )

    # Statutory Compliance Flags
    is_taxable = models.BooleanField(default=True, help_text="Subject to Income Tax TDS")
    is_part_of_pf_wages = models.BooleanField(
        default=False, 
        help_text="Included in EPF wage pool for 12% calculation (up to statutory ₹15,000 ceiling)"
    )
    is_part_of_esi_wages = models.BooleanField(
        default=False, 
        help_text="Included in ESI gross wage pool (statutory ₹21,000 threshold)"
    )
    is_statutory = models.BooleanField(
        default=False,
        help_text="Protected core components (Basic, HRA, EPF, PT) that cannot be deleted."
    )
    display_order = models.PositiveSmallIntegerField(default=10)
    is_active = models.BooleanField(default=True)

    @property
    def carve_out_from_ctc(self) -> bool:
        """
        True if this component is carved out from the CTC pool upfront before calculating Basic/HRA.
        Persisted cleanly in the `formula` field alongside 'VARIABLE' or 'FIXED' (e.g. 'FIXED,CARVE_OUT')
        to avoid DB schema migrations.
        """
        raw = (self.formula or "").strip().upper()
        return "CARVE_OUT" in raw or self.do_not_include_in_total

    class Meta:
        db_table = "payroll_salary_components"
        unique_together = [("client", "code")]
        ordering = ["display_order", "name"]
```

### 4.2 Single Source of Truth: The Carve-Out Architecture
To avoid ambiguous configurations, component-level carve-outs follow a strict architectural hierarchy:
* **Component Catalog Single Source of Truth:** The `carve_out_from_ctc` toggle on the individual `SalaryComponent` record governs whether that allowance is carved from the CTC pool upfront. (The legacy Row 1.5 global toggle in the client salary policy is deprecated).
* **Dual-Sum Structure Validation (`EmployeeFormModal` & Backend):**
  When validating salary structures, custom allowances are partitioned into two mutually exclusive sets:
  1. `insideGrossCustomEarningsSum`: Cash allowances included inside Monthly Gross (e.g. standard allowances).
  2. `carvedCustomEarningsSum`: Carved-out or non-cash allowances deducted directly from CTC (e.g. Food Coupons, Employer provisions).
  $$\text{Monthly Gross} = \text{Basic} + \text{HRA} + \text{Special Allowance} + \text{insideGrossCustomEarningsSum}$$
  This prevents false gross mismatch warnings when an employee has legitimate carved-out benefits.

### 4.3 Zero-Migration Statutory Properties (`ClientProfile`)
Special statutory rules are persisted as system custom components under `client.custom_salary_components`:
* `__LWF_STATE__`: Stores state LWF rule (`EXEMPT_ZERO`, `KARNATAKA_DEC`, `MAHARASHTRA_JUN_DEC`, `CUSTOM_DECEMBER`, `CUSTOM_MONTHLY`).
* `__LWF_EMPLOYEE_AMOUNT__`: Decimal deduction for employee LWF (e.g. ₹20.00 / ₹25.00).
* `__LWF_EMPLOYER_AMOUNT__`: Decimal statutory liability for employer LWF (e.g. ₹40.00 / ₹75.00).
* `__STATUTORY_BONUS_PCT__`: Decimal percentage under the Payment of Bonus Act (0.00% to 20.00%).

### 4.4 Client Structuring Policy (`ClientProfile` Extensions)
Added to `payroll_client_profiles` so each client company has a default structuring template:
* `basic_calculation_type`: `PERCENT_GROSS` vs `CUSTOM_FIXED`.
* `basic_percentage`: Decimal (default: `50.00`).
* `hra_calculation_type`: `PERCENT_BASIC` vs `CUSTOM_FIXED`.
* `hra_percentage`: Decimal (default: `50.00`).
* `pf_calculation_rule`: `CAPPED_1800` vs `UNCAPPED_12_PERCENT` vs `NOT_OPTED`.
* `employer_pf_in_ctc`: Boolean (default: `True` — deducted from CTC upfront to derive true Monthly Gross).

### 4.3 JSON Payloads on Structure & Payslip Records

#### Inside `EmployeeSalaryStructure.custom_components`:
```json
{
  "FUEL_ALLOW": {
    "code": "FUEL_ALLOW",
    "name": "Fuel Allowance",
    "abbr": "FUEL",
    "type": "EARNING",
    "amount": 3000.00,
    "depends_on_payment_days": true
  },
  "INTERNET": {
    "code": "INTERNET",
    "name": "Internet Stipend",
    "abbr": "INET",
    "type": "EARNING",
    "amount": 1500.00,
    "depends_on_payment_days": false
  }
}
```

#### Inside `PayslipRecord.custom_components`:
```json
{
  "earnings": [
    {
      "code": "FUEL_ALLOW",
      "name": "Fuel Allowance",
      "abbr": "FUEL",
      "default_amount": 3000.00,
      "additional_amount": 500.00,
      "amount": 3403.23,
      "depends_on_payment_days": true,
      "do_not_include_in_total": false
    },
    {
      "code": "INTERNET",
      "name": "Internet Stipend",
      "abbr": "INET",
      "default_amount": 1500.00,
      "additional_amount": 0.00,
      "amount": 1500.00,
      "depends_on_payment_days": false,
      "do_not_include_in_total": false
    }
  ],
  "deductions": [
    {
      "code": "UNIFORM_DED",
      "name": "Uniform Deduction",
      "abbr": "UNIFORM",
      "default_amount": 500.00,
      "additional_amount": 0.00,
      "amount": 500.00,
      "depends_on_payment_days": false,
      "do_not_include_in_total": false
    }
  ]
}
```

---

## ⚙️ 5. Deterministic Calculation Pipeline (`calculations.py`)

Adapted directly from Frappe HR (`payroll_process.md:766-810`), our calculation engine follows this exact 8-stage sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 1: Attendance & Payment Days Settlement                          │
│   payment_days = days_in_month - lop_days + leave_used + comp_off_used│
│   proration_factor = payment_days / days_in_month                      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 2: Evaluate Earnings (Base + Dynamic Components)                 │
│   For each earning:                                                    │
│     amount = (default_amount * proration_factor if depends_on_days     │
│               else default_amount) + additional_amount                 │
│   Build evaluation context dictionary: context['FUEL'] = amount        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 3: Gross Pay Derivation                                          │
│   gross_pay = sum(e.amount for e in earnings if not do_not_include)    │
│   context['GROSS'] = gross_pay                                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 4: Evaluate Deductions                                           │
│   Percentage-based or formula deductions evaluate with GROSS in context│
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 5: Balances & Ledger Recoveries                                  │
│   Salary Advance recovery & On-Hold deductions                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 6: Regional Statutory Compliance (India PF, ESI, PT)             │
│   PF_WAGES = Basic + sum(e.amount where is_part_of_pf_wages)           │
│   EPF = calculate_epf(PF_WAGES, rule=structure.pf_rule)                │
│   PT = state_slab_lookup(monthly_gross, month)                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 7: Informational & Employer Contributions                        │
│   Employer PF tagged with do_not_include_in_total = True               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 8: Totals, Rounding & Net Pay                                    │
│   earned_salary = sum(earnings without do_not_include)                 │
│   total_deductions = sum(deductions without do_not_include)            │
│   net_salary = earned_salary - total_deductions                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 6. Dynamic ReportLab PDF Payslip Rendering (`pdf_generator.py`)

In the existing designs, ReportLab tables use static keys. Under the dynamic schema:
1. **Dynamic Line Extraction:**
   ```python
   def get_payslip_display_lines(record):
       earnings_lines = []
       deductions_lines = []
       
       # Standard baseline
       if record.basic_da: earnings_lines.append(("Basic + DA", record.basic_da))
       if record.hra: earnings_lines.append(("House Rent Allowance", record.hra))
       if record.special_allowance: earnings_lines.append(("Special Allowance", record.special_allowance))
       
       # Dynamic custom components from JSON
       for item in record.custom_components.get("earnings", []):
           if item.get("amount") or not item.get("remove_if_zero_valued"):
               earnings_lines.append((item["name"], item["amount"]))
               
       for item in record.custom_components.get("deductions", []):
           if item.get("amount") or not item.get("remove_if_zero_valued"):
               deductions_lines.append((item["name"], item["amount"]))
               
       # Balance rows symmetrically
       max_len = max(len(earnings_lines), len(deductions_lines))
       while len(earnings_lines) < max_len: earnings_lines.append(("", ""))
       while len(deductions_lines) < max_len: deductions_lines.append(("", ""))
       
       return list(zip(earnings_lines, deductions_lines))
   ```
2. **Auto-Expanding Geometry:**  
   The ReportLab table calculates height dynamically: each row adds 16pt to the table. As long as items fit within the page, borders remain crisp and aligned.

---

## 💻 7. Frontend User Interface Specifications

Per **Rule 8 (5-File Max Discipline)**, frontend changes stay consolidated within `PayrollWorkspace.jsx`, `PayrollJobDashboard.jsx`, and `PayrollJobBatchReview.jsx`:

1. **Client Salary Policy & Component Configurator (Inside Client Workspace):**  
   * **Structuring Policy Card:**
     * Basic derivation: Radio toggle for `% of Gross` (with percentage input) vs `Custom Flat ₹`.
     * HRA derivation: Radio toggle for `% of Basic` (40% / 50% presets) vs `Custom Flat ₹`.
     * PF Rule selector: `Statutory Capped (₹1,800)`, `Actual 12% (Uncapped)`, or `Not Opted`.
     * Employer PF checkbox: `Include in CTC (Carve out from Special Allowance)`.
   * **Custom Components Card:**
     * Table of custom allowances with an **"Add Component"** drawer (Name, Code, Abbr, Flat vs %, Taxable, PF Wages).
2. **Employee Salary Structure Modal:**  
   * Renders the computed preview according to the client's policy.
   * Allows overriding policy defaults for specific senior executives or non-standard contracts.
3. **Monthly Batch Payslip Review Table (`PayrollJobBatchReview.jsx`):**  
   * **Dynamic Custom Component Extraction with Strict Metadata Guard:**  
     Columns for custom allowances/deductions are extracted dynamically from all records in the batch via `extractCustomColumns`.  
     To prevent internal calculation provisions (such as Carve-Out reserves or Gratuity provisions) from rendering as fake allowances (`CARVE_ ✨` or `GRATUI ✨`), the extractor enforces `isMetadataCode`:
     ```javascript
     const isMetadataCode = (code) => {
       if (!code) return false;
       const upper = String(code).trim().toUpperCase();
       if (METADATA_CODES.has(upper)) return true;
       if (upper.startsWith('CARVE_') || upper.startsWith('__') || upper.startsWith('GRATUI')) return true;
       return false;
     };
     ```
   * **Streamlined Financial Register Column Flow:**  
     The review grid organizes 35+ columns into a crystal-clear, non-redundant sequence:
     1. **Master Identification & CTC Baseline:** `#`, `Employee`, `Annual CTC`, `Monthly CTC`, `ER PF`, `ER ESI`, `Gratuity`, `FBP Carved`, `Carved Allow`, `Base Gross`.
     2. **Attendance & Proration:** `Days`, `Extra Days`, `LOP`, `Paid Leave`.
     3. **Earnings (Cleanly Terminated by `Earned Salary`):** `Basic + DA`, `HRA`, `LTA`, `Special`, `NPS Allow`, `FBP`, `Variable Pay`, `Comm / Other`, `Arrears`, `Advance Given`, `Hold Rel`, `Reimb`, Dynamic Custom Earnings, terminating cleanly with **`Earned Salary`** (redundant internal `gross_salary` removed).
     4. **Deductions (Statutory Grouping First):** `EPF`, `ESI`, `VPF`, `PT`, **`LWF`** (grouped alongside taxes), `TDS`, followed by internal recoveries `NPS Ded`, `Loan Ded`, `Advance Rec`, `On Hold`, `Other Ded`, Dynamic Custom Deductions, terminating with **`Total Deduct`**.
     5. **Net Pay & Balances:** **`Net Salary`**, `Adv Bal`, `Hold Bal`.
   * **`⚡ Smart Filter Active` Zero-Sum Column Suppression:**  
     By default, the workbench hides non-statutory allowance and deduction columns where every employee in the batch has ₹0.00. This eliminates horizontal scrolling fatigue while preserving an instant 1-click toggle to view all 35+ columns or toggle specific groups (`Master / CTC`, `Attendance`, `Earnings`, `Statutory`, `Deductions`, `Balances`).
   * **Legitimate Custom Component Zero-Sum Suppression:**  
     Even when a custom salary component exists in the catalog, if the entire batch has a sum of 0 for that custom allowance or deduction, it is automatically hidden in Smart Filter mode and only surfaces when toggled on or when a non-zero value is present.

---

## 🛡️ 8. Full-Lifecycle Dual-Path Matrix (Rule 15 Standard)

| Lifecycle Stage | Read-Path (UI & APIs) | Write-Path (Data Persistence) | Coherence Guardrail |
| :--- | :--- | :--- | :--- |
| **1. Catalog Definition** | Component list loaded in Client Workspace. | Written to `payroll_salary_components`. | Code & Abbr must be unique per client. |
| **2. Employee Structuring** | Input fields dynamically generated in `SalaryStructureModal`. | Saved in `EmployeeSalaryStructure.custom_components` JSON. | Validated against active catalog items. |
| **3. Monthly Batch Execution** | Appears as columns in batch review grid. | Snapshotted into `PayslipRecord.custom_components` JSON. | Historical records are immutable; editing catalog later never mutates past payslips! |
| **4. Deactivation** | Hidden from new salary structure modal. | `is_active = False` in database. | Existing historical records continue displaying normally. |
| **5. Deletion Attempt** | Deletion button disabled if used in any past payslips. | Soft-delete only (`is_active = False`). | Hard delete blocked by database foreign keys. |

---

## 📋 9. Upfront Multi-Option Refinement Menu (Rule 10 Standard)

To avoid conversational ping-pong, here is the complete menu of anticipated options for your selection:

* **[Option 1] Client Policy Presets (Recommended):** Provide standard one-click presets when onboarding a client:
  * *Preset A (Standard Corporate):* Basic = 50% Gross, HRA = 50% Basic, PF = Capped ₹1,800 in CTC.
  * *Preset B (Tech Startup / Uncapped):* Basic = 40% Gross, HRA = 50% Basic, PF = 12% actual Basic, Employer PF on top of CTC.
  * *Preset C (Contract / Consultant):* Basic = 100% Gross, PF = Not Opted, HRA = 0.
* **[Option 2] Minimum Wage Floor Validator:** Add an optional validation guard when saving a structure ensuring Basic + DA meets the state statutory minimum wage threshold (e.g. ₹16,500 for Karnataka commercial establishments).
* **[Option 3] Multi-Sheet Client Portal Auto-Mapping:** Enhance `payroll/excel_parser.py` so that if a client uploads an optional 9th tab `Custom_Allowances` (Employee Code, Component Code, Amount), it automatically loads into `PayslipRecord.custom_components` as `additional_amount`.
* **[Option 4] Retroactive Batch Recalculation Protection:** Enforce a strict lock preventing changes to a client's `SalaryComponent` catalog if an unapproved batch is currently in progress, preventing calculation desynchronization.

---
*End of Updated Specification Document.*
