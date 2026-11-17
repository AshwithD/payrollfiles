# 📖 The Plain-English Guide to Payroll Calculations

> **Audience:** Business owners, HR professionals, finance managers, and employees.  
> **Goal:** Explain exactly how every single number on an employee's salary slip is derived, from their annual CTC offer letter down to the final rupee transferred to their bank account.  
> **Tone:** Simple, intuitive, and crystal-clear — zero confusing technical jargon.

---

## 🧭 Executive Summary: The 30-Second Big Picture

Think of an employee's salary like a **monthly water distribution system**:

```
[ Annual CTC Offer Letter ]
           │
           ▼ (Divided by 12)
[ Monthly Stated Gross ] ─── (Split into Basic, HRA, Allowances & PF Reserve)
           │
           ▼ (Adjusted by Attendance: Working Days vs Calendar Days)
[ Earned Gross Salary ]  ─── (The actual money earned by the employee this month)
           │
           ▼ (Minus Deductions: EPF, Professional Tax, TDS Tax, Loan EMIs)
[ Net Bank Payout ]      ─── (The actual cash deposited into the employee's bank)
```

In plain English:
1. **CTC (Cost to Company):** The total amount the company spends on you per year (including taxes, benefits, and employer savings).
2. **Monthly Gross:** Your monthly starting pool before any attendance adjustments.
3. **Earned Salary:** What you actually earned this specific month based on your attendance and special allowances.
4. **Total Deductions:** What gets subtracted for government taxes, retirement funds, and loans.
5. **Net Salary:** The final "take-home" salary deposited into your bank account.
6. **Reimbursements:** Expense claims (like travel or client lunch bills) are added **on top** of Net Salary — they are tax-free repayments, not taxable salary!

---

## 🍰 Stage 1: How Annual CTC Turns into Monthly Pay Components

When an employee signs an offer letter with an annual CTC (e.g. ₹6,00,000/year), the system divides it by 12 to establish the **Monthly Pool** (₹50,000/month).

This monthly pool is divided into specific buckets following Indian statutory compliance rules:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Monthly Pool (e.g. ₹50,000)                       │
├────────────────────┬────────────────────┬───────────────┬──────────────┤
│    Basic + DA      │        HRA         │    Special    │ Employer PF  │
│       (50%)        │   (50% of Basic)   │   Allowance   │   Reserve    │
│      ₹25,000       │      ₹12,500       │    ₹10,700    │   ₹1,800     │
└────────────────────┴────────────────────┴───────────────┴──────────────┘
```

### 1. Basic + DA (Dearness Allowance)
- **The Foundation Pipe:** Under Indian labor codes and client structuring policies, Basic pay is derived directly as a percentage of the true **Monthly Gross** (typically **50% of Monthly Gross**).
- **Zero Artificial Floor (Advisory Sentinel Only):** Basic pay strictly honors the client's configured percentage (`basic_percentage`). If Basic falls below state statutory minimum wage thresholds (e.g., Karnataka commercial baseline of ₹16,500/month), the system flags an informational `min_wage_warning: True` sentinel in HR dashboards without artificially distorting the salary components or employer gratuity liability.
- **Why it matters:** Government retirement contributions (EPF) and gratuity are calculated as a percentage of Basic pay.

### 2. HRA (House Rent Allowance)
- **What it is:** Allowance provided to help employees pay for rental housing, which can be partially tax-exempt under Section 10(13A).
- **The Formula:** Set at **50% of Basic Pay** (capped so it never exceeds whatever money is left after Basic and any LTA).

### 3. Special Allowance (The Balancing Bucket)
- **What it is:** A fully taxable flexible allowance.
- **The Formula:** `Special Allowance = Monthly Gross - Basic - HRA - Discretionary Allowances - Custom Fixed Allowances`.
- It acts like a shock absorber: after statutory components like Basic and HRA are set, Special Allowance absorbs whatever balance remains so that the sum of earnings matches the true Monthly Gross to the exact paisa.

### 4. CTC to Monthly Gross Derivation (Employer Contributions Upfront)
- **The Fundamental Formula:**
  $$\text{Monthly Gross} = \text{Monthly CTC} - (\text{Employer PF} + \text{Employer ESI})$$
- In India, both the employee and the employer contribute to the Provident Fund (EPF) and ESI.
- When `employer_pf_in_ctc = True` (or `employer_esi_in_ctc = True`), employer statutory contributions are deducted from CTC **upfront** to establish the true Monthly Gross. Then Basic, HRA, and Special Allowance are structured from that Gross.
- **CRITICAL RULE:** **Employer PF is NEVER deducted from the employee's monthly salary slip.** It is purely informational on the payslip showing what the company pays directly into EPFO on the employee's behalf.
- **Employer PF in CTC Toggle:** Clients can choose whether Employer PF is deducted from CTC (`employer_pf_in_ctc = True`) so total company cost matches agreed CTC, or paid as an extra company overhead on top of CTC (`employer_pf_in_ctc = False`).

### 5. Gratuity Accrual (4.81% Retiral Carve-Out)
- **Legal Mandate:** Governed by the **Payment of Gratuity Act, 1972** for employees completing 5+ years of continuous service.
- **The Statutory Calculation Formula:**
  $$\text{Gratuity Benefit} = \frac{15}{26} \times \text{Last Drawn (Basic + DA)} \times \text{Completed Years of Service}$$
- **Monthly CTC Structuring:** Under corporate CTC structuring, the actuarial monthly provision is $\frac{15}{26 \times 12} \approx \mathbf{4.81\%}$ of Basic.
- **When `gratuity_in_ctc = True`:** The 4.81% gratuity provision is carved out from the annual CTC pool upfront, reducing the residual Special Allowance.
- **CRITICAL INVARIANT:** Gratuity is **NEVER a monthly deduction** from the employee's paycheck. It is an informational employer provision tracked on the corporate ledger.

### 6. 1-Click Structuring Presets & Custom Components
Different client companies follow different structuring philosophies:
- **🏢 Standard Corporate Preset:** 50% Basic, 50% HRA, Capped EPF (₹1,800), Employer PF carved out from CTC.
- **🚀 Tech Startup Preset:** 40% Basic, 50% HRA, Uncapped 12% EPF on actual Basic, Employer PF paid on top of CTC.
- **💼 Contractor / Consultant Preset:** 100% Gross Basic, 0% HRA, 0 PF.
- **🧩 Custom Allowances & Deductions:** Bespoke client items (Fuel Allowance, Internet Reimbursement, Mobile Subsidy) can be created per client. Active earning components are factored into the zero-paisa balancing equation:
  $$\text{Special Allowance} = \text{Monthly Gross} - \text{Basic} - \text{HRA} - \text{LTA} - \sum \text{Custom Allowances} - \text{Employer PF} - \text{Gratuity}$$

### 7. Employment Type Classifications: Regular Staff vs. Interns vs. Consultants

Not every person on a monthly payroll is a standard permanent employee. CAOAS enforces three distinct employment models with tailored statutory and calculation behaviors:

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│        💼 Regular Staff         │     🎓 Intern / Apprentice      │    🤝 Consultant / Retainer     │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ • Full CTC structure            │ • Fixed monthly learning        │ • Fixed professional retainer   │
│   (Basic, HRA, Allowances)      │   stipend                       │   fees                          │
│ • EPF: 12% (capped or uncapped) │ • EPF: 100% Statutory Exempt    │ • EPF: 100% Exempt              │
│ • ESI: 0.75% (Gross ≤ ₹21k)     │ • ESI: 100% Statutory Exempt    │ • ESI: 100% Exempt              │
│ • State Professional Tax & TDS  │ • Title: "STIPEND SLIP"         │ • TDS: Section 194J (10% / 2%)  │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

#### Why Interns Are Legally Exempt from EPF & ESI:
- **The Law (EPF Act, 1952):** Section 2(f) of the Employees' Provident Funds and Miscellaneous Provisions Act explicitly excludes an *"apprentice engaged under the Apprentices Act, 1961, or under the certified standing orders of the establishment"*.
- **The Law (ESI Act, 1948):** Trainees undergoing learning or student apprentices receiving stipends are not considered "employees" for statutory social security deductions.
- **System Automation in CAOAS:** When an employee is classified as `INTERN` (`is_intern = True`):
  1. The system automatically unchecks and locks `pf_opted` and `esi_opted` to `False`.
  2. The calculation engine zeroes out both employee EPF/ESI deductions and employer liability contributions.
  3. The PDF generator dynamically prints **STIPEND SLIP** across the header and watermark instead of standard "Salary Slip".
  4. The employee is badged as `🎓 Intern` across the client portal and staff review workbench.

---

## 🛡️ Stage 2: Attendance, Leave & The "Zero Pay-Cut" Shield

Not every month has the same number of days (e.g. February has 28, March has 31). Furthermore, employees take vacations, sick days, or work overtime.

### The Proration Ratio (The Work Multiplier)

Whenever an employee does not work every day of the month, their fixed monthly pay components (Basic, HRA, Special Allowance) are adjusted using the **Proration Ratio**:

$$\text{Proration Ratio} = \frac{\text{Effective Present Days}}{\text{Total Calendar Days in Month}}$$

*Example:* In a 30-day month, if an employee's effective attendance is 30 days, the ratio is $30 / 30 = 1.0$ (100% pay). If effective attendance is 15 days, the ratio is $15 / 30 = 0.5$ (50% pay).

---

### The Two Classes of Employees: Probation vs. Confirmed

The system automatically checks if an employee has completed their **6-month probation period**:

| Rule / Feature | 🐣 Employee on Probation (< 6 Months) | 🦅 Confirmed Employee (> 6 Months) |
|---|---|---|
| **Monthly Leave Accrual** | **0 days** (No paid leave earned) | **+1.833 days/month** (22 days/year) |
| **Unpaid Leave (LOP)** | **Direct salary deduction** for every day missed | **Protected from pay cuts!** Covered by balances |
| **Comp-Off Banking** | Extra weekend days worked are not banked | Extra days worked are credited to Comp-Off ledger |
| **Shortfall Handling** | Immediate pay reduction | Tracked as a "Leave Debt" balance to work off later |

---

### 🛡️ Dual LOP Policy Models: Accrue Leave Debt vs. Direct Salary Reduction

Because CAOAS services diverse client companies, the payroll engine provides two client-selectable LOP policies:

1. **`ACCRUE_LEAVE_DEBT` (CKPS Firm Model — The "Zero Pay-Cut" Shield):**
   - For confirmed employees, approved leave and LOP are unconditionally paid in full.
   - Any shortfall beyond earned leave and comp-off balances is logged as a **negative ledger debt** (e.g. `-2.0 days`).
   - In subsequent months, as the employee earns leave accruals or logs extra working days, the system automatically pays down the negative debt without cutting pay.

2. **`REDUCE_SALARY` (Standard Commercial Client Model — Pay-for-Time):**
   - Uncovered LOP directly reduces payable days and earned monthly salary.
   - If an employee takes 3 days of unpaid leave with 0 leave balance, the proration ratio decreases accordingly:
     $$\text{Earned Salary} = \text{Monthly Contract} \times \left(\frac{\text{Days in Month} - \text{LOP Days}}{\text{Days in Month}}\right)$$

#### ⚖️ Side-by-Side LOP Comparison (Ramesh Kumar — 3 Days LOP with 0 Leave Balance)

| Factor | Model A: `ACCRUE_LEAVE_DEBT` | Model B: `REDUCE_SALARY` |
|---|---|---|
| **Monthly Gross** | ₹50,000 | ₹50,000 |
| **LOP Days** | 3 days unpaid | 3 days unpaid |
| **Earned Salary This Month** | **₹48,200 (100% full pay)** | **₹43,535 (Prorated for 28/31 days)** |
| **Leave Ledger Impact** | Negative balance: `-3.0 days` | Ledger untouched: `0.0 days` |
| **Paycheck Impact** | ₹0 deducted from bank transfer | **₹4,665 deducted** from monthly payout |
| **Future Settlement** | Auto-cleared by future leave accruals | No future debt; loss realized immediately |

---

### 🛡️ The Confirmed Employee "Zero Pay-Cut" Policy (Under `ACCRUE_LEAVE_DEBT`)

When a client operates under `ACCRUE_LEAVE_DEBT`, the system uses an employee-friendly safety net: **The system never automatically cuts a confirmed employee's monthly pay for approved leaves or LOP.**

Instead, the system uses a **multi-tier safety net**:

```
[ Employee Takes Leave or Unplanned Days Off ]
                     │
                     ▼
  Tier 1: Covered by General Leave Balance (Earned 1.83 days/month)
                     │ (If Leave runs out)
                     ▼
  Tier 2: Covered by Comp-Off Balance (Banked weekend/overtime days)
                     │ (If Comp-Off runs out)
                     ▼
  Tier 3: Tracked as "Negative Leave Balance" (Leave Debt)
                     │
                     ▼
         ★ Full Salary is Still Paid! ★
```

1. **Approved Paid Leave and LOP are unconditionally paid:** The employee receives their full salary.
2. **Bookkeeping Debt:** Days that exceed available leave and comp-off balances are logged as a **negative balance** (e.g., `-2.0 days`).
3. **Automatic Settlement:** As the employee earns 1.83 leave days in future months or works extra weekend days (`extra_working_days`), the spare days **automatically pay down the negative leave debt** with zero manual intervention required from HR!

### 🏖️ Leave Encashment Calculation Formula (Exit & Year-End Monetization)
When an employee resigns or under company policy monetizes their unused positive leave balance, the system converts accumulated leave days into cash earnings:
- **1-Day Rate Formula:**
  $$\text{1-Day Rate} = \frac{\text{Contracted Basic} + \text{DA}}{\text{Day Divisor (Standard 30 Days or Factories Act 26 Days)}}$$
- **Total Leave Encashment Payout:**
  $$\text{Leave Encashment} = \text{Positive Closing Leave Days} \times \text{1-Day Rate}$$
- **Accounting & Tax Treatment:**
  - **It is an EARNING (Addition):** Increases gross earnings and net payout on the employee's final payslip.
  - **Full & Final Settlement (FnF):** Automatically injected into the exit payslip during employee termination/resignation processing.
  - **TDS:** Treated as taxable income (exempt up to statutory limits under Section 10(10AA) for eligible retiral exits).

---

## 💰 Stage 3: Monthly Earnings (What Adds Up)

Here is every item that can appear on the **Earnings** side of the payslip:

| Earnings Component | How It Is Calculated | Prorated by Attendance? |
|---|---|---|
| **Basic + DA** | `Contracted Basic × Proration Ratio` | **Yes** |
| **HRA** | `Contracted HRA × Proration Ratio` | **Yes** |
| **Special Allowance** | `(Contracted SA × Proration Ratio) + Uploaded Top-up` | **Yes** (baseline) |
| **LTA (Leave Travel)** | `(Contracted LTA × Proration Ratio) + Uploaded Top-up` | **Yes** (baseline) |
| **NPS Allowance** | `(Contracted NPS × Proration Ratio) + Uploaded Top-up` | **Yes** (baseline) |
| **Statutory Bonus** | `Earned Basic × (Client Bonus % ÷ 100)` (Min 8.33%, Max 20%) | **Yes** (on Earned Basic) |
| **Leave Encashment** | `Closing Leave Days × 1-Day Basic Rate` (FnF / Annual) | No (Direct payout) |
| **Commission / Bonus** | Flat incentive amount entered for this month | No (100% paid) |
| **Salary Arrears** | Back-pay owed from prior months | No (100% paid) |
| **Salary Advance Disbursed** | Emergency cash advance given to employee | No (Added to pay) |
| **Salary On-Hold Released** | Previously frozen pay released back to employee | No (Added to pay) |
| **TOTAL EARNED SALARY** | **Sum of all above earnings components** | **Equals Gross Earnings** |

### 🎁 Statutory Bonus Mechanics (Payment of Bonus Act, 1965)
- **Legal Mandate:** Commercial establishments with 20+ employees must pay eligible employees an annual bonus between **8.33%** (minimum: exactly 1 month's basic) and **20.00%** (maximum).
- **Monthly Distribution Mode:** Rather than creating a giant cashflow shock at Diwali, modern employers distribute $\frac{1}{12}\text{th}$ (**8.33%**) every month.
- **The Core Calculation (`calculations.py:706`):**
  $$\text{Statutory Bonus} = \text{Earned (Basic + DA)} \times \left(\frac{\text{statutory\_bonus\_pct}}{100}\right)$$
- **Attendance-Linked Proration:** Because the formula multiplies against **Earned Basic** (which already reflects LOP or mid-month joining), the bonus automatically prorates with attendance (`depends_on_payment_days: True`).
- **CRITICAL DISTINCTION:** Statutory Bonus is an **EARNING (Addition)**, NOT a deduction! It increases the employee's take-home pay.

> 💡 **Notice on Reimbursements:** If an employee submits an official travel bill of ₹2,500, this is entered under **Reimbursements**. It is **not** mixed into Earned Salary because it is non-taxable expense repayment. It is added at the very end to "Total Payable".

---

## 📉 Stage 4: Monthly Deductions (What Gets Subtracted)

Here is every item that can appear on the **Deductions** side of the payslip:

### 1. EPF (Employee Provident Fund)
- **Who pays:** The employee's own contribution to their retirement fund.
- **The Statutory Rule:** **12% of Basic Pay**, capped at ₹15,000 monthly statutory wage ceiling.
- **The Formula:** $\min(\text{Basic} \times 12\%, ₹1,800)$.
- *Note:* If an employee opts out of PF (`pf_opted = False`), EPF deduction is ₹0.

### 2. ESI (Employees' State Insurance — Statutory Healthcare Scheme)
- **Who pays:** Both the employee and the employer contribute to the ESIC medical care and social security scheme.
- **Statutory Wage Ceiling:** **₹21,000 Gross Wages per month** (₹25,000 for employees with recognized physical disabilities).
- **Eligibility Rule:** Applicable only when `esi_opted = True` and the employee's monthly gross earnings are within the statutory wage threshold.
- **Employee Deduction:** **0.75% of Gross Wages** (deducted from employee's monthly take-home salary).
- **Employer Contribution:** **3.25% of Gross Wages** (paid directly by the company to ESIC).
- **CTC Structuring:** When `employer_esi_in_ctc = True`, the employer's 3.25% contribution is carved out upfront from CTC during structure derivation. Like Employer PF, Employer ESI is **NEVER** a monthly payslip deduction—it is an informational employer statutory benefit.
- **Insurance IP Number:** Employees enrolled in ESI receive a unique 10-digit Insurance Person (IP) number tracked directly on their profile and monthly inputs onboarding.

### 3. Professional Tax (PT — Multi-State Statutory Engine)
- **Who pays:** State government employment tax remitted per state rules.
- **Dynamic State Engine:** The engine supports 6 statutory regimes selected on the client's profile (`pt_state`):

#### 🗺️ Multi-State Professional Tax Quick-Lookup Cheat Sheet

| State Regime (`pt_state`) | Monthly Gross Threshold | Monthly Deduction | Special Rules |
|---|---|---|---|
| **Karnataka** (2025 Act) | < ₹25,000<br>≥ ₹25,000 | **₹0**<br>**₹200** | ₹300 in February (₹2,500 annual statutory cap) |
| **Telangana / Andhra Pradesh** | ≤ ₹15,000<br>₹15,001 – ₹20,000<br>> ₹20,000 | **₹0**<br>**₹150**<br>**₹200** | Standard 3-slab progressive schedule |
| **Maharashtra** | Men ≤ ₹7,500<br>Men ₹7,501 – ₹10,000<br>Men > ₹10,000<br>Women ≤ ₹25,000 | **₹0**<br>**₹175**<br>**₹200**<br>**₹0** | ₹300 in February for eligible men; women exempt up to ₹25,000 |
| **Gujarat** | ≤ ₹12,000<br>> ₹12,000 | **₹0**<br>**₹200** | Simple 2-tier threshold |
| **Exempt (Delhi, UP, Rajasthan, etc.)** | All salary levels | **₹0** | No Professional Tax applicable in state |
| **Custom Fixed Amount** | Defined per client | **`pt_amount`** | Flat monthly deduction configured by client HR |

### 4. TDS (Income Tax / Tax Deducted at Source)
- **Who pays:** Withholding tax remitted directly to the Income Tax Department.
- Derived from the employee's chosen tax regime (Old vs. New) and investment declarations.

### 5. Salary Advance / Loan Recovery
- When an employee borrows a salary advance with a 6-month repayment tenure, the system automatically computes an equal monthly EMI ($\text{Loan Amount} / 6$) and deducts it here until fully repaid.

### 6. Salary On-Hold
- If HR needs to temporarily freeze a portion of salary (e.g. during exit clearance or pending documentation), the held amount is deducted here and parked in the **On-Hold Balance**, ready to be automatically released in a future chosen month.

### 7. State Labour Welfare Fund (LWF — Calendar-Automated Deduction)
- **What is LWF?** Statutory contribution collected under state Labour Welfare Fund Acts for employee recreation and social amenities.
- **The "Calendar Alarm Clock" Rule (`calculations.py:958-978`):** Unlike PF or PT, state welfare boards do not collect LWF every single month. The calculation engine automatically evaluates the client's configured rule against the batch `month`:
  - **`KARNATAKA_DEC`:** Deducts **only in Month 12 (December)** (default: ₹20 Employee deduction / ₹40 Employer contribution). Months 1–11 evaluate to **₹0.00**.
  - **`MAHARASHTRA_JUN_DEC`:** Deducts **twice a year in Months 6 & 12 (June and December)** (default: ₹25 Employee deduction / ₹75 Employer contribution). Other months evaluate to **₹0.00**.
  - **`CUSTOM_DECEMBER`:** Custom configured employee amount auto-deducted in December only.
  - **`CUSTOM_MONTHLY`:** Custom employee amount deducted every single month.
  - **`EXEMPT_ZERO`:** LWF is completely disabled (₹0.00).
- **Auto-Injection Guard:**
  ```python
  if "lwf" not in row and computed_lwf > 0:
      result_dict["lwf"] = computed_lwf.quantize(Decimal("0.01"))
  ```
  In designated months, the system automatically populates the `lwf` deduction column unless an explicit override was typed into an uploaded Excel spreadsheet.
- **Deduction vs. Employer Cost:**
  - **Employee LWF:** A **DEDUCTION** subtracted from take-home pay.
  - **Employer LWF:** An **EMPLOYER STATUTORY LIABILITY** tracked for state board challan returns (never deducted from employee salary).

$$\text{Total Deductions} = (\text{EPF} + \text{ESI} + \text{VPF} + \text{PT} + \text{LWF} + \text{TDS}) + (\text{Loan EMI} + \text{Advance Recovery} + \text{On-Hold} + \text{Other Deductions})$$

---

## 🏁 Stage 5: The Final Bottom Line

$$\mathbf{\text{Net Take-Home Salary}} = \mathbf{\text{Earned Salary}} - \mathbf{\text{Total Deductions}}$$

$$\mathbf{\text{Total Bank Transfer}} = \mathbf{\text{Net Salary}} + \mathbf{\text{Non-Taxable Reimbursements}}$$

---

## 📊 Stage 7: Batch Review Workbench & Smart Zero-Suppression

When reviewing a monthly payroll batch, the staff workbench (`PayrollJobBatchReview.jsx`) displays over 35 potential financial metrics per employee. In a standard 50-person company, however, many components (like Voluntary PF, Loan EMIs, or bespoke custom allowances) may have a balance of ₹0 for all employees.

### The Canonical Column Sequence
The review register enforces a strict, logical column sequence that eliminates visual confusion:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                            PAYROLL REGISTER COLUMN FLOW                                              │
├────────────────────┬────────────────────┬──────────────────────────────────────┬─────────────────────────────────────┤
│ 1. Master & CTC    │ 2. Attendance      │ 3. Earnings (Terminated by Earned)   │ 4. Deductions (Statutory First)     │
│ • # & Employee     │ • Total Days       │ • Basic + DA, HRA, LTA, Special Allow│ • Statutory: EPF, ESI, VPF, PT, LWF,│
│ • Annual CTC       │ • Extra Days       │ • NPS Allow, FBP, Variable, Comm/Oth │   TDS                               │
│ • Monthly CTC      │ • LOP Days         │ • Arrears, Advance Disbursed         │ • Recoveries: NPS Ded, Loan EMI,    │
│ • Carved Reserves  │ • Paid Leave       │ • Hold Released, Reimbursement       │   Advance Recovery, On Hold, Other  │
│   (ER PF, ESI,     │                    │ • Dynamic Custom Allowances          │ • Dynamic Custom Deductions         │
│    Gratuity, FBP)  │                    │ ════════════════════════════════════ │ ═══════════════════════════════════ │
│ • Base Gross       │                    │ ▶ EARNED SALARY (Gross Total)        │ ▶ TOTAL DEDUCTIONS                  │
└────────────────────┴────────────────────┴──────────────────────────────────────┴─────────────────────────────────────┘
                                                          │
                                                          ▼
                                ┌───────────────────────────────────────────────────┐
                                │ 5. Net Payout & Balances                          │
                                │ • NET SALARY (Take-Home Bank Transfer)            │
                                │ • Advance Balance, Hold Balance                   │
                                └───────────────────────────────────────────────────┘
```

* **No Redundant Gross Column:** The duplicate `gross_salary` column has been removed from inside the Earnings group. The group culminates decisively at **`Earned Salary`**, after which Deductions begin immediately.
* **LWF Grouped with Statutory Taxes:** `LWF` is displayed alongside `EPF`, `ESI`, `VPF`, `PT`, and `TDS`, keeping all statutory government deductions unified before internal loan/advance recoveries.

### ⚡ Smart Zero-Suppression Architecture

To prevent horizontal scrolling fatigue, the review table operates with an active **Smart Filter** by default:

```
                  ┌──────────────────────────────────────────────┐
                  │ Batch Records Loaded (e.g. 50 Employees)     │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ For each non-statutory column:               │
                  │ Calculate Sum(All Employees)                 │
                  └──────────────────────┬───────────────────────┘
                                         │
                      ┌──────────────────┴──────────────────┐
                      ▼                                     ▼
             Sum > ₹0.00 across batch              Sum == ₹0.00 across batch
             ┌─────────────────────┐               ┌────────────────────────┐
             │ Keep Column Visible │               │ ⚡ Smart Filter Active: │
             │ in Review Table     │               │ Auto-Hide Column       │
             └─────────────────────┘               └────────────────────────┘
                                                                │
                                                                ▼
                                                   [ Show All Columns Toggle ]
                                                   Instantly expands to 35+
                                                   audit columns on demand
```

1. **Automatic Zero Detection:** Any non-statutory allowance, discretionary top-up, or internal deduction column where every single employee in the batch has ₹0.00 is automatically hidden.
2. **Instant 1-Click Expansion:** Clicking the **`⚡ Smart Filter Active`** toggle in the review toolbar immediately switches between the compact operational view and the complete 35+ column audit view.
3. **Group Toggles:** Users can independently toggle individual groups (`Master / CTC`, `Attendance`, `Earnings`, `Statutory`, `Deductions`, `Balances`) from the Columns dropdown.

---

## 📄 Stage 8: Live Draft Document Access & Verification Badges

In fast-paced payroll operations, waiting until a batch is finalized and sealed just to preview the Excel register or bank payout schedule creates unnecessary bottlenecks. CAOAS provides **Live Draft Document Access** during the active review cycle.

### The Document Lifecycle State Machine

```
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │ BATCH STATUS: DRAFT / IN_PROGRESS / REVIEWING                                    │
   ├─────────────────────────────────────────────────────────────────────────────────┤
   │ • All 11 generated batch documents are 100% UNLOCKED and downloadable at runtime│
   │ • Documents are stamped with an amber [Draft] status badge:                     │
   │                                                                                 │
   │   📗 Payroll Register              [Draft]  ✓ PayrollRegister_Nov-2026.xlsx     │
   │   💳 Bank Payout Schedule          [Draft]  ✓ Bank_Disbursement_Nov-2026.xlsx   │
   │   📦 Payslips Archive Bundle       [Draft]  📦 Payslips_Nov-2026.zip            │
   │   ✉️ Email Audit Log               [Draft]  ✓ EmailLog_Nov-2026.xlsx            │
   └────────────────────────────────────────┬────────────────────────────────────────┘
                                            │
                                            │ Batch Approved, Finalized & Sealed
                                            ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │ BATCH STATUS: DONE / COMPLETED                                                  │
   ├─────────────────────────────────────────────────────────────────────────────────┤
   │ • Amber [Draft] badges automatically switch to official green regulatory pills: │
   │                                                                                 │
   │   📗 Payroll Register              [Live Register]    ✓ Download Final          │
   │   💳 Bank Payout Schedule          [NEFT / RTGS]      ✓ Download Final          │
   │   🏛️ EPFO ECR (.txt)               [Unified Portal]   ✓ Download ECR            │
   │   🏥 ESIC Monthly File             [ESIC Portal]      ✓ Download ESIC           │
   │   📦 Payslips Archive Bundle       [Live Bundle]      📦 Download Sealed Zip    │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

* **Zero Lockout:** Staff can verify the double-entry Journal Voucher (JV), Month-over-Month (MoM) variance bridge, and bank payout schedule before locking the batch.
* **Audit Transparency:** Amber `Draft` badges make it visually impossible to mistake an unfinalized register for an approved, sealed corporate disbursement schedule.

---

## 🔍 Stage 6: Real-World Walkthrough (Ramesh's Payslip)

Let's trace a real employee named **Ramesh Kumar**:
- **Role:** Senior Associate (Confirmed employee, post-probation).
- **Annual CTC:** ₹6,00,000.
- **Month:** October (31 days).
- **Attendance:** Worked 29 days, took 2 days off (covered by leave balance).

---

### Step 1: Establishing Ramesh's Monthly Contract
- **Monthly Gross:** $₹6,00,000 / 12 = \mathbf{₹50,000.00}$.
- **Basic + DA (50%):** $\mathbf{₹25,000.00}$.
- **HRA (50% of Basic):** $\mathbf{₹12,500.00}$.
- **Employer PF Reserve:** $\min(₹25,000 \times 12\%, ₹1,800) = \mathbf{₹1,800.00}$.
- **Special Allowance:** $₹50,000 - ₹25,000 - ₹12,500 - ₹1,800 = \mathbf{₹10,700.00}$.

---

### Step 2: Applying October Attendance
- **Days in Month:** 31.
- **Actual Working Days:** 29 days.
- **Approved Leave:** 2 days (deducted from Ramesh's leave balance, leaving salary 100% intact).
- **Effective Present Days:** $29 + 2 = \mathbf{31\text{ days}}$.
- **Proration Ratio:** $31 / 31 = \mathbf{1.0}$ (Full 100% pay!).

---

### Step 3: Computing Monthly Earnings
- **Basic + DA:** $₹25,000 \times 1.0 = \mathbf{₹25,000.00}$
- **HRA:** $₹12,500 \times 1.0 = \mathbf{₹12,500.00}$
- **Special Allowance:** $₹10,700 \times 1.0 = \mathbf{₹10,700.00}$
- **Total Earned Salary (Gross):** $\mathbf{₹48,200.00}$  
  *(Note: ₹48,200 Earned + ₹1,800 Employer PF in EPFO = ₹50,000 monthly CTC).*

---

### Step 4: Computing Monthly Deductions
- **EPF (Employee Contribution):** $\min(₹25,000 \times 12\%, ₹1,800) = \mathbf{₹1,800.00}$.
- **Professional Tax (Karnataka):** Monthly Gross is ₹50,000 (above ₹25,000) $\rightarrow \mathbf{₹200.00}$.
- **TDS (Income Tax):** Estimated at $\mathbf{₹1,500.00}$.
- **Total Deductions:** $₹1,800 + ₹200 + ₹1,500 = \mathbf{₹3,500.00}$.

---

### Step 5: The Final Paycheck
- **Net Salary:** $₹48,200.00 - ₹3,500.00 = \mathbf{₹44,700.00}$.
- **Approved Expense Reimbursement:** ₹1,200.00 (Client travel).
- **Final Bank Deposit:** $₹44,700.00 + ₹1,200.00 = \mathbf{₹45,900.00}$.

---

## ❓ Frequently Asked Questions (FAQ)

#### Q1: "Why is Employer PF deducted from my CTC if I don't see it in my bank account?"
**Answer:** CTC represents the total cost your employer incurs to hire you. When your employer deposits ₹1,800 every month into your central EPFO government retirement account, that is real money being invested in your future. Because it goes directly to the EPFO rather than your checking account, it is reflected in your CTC structure, but never deducted from your monthly take-home pay.

#### Q2: "What happens if my leave balance goes below zero?"
**Answer:** Nothing bad happens to your paycheck! Under our zero-pay-cut policy, your salary is still paid in full. The system simply tracks your negative leave balance as an internal ledger debt. When you earn your 1.83 leave days next month, or work an extra weekend day, the system automatically pays off that balance.

#### Q3: "Why is my Professional Tax ₹300 in February but ₹200 in other months?"
**Answer:** Karnataka state law imposes an annual cap of ₹2,500 on Professional Tax. To make the 12 months equal exactly ₹2,500 without dealing with odd fractions of rupees, the state government mandates ₹200 for 11 months ($11 \times 200 = ₹2,200$) and ₹300 in February ($₹2,200 + ₹300 = ₹2,500$).

#### Q4: "What is the difference between an Advance and a Reimbursement?"
**Answer:**
- An **Advance** is money the company lends you before you earn it (which is auto-recovered from future payslips in monthly EMIs).
- A **Reimbursement** is money you spent out-of-pocket for company business (travel, hotel, client meals) that the company is repaying you. It is completely tax-free and added directly on top of your net salary.

