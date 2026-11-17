import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import {
  AssignModal,
  fetchAssignableEmployees,
  StatCard,
  Breadcrumb,
  Panel,
  StatusBreakdown,
  TeamBadges,
  Pill,
  JobCard,
  P,
  PL,
  BRD,
  BG,
  MUT,
  GR,
  RED,
  AMB,
  PUR,
  PURL,
  WH,
  INK,
  STATUS_COLORS,
  fmtDate,
} from "../../IncomeTaxPage/JobUiCommon";
import {
  Search, X, LayoutGrid, List, List as ListIcon,
  Download, Send, CheckCircle2, FileSpreadsheet,
  Clock, Lock, Unlock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  AlertTriangle, AlertCircle, TrendingUp, TrendingDown,
  CalendarClock, CalendarDays, CalendarX, Wallet, Sparkles, Mail,
  ClipboardCheck, Edit3, Upload, RotateCcw,
  Building2, Users, ShieldCheck, FastForward,
  Eye, Play, ArrowUpDown, ArrowLeft, ArrowRight, ArrowUpRight,
  Ban, Bell, Check, CreditCard, DollarSign, FileCheck2, FileText,
  Filter, Globe, HelpCircle, Inbox, Info, Layers, ListFilter,
  Loader2, Minus, PauseCircle, Pencil, Plus,
  Receipt, Trash2, UserCheck, UserMinus, UserPlus,
} from "lucide-react";
import {
  LedgerAdjustmentModal,
  PayrollDialog,
  formatCurrency,
  formatDateTime,
  unwrapList,
  api,
  apiPath,
  Button,
  Input,
  Textarea,
  MONTHS,
  sanitizeFileNamePart,
} from "../PayrollRoutes";
import { PayrollJobUnifiedAuditModal } from "./PayrollJobDashboard";

export { sanitizeFileNamePart };

export async function unpackBlobError(err, fallback = "Download failed") {
  if (err?.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const json = JSON.parse(text);
      return json.error || json.detail || json.message || fallback;
    } catch (_) { }
  }
  return err?.response?.data?.error || err?.response?.data?.detail || err?.message || fallback;
}

/* ==========================================================================
   PART 2.5: PAYROLL JOB BATCH REVIEW WORKBENCH
   ========================================================================== */

const REGISTER_COLUMNS = [
  // CTC & Retirals (Waterfall: CTC -> Carve-Outs -> Base Gross)
  { key: "ctc_annual", label: "Annual CTC", fullLabel: "Annual Cost to Company", group: "CTC & Retirals", width: 110, color: "#0f172a", fontWeight: 700 },
  { key: "monthly_ctc", label: "Monthly CTC", fullLabel: "Monthly CTC Budget (Annual ÷ 12)", group: "CTC & Retirals", width: 105, color: "#334155" },
  { key: "employer_pf_carveout", label: "ER PF", fullLabel: "Employer PF Contribution (CTC Carve-Out)", group: "CTC & Retirals", width: 90, color: "#b45309" },
  { key: "employer_esi_carveout", label: "ER ESI", fullLabel: "Employer ESI Contribution (CTC Carve-Out)", group: "CTC & Retirals", width: 90, color: "#b45309" },
  { key: "gratuity_carveout", label: "Gratuity", fullLabel: "Statutory Gratuity Accrual (CTC Carve-Out)", group: "CTC & Retirals", width: 95, color: "#b45309" },
  { key: "fbp_carveout", label: "FBP Carved", fullLabel: "Flexible Benefit Plan (CTC Carve-Out)", group: "CTC & Retirals", width: 95, color: "#4338ca" },
  { key: "custom_carveouts_total", label: "Carved Allow", fullLabel: "Carved Custom Allowances (CTC Carve-Out)", group: "CTC & Retirals", width: 100, color: "#7e22ce" },
  { key: "contracted_monthly_gross", label: "Base Gross", fullLabel: "Base Monthly Gross Salary (Post Carve-Outs)", group: "CTC & Retirals", width: 115, color: "#1d4ed8", fontWeight: 700 },

  // Attendance
  { key: "actual_working_days", label: "Days", fullLabel: "Days Worked", group: "Attendance", width: 58, align: "center" },
  { key: "extra_working_days", label: "Extra Days", fullLabel: "Extra Working Days", group: "Attendance", width: 75 },
  { key: "lop_days", label: "LOP", fullLabel: "Loss of Pay Days", group: "Attendance", width: 55 },
  { key: "paid_leave_days", label: "Paid Leave", fullLabel: "Paid Leave Days", group: "Attendance", width: 75 },

  // Earnings
  { key: "basic_da", label: "Basic + DA", fullLabel: "Basic + DA", group: "Earnings", width: 110 },
  { key: "hra", label: "HRA", fullLabel: "House Rent Allowance", group: "Earnings", width: 95 },
  { key: "lta", label: "LTA", fullLabel: "Leave Travel Allowance", group: "Earnings", width: 95 },
  { key: "special_allowance", label: "Special", fullLabel: "Special Allowance", group: "Earnings", width: 95 },
  { key: "nps_allowance_earned", label: "NPS Allow", fullLabel: "NPS Allowance Earned", group: "Earnings", width: 95 },
  { key: "fbp", label: "FBP", fullLabel: "Flexible Benefit Plan (Earned)", group: "Earnings", width: 95, color: "#4338ca" },
  { key: "variable_pay", label: "Variable Pay", fullLabel: "Variable Pay", group: "Earnings", width: 100 },
  { key: "commission_other", label: "Comm / Other", fullLabel: "Commission / Other", group: "Earnings", width: 105 },
  { key: "arrears", label: "Arrears", fullLabel: "Salary Arrears", group: "Earnings", width: 95 },
  { key: "salary_advance_disbursed", label: "Advance Given", fullLabel: "Salary Advance Disbursed", group: "Earnings", width: 105 },
  { key: "on_hold_released", label: "Hold Rel", fullLabel: "Salary On-Hold Released", group: "Earnings", width: 100 },
  { key: "reimbursements", label: "Reimb", fullLabel: "Reimbursements", group: "Earnings", width: 95 },
  { key: "earned_salary", label: "Earned Salary", fullLabel: "Earned Salary", group: "Earnings", width: 135, color: "#1d4ed8" },

  // Deductions
  { key: "epf", label: "EPF", fullLabel: "Employee Provident Fund", group: "Deductions", width: 68 },
  { key: "esi", label: "ESI", fullLabel: "Employees' State Insurance", group: "Deductions", width: 68 },
  { key: "vpf", label: "VPF", fullLabel: "Voluntary Provident Fund", group: "Deductions", width: 90 },
  { key: "professional_tax", label: "PT", fullLabel: "Professional Tax", group: "Deductions", width: 58 },
  { key: "lwf", label: "LWF", fullLabel: "Labour Welfare Fund", group: "Deductions", width: 75 },
  { key: "tds", label: "TDS", fullLabel: "Tax Deducted at Source (TDS)", group: "Deductions", width: 95 },
  { key: "nps_deduction", label: "NPS Ded", fullLabel: "NPS Deduction", group: "Deductions", width: 95 },
  { key: "loan_deduction", label: "Loan Ded", fullLabel: "Loan / Advance Deduction", group: "Deductions", width: 95 },
  { key: "salary_advance_recovered", label: "Advance Rec", fullLabel: "Salary Advance Recovered", group: "Deductions", width: 100 },
  { key: "on_hold_deducted", label: "On Hold", fullLabel: "Salary On Hold Deducted", group: "Deductions", width: 95 },
  { key: "other_deduction", label: "Other Ded", fullLabel: "Other Deductions", group: "Deductions", width: 95 },
  { key: "total_deductions", label: "Total Deduct", fullLabel: "Total Deductions", group: "Deductions", width: 115, color: "#b91c1c" },

  // Summary & Ledger Balances
  { key: "net_salary", label: "Net Salary", fullLabel: "Net Take-Home Salary", group: "Summary", width: 120, color: "#166534", fontWeight: 800 },
  { key: "salary_advance_closing_balance", label: "Adv Bal", fullLabel: "Salary Advance Balance (Remaining)", group: "Summary", width: 105, color: "#d97706" },
  { key: "on_hold_closing_balance", label: "Hold Bal", fullLabel: "Salary On-Hold Balance (Held)", group: "Summary", width: 100, color: "#7c3aed" },
];

export function extractCustomColumns(records = [], clientComponents = []) {
  const earningsMap = new Map();
  const deductionsMap = new Map();
  const METADATA_CODES = new Set([
    "EMPLOYMENT_TYPE", "IS_INTERN", "EMPLOY", "IS_INT",
    "ESI", "PF", "EPF", "BASIC", "HRA", "LTA", "SPECIAL_ALLOWANCE", "FBP",
    "CARVE_OUT_CUSTOM_IN_CTC", "CARVE_OUT_FBP_IN_CTC", "CARVE_",
    "GRATUITY", "GRATUITY_IN_CTC", "GRATUI", "GRAT_PCT",
    "EMPLOYER_PF_CONTRIBUTION", "EMPLOYER_PF", "EMPLOYER_PF_IN_CTC",
    "EMPLOYER_ESI", "EMPLOYER_ESI_IN_CTC", "ESI_OPTED", "ESI_NUMBER", "UAN_NUMBER",
    "IS_SENIOR_CITIZEN", "NON_EPS", "PF_OPTED",
    "CONTRACTED_MONTHLY_GROSS", "MONTHLY_GROSS", "BASE_GROSS", "EARNED_SALARY"
  ]);

  const isMetadataCode = (code, abbr) => {
    const cUpper = String(code || "").trim().toUpperCase();
    const aUpper = String(abbr || "").trim().toUpperCase();
    if (!cUpper) return true;
    if (
      cUpper.startsWith("__") ||
      cUpper.startsWith("CARVE_OUT_") ||
      aUpper.startsWith("CARVE_") ||
      aUpper.startsWith("GRATUI") ||
      METADATA_CODES.has(cUpper) ||
      METADATA_CODES.has(aUpper)
    ) {
      return true;
    }
    return false;
  };

  // 1. Seed columns from configured client components catalog (ensures newly added components like MEDICAL_ALLOWANCE display immediately)
  if (Array.isArray(clientComponents)) {
    for (const comp of clientComponents) {
      if (!comp || !comp.code || comp.is_active === false) continue;
      // Skip internal metadata components, statutory ESI/PF, and standard salary codes
      if (isMetadataCode(comp.code, comp.abbr)) continue;

      const isDed = comp.component_type === "DEDUCTION";
      const colKey = `custom_${isDed ? "ded" : "earn"}_${comp.code}`;
      const map = isDed ? deductionsMap : earningsMap;

      map.set(colKey, {
        key: colKey,
        code: comp.code,
        label: comp.abbr || comp.name || comp.code,
        fullLabel: comp.name || comp.code,
        group: isDed ? "Deductions" : "Earnings",
        isCustom: true,
        customType: isDed ? "DEDUCTION" : "EARNING",
        payout_frequency: comp.payout_frequency || "MONTHLY",
        payout_month: comp.payout_month || 3,
        width: 105,
      });
    }
  }

  // 2. Extract any dynamic components present in payroll records (both list & object schemas)
  for (const r of records) {
    const cc = r.custom_components;
    if (!cc || typeof cc !== "object") continue;

    // Standard list format: { earnings: [...], deductions: [...] }
    if (Array.isArray(cc.earnings)) {
      for (const item of cc.earnings) {
        if (!item || !item.code) continue;
        if (isMetadataCode(item.code, item.abbr)) continue;

        const existing = earningsMap.get(`custom_earn_${item.code}`);
        earningsMap.set(`custom_earn_${item.code}`, {
          key: `custom_earn_${item.code}`,
          code: item.code,
          label: item.abbr || item.name || item.code,
          fullLabel: item.name || item.code,
          group: "Earnings",
          isCustom: true,
          customType: "EARNING",
          payout_frequency: item.payout_frequency || existing?.payout_frequency || "MONTHLY",
          payout_month: item.payout_month || existing?.payout_month || 3,
          width: 105,
        });
      }
    }
    if (Array.isArray(cc.deductions)) {
      for (const item of cc.deductions) {
        if (!item || !item.code) continue;
        if (isMetadataCode(item.code, item.abbr)) continue;

        const existing = deductionsMap.get(`custom_ded_${item.code}`);
        deductionsMap.set(`custom_ded_${item.code}`, {
          key: `custom_ded_${item.code}`,
          code: item.code,
          label: item.abbr || item.name || item.code,
          fullLabel: item.name || item.code,
          group: "Deductions",
          isCustom: true,
          customType: "DEDUCTION",
          payout_frequency: item.payout_frequency || existing?.payout_frequency || "MONTHLY",
          payout_month: item.payout_month || existing?.payout_month || 3,
          width: 105,
        });
      }
    }
    // Key-value object format fallback
    for (const [k, v] of Object.entries(cc)) {
      const vAbbr = v && typeof v === "object" ? String(v.abbr || "").trim().toUpperCase() : "";
      if (k === "earnings" || k === "deductions" || k === "metadata" || isMetadataCode(k, vAbbr)) continue;
      if (v && typeof v === "object") {
        const isDed = v.component_type === "DEDUCTION" || v.type === "DEDUCTION";
        const map = isDed ? deductionsMap : earningsMap;
        const colKey = `custom_${isDed ? "ded" : "earn"}_${k}`;
        if (!map.has(colKey)) {
          map.set(colKey, {
            key: colKey,
            code: k,
            label: v.abbr || v.name || k,
            fullLabel: v.name || k,
            group: isDed ? "Deductions" : "Earnings",
            isCustom: true,
            customType: isDed ? "DEDUCTION" : "EARNING",
            width: 105,
          });
        }
      }
    }
  }

  return {
    customEarnings: Array.from(earningsMap.values()),
    customDeductions: Array.from(deductionsMap.values()),
  };
}

export function getRecordCustomValue(r, col) {
  if (!r?.custom_components) return 0;
  const cc = r.custom_components;
  const targetCode = col.code || (typeof col.key === "string" ? col.key.replace(/^custom_(earn|ded)_/, "") : "");
  const targetUpper = String(targetCode || "").trim().toUpperCase();

  if (col.customType === "DEDUCTION" && Array.isArray(cc.deductions)) {
    const found = cc.deductions.find((d) => {
      const dCode = String(d.code || "").trim().toUpperCase();
      const dAbbr = String(d.abbr || "").trim().toUpperCase();
      return dCode === targetUpper || dAbbr === targetUpper;
    });
    if (found) return found.amount || 0;
  }
  if (col.customType === "EARNING" && Array.isArray(cc.earnings)) {
    const found = cc.earnings.find((e) => {
      const eCode = String(e.code || "").trim().toUpperCase();
      const eAbbr = String(e.abbr || "").trim().toUpperCase();
      return eCode === targetUpper || eAbbr === targetUpper;
    });
    if (found) return found.amount || 0;
  }
  if (cc[targetCode]) {
    return cc[targetCode].amount ?? cc[targetCode] ?? 0;
  }
  for (const [k, v] of Object.entries(cc)) {
    if (k.toUpperCase() === targetUpper && k !== "earnings" && k !== "deductions") {
      return v?.amount ?? v ?? 0;
    }
  }
  return 0;
}

const fmt = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n || 0));
const fmtCurrency = (n) => `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))}`;

let _editableUid = 0;
function Editable({
  record,
  field,
  customCol,
  valueOverride,
  editing,
  setEditing,
  save,
  money,
  locked,
  readOnly,
  accentBg,
  accentColor,
  editableHighlight,
}) {
  const [uid] = useState(() => ++_editableUid);
  const active = !locked && !readOnly && editing?.uid === uid && editing?.id === record?.id && editing?.field === field;
  const currentVal = valueOverride !== undefined ? valueOverride : (customCol ? getRecordCustomValue(record, customCol) : record?.[field]);

  if (active) {
    return (
      <input
        autoFocus
        type="number"
        defaultValue={currentVal}
        onBlur={(e) => save(record, field, e.target.value, customCol)}
        onKeyDown={(e) => e.key === "Enter" && save(record, field, e.currentTarget.value, customCol)}
        onWheel={(e) => e.currentTarget.blur()}
        style={{
          width: 88,
          height: 28,
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: 12,
          border: "2px solid #0284c7",
          background: "#ffffff",
          outline: "none",
          fontWeight: 700,
          color: "#0f172a",
          boxShadow: "0 0 0 2px rgba(2, 132, 199, 0.2)",
        }}
      />
    );
  }

  if (locked || readOnly) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px",
          borderRadius: 4,
          background: accentBg || "transparent",
          color: accentColor || "#475569",
          fontSize: 12,
          fontWeight: 600,
        }}
        title={readOnly ? "Computed automatically" : "Locked"}
      >
        {readOnly && <Lock size={10} style={{ opacity: 0.6 }} />}
        {money ? formatCurrency(currentVal) : (currentVal ?? "—")}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing({ id: record.id, field, uid });
      }}
      style={{
        padding: "2px 6px",
        borderRadius: 4,
        background: editableHighlight ? "#eff6ff" : (accentBg || "transparent"),
        color: accentColor || (editableHighlight ? "#1d4ed8" : "#0f172a"),
        fontSize: 12,
        fontWeight: 600,
        border: editableHighlight ? "1px dashed #60a5fa" : "1px dashed transparent",
        cursor: "pointer",
        textAlign: "right",
        transition: "all 0.15s ease",
      }}
      title="Click to edit value"
      onMouseEnter={(e) => {
        e.currentTarget.style.border = "1px dashed #0284c7";
        e.currentTarget.style.background = "#e0f2fe";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = editableHighlight ? "1px dashed #60a5fa" : "1px dashed transparent";
        e.currentTarget.style.background = editableHighlight ? "#eff6ff" : (accentBg || "transparent");
      }}
    >
      {money ? formatCurrency(currentVal) : (currentVal ?? "—")}
    </button>
  );
}

function StatChip({ icon: Icon, label, value, subtext, color, active, onClick }) {
  const colorMap = {
    blue: {
      active: "bg-blue-50 border-blue-400 ring-1 ring-blue-300",
      icon: "bg-blue-50 border-blue-200 text-blue-600",
      text: "text-blue-700",
    },
    purple: {
      active: "bg-purple-50 border-purple-400 ring-1 ring-purple-300",
      icon: "bg-purple-50 border-purple-200 text-purple-600",
      text: "text-purple-700",
    },
    green: {
      active: "bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300",
      icon: "bg-emerald-50 border-emerald-200 text-emerald-600",
      text: "text-emerald-700",
    },
    amber: {
      active: "bg-amber-50 border-amber-400 ring-1 ring-amber-300",
      icon: "bg-amber-50 border-amber-200 text-amber-600",
      text: "text-amber-700",
    },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border transition-all ${active
        ? `${c.active} border-2`
        : "bg-white border-slate-200 hover:border-slate-300"
        } ${onClick ? "cursor-pointer" : "default"}`}
    >
      {Icon && (
        <span className={`flex items-center justify-center w-8 h-8 rounded-md border shrink-0 ${c.icon}`}>
          <Icon size={16} />
        </span>
      )}
      <div className="min-w-0 leading-tight">
        <div className="text-[10.5px] font-bold uppercase text-slate-500">
          {label}
        </div>
        <div className={`text-[13.5px] font-extrabold mt-0.5 ${c.text}`}>
          {value}
        </div>
        {subtext && (
          <div className="text-[10px] text-slate-400 font-medium mt-0.5">
            {subtext}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoLine({ label, value, icon: Icon, color = "#0284c7" }) {
  return (
    <div className="flex items-center justify-between text-[12.5px] py-1">
      <span className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon size={13} style={{ color }} />}
        {label}
      </span>
      <span className="font-semibold text-slate-900">{value ?? "—"}</span>
    </div>
  );
}

function ClosingBalanceRow({ label = "Closing Balance", value, color = "#0284c7", bg = "#eff6ff", border = "#bfdbfe", isHighlighted = false }) {
  return (
    <div
      style={{
        background: isHighlighted ? "#f0fdf4" : bg,
        borderColor: isHighlighted ? "#86efac" : border,
      }}
      className={`mt-2 flex items-center justify-between rounded-md px-2.5 py-2 border transition-all duration-300 ${isHighlighted ? "ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.35)] animate-pulse" : ""
        }`}
    >
      <span style={{ color: isHighlighted ? "#166534" : color }} className="text-xs font-bold">
        {isHighlighted ? `✨ ${label} (Updated)` : label}
      </span>
      <span style={{ color: isHighlighted ? "#15803d" : color }} className="text-[13px] font-extrabold">
        {value ?? "—"}
      </span>
    </div>
  );
}

function ledgerChipDefs(record, clientDetails = {}) {
  if (!record) return [];
  const compOffBalance = record.comp_off_closing_balance ?? 0;
  const leaveBalance = record.leave_closing_balance ?? 0;
  const advanceRaw = Number(record.salary_advance_closing_balance ?? 0);
  const onHoldRaw = Number(record.on_hold_closing_balance ?? 0);
  const advanceBalance = Math.max(0, Math.abs(advanceRaw));
  const onHoldBalance = Math.max(0, Math.abs(onHoldRaw));
  let chips = [
    { key: "comp_off", label: "Comp-Off", icon: Clock, badge: `${compOffBalance} Days`, color: "blue", highlight: compOffBalance > 0 },
    { key: "leave", label: "Leave", icon: CalendarClock, badge: `${leaveBalance} Days`, color: "purple", highlight: leaveBalance > 0 },
    {
      key: "salary_advance",
      label: "Advance",
      icon: Wallet,
      badge: formatCurrency(advanceBalance),
      subtext: advanceBalance > 0 ? "Remaining Debt" : "Cleared",
      color: "green",
      highlight: advanceBalance > 0,
    },
    {
      key: "on_hold",
      label: "On-Hold",
      icon: Lock,
      badge: formatCurrency(onHoldBalance),
      subtext: onHoldBalance > 0 ? "Held in Trust" : "None Held",
      color: "amber",
      highlight: onHoldBalance > 0,
    },
  ];
  if (record.is_probation) {
    chips = chips.filter((c) => c.key !== "comp_off" && c.key !== "leave");
  }
  if (clientDetails?.track_comp_off === false) {
    chips = chips.filter((c) => c.key !== "comp_off");
  }
  if (clientDetails?.track_leave_ledger === false) {
    chips = chips.filter((c) => c.key !== "leave");
  }
  return chips;
}

function BreakdownPanel({
  title,
  record,
  fields,
  deduction,
  editing,
  setEditing,
  saveCell,
  locked,
  editMode,
}) {
  const [showAll, setShowAll] = useState(false);
  const getFieldValue = (f) => {
    if (f.customCol) {
      return getRecordCustomValue(record, f.customCol);
    }
    return record?.[f.key] ?? 0;
  };

  const visibleFields = fields.filter(
    (f) => showAll || f.alwaysShow || Number(getFieldValue(f)) !== 0
  );
  const hiddenCount = fields.length - visibleFields.length;
  const accentBorder = deduction ? "border-red-200" : "border-blue-200";
  const accentText = deduction ? "text-red-700" : "text-blue-700";
  const accentBg = deduction ? "bg-red-50" : "bg-blue-50";
  const accentBadgeBorder = deduction ? "border-red-300" : "border-blue-300";

  return (
    <div className={`rounded-xl p-3.5 bg-white border ${accentBorder} shadow-sm`}>
      <div className="flex items-center justify-between mb-2.5">
        <span className={`flex items-center gap-1.5 text-xs font-extrabold uppercase ${accentText}`}>
          {deduction ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
          {title}
        </span>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={`text-[11px] font-semibold px-2 py-0.5 rounded border cursor-pointer hover:opacity-80 transition-opacity ${accentBadgeBorder} ${accentBg} ${accentText}`}
          >
            {showAll ? "Hide zero" : `Show all (${hiddenCount})`}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {visibleFields.map((f) => {
          const { key, label, readOnly, customCol } = f;
          const isTotal = key === "earned_salary" || key === "total_deductions";
          const fieldVal = getFieldValue(f);
          return (
            <div
              key={key}
              className={`flex items-center justify-between transition-colors ${isTotal
                ? `px-2 py-1.5 rounded-md mt-1 border-t-[1.5px] ${accentBg} ${accentBorder}`
                : "py-0.5"
                }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`text-xs truncate ${isTotal ? `font-bold ${accentText}` : "font-medium text-slate-600"
                    }`}
                >
                  {label}
                </span>
                {(() => {
                  const contractedMap = {
                    basic_da: record?.contracted_basic_da,
                    hra: record?.contracted_hra,
                    lta: record?.contracted_lta,
                    special_allowance: record?.contracted_special_allowance,
                  };
                  const baseVal = contractedMap[key];
                  if (baseVal !== undefined && Number(baseVal) > 0) {
                    return (
                      <span className="text-[10px] text-slate-400 font-mono font-normal shrink-0" title={`Contracted baseline: ₹${Number(baseVal).toLocaleString()}`}>
                        (Base ₹{Number(baseVal).toLocaleString()})
                      </span>
                    );
                  }
                  return null;
                })()}
                {customCol && record?.custom_components && (() => {
                  const list = customCol.type === "DEDUCTION" ? record.custom_components.deductions : record.custom_components.earnings;
                  const entry = (list || []).find((c) => c.code === customCol.code || c.abbr === customCol.code);
                  const src = entry?.source;
                  if (src === "MANUAL_DRAWER_EDIT") {
                    return (
                      <span className="px-1 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800" title="Manually edited in drawer">
                        ✏️ Edited
                      </span>
                    );
                  }
                  if (src === "MONTHLY_INPUT" || src === "EXCEL_UPLOAD") {
                    return (
                      <span className="px-1 py-0.2 rounded text-[9.5px] font-bold bg-purple-100 text-purple-800" title="Imported from monthly inputs / Excel">
                        📊 Uploaded
                      </span>
                    );
                  }
                  return (
                    <span className="px-1 py-0.2 rounded text-[9.5px] font-normal bg-slate-100 text-slate-600" title="From employee contracted baseline">
                      📜 Baseline
                    </span>
                  );
                })()}
              </div>
              <Editable
                record={record}
                field={key}
                customCol={customCol}
                valueOverride={fieldVal}
                editing={editing}
                setEditing={setEditing}
                save={(rec, fld, val) => saveCell(rec, fld, val, customCol)}
                money
                locked={locked || readOnly || !editMode}
                readOnly={readOnly}
                accentColor={isTotal ? (deduction ? "#b91c1c" : "#1d4ed8") : undefined}
                editableHighlight={editMode && !readOnly && !locked}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useEditHistory(recordId) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!recordId) {
      setData(null);
      return;
    }
    let cancelled = false;
    api
      .get(apiPath(`records/${recordId}/edit-history/`))
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);
  return { data };
}

function EditHistoryDrawer({ record, onClose, changes = [] }) {
  const { data } = useEditHistory(record?.id);
  const edits = unwrapList(data);
  return (
    <div className="fixed inset-0 z-[1400] flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-[440px] bg-white h-full p-6 overflow-y-auto shadow-[-8px_0_25px_rgba(0,0,0,0.15)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[11px] font-bold uppercase text-sky-600">
              Edit History Audit
            </div>
            <h3 className="text-base font-extrabold m-0 text-slate-900 mt-0.5">
              {record?.employee_name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-300 text-xs font-semibold cursor-pointer hover:bg-slate-200 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Staged Adjustments from Portal / Excel */}
        {(() => {
          const stagedChanges = changes.filter((item) => item.source !== "manual_edit");
          if (stagedChanges.length === 0) return null;
          return (
            <div className="mb-4.5 bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="text-[11px] font-bold text-purple-800 uppercase mb-1.5">
                STAGED ADJUSTMENTS FOR THIS EMPLOYEE ({stagedChanges.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {stagedChanges.map((item) => {
                  const isExcel = item.source === "excel_merge" || item.item_type === "EXCEL_MERGED";
                  return (
                    <div key={item.id} className="text-xs text-slate-700">
                      • <strong>{isExcel ? "Attendance & Salary Revision:" : `${item.item_type.replace(/_/g, " ")}:`}</strong>{" "}
                      {item.payload?.amount ? `₹${fmt(item.payload.amount)} ` : ""}
                      {item.payload?.description || item.payload?.reason || ""}
                      <span className="text-[10.5px] text-purple-700 font-bold ml-1.5">
                        ({item.status})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">
          MANUAL CELL REVISIONS ({edits.length})
        </div>

        <div className="flex flex-col gap-2.5">
          {edits.length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center mt-3">No cell edits recorded yet.</p>
          ) : (
            edits.map((edit) => (
              <div
                key={edit.id}
                className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200"
              >
                <div className="flex justify-between text-[12.5px]">
                  <strong className="text-slate-900">{edit.field_name.replace(/_/g, " ")}</strong>
                  <span className="text-slate-500">{edit.old_value} → {edit.new_value}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {edit.edited_by_display} · {formatDateTime(edit.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}



// Configuration map for all workflow transition dialogs
const WORKFLOW_DIALOGS = {
  submit_review: {
    title: "📤 Submit for Review",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • ${job?.period || `${job?.month_name || ""} ${job?.year || ""}`.trim()}`,
    theme: { bg: "#eff6ff", border: "#bfdbfe", titleColor: "#1e3a8a", btnBg: "#2563eb" },
    confirmText: "📤 Submit for Review",
    loadingText: "Submitting…",
    showPill: true,
    showZeroGrossCheck: true,
    prompt: "Submit this payroll batch to the Checker for review?",
    notesLabel: "📝 Remarks (Optional)",
    notesPlaceholder: "Optional notes for Checker...",
    action: "submit_for_review",
    defaultNotes: "Submitted directly from Batch Review workbench.",
  },
  send_to_approver: {
    title: "👔 Send to Approver",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • 👑 Leadership sign-off`,
    theme: { bg: "#f8fafc", border: "#e2e8f0", titleColor: "#0f172a", btnBg: "#1e3a5f" },
    confirmText: "👔 Send to Approver",
    loadingText: "Sending…",
    prompt: "Forward this payroll batch to Admin / Founder for sign-off?",
    action: "send_to_approver",
  },
  skip_approval: {
    title: "⚡ Skip Approval",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • 🔓 Direct Finalization`,
    theme: { bg: "#fffbeb", border: "#fde68a", titleColor: "#92400e", btnBg: "#d97706" },
    confirmText: "⚡ Skip & Unlock",
    loadingText: "Skipping…",
    prompt: "Bypass leadership sign-off and unlock finalization immediately?",
    action: "approver_skip",
  },
  revert_to_maker: {
    title: "↩️ Rework",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • Return batch to Maker for corrections`,
    theme: { bg: "#fff1f2", border: "#fee2e2", titleColor: "#991b1b", btnBg: "#b91c1c" },
    confirmText: "↩️ Return to Rework",
    loadingText: "Reverting…",
    prompt: "Return this payroll batch to the Maker for revisions? The status will revert to Rework, unlocking employee calculations and attendance adjustments for the Maker.",
    requireNotes: true,
    notesLabel: "📝 Audit Remarks *",
    notesPlaceholder: "Describe adjustments required by the Maker...",
    action: "rework",
    navigateAway: true,
    onSuccess: ({ navigate, id, setWorkflowSuccessData }) => {
      if (setWorkflowSuccessData) {
        setWorkflowSuccessData({
          type: "success",
          title: "↩️ Batch Returned to Rework",
          subtitle: "Status changed to Rework",
          message: "Job returned to Maker in Rework status. Maker now has full access to update figures.",
          primaryText: "Go to Job Overview",
          onPrimary: () => navigate(`/payroll/jobs/${id}`),
        });
      } else {
        navigate(`/payroll/jobs/${id}`);
      }
    },
  },
  approve_batch: {
    title: "✅ Approve Batch",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • 👑 Leadership sign-off`,
    theme: { bg: "#f0fdf4", border: "#bbf7d0", titleColor: "#166534", btnBg: "#059669" },
    confirmText: "✅ Approve Batch",
    loadingText: "Approving…",
    showPill: true,
    prompt: "Approve this payroll batch? This will unlock finalization and payslip distribution.",
    action: "approver_approve",
  },
  reject_batch: {
    title: "🛑 Reject Batch",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • 🔄 Return to Maker for corrections`,
    theme: { bg: "#fff1f2", border: "#fee2e2", titleColor: "#9f1239", btnBg: "#b91c1c" },
    confirmText: "🛑 Reject Batch",
    loadingText: "Rejecting…",
    requireNotes: true,
    notesLabel: "📝 Rejection Remarks *",
    notesPlaceholder: "Describe corrections required by Maker...",
    action: "approver_reject",
  },
  finalize_skip_emails: {
    title: "📁 Mark Done (Skip Emailing)",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • Seal batch without sending emails`,
    theme: { bg: "#f0fdf4", border: "#bbf7d0", titleColor: "#166534", btnBg: "#15803d" },
    confirmText: "📁 Mark Done",
    loadingText: "Sealing…",
    showPill: true,
    prompt: "Approve and seal this payroll batch as Done? Payslip PDFs will be updated without dispatching bulk emails.",
    endpoint: (id) => `/payroll/jobs/${id}/finalize-and-send/`,
    getPayload: () => ({ send_emails: false }),
    successMessage: "Payroll sealed as Done (emails skipped)!",
  },
  finalize_and_send: {
    title: "🚀 Finalize & Send Emails",
    subtitle: (job, { unsentCount = 0 } = {}) =>
      unsentCount > 0
        ? `${job?.client_name || job?.client_company_name || "Client"} • ${unsentCount} unsent payslip email${unsentCount === 1 ? "" : "s"} ready for dispatch`
        : `${job?.client_name || job?.client_company_name || "Client"} • All payslips delivered • Direct seal`,
    theme: { bg: "#eff6ff", border: "#bfdbfe", titleColor: "#1e3a8a", btnBg: "#2563eb" },
    confirmText: "🚀 Finalize & Send",
    loadingText: "Finalizing…",
    showPill: true,
    showMissingEmailCheck: true,
    prompt: (job, { unsentCount = 0 } = {}) =>
      unsentCount > 0
        ? `Approve and finalize this monthly payroll? This will seal the batch, update payslip PDFs, and email ${unsentCount} unsent payslip${unsentCount > 1 ? "s" : ""} to employees. The job will be stamped as Done once all emails are successfully delivered.`
        : "All employee payslips have already been delivered! Approve and seal this payroll batch as Done without re-sending emails?",
    endpoint: (id) => `/payroll/jobs/${id}/finalize-and-send/`,
    getPayload: (extra) => ({ send_emails: (extra?.unsentCount ?? 0) > 0 }),
    successMessage: "Payroll finalized and payslips dispatched successfully!",
  },
  reopen_batch: {
    title: "🔓 Reopen Batch",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • Admin / Founder disaster recovery`,
    theme: { bg: "#fffbeb", border: "#fde68a", titleColor: "#92400e", btnBg: "#b45309" },
    confirmText: "🔓 Reopen Batch",
    loadingText: "Reopening…",
    requireNotes: true,
    notesLabel: "📝 Reason for Reopening *",
    notesPlaceholder: "Explain why this finalized batch is being reopened...",
    endpoint: (id) => `/payroll/jobs/${id}/reopen/`,
    getPayload: (extra, notes) => ({ notes }),
    successMessage: "Payroll job reopened successfully and returned to In Progress.",
  },
  reset_batch: {
    title: "⚠️ Reset Batch & Start Fresh?",
    subtitle: (job) => `${job?.client_name || job?.client_company_name || "Client"} • Purge changes & restore clean master`,
    theme: { bg: "#fff1f2", border: "#fee2e2", titleColor: "#991b1b", btnBg: "#be123c" },
    confirmText: "⚠️ Reset Batch",
    loadingText: "Resetting…",
    maxWidth: 500,
    prompt: "If there were errors in uploaded spreadsheets or key-ins, this will clear all changes and allow you to start completely fresh:",
    bulletPoints: [
      "Purges all Multi-Sheet Excel inputs and manual monthly key-in adjustments.",
      "Reverts client portal submissions back to Pending (for clean re-review).",
      "Deletes all manual cell edits & attendance merge logs from batch audit trail.",
      "Clears prior email logs & delivery records so payslips can be cleanly re-sent.",
      "Recalculates every employee payslip cleanly from base salary structure.",
    ],
    warningBanner: "⚠️ This action cannot be undone. Are you sure you wish to proceed?",
    endpoint: (id) => `/payroll/jobs/${id}/reset-batch/`,
    getPayload: () => ({}),
    successMessage: "Batch successfully reset to clean master calculations!",
    onSuccess: ({ setChangesModalOpen }) => {
      if (setChangesModalOpen) setChangesModalOpen(false);
    },
  },
};


// ── Hotspot 4: Grid Row Memoization & Pure Value Checkers ────────────────────────
export const isZeroValue = (val) => {
  if (val === null || val === undefined || val === "" || val === 0 || val === "0" || val === "0.00") return true;
  if (React.isValidElement(val)) return false;
  if (typeof val === "number" && (val === 0 || Number.isNaN(val))) return true;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.includes("/")) return false; // Preserve ratios like "26/30"
    const cleaned = trimmed.replace(/[,₹]/g, "").trim();
    const num = Number(cleaned);
    return !isNaN(num) && num === 0;
  }
  return false;
};

function areBatchRowPropsEqual(prev, next) {
  if (prev.record !== next.record) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.idx !== next.idx) return false;
  if (prev.isSendingEmail !== next.isSendingEmail) return false;
  if (prev.empChanges !== next.empChanges) return false;
  if (prev.empChangedSet !== next.empChangedSet) return false;
  if (prev.isColVisible !== next.isColVisible) return false;
  if (prev.showActionsColumn !== next.showActionsColumn) return false;
  if (prev.canSendPayslip !== next.canSendPayslip) return false;
  if (prev.isChecker !== next.isChecker) return false;
  if (prev.customEarnings !== next.customEarnings) return false;
  if (prev.customDeductions !== next.customDeductions) return false;
  if (prev.currentMonth !== next.currentMonth) return false;
  if (prev.job?.month !== next.job?.month || prev.job?.year !== next.job?.year) return false;
  return true;
}

const BatchRegisterRow = React.memo(({
  record: r,
  idx,
  isSelected,
  empChanges,
  empChangedSet,
  isColVisible,
  fmt,
  customEarnings,
  customDeductions,
  getRecordCustomValue,
  currentMonth,
  job,
  showActionsColumn,
  canSendPayslip,
  isChecker,
  isSendingEmail,
  onSelectRecord,
  onOpenHistoryRecord,
  onRequestSendSingleEmail,
  onDownloadPDF,
}) => {
  const empStaged = empChanges.filter((item) => item.source !== "manual_edit");
  const totalChanges = empStaged.length + (r.edit_count || 0);
  const hasChanges = totalChanges > 0;
  const joinChange = empChanges.find((c) => (c.item_type || "").toUpperCase() === "NEW_EMPLOYEE");
  const isNewJoiner = Boolean(joinChange);
  const exitChange = empChanges.find((c) => (c.item_type || "").toUpperCase() === "EXIT");
  const isResigned = Boolean(exitChange);
  const pendingAdjustments = empStaged.filter((item) => String(item.status || "").toUpperCase() === "PENDING");
  const rowBg = isSelected ? "#eff6ff" : (hasChanges ? "#fdfaff" : "#ffffff");

  const renderCell = (_record, fieldName, value, extra = {}) => {
    const isChanged = empChangedSet ? empChangedSet.has(fieldName.toLowerCase()) : false;
    const isZero = isZeroValue(value);
    const label = fieldName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const isAttendance = ["extra_working_days", "lop_days", "paid_leave_days", "actual_working_days"].includes(fieldName);

    const effectiveChanged = isChanged && (!isZero || isAttendance);
    const displayVal = (!effectiveChanged && isZero) ? "" : value;

    let tooltipTitle = undefined;
    if (effectiveChanged) {
      tooltipTitle = isAttendance
        ? `Modified: ${label} (${r[fieldName] ?? 0} days)`
        : `Modified: ${label} (₹${r[fieldName] ?? 0})`;
    } else if (isZero) {
      tooltipTitle = isAttendance
        ? `${label}: 0 days`
        : `${label}: ₹0.00`;
    }

    return (
      <td
        key={fieldName}
        style={{
          padding: extra.padding || "8px 12px",
          textAlign: extra.align || "right",
          whiteSpace: "nowrap",
          borderRight: "1px solid #e2e8f0",
          borderBottom: "1px solid #e2e8f0",
          background: effectiveChanged ? "#fef3c7" : "inherit",
          color: effectiveChanged ? "#92400e" : (extra.color || "#0f172a"),
          fontWeight: effectiveChanged ? 700 : (extra.fontWeight || 400),
          fontFamily: extra.fontFamily || (extra.align === "center" ? "inherit" : "monospace"),
          ...extra.style,
        }}
        title={tooltipTitle}
      >
        {displayVal}
      </td>
    );
  };

  return (
    <tr
      key={r.id}
      onClick={() => onSelectRecord(r)}
      style={{
        cursor: "pointer",
        background: rowBg,
      }}
      className={`group transition-colors ${isSelected ? "bg-blue-50" : (hasChanges ? "bg-[#fdfaff] hover:bg-slate-50" : "bg-white hover:bg-slate-50")
        }`}
    >
      {/* Sticky Left Identity Columns */}
      <td style={{
        padding: "8px 8px", color: "#94a3b8", fontWeight: 600,
        width: 48, minWidth: 48, maxWidth: 48, boxSizing: "border-box", textAlign: "center",
        position: "sticky", left: 0,
        background: rowBg,
        zIndex: 2,
        borderRight: "1px solid #e2e8f0",
        borderBottom: "1px solid #e2e8f0",
        whiteSpace: "nowrap",
      }}>
        {idx + 1}
      </td>
      <td style={{
        padding: "8px 12px",
        position: "sticky", left: 48,
        width: 200, minWidth: 200, maxWidth: 200, boxSizing: "border-box",
        background: rowBg,
        zIndex: 2,
        boxShadow: "2px 0 4px rgba(0,0,0,0.04)",
        borderRight: "1px solid #e2e8f0",
        borderBottom: "1px solid #e2e8f0",
        whiteSpace: "nowrap",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%", minWidth: 0 }}>
          {/* Line 1: Employee Name (Left) + Email Delivery Pill (Right) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, minWidth: 0, width: "100%" }}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: "#0f172a",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
                title={r.employee_name}
              >
                {r.employee_name}
              </span>
              {(r.is_intern || r.employment_type === "INTERN" || /intern|apprentice|trainee/i.test(r.employee_designation || "") || joinChange?.payload?.employment_type === "INTERN" || joinChange?.payload?.is_intern) && (
                <span
                  title="Intern / Apprentice receiving a monthly stipend (Exempt from PF/ESI)"
                  className="text-[9.5px] font-bold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap"
                >
                  🎓 Intern
                </span>
              )}
            </div>
            {r.status === "EMAIL_SENT" && (
              <span
                title="Payslip email delivered"
                className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap"
              >
                ✉️ Sent
              </span>
            )}
            {r.status === "EMAIL_FAILED" && (
              <span
                onClick={isChecker ? ((e) => {
                  e.stopPropagation();
                  onRequestSendSingleEmail(r);
                }) : undefined}
                title={isChecker ? "Email delivery failed. Click to retry dispatching to this employee" : "Email delivery failed"}
                className={`text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap ${isChecker ? "cursor-pointer hover:bg-amber-200" : "default"
                  }`}
              >
                {isChecker ? "⚠️ Failed" : "⚠️ Failed"}
              </span>
            )}
          </div>

          {/* Line 2: Employee Code (Left) + Lifecycle Badge / Pending Badge (Right) */}
          <div className="flex items-center justify-between gap-1.5 min-w-0 w-full h-[18px]">
            <span className="text-[11px] text-slate-500 font-mono font-semibold shrink-0 whitespace-nowrap">
              ({r.employee_code})
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {pendingAdjustments.length > 0 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenHistoryRecord(r);
                  }}
                  title={`${pendingAdjustments.length} staged adjustment(s) pending approval. Click to view.`}
                  className="text-[9.5px] font-bold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-px rounded tracking-wide shrink-0 whitespace-nowrap cursor-pointer hover:bg-purple-100"
                >
                  ⏳ {pendingAdjustments.length} Pending
                </span>
              )}
              {isNewJoiner && (
                <span
                  title="New joiner added in this payroll period"
                  className="text-[9.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-px rounded tracking-wide shrink-0 whitespace-nowrap"
                >
                  ✨ New
                </span>
              )}
              {isResigned && (
                <span
                  title="Exit / Resignation recorded for this employee"
                  className="text-[9.5px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-px rounded tracking-wide shrink-0 whitespace-nowrap"
                >
                  🚪 Exit
                </span>
              )}
              {(r.employment_type === "CONSULTANT" || joinChange?.payload?.employment_type === "CONSULTANT") && (
                <span
                  title="Consultant / Retainer (Professional Fees)"
                  className="text-[9.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-px rounded tracking-wide shrink-0 whitespace-nowrap"
                >
                  🤝 Consultant
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* ── CTC & Retirals Waterfall Group ── */}
      {isColVisible("ctc_annual") && renderCell(
        r,
        "ctc_annual",
        Number(r.ctc_annual || 0) > 0 ? fmt(r.ctc_annual) : "—",
        { fontWeight: 700, color: "#0f172a" }
      )}
      {isColVisible("monthly_ctc") && renderCell(
        r,
        "monthly_ctc",
        Number(r.monthly_ctc || 0) > 0 ? fmt(r.monthly_ctc) : (Number(r.ctc_annual || 0) > 0 ? fmt(Number(r.ctc_annual) / 12) : "—"),
        { color: "#334155" }
      )}
      {isColVisible("employer_pf_carveout") && renderCell(
        r,
        "employer_pf_carveout",
        (() => {
          const val = Number(r.employer_pf_carveout || (r.employer_pf_in_ctc !== false ? r.employer_pf : 0) || 0);
          if (val > 0) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span>{fmt(val)}</span>
                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200" title="Employer PF carved out from CTC pool">
                  Carved
                </span>
              </div>
            );
          }
          return <span className="text-slate-400" title={r.employer_pf_in_ctc === false ? "Employer PF paid on top (not carved from CTC)" : "Zero / Exempt"}>—</span>;
        })(),
        { color: "#b45309" }
      )}
      {isColVisible("employer_esi_carveout") && renderCell(
        r,
        "employer_esi_carveout",
        (() => {
          const val = Number(r.employer_esi_carveout || (r.employer_esi_in_ctc ? r.employer_esi : 0) || 0);
          if (val > 0) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span>{fmt(val)}</span>
                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200" title="Employer ESI carved out from CTC pool">
                  Carved
                </span>
              </div>
            );
          }
          return <span className="text-slate-400">—</span>;
        })(),
        { color: "#b45309" }
      )}
      {isColVisible("gratuity_carveout") && renderCell(
        r,
        "gratuity_carveout",
        (() => {
          const val = Number(r.gratuity_carveout || 0);
          if (val > 0) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span>{fmt(val)}</span>
                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200" title="Statutory Gratuity accrual carved out from CTC pool">
                  Carved
                </span>
              </div>
            );
          }
          return <span className="text-slate-400">—</span>;
        })(),
        { color: "#b45309" }
      )}
      {isColVisible("fbp_carveout") && renderCell(
        r,
        "fbp_carveout",
        (() => {
          const val = Number(r.fbp_carveout || 0);
          if (val > 0) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span>{fmt(val)}</span>
                <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1 py-0.2 rounded border border-indigo-200" title="Flexible Benefit Plan carved out upfront from CTC">
                  Carved
                </span>
              </div>
            );
          }
          return <span className="text-slate-400">—</span>;
        })(),
        { color: "#4338ca" }
      )}
      {isColVisible("custom_carveouts_total") && renderCell(
        r,
        "custom_carveouts_total",
        (() => {
          const val = Number(r.custom_carveouts_total || 0);
          if (val > 0) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span>{fmt(val)}</span>
                <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-1 py-0.2 rounded border border-purple-200" title="Carved non-cash / custom allowances">
                  Carved
                </span>
              </div>
            );
          }
          return <span className="text-slate-400">—</span>;
        })(),
        { color: "#7e22ce" }
      )}
      {isColVisible("contracted_monthly_gross") && renderCell(
        r,
        "contracted_monthly_gross",
        (() => {
          const mCtc = Number(r.monthly_ctc || (r.ctc_annual ? Number(r.ctc_annual) / 12 : 0) || 0);
          const pfCarve = Number(r.employer_pf_carveout || (r.employer_pf_in_ctc !== false ? r.employer_pf : 0) || 0);
          const esiCarve = Number(r.employer_esi_carveout || 0);
          const gratCarve = Number(r.gratuity_carveout || 0);
          const fbpCarve = Number(r.fbp_carveout || 0);
          const customCarve = Number(r.custom_carveouts_total || 0);
          const grossVal = Number(r.contracted_monthly_gross || r.gross_salary || 0);
          const totalCarved = pfCarve + esiCarve + gratCarve + fbpCarve + customCarve;

          const formulaTooltip = mCtc > 0
            ? `Waterfall: ₹${fmt(mCtc)} (Monthly CTC) - ₹${fmt(totalCarved)} (Total Carve-Outs) = ₹${fmt(grossVal)} (Base Gross)`
            : `Contracted Base Gross: ₹${fmt(grossVal)}`;

          return (
            <div className="flex items-center justify-end gap-1" title={formulaTooltip}>
              <span style={{ fontWeight: 700 }}>{fmt(grossVal)}</span>
              {totalCarved > 0 && (
                <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1 py-0.2 rounded border border-blue-200" title={formulaTooltip}>
                  Base
                </span>
              )}
            </div>
          );
        })(),
        { color: "#1d4ed8", fontWeight: 700 }
      )}

      {isColVisible("actual_working_days") && renderCell(
        r,
        "actual_working_days",
        (() => {
          const bMonth = Number(r.batch_month || job?.month || job?.batch_details?.month || 0);
          const bYear = Number(r.batch_year || job?.year || job?.batch_details?.year || 0);

          // Join Date detection (uses hoisted joinChange)
          const hireRaw = r.hire_date || r.employee_hire_date || r.raw_row_data?.hire_date || r.raw_row_data?.doj || r.raw_row_data?.date_of_joining || joinChange?.payload?.hire_date;
          let joinDay = null;
          if (hireRaw) {
            const hd = new Date(hireRaw);
            if (!isNaN(hd.getTime()) && (bMonth === 0 || hd.getMonth() + 1 === bMonth) && (bYear === 0 || hd.getFullYear() === bYear) && hd.getDate() > 1) {
              joinDay = hd.getDate();
            }
          }

          // Exit Date detection (uses hoisted exitChange)
          const exitRaw = r.last_working_date || r.raw_row_data?.last_working_date || r.raw_row_data?.lwd || r.raw_row_data?.exit_date || exitChange?.payload?.last_working_date;
          let exitDay = null;
          if (exitRaw) {
            const ed = new Date(exitRaw);
            if (!isNaN(ed.getTime()) && (bMonth === 0 || ed.getMonth() + 1 === bMonth) && (bYear === 0 || ed.getFullYear() === bYear)) {
              exitDay = ed.getDate();
            }
          }

          // Increment detection (synthetic structure blended mid-month)
          const isBlended = r.salary_structure_snapshot?.change_reason?.includes("Blended Mid-Month Rate");

          return (
            <div className="flex flex-col items-center justify-center">
              <span>
                <span style={{ fontWeight: 700 }}>{r.actual_working_days}</span>
                <span style={{ fontSize: 10, opacity: 0.65, fontWeight: 500 }}>/{r.days_in_month}</span>
              </span>
              {joinDay && (
                <span
                  className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1 py-0.5 rounded border border-blue-200 mt-0.5 whitespace-nowrap"
                  title={`Joined mid-month on day ${joinDay} (${r.actual_working_days}/${r.days_in_month} days)`}
                >
                  Joined D{joinDay}
                </span>
              )}
              {exitDay && (
                <span
                  className="text-[9px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded border border-rose-200 mt-0.5 whitespace-nowrap"
                  title={`Exited mid-month on day ${exitDay} (${r.actual_working_days}/${r.days_in_month} days)`}
                >
                  Exited D{exitDay}
                </span>
              )}
              {isBlended && (
                <span
                  className="text-[9px] font-bold text-purple-700 bg-purple-50 px-1 py-0.5 rounded border border-purple-200 mt-0.5 whitespace-nowrap"
                  title="Mid-Month Salary Increment Prorated"
                >
                  📈 Increment
                </span>
              )}
            </div>
          );
        })(),
        { align: "center", padding: "6px 4px" }
      )}
      {isColVisible("extra_working_days") && renderCell(r, "extra_working_days", r.extra_working_days || 0, { color: Number(r.extra_working_days) > 0 ? "#15803d" : "#64748b" })}
      {isColVisible("lop_days") && renderCell(r, "lop_days", r.lop_days || 0, { color: Number(r.lop_days) > 0 ? "#b91c1c" : "#64748b", fontWeight: Number(r.lop_days) > 0 ? 700 : 400 })}
      {isColVisible("paid_leave_days") && renderCell(r, "paid_leave_days", r.paid_leave_days || 0, { color: "#64748b" })}
      {isColVisible("basic_da") && renderCell(r, "basic_da", fmt(r.basic_da))}
      {isColVisible("hra") && renderCell(r, "hra", fmt(r.hra))}
      {isColVisible("lta") && renderCell(r, "lta", fmt(r.lta))}
      {isColVisible("special_allowance") && renderCell(r, "special_allowance", fmt(r.special_allowance))}
      {isColVisible("nps_allowance_earned") && renderCell(r, "nps_allowance_earned", fmt(r.nps_allowance_earned))}
      {isColVisible("fbp") && renderCell(
        r,
        "fbp",
        (() => {
          const fVal = Number(r.fbp || 0);
          const cVal = Number(r.contracted_fbp || 0);
          const tooltip = cVal > 0
            ? `Contracted: ₹${cVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} | Earned: ₹${fVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (Prorated for ${r.payment_days || 0}/${r.total_working_days || 30} days)`
            : `Flexible Benefit Plan: ₹${fVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
          return (
            <span title={tooltip} className={cVal > 0 ? "cursor-help" : ""}>
              {fmt(fVal)}
            </span>
          );
        })(),
        { color: Number(r.fbp || 0) > 0 ? "#4338ca" : undefined }
      )}
      {isColVisible("variable_pay") && renderCell(r, "variable_pay", fmt(r.variable_pay))}
      {isColVisible("commission_other") && renderCell(r, "commission_other", fmt(r.commission_other))}
      {isColVisible("arrears") && renderCell(r, "arrears", fmt(r.arrears))}
      {isColVisible("salary_advance_disbursed") && renderCell(r, "salary_advance_disbursed", fmt(r.salary_advance_disbursed))}
      {isColVisible("on_hold_released") && renderCell(r, "on_hold_released", fmt(r.on_hold_released))}
      {isColVisible("reimbursements") && renderCell(r, "reimbursements", fmt(r.reimbursements))}
      {customEarnings.map((col) => {
        if (!isColVisible(col.key)) return null;
        const val = getRecordCustomValue(r, col);
        const isAnnual = col.payout_frequency === "ANNUAL";
        const isPayoutMonth = isAnnual && currentMonth === Number(col.payout_month);
        const isMutedScheduled = isAnnual && !isPayoutMonth && Number(val || 0) === 0;

        const cellContent = (
          <div className="flex items-center justify-end gap-1">
            {isMutedScheduled ? (
              <span className="text-slate-400 text-[11px]" title={`Scheduled for Annual payout in Month ${col.payout_month}`}>—</span>
            ) : (
              <span>{fmt(val)}</span>
            )}
            {isPayoutMonth && Number(val || 0) > 0 && (
              <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded border border-emerald-300 whitespace-nowrap shadow-2xs" title="Annual Payout Month">
                🎁 Payout
              </span>
            )}
          </div>
        );
        return renderCell(r, col.key, cellContent, { color: isPayoutMonth ? "#047857" : "#0369a1", fontWeight: isPayoutMonth ? 700 : 400 });
      })}
      {isColVisible("earned_salary") && renderCell(r, "earned_salary", fmt(r.earned_salary), { color: "#1d4ed8", fontWeight: 700 })}
      {isColVisible("epf") && renderCell(r, "epf", fmt(r.epf))}
      {isColVisible("esi") && renderCell(r, "esi", fmt(r.esi))}
      {isColVisible("vpf") && renderCell(r, "vpf", fmt(r.vpf))}
      {isColVisible("professional_tax") && renderCell(r, "professional_tax", fmt(r.professional_tax))}
      {isColVisible("lwf") && renderCell(r, "lwf", fmt(r.lwf))}
      {isColVisible("tds") && renderCell(r, "tds", fmt(r.tds))}
      {isColVisible("nps_deduction") && renderCell(r, "nps_deduction", fmt(r.nps_deduction))}
      {isColVisible("loan_deduction") && renderCell(r, "loan_deduction", fmt(r.loan_deduction))}
      {isColVisible("salary_advance_recovered") && renderCell(r, "salary_advance_recovered", fmt(r.salary_advance_recovered))}
      {isColVisible("on_hold_deducted") && renderCell(r, "on_hold_deducted", fmt(r.on_hold_deducted))}
      {isColVisible("other_deduction") && renderCell(r, "other_deduction", fmt(r.other_deduction))}
      {customDeductions.map((col) =>
        isColVisible(col.key) &&
        renderCell(r, col.key, fmt(getRecordCustomValue(r, col)), { color: "#991b1b" })
      )}
      {isColVisible("total_deductions") && renderCell(r, "total_deductions", fmt(r.total_deductions), { color: "#b91c1c", fontWeight: 700 })}
      {isColVisible("net_salary") && renderCell(
        r,
        "net_salary",
        (() => {
          const isZeroNetCapped = Number(r.net_salary || 0) === 0 && Number(r.earned_salary || 0) > 0;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <span>{fmt(r.net_salary)}</span>
              {isZeroNetCapped && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap cursor-help shadow-sm"
                  title={`Zero Net Pay Guard: Advance deduction was capped to prevent negative pay. Unrecovered balance (₹${fmt(r.salary_advance_closing_balance)}) carries forward.`}
                >
                  ⚠️ Capped
                </span>
              )}
            </div>
          );
        })(),
        { color: Number(r.net_salary || 0) === 0 && Number(r.earned_salary || 0) > 0 ? "#b45309" : "#047857", fontWeight: 800 }
      )}
      {isColVisible("salary_advance_closing_balance") && renderCell(r, "salary_advance_closing_balance", fmt(Math.max(0, Math.abs(Number(r.salary_advance_closing_balance || 0)))), { color: "#d97706", fontWeight: 600 })}
      {isColVisible("on_hold_closing_balance") && renderCell(r, "on_hold_closing_balance", fmt(Math.max(0, Math.abs(Number(r.on_hold_closing_balance || 0)))), { color: "#7c3aed", fontWeight: 600 })}

      {/* Actions Column (Visible only to Checker when batch is Approved; strictly hidden once Done) */}
      {showActionsColumn && (
        <td
          className={`px-3 py-2 text-center whitespace-nowrap sticky right-0 w-[155px] min-w-[155px] max-w-[155px] box-border z-[2] shadow-[-2px_0_4px_rgba(0,0,0,0.04)] border-r border-b border-slate-200 ${isSelected ? "bg-blue-50" : (hasChanges ? "bg-[#fdfaff]" : "bg-white")
            }`}
        >
          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownloadPDF(r.id, r.employee_name);
              }}
              title="Download payslip PDF"
              className="bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-semibold cursor-pointer text-emerald-600 inline-flex items-center gap-1 hover:bg-emerald-50 hover:border-emerald-300 transition-colors"
            >
              <Download size={11} />
              <span>PDF</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRequestSendSingleEmail(r);
              }}
              disabled={isSendingEmail || !r.employee_email || !canSendPayslip}
              title={
                !canSendPayslip
                  ? "Only assigned Makers or Checkers can send payslips (View-Only)"
                  : r.employee_email
                    ? r.status === "EMAIL_FAILED"
                      ? `Retry failed payslip email to ${r.employee_email}`
                      : `Send payslip email to ${r.employee_email}`
                    : "No email address registered"
              }
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold inline-flex items-center gap-1 border transition-all ${r.status === "EMAIL_FAILED"
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "bg-white border-slate-300 text-blue-600 hover:bg-blue-50 hover:border-blue-300"
                } ${canSendPayslip && r.employee_email && !isSendingEmail
                  ? "cursor-pointer opacity-100"
                  : "cursor-not-allowed opacity-40 text-slate-400"
                }`}
            >
              <Mail size={11} />
              <span>{r.status === "EMAIL_FAILED" ? "Retry" : (r.status === "EMAIL_SENT" ? "Resend" : "Email")}</span>
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}, areBatchRowPropsEqual);

export function PayrollJobBatchReview({ jobId, embedded = false, onJobUpdated }) {
  const params = useParams();
  const id = jobId || params.id;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [job, setJob] = useState(null);
  const [records, setRecords] = useState([]);
  const [clientComponents, setClientComponents] = useState([]);
  const [changes, setChanges] = useState({ items: [], summary: { total: 0, pending: 0, applied: 0 } });
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  // Celery Live Background Email Queue Tracking (hoisted above layout hooks)
  const [celeryTracking, setCeleryTracking] = useState(null);

  // View switch & filters (defaulted permanently to detailed grid view)
  const [viewMode, setViewMode] = useState("detailed"); // "summary" | "detailed"
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // "all" | "changed" | "probation"
  const [sortField, setSortField] = useState("name"); // "name" | "code" | "net_salary" | "gross_salary"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" | "desc"
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [recentlyAdjustedLedger, setRecentlyAdjustedLedger] = useState(null);
  const [showAllUnfilteredCols, setShowAllUnfilteredCols] = useState(false);

  const currentMonth = Number(job?.month || job?.batch_details?.month || 0);

  // Dynamic custom columns extracted from payroll records AND client custom components catalog
  const { customEarnings, customDeductions } = useMemo(
    () => extractCustomColumns(records, clientComponents),
    [records, clientComponents]
  );

  const allColumns = useMemo(() => {
    let cols = [...REGISTER_COLUMNS];

    // If "Show All Unfiltered Columns" toggle is off, apply smart zero/configuration suppression
    if (!showAllUnfilteredCols) {
      // 1. Attendance Columns: hide if disabled for client OR zero across all records
      const trackCompOff = job?.client_details?.track_comp_off !== false && job?.client_details?.track_compoff !== false;
      const trackLeave = job?.client_details?.track_leave_ledger !== false && job?.client_details?.track_leave !== false;
      const hasExtraDays = Array.isArray(records) && records.some((r) => Number(r.extra_working_days || 0) > 0);
      const hasLeaveDays = Array.isArray(records) && records.some((r) => Number(r.paid_leave_days || 0) > 0);

      if (!trackCompOff || !hasExtraDays) {
        cols = cols.filter((c) => c.key !== "extra_working_days");
      }
      if (!trackLeave || !hasLeaveDays) {
        cols = cols.filter((c) => c.key !== "paid_leave_days");
      }

      // 2. Comprehensive Batch-Level and Client Configuration Zero-Suppression
      if (Array.isArray(records) && records.length > 0) {
        // CTC Carve-Outs
        const hasPfCarve = records.some((r) => Number(r.employer_pf_carveout || (r.employer_pf_in_ctc !== false ? r.employer_pf : 0) || 0) > 0);
        const hasEsiCarve = records.some((r) => Number(r.employer_esi_carveout || (r.employer_esi_in_ctc ? r.employer_esi : 0) || 0) > 0);
        const hasGratuityCarve = records.some((r) => Number(r.gratuity_carveout || 0) > 0);
        const hasFbpCarve = records.some((r) => Number(r.fbp_carveout || 0) > 0);
        const hasCustomCarve = records.some((r) => Number(r.custom_carveouts_total || 0) > 0);
        const clientPfOpted = job?.client_details?.pf_calculation_rule !== "NOT_OPTED" && job?.client_details?.employer_pf_in_ctc !== false;

        if (!hasPfCarve && !clientPfOpted) cols = cols.filter((c) => c.key !== "employer_pf_carveout");
        if (!hasEsiCarve) cols = cols.filter((c) => c.key !== "employer_esi_carveout");
        if (!hasGratuityCarve) cols = cols.filter((c) => c.key !== "gratuity_carveout");
        if (!hasFbpCarve) cols = cols.filter((c) => c.key !== "fbp_carveout");
        if (!hasCustomCarve) cols = cols.filter((c) => c.key !== "custom_carveouts_total");

        // Optional Earnings
        const hasLta = records.some((r) => Number(r.lta || 0) > 0);
        const hasNpsEarned = records.some((r) => Number(r.nps_allowance_earned || 0) > 0);
        const hasFbpEarned = records.some((r) => Number(r.fbp || 0) > 0 || Number(r.contracted_fbp || 0) > 0);
        const hasVariablePay = records.some((r) => Number(r.variable_pay || 0) > 0);
        const hasCommission = records.some((r) => Number(r.commission_other || 0) > 0);
        const hasArrears = records.some((r) => Number(r.arrears || 0) > 0);
        const hasAdvanceDisbursed = records.some((r) => Number(r.salary_advance_disbursed || 0) > 0);
        const hasOnHoldReleased = records.some((r) => Number(r.on_hold_released || 0) > 0);
        const hasReimbursements = records.some((r) => Number(r.reimbursements || 0) > 0);

        if (!hasLta) cols = cols.filter((c) => c.key !== "lta");
        if (!hasNpsEarned) cols = cols.filter((c) => c.key !== "nps_allowance_earned");
        if (!hasFbpEarned) cols = cols.filter((c) => c.key !== "fbp");
        if (!hasVariablePay) cols = cols.filter((c) => c.key !== "variable_pay");
        if (!hasCommission) cols = cols.filter((c) => c.key !== "commission_other");
        if (!hasArrears) cols = cols.filter((c) => c.key !== "arrears");
        if (!hasAdvanceDisbursed) cols = cols.filter((c) => c.key !== "salary_advance_disbursed");
        if (!hasOnHoldReleased) cols = cols.filter((c) => c.key !== "on_hold_released");
        if (!hasReimbursements) cols = cols.filter((c) => c.key !== "reimbursements");

        // Optional Deductions
        const hasEpf = records.some((r) => Number(r.epf || 0) > 0);
        const hasEsi = records.some((r) => Number(r.esi || 0) > 0);
        const hasVpf = records.some((r) => Number(r.vpf || 0) > 0);
        const hasPt = records.some((r) => Number(r.professional_tax || 0) > 0);
        const hasLwf = records.some((r) => Number(r.lwf || 0) > 0);
        const hasTds = records.some((r) => Number(r.tds || 0) > 0);
        const hasNpsDed = records.some((r) => Number(r.nps_deduction || 0) > 0);
        const hasLoanDed = records.some((r) => Number(r.loan_deduction || 0) > 0);
        const hasAdvanceRec = records.some((r) => Number(r.salary_advance_recovered || 0) > 0);
        const hasOnHoldDed = records.some((r) => Number(r.on_hold_deducted || 0) > 0);
        const hasOtherDed = records.some((r) => Number(r.other_deduction || 0) > 0);

        if (!hasEpf && !clientPfOpted) cols = cols.filter((c) => c.key !== "epf");
        if (!hasEsi) cols = cols.filter((c) => c.key !== "esi");
        if (!hasVpf) cols = cols.filter((c) => c.key !== "vpf");
        if (!hasPt) cols = cols.filter((c) => c.key !== "professional_tax");
        if (!hasLwf) cols = cols.filter((c) => c.key !== "lwf");
        if (!hasTds) cols = cols.filter((c) => c.key !== "tds");
        if (!hasNpsDed) cols = cols.filter((c) => c.key !== "nps_deduction");
        if (!hasLoanDed) cols = cols.filter((c) => c.key !== "loan_deduction");
        if (!hasAdvanceRec) cols = cols.filter((c) => c.key !== "salary_advance_recovered");
        if (!hasOnHoldDed) cols = cols.filter((c) => c.key !== "on_hold_deducted");
        if (!hasOtherDed) cols = cols.filter((c) => c.key !== "other_deduction");

        // Ledger Balances
        const hasAdvBalance = records.some((r) => Math.abs(Number(r.salary_advance_closing_balance || 0)) > 0);
        const hasHoldBalance = records.some((r) => Math.abs(Number(r.on_hold_closing_balance || 0)) > 0);

        if (!hasAdvBalance) cols = cols.filter((c) => c.key !== "salary_advance_closing_balance");
        if (!hasHoldBalance) cols = cols.filter((c) => c.key !== "on_hold_closing_balance");
      }
    }

    // Custom components zero-suppression (Option 2)
    const activeCustomDeductions = showAllUnfilteredCols
      ? customDeductions
      : customDeductions.filter((c) => Array.isArray(records) && records.some((r) => Number(getRecordCustomValue(r, c) || 0) > 0));

    const activeCustomEarnings = showAllUnfilteredCols
      ? customEarnings
      : customEarnings.filter((c) => {
        const isAnnual = c.payout_frequency === "ANNUAL";
        const isPayoutMonth = isAnnual && currentMonth === Number(c.payout_month);
        if (isPayoutMonth) return true; // keep scheduled annual payout month visible
        return Array.isArray(records) && records.some((r) => Number(getRecordCustomValue(r, c) || 0) > 0);
      });

    const dedIdx = cols.findIndex((c) => c.key === "total_deductions");
    if (activeCustomDeductions.length > 0 && dedIdx !== -1) {
      cols.splice(dedIdx, 0, ...activeCustomDeductions);
    }
    const earnIdx = cols.findIndex((c) => c.key === "earned_salary");
    if (activeCustomEarnings.length > 0 && earnIdx !== -1) {
      cols.splice(earnIdx, 0, ...activeCustomEarnings);
    }
    return cols;
  }, [
    records,
    customEarnings,
    customDeductions,
    showAllUnfilteredCols,
    job?.client_details?.track_comp_off,
    job?.client_details?.track_compoff,
    job?.client_details?.track_leave_ledger,
    job?.client_details?.track_leave,
    job?.client_details?.pf_calculation_rule,
    job?.client_details?.employer_pf_in_ctc,
  ]);

  // Drawer custom fields incorporating custom components
  const drawerEarningFields = useMemo(() => [
    { key: "basic_da", label: "Basic DA" },
    { key: "hra", label: "HRA" },
    { key: "lta", label: "LTA" },
    { key: "special_allowance", label: "Special Allowance" },
    { key: "nps_allowance_earned", label: "NPS Allowance" },
    { key: "fbp", label: "FBP (Earned)" },
    { key: "variable_pay", label: "Variable Pay" },
    { key: "commission_other", label: "Commission / Other" },
    { key: "arrears", label: "Arrears" },
    { key: "reimbursements", label: "Reimbursements" },
    { key: "salary_advance_disbursed", label: "Advance Given", readOnly: true },
    { key: "on_hold_released", label: "On Hold Released", readOnly: true },
    ...customEarnings.map((c) => ({
      key: c.key,
      label: `${c.fullLabel} ✨`,
      readOnly: false,
      customCol: c,
    })),
    { key: "earned_salary", label: "Earned Salary", readOnly: true, alwaysShow: true },
  ], [customEarnings]);

  const drawerDeductionFields = useMemo(() => [
    { key: "epf", label: "EPF (12%)" },
    { key: "esi", label: "ESI (0.75%)" },
    { key: "vpf", label: "VPF" },
    { key: "professional_tax", label: "Professional Tax" },
    { key: "tds", label: "TDS (Tax)" },
    { key: "nps_deduction", label: "NPS Deduction" },
    { key: "loan_deduction", label: "Loan / Advance EMI" },
    { key: "lwf", label: "LWF" },
    { key: "other_deduction", label: "Other Deduction" },
    { key: "salary_advance_recovered", label: "Advance Recovered", readOnly: true },
    { key: "on_hold_deducted", label: "On Hold Deducted", readOnly: true },
    ...customDeductions.map((c) => ({
      key: c.key,
      label: `${c.fullLabel} ✨`,
      readOnly: false,
      customCol: c,
    })),
    { key: "total_deductions", label: "Total Deductions", readOnly: true, alwaysShow: true },
  ], [customDeductions]);

  // Column Visibility state
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [colSearchQuery, setColSearchQuery] = useState("");
  const columnsMenuRef = useRef(null);
  const [visibleCols, setVisibleCols] = useState(() => {
    const init = {};
    REGISTER_COLUMNS.forEach((c) => { init[c.key] = true; });
    return init;
  });

  const activeColumnKeys = useMemo(() => new Set(allColumns.map((c) => c.key)), [allColumns]);
  const isColVisible = useCallback((key) => activeColumnKeys.has(key) && visibleCols[key] !== false, [activeColumnKeys, visibleCols]);

  const visibleCount = useMemo(() => {
    return allColumns.filter((c) => isColVisible(c.key)).length;
  }, [allColumns, activeColumnKeys, visibleCols]);

  const toggleCol = (key) => {
    setVisibleCols((prev) => ({ ...prev, [key]: !(prev[key] !== false) }));
  };

  const handleShowAllCols = () => {
    const all = {};
    allColumns.forEach((c) => { all[c.key] = true; });
    setVisibleCols(all);
  };

  const handleTotalsOnlyCols = () => {
    const compactKeys = new Set(["actual_working_days", "earned_salary", "total_deductions", "net_salary"]);
    const next = {};
    allColumns.forEach((c) => { next[c.key] = compactKeys.has(c.key); });
    setVisibleCols(next);
  };

  const handleResetDefaultCols = () => {
    const init = {};
    allColumns.forEach((c) => { init[c.key] = true; });
    setVisibleCols(init);
    setColSearchQuery("");
  };

  // Option 1: 1-Click CTC Waterfall group toggle helper
  const ctcWaterfallKeys = useMemo(
    () => allColumns.filter((c) => c.group === "CTC & Retirals").map((c) => c.key),
    [allColumns]
  );
  const isCtcWaterfallActive = useMemo(
    () => ctcWaterfallKeys.length > 0 && ctcWaterfallKeys.some((k) => isColVisible(k)),
    [ctcWaterfallKeys, activeColumnKeys, visibleCols]
  );
  const toggleCtcWaterfall = () => {
    const nextState = !isCtcWaterfallActive;
    setVisibleCols((prev) => {
      const next = { ...prev };
      ctcWaterfallKeys.forEach((k) => {
        next[k] = nextState;
      });
      return next;
    });
  };

  // Close columns dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!columnsMenuOpen) return;
    const handleClickOutside = (e) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target)) {
        setColumnsMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setColumnsMenuOpen(false);
        setColSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [columnsMenuOpen]);

  // Modals & Drawers
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sendingEmailId, setSendingEmailId] = useState(null);
  const [showEmpMasterDetails, setShowEmpMasterDetails] = useState(false);
  const [historyRecord, setHistoryRecord] = useState(null);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(null);
  const [breakdownEditMode, setBreakdownEditMode] = useState(false);
  const [activeLedgerSection, setActiveLedgerSection] = useState(null);

  // Unified Workflow Transition Modal
  const [activeWorkflowModal, setActiveWorkflowModal] = useState(null);
  const [workflowNotes, setWorkflowNotes] = useState("");

  // Keyboard accessibility: Escape to dismiss active workflow modal
  useEffect(() => {
    if (!activeWorkflowModal) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !transitioning) {
        setActiveWorkflowModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkflowModal, transitioning]);

  // Universal Action Result / Email Delivery Success Modal
  const [workflowSuccessData, setWorkflowSuccessData] = useState(null);

  // In-App Modern Dialog State (confirm / prompt / alert)
  const [dialogConfig, setDialogConfig] = useState({
    isOpen: false,
    type: "confirm",
    title: "",
    message: "",
    variant: "primary",
    confirmText: "",
    cancelText: "Cancel",
    defaultValue: "",
    placeholder: "",
    multiline: false,
    loading: false,
    onConfirm: null,
  });

  const closeDialog = () => setDialogConfig((prev) => ({ ...prev, isOpen: false }));

  // Synchronized Layout References
  const searchToolbarRef = useRef(null);
  const celeryBannerRef = useRef(null);
  const tableContainerRef = useRef(null);

  // Ensure outer layout container scroll is natural
  useEffect(() => {
    const contentEl = document.querySelector(".ant-layout-content");
    if (contentEl) {
      contentEl.style.overflowY = "auto";
    }
  }, []);

  // Dynamic Sider Width Tracking for Full-Width Fixed Dock Footer
  const [siderWidth, setSiderWidth] = useState(64);
  useEffect(() => {
    const updateSiderWidth = () => {
      const sider = document.querySelector(".ant-layout-sider");
      if (sider) {
        setSiderWidth(sider.getBoundingClientRect().width);
      }
    };
    updateSiderWidth();
    window.addEventListener("resize", updateSiderWidth);
    const sider = document.querySelector(".ant-layout-sider");
    let observer = null;
    if (sider) {
      observer = new MutationObserver(updateSiderWidth);
      observer.observe(sider, { attributes: true, attributeFilter: ["style", "class"] });
    }
    return () => {
      window.removeEventListener("resize", updateSiderWidth);
      if (observer) observer.disconnect();
    };
  }, []);

  // Role detection with strict segregation of duties
  const currentUserId = user?.id;
  const userRole = (user?.role || "").toLowerCase();
  const isAdmin = ["admin", "founder", "manager", "team lead"].includes(userRole) || user?.is_superuser;
  const isAdminOrFounder = ["admin", "founder"].includes(userRole) || user?.is_superuser;
  const isAssignedChecker =
    (job?.checkers || []).some((c) => String(c?.id ?? c) === String(currentUserId)) ||
    (job?.checkers_list || []).some((c) => String(c?.id) === String(currentUserId));
  const isAssignedMaker =
    (job?.makers || []).some((m) => String(m?.id ?? m) === String(currentUserId)) ||
    (job?.makers_list || []).some((m) => String(m?.id) === String(currentUserId));

  // Strict 4-Eyes Segregation of Duties:
  // - Makers: Can prepare and edit records & adjust ledgers ONLY while job is In Progress/To Do/Rework.
  // - Checkers: Can review, apply staged inputs, return to maker, and finalize & send emails.
  // - Unassigned Admins/Founders: Strictly View-Only mode (can download PDFs and export Excel).
  //   Admins/Founders have disaster-recovery reopen authority ONLY when the batch is Done.
  const isChecker = isAssignedChecker;
  const isMaker = isAssignedMaker;
  const isViewer = !isMaker && !isChecker;

  const canEditBatch = isMaker && ["In Progress", "To Do", "Rework"].includes(job?.status) && job?.status !== "Done";
  const canSendPayslip = isChecker && job?.status !== "Done";

  const loadAll = async (selectUpdatedRecordId = null, { silent = false } = {}) => {
    // Only trigger full-page blocking loader on cold initial mount before data exists
    if (!silent && !job && records.length === 0) {
      setLoading(true);
    }
    try {
      // 1. Fetch Job
      const jobRes = await api.get(`/payroll/jobs/${id}/`);
      setJob(jobRes.data);
      if (onJobUpdated) {
        onJobUpdated(jobRes.data);
      }

      // 2. Fetch Records, Changes & Client Components in parallel
      const clientId = jobRes.data?.client || jobRes.data?.client_id;
      const [recRes, chgRes, compRes] = await Promise.all([
        api.get(`/payroll/jobs/${id}/batch-records/`).catch(() => ({ data: [] })),
        api.get(`/payroll/jobs/${id}/changes/`).catch(() => ({ data: { items: [], summary: {} } })),
        clientId
          ? api.get(`/payroll/components/?client=${clientId}`).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);

      const recs = recRes.data || [];
      setRecords(recs);
      setChanges(chgRes.data || { items: [], summary: {} });
      setClientComponents(Array.isArray(compRes.data) ? compRes.data : compRes.data?.results || []);

      // Auto-resume active background mail tracking ONLY if batch is legitimately in active dispatch
      const isActivelyDispatching =
        jobRes.data?.batch_details?.status === "SENDING" ||
        jobRes.data?.status === "SENDING";

      if (
        isActivelyDispatching &&
        recs.length > 0 &&
        recs.some((r) => r.status !== "EMAIL_SENT" && r.status !== "EMAIL_FAILED")
      ) {
        setCeleryTracking((prev) => (prev?.active ? prev : { active: true, startTime: Date.now(), mode: "celery" }));
      }

      // Live synchronization for open inspection drawer
      if (selectUpdatedRecordId) {
        const found = recs.find((r) => r.id === selectUpdatedRecordId);
        if (found) setSelectedRecord(found);
      } else if (selectedRecord) {
        const found = recs.find((r) => r.id === selectedRecord.id);
        if (found) setSelectedRecord(found);
      }
    } catch (err) {
      console.error("Failed to load batch review workspace:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Map changes by employee_id AND employee_code for quick lookups
  const changesByEmpId = useMemo(() => {
    const map = {};
    (changes.items || []).forEach((item) => {
      const eid = item.employee_id;
      const code = item.employee_code || (item.payload || {}).employee_code;
      if (eid) {
        if (!map[eid]) map[eid] = [];
        map[eid].push(item);
      }
      if (code) {
        if (!map[code]) map[code] = [];
        map[code].push(item);
      }
    });
    return map;
  }, [changes]);

  // Map changed field names by employee_id and employee_code for precise cell-level highlighting
  const changedFieldsByEmpId = useMemo(() => {
    const map = {};
    const addField = (key, f) => {
      if (!key) return;
      if (!map[key]) map[key] = new Set();
      map[key].add(String(f).toLowerCase());
    };

    (changes.items || []).forEach((item) => {
      // Staged adjustments from portal submissions only affect batch cells once APPLIED
      if (item.source !== "manual_edit" && item.source !== "excel_merge") {
        const itemStatus = String(item.status || "").toUpperCase();
        if (itemStatus && itemStatus !== "APPLIED") {
          return;
        }
      }

      const eid = item.employee_id;
      const code = item.employee_code || (item.payload || {}).employee_code;
      const keys = [eid, code].filter(Boolean);
      if (keys.length === 0) return;

      const p = item.payload || {};

      const markField = (f) => {
        keys.forEach((k) => addField(k, f));
      };

      if (item.source === "manual_edit") {
        const fn = (p.field_name || item.item_type || "").toLowerCase();
        if (fn) markField(fn);
      } else if (item.source === "excel_merge") {
        const raw = (p.raw_description || "").toLowerCase();
        [
          "actual_working_days", "extra_working_days", "paid_leave_days", "lop_days",
          "basic_da", "hra", "lta", "special_allowance", "nps_allowance_earned",
          "variable_pay", "commission_other", "arrears", "reimbursements",
          "salary_advance_disbursed", "on_hold_released",
          "tds", "epf", "esi", "vpf", "professional_tax", "nps_deduction", "loan_deduction",
          "salary_advance_recovered", "on_hold_deducted",
          "lwf", "other_deduction", "earned_salary", "gross_salary", "total_deductions", "net_salary"
        ].forEach((f) => {
          if (raw.includes(f)) markField(f);
        });
      } else {
        const it = (item.item_type || "").toUpperCase();
        if (it === "ATTENDANCE" || it === "LOP") {
          markField("lop_days");
          markField("actual_working_days");
        } else if (it === "SALARY_REVISION" || it === "REVISION") {
          markField("basic_da");
          markField("hra");
          markField("special_allowance");
          markField("gross_salary");
        } else if (it === "ONE_TIME_EARNING" || it === "EARNING") {
          const comp = String(p.component || p.earning_type || p.field_name || "").toLowerCase();
          const targetCol = comp.includes("arrear") ? "arrears" : comp.includes("reimb") ? "reimbursements" : comp.includes("variable") ? "variable_pay" : "commission_other";
          markField(targetCol);
          markField("earned_salary");
        } else if (it === "ONE_TIME_DEDUCTION" || it === "DEDUCTION") {
          const comp = String(p.component || p.deduction_type || p.field_name || "other_deduction").toLowerCase();
          const targetCol = comp.includes("tds") ? "tds" : (comp.includes("loan") || comp.includes("advance")) ? "loan_deduction" : "other_deduction";
          markField(targetCol);
          markField("total_deductions");
        } else if (it === "ARREARS") {
          markField("arrears");
          markField("earned_salary");
        } else if (it === "TDS") {
          markField("tds");
          markField("total_deductions");
        } else if (it === "REIMBURSEMENT") {
          markField("reimbursements");
          markField("net_salary");
        } else if (it === "SALARY_HOLD") {
          markField("on_hold_deducted");
          markField("total_deductions");
          markField("net_salary");
        } else if (it === "ADVANCE") {
          markField("salary_advance_disbursed");
          if (Number(p.emi_amount || p.recovery_amount) > 0) {
            markField("loan_deduction");
            markField("salary_advance_recovered");
            markField("total_deductions");
          }
          markField("earned_salary");
          markField("net_salary");
        } else if (it === "NEW_EMPLOYEE") {
          markField("new_joiner");
          markField("basic_da");
          markField("earned_salary");
          markField("net_salary");
        } else if (it === "EXIT") {
          markField("exit");
          markField("actual_working_days");
        }
        if (p.field_name) markField(String(p.field_name).toLowerCase());
        if (p.component) markField(String(p.component).toLowerCase());
      }
    });
    return map;
  }, [changes]);

  // Actions column is visible ONLY for Checkers during the "Approved" verification stage; once the batch is "Done" or "Closed", it is hidden for everyone
  const showActionsColumn = job?.status === "Approved" && isChecker;

  // Synchronized Column Definitions & Header Cells
  const renderColGroup = () => (
    <colgroup>
      <col style={{ width: 48, minWidth: 48 }} />
      <col style={{ width: 200, minWidth: 200 }} />
      {allColumns.map((col) =>
        isColVisible(col.key) ? (
          <col key={col.key} style={{ width: col.width, minWidth: col.width }} />
        ) : null
      )}
      {showActionsColumn && (
        <col style={{ width: 155, minWidth: 155 }} />
      )}
    </colgroup>
  );

  const renderHeaderCells = () => (
    <>
      {/* Sticky Left Identity Headers */}
      <th
        style={{
          padding: "10px 8px",
          fontWeight: 700,
          color: "#475569",
          width: 48,
          minWidth: 48,
          maxWidth: 48,
          boxSizing: "border-box",
          textAlign: "center",
          position: "sticky",
          top: 0,
          left: 0,
          background: "#f8fafc",
          zIndex: 25,
          borderRight: "1px solid #e2e8f0",
          borderBottom: "1.5px solid #cbd5e1",
          whiteSpace: "nowrap",
        }}
      >
        #
      </th>
      <th
        style={{
          padding: "10px 12px",
          fontWeight: 700,
          color: "#475569",
          width: 200,
          minWidth: 200,
          boxSizing: "border-box",
          position: "sticky",
          top: 0,
          left: 48,
          background: "#f8fafc",
          zIndex: 25,
          boxShadow: "2px 0 4px rgba(0,0,0,0.04)",
          borderRight: "1px solid #e2e8f0",
          borderBottom: "1.5px solid #cbd5e1",
          whiteSpace: "nowrap",
        }}
      >
        Employee
      </th>

      {/* Dynamic Data Column Headers */}
      {allColumns.map((col) => {
        if (!isColVisible(col.key)) return null;
        return (
          <th
            key={col.key}
            title={col.fullLabel}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              background: "#f8fafc",
              padding: "10px 8px",
              fontWeight: col.fontWeight || 700,
              color: col.color || (col.isCustom ? (col.customType === "DEDUCTION" ? "#991b1b" : "#0369a1") : "#475569"),
              textAlign: col.align || "right",
              borderRight: "1px solid #e2e8f0",
              borderBottom: "1.5px solid #cbd5e1",
              whiteSpace: "nowrap",
            }}
          >
            <div className="flex items-center justify-end gap-1">
              <span>{col.label}</span>
              {col.isCustom && (
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-200" title="Custom Dynamic Component">
                  ✨
                </span>
              )}
              {col.payout_frequency === "ANNUAL" && currentMonth === Number(col.payout_month) && (
                <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1 py-0.5 rounded border border-emerald-300 shadow-2xs" title={`Scheduled Annual Payout in Month ${col.payout_month}`}>
                  🎁 Payout
                </span>
              )}
            </div>
          </th>
        );
      })}

      {/* Sticky Right Actions Header */}
      {showActionsColumn && (
        <th
          style={{
            padding: "10px 12px",
            fontWeight: 700,
            color: "#475569",
            textAlign: "center",
            width: 155,
            minWidth: 155,
            position: "sticky",
            top: 0,
            right: 0,
            background: "#f8fafc",
            zIndex: 25,
            boxShadow: "-2px 0 4px rgba(0,0,0,0.04)",
            borderRight: "1px solid #e2e8f0",
            borderBottom: "1.5px solid #cbd5e1",
            whiteSpace: "nowrap",
          }}
        >
          Actions
        </th>
      )}
    </>
  );

  // Export detailed Excel register
  const handleDownloadExcel = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-excel/`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      const cleanName = (job.client_name || "Payroll").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.download = `${cleanName}_${job.period || "Period"}_Payroll_Register.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Export Failed",
        message: "Failed to export Excel register: " + (err?.response?.data?.error || err.message),
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    }
  };

  const [statutoryMenuOpen, setStatutoryMenuOpen] = useState(false);
  const [statutoryValidationLoading, setStatutoryValidationLoading] = useState(false);

  const handleValidateStatutory = async () => {
    setStatutoryValidationLoading(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/validate-statutory-identifiers/`);
      const data = res.data;
      if (data.has_issues) {
        const issuesSummary = [
          data.missing_uan_count > 0 ? `⚠️ ${data.missing_uan_count} employee(s) have EPF deductions but missing 12-digit UAN numbers: ${data.missing_uan_employees.map(e => `${e.employee_name} (${e.employee_code})`).slice(0, 5).join(", ")}${data.missing_uan_count > 5 ? "..." : ""}` : "",
          data.missing_esi_count > 0 ? `⚠️ ${data.missing_esi_count} employee(s) have ESI deductions but missing 10-digit IP numbers: ${data.missing_esi_employees.map(e => `${e.employee_name} (${e.employee_code})`).slice(0, 5).join(", ")}${data.missing_esi_count > 5 ? "..." : ""}` : "",
        ].filter(Boolean).join("\n\n");

        setDialogConfig({
          isOpen: true,
          type: "alert",
          variant: "warning",
          title: "Statutory Identifiers Advisory",
          message: issuesSummary + "\n\nYou can still proceed to export returns, but updating these numbers before portal upload is recommended.",
          confirmText: "Understood",
          onConfirm: closeDialog,
        });
      } else {
        setDialogConfig({
          isOpen: true,
          type: "alert",
          variant: "success",
          title: "Statutory Validation Passed",
          message: "All contributing employees have valid 12-digit UAN and 10-digit ESIC numbers configured!",
          confirmText: "Great",
          onConfirm: closeDialog,
        });
      }
    } catch (err) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Validation Check Failed",
        message: "Failed to validate statutory identifiers: " + (err?.response?.data?.error || err.message),
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setStatutoryValidationLoading(false);
    }
  };

  const downloadStatutoryReturn = async (endpoint, format, fileNameSuffix, ext = "xlsx") => {
    try {
      const cleanEndpoint = String(endpoint || "").replace(/^\/+|\/+$/g, "");
      const url = format
        ? `/payroll/jobs/${id}/${cleanEndpoint}/?format=${format}`
        : `/payroll/jobs/${id}/${cleanEndpoint}/`;
      const res = await api.get(url, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `${cleanName}_${cleanPeriod}_${fileNameSuffix}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export statutory file");
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Export Failed",
        message: errMsg,
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    }
  };

  const [bankMenuOpen, setBankMenuOpen] = useState(false);
  const [bankValidationLoading, setBankValidationLoading] = useState(false);
  const [holdDrawerOpen, setHoldDrawerOpen] = useState(false);
  const [holdData, setHoldData] = useState({ records: [], total_on_hold_count: 0, total_closing_hold_amount: 0 });
  const [holdLoading, setHoldLoading] = useState(false);
  const [holdActionModal, setHoldActionModal] = useState({ open: false, type: "RELEASE", record: null, amount: "", reason: "", releaseMonth: "", releaseYear: "" });

  const fetchHoldRecords = async () => {
    setHoldLoading(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/hold-records/`);
      setHoldData(res.data || { records: [], total_on_hold_count: 0, total_closing_hold_amount: 0 });
    } catch (err) {
      console.error("Failed to load hold records:", err);
    } finally {
      setHoldLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchHoldRecords();
    }
  }, [id]);

  const [auditMenuOpen, setAuditMenuOpen] = useState(false);
  const [momModalOpen, setMomModalOpen] = useState(false);
  const [momData, setMomData] = useState(null);
  const [momLoading, setMomLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Option 3: Auto-dismiss Recalculate completion modal after 4 seconds
  useEffect(() => {
    if (workflowSuccessData?.type === "recalculate_done") {
      const timer = setTimeout(() => {
        setWorkflowSuccessData(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [workflowSuccessData]);
  const [anomalyFilter, setAnomalyFilter] = useState("all");
  const [momSearchTerm, setMomSearchTerm] = useState("");
  const [downloadingAudit, setDownloadingAudit] = useState(false);
  const [waterfallCollapsed, setWaterfallCollapsed] = useState(false);

  const handleJumpToEmployeeRow = (employeeId) => {
    setMomModalOpen(false);
    const target = (records || []).find(r => r.employee === employeeId || r.employee_id === employeeId || (r.employee && r.employee.id === employeeId));
    if (target) {
      setSelectedRecord(target);
      setSearchTerm("");
    }
  };

  const fetchMomVariance = async (openModal = true) => {
    setMomLoading(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/mom-variance-summary/`);
      setMomData(res.data);
      if (openModal) setMomModalOpen(true);
    } catch (err) {
      console.error("Failed to load MoM variance:", err);
      if (openModal) {
        alert("Failed to load MoM variance summary: " + (err?.response?.data?.error || err.message));
      }
    } finally {
      setMomLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchMomVariance(false);
    }
  }, [id]);

  const downloadMomVarianceXlsx = async () => {
    setDownloadingAudit(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-mom-variance/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `MoM_Variance_Reconciliation_${cleanName}_${cleanPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export MoM variance");
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Export Failed",
        message: errMsg,
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setDownloadingAudit(false);
    }
  };

  const downloadJournalVoucher = async (format = "xlsx") => {
    setDownloadingAudit(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-journal-voucher/?format=${format}`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      const ext = format === "xml" ? "xml" : (format === "csv" ? "csv" : "xlsx");
      const prefix = format === "xml" ? "Payroll_JV_Tally" : "Payroll_Journal_Voucher";
      link.download = `${prefix}_${cleanName}_${cleanPeriod}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Journal Voucher");
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Export Failed",
        message: errMsg,
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setDownloadingAudit(false);
    }
  };

  const handleValidateBank = async () => {
    setBankValidationLoading(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/validate-bank-details/`);
      const data = res.data;
      if (data.has_issues) {
        const issuesSummary = data.invalid_bank_employees.map(e => `• ${e.employee_name} (${e.employee_code}): ${e.issues.join(", ")} [Net: ₹${e.net_payout.toLocaleString()}]`).slice(0, 6).join("\n") + (data.invalid_bank_count > 6 ? `\n...and ${data.invalid_bank_count - 6} more` : "");

        setDialogConfig({
          isOpen: true,
          type: "alert",
          variant: "warning",
          title: `Bank Validation Issues (${data.invalid_bank_count} Found)`,
          message: `The following employees have missing or invalid bank credentials:\n\n${issuesSummary}\n\nTotal Payable: ₹${data.total_payout_amount.toLocaleString()} across ${data.payable_count} employees.\nWithheld Salaries: ${data.withheld_count} employee(s) (₹${data.total_withheld_amount.toLocaleString()}).`,
          confirmText: "Understood",
          onConfirm: closeDialog,
        });
      } else {
        const corpMsg = data.corporate_debit_account ? `\nDebit Account: ${data.corporate_debit_account} (${data.corporate_debit_bank || "Bank"})` : "";
        setDialogConfig({
          isOpen: true,
          type: "alert",
          variant: "success",
          title: "Bank Disbursement Validation Passed",
          message: `All ${data.payable_count} payable employees have valid bank accounts and 11-digit IFSC codes!\n\nTotal Payout Volume: ₹${data.total_payout_amount.toLocaleString()}\nWithheld / On-Hold: ${data.withheld_count} employee(s) (₹${data.total_withheld_amount.toLocaleString()})${corpMsg}`,
          confirmText: "Download Payout",
          onConfirm: () => {
            closeDialog();
            downloadBankPayout("xlsx");
          },
        });
      }
    } catch (err) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Validation Check Failed",
        message: "Failed to validate bank details: " + (err?.response?.data?.error || err.message),
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setBankValidationLoading(false);
    }
  };

  const downloadBankPayout = async (format = "xlsx") => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-bank-payout/?format=${format}`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      const ext = format === "xlsx" ? "xlsx" : "csv";
      const prefix = format === "hdfc" ? "HDFC_CMS_Payout" : "Bank_Payout";
      link.download = `${prefix}_${cleanName}_${cleanPeriod}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export bank payout file");
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Export Failed",
        message: errMsg,
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    }
  };

  const handleExecuteHoldAction = async () => {
    const { type, record, amount, reason, releaseMonth, releaseYear } = holdActionModal;
    if (!record || !amount || Number(amount) <= 0) {
      alert("Please enter a valid positive amount.");
      return;
    }
    const endpoint = type === "RELEASE" ? "release-salary-hold" : "place-salary-hold";
    const payload = type === "RELEASE" ? {
      employee_id: record.employee_id,
      release_amount: Number(amount),
      reason: reason || "Staff hold release",
    } : {
      employee_id: record.employee_id,
      hold_amount: Number(amount),
      reason: reason || "Staff salary hold",
      release_month: releaseMonth ? Number(releaseMonth) : null,
      release_year: releaseYear ? Number(releaseYear) : null,
    };

    try {
      const res = await api.post(`/payroll/jobs/${id}/${endpoint}/`, payload);
      setHoldActionModal({ open: false, type: "RELEASE", record: null, amount: "", reason: "", releaseMonth: "", releaseYear: "" });
      fetchHoldRecords();
      const recRes = await api.get(`/payroll/jobs/${id}/batch-records/`);
      if (recRes.data) setRecords(recRes.data);
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "success",
        title: type === "RELEASE" ? "Salary Released" : "Salary Placed on Hold",
        message: res.data.message || "Operation completed successfully.",
        confirmText: "OK",
        onConfirm: closeDialog,
      });
    } catch (err) {
      alert("Action failed: " + (err?.response?.data?.error || err.message));
    }
  };

  // Download individual employee payslip PDF
  const downloadPDF = async (recordId, employeeName) => {
    try {
      const response = await api.get(`/payroll/records/${recordId}/download-pdf/`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      const clientName = sanitizeFileNamePart(job?.client_name, "Client");
      const empName = sanitizeFileNamePart(employeeName, "Staff");
      const periodName = sanitizeFileNamePart(job?.period, "Period");
      link.download = `${clientName}_${empName}_${periodName}_payslip.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "PDF download failed");
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Download Failed",
        message: errMsg,
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    }
  };

  // Request send single email (opens styled confirmation modal via PayrollDialog)
  const handleRequestSendSingleEmail = (record) => {
    if (!canSendPayslip) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "warning",
        title: "Permission Denied",
        message: "Only assigned Checkers can dispatch payslip emails.",
        confirmText: "Understood",
        onConfirm: closeDialog,
      });
      return;
    }
    if (!record.employee_email) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "No Email Registered",
        message: `Cannot send payslip email: No email address is registered for ${record.employee_name}. Please configure an email address in Employee Master first.`,
        confirmText: "Understood",
        onConfirm: closeDialog,
      });
      return;
    }

    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "primary",
      title: "Send Salary Slip Email",
      confirmText: "Send Payslip Email",
      cancelText: "Cancel",
      message: (
        <div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 12,
              marginTop: 4,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
              {record.employee_name}{" "}
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>
                ({record.employee_code || "Staff"})
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#334155", display: "flex", alignItems: "center", gap: 6 }}>
              <span>✉️</span>
              <strong style={{ color: "#2563eb" }}>{record.employee_email}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#334155", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span>💵 Net Pay:</span>
              <strong style={{ color: "#166534" }}>{fmtCurrency(record.net_salary)}</strong>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>
            A fresh PDF payslip will be compiled with all approved adjustments and emailed directly to this employee's inbox.
          </p>
        </div>
      ),
      onConfirm: () => {
        closeDialog();
        handleConfirmSendSingleEmail(record);
      },
    });
  };

  // Perform individual employee payslip email dispatch
  const handleConfirmSendSingleEmail = async (record) => {
    setSendingEmailId(record.id);
    try {
      const res = await api.post(`/payroll/records/${record.id}/resend/`);
      if (res.data?.success) {
        setRecords((prev) =>
          prev.map((r) => (r.id === record.id ? { ...r, status: "EMAIL_SENT" } : r))
        );
        if (selectedRecord && selectedRecord.id === record.id) {
          setSelectedRecord((prev) => ({ ...prev, status: "EMAIL_SENT" }));
        }
        setWorkflowSuccessData({
          type: "email_success",
          title: "🎉 Salary Slip Emailed Successfully!",
          subtitle: `${record.employee_name} (${record.employee_code || "Staff"})`,
          message: `Payslip PDF was generated freshly and delivered to ${record.employee_email}.`,
          stats: [
            { label: "Recipient", value: record.employee_name },
            { label: "Net Salary", value: fmtCurrency(record.net_salary), color: "#166534" },
            { label: "Delivery", value: "✉️ Delivered", color: "#059669" },
          ],
          primaryText: "Done",
        });
      } else {
        const errorMsg = res.data?.message || "Unknown mail server error";
        setRecords((prev) =>
          prev.map((r) => (r.id === record.id ? { ...r, status: "EMAIL_FAILED" } : r))
        );
        setWorkflowSuccessData({
          type: "email_failed",
          title: "❌ Email Delivery Failed",
          subtitle: `${record.employee_name} (${record.employee_code || "Staff"})`,
          message: `Failed to deliver payslip email to ${record.employee_email}: ${errorMsg}`,
          primaryText: "Close",
          secondaryText: "🔄 Retry Now",
          onSecondary: () => handleRequestSendSingleEmail(record),
        });
      }
    } catch (err) {
      const errorMsg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      setRecords((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, status: "EMAIL_FAILED" } : r))
      );
      setWorkflowSuccessData({
        type: "email_failed",
        title: "❌ Email Delivery Failed",
        subtitle: `${record.employee_name} (${record.employee_code || "Staff"})`,
        message: `Failed to send email to ${record.employee_email}: ${errorMsg}`,
        primaryText: "Close",
        secondaryText: "🔄 Retry Now",
        onSecondary: () => handleRequestSendSingleEmail(record),
      });
    } finally {
      setSendingEmailId(null);
    }
  };

  // In-place inline cell save & server auto-recalculate
  const saveCell = async (record, field, value, customCol) => {
    if (!canEditBatch) {
      setWorkflowSuccessData({
        type: "email_failed",
        title: "Permission Denied",
        message: "Only assigned Makers can edit payslip records while job is In Progress.",
        primaryText: "Understood",
      });
      return;
    }
    try {
      let patchBody = { [field]: value };
      if (customCol || (field && field.startsWith("custom_")) || field === "fbp") {
        const cCode = customCol?.code || (field === "fbp" ? "FBP" : field.replace("custom_earnings_", "").replace("custom_deductions_", "").replace("custom_", ""));
        patchBody = {
          custom_component_override: {
            code: cCode,
            amount: Number(value || 0),
          },
        };
      }
      const res = await api.patch(`/payroll/records/${record.id}/`, patchBody);
      const updated = res.data;
      setEditing(null);
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (selectedRecord && selectedRecord.id === updated.id) {
        setSelectedRecord(updated);
      }
      // Re-fetch changes in background so audit details tray and employee badges stay live
      api.get(`/payroll/jobs/${id}/changes/`)
        .then((chgRes) => setChanges(chgRes.data || { items: [], summary: {} }))
        .catch(() => { });
    } catch (err) {
      setEditing(null);
      setWorkflowSuccessData({
        type: "email_failed",
        title: "Update Failed",
        message: "Failed to update field: " + (err?.response?.data?.error || err?.response?.data?.[field] || err.message),
        primaryText: "Close",
      });
      const recRes = await api.get(`/payroll/jobs/${id}/batch-records/`).catch(() => ({ data: [] }));
      setRecords(recRes.data || []);
    }
  };

  // Checker: Apply all pending inputs to batch
  const executeApplyInputs = async () => {
    setTransitioning(true);
    try {
      const res = await api.post(`/payroll/jobs/${id}/apply-inputs/`);
      const appliedCount = res.data?.summary?.applied_count ?? res.data?.summary?.applied ?? changes.summary?.pending ?? 0;
      setWorkflowSuccessData({
        type: "success",
        title: "✅ Inputs Applied",
        message: `Applied ${appliedCount} input${appliedCount === 1 ? "" : "s"}! Batch totals refreshed.`,
        primaryText: "Done",
      });
      await loadAll();
    } catch (err) {
      setWorkflowSuccessData({
        type: "email_failed",
        title: "Apply Inputs Failed",
        message: err?.response?.data?.error || err.message,
        primaryText: "Close",
      });
    } finally {
      setTransitioning(false);
    }
  };

  const handleApplyInputs = () => {
    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "success",
      title: "Apply Pending Monthly Inputs",
      message: "Approve and apply all pending monthly inputs into this batch? This will recalculate employee payslip figures and refresh the batch register.",
      confirmText: "Apply All Inputs",
      cancelText: "Cancel",
      onConfirm: () => {
        closeDialog();
        executeApplyInputs();
      },
    });
  };

  // Programmatic Finalize (used by Audit modal)
  const handleFinalizeAndSend = async (options = {}) => {
    const { skipEmails = false } = options;
    setTransitioning(true);
    try {
      const res = await api.post(`/payroll/jobs/${id}/finalize-and-send/`, {
        send_emails: !skipEmails,
      });
      if (!skipEmails && res.data?.email_dispatched) {
        const mode = res.data?.dispatch_mode === "thread" ? "thread" : "celery";
        setCeleryTracking({ active: true, startTime: Date.now(), mode });
        setWorkflowSuccessData({
          type: "celery_queued",
          title: mode === "thread" ? "🛡️ Direct Mail Dispatch Initiated" : "🚀 Automated Mail Dispatch Queued",
          subtitle: `${job?.client_company_name || ""} • ${job?.month_name || ""} ${job?.year || ""}`,
          message: mode === "thread"
            ? "Payroll calculations approved and sealed. Payslip emails are being dispatched in the background via our resilient direct server dispatch engine."
            : "Payroll calculations approved and sealed. Automated payslip email distribution has been queued and is dispatching in the background.",
          stats: [
            { label: "Job Status", value: "Approved • Dispatching…", color: "#d97706" },
            { label: "Dispatch Engine", value: mode === "thread" ? "Direct Server Dispatch (Failsafe Backup)" : "Automated Enterprise Queue", color: mode === "thread" ? "#d97706" : "#2563eb" },
            { label: "Recipients", value: `${unsentCount} Staff`, color: "#0f172a" },
          ],
          primaryText: "Keep Reviewing",
        });
      } else {
        setWorkflowSuccessData({
          type: "success",
          title: "🎉 Payroll Finalized",
          message: res.data?.message || "Payroll finalized successfully!",
          primaryText: "Done",
        });
      }
      await loadAll();
    } catch (err) {
      setWorkflowSuccessData({
        type: "email_failed",
        title: "Finalize Failed",
        message: err?.response?.data?.error || err.message,
        primaryText: "Close",
      });
    } finally {
      setTransitioning(false);
    }
  };

  // Unified Workflow Transition Handlers
  const openWorkflowModal = (key, initialNotes = "") => {
    setWorkflowNotes(initialNotes);
    setActiveWorkflowModal(key);
  };

  const handleReworkFailedEmails = (failedList = []) => {
    const codes = failedList.map((r) => r.employee_code || r.employee_name).filter(Boolean).join(", ");
    const note = codes
      ? `Email delivery failed for ${failedList.length} employee(s): ${codes}. Please verify employee email addresses in master and resend.`
      : "Email delivery failed for some employees. Please verify employee master email addresses and resend.";
    openWorkflowModal("revert_to_maker", note);
  };

  const handleWorkflowConfirm = async () => {
    const config = WORKFLOW_DIALOGS[activeWorkflowModal];
    if (!config) return;
    if (config.requireNotes && !workflowNotes.trim()) return;

    setTransitioning(true);
    try {
      const url = config.endpoint ? config.endpoint(id) : `/payroll/jobs/${id}/transition-status/`;
      let payload = {};
      if (config.getPayload) {
        payload = config.getPayload({ unsentCount }, workflowNotes.trim());
      } else {
        payload = { action: config.action };
        if (config.notesLabel) {
          payload.notes = workflowNotes.trim() || config.defaultNotes;
        }
      }

      const res = await api.post(url, payload);
      const isFinalizeWithCelery = activeWorkflowModal === "finalize_and_send" && res.data?.email_dispatched;
      setActiveWorkflowModal(null);
      setWorkflowNotes("");

      if (isFinalizeWithCelery) {
        const mode = res.data?.dispatch_mode === "thread" ? "thread" : "celery";
        setCeleryTracking({ active: true, startTime: Date.now(), mode });
        setWorkflowSuccessData({
          type: "celery_queued",
          title: mode === "thread" ? "🛡️ Direct Mail Dispatch Initiated" : "🚀 Automated Mail Dispatch Queued",
          subtitle: `${job?.client_company_name || ""} • ${job?.month_name || ""} ${job?.year || ""}`,
          message: mode === "thread"
            ? "Payroll calculations approved and sealed. Payslip emails are being dispatched in the background via our resilient direct server dispatch engine."
            : "Payroll calculations approved and sealed. Automated payslip email distribution has been queued and is dispatching in the background.",
          stats: [
            { label: "Job Status", value: "Approved • Dispatching…", color: "#d97706" },
            { label: "Dispatch Engine", value: mode === "thread" ? "Direct Server Dispatch (Failsafe Backup)" : "Automated Enterprise Queue", color: mode === "thread" ? "#d97706" : "#2563eb" },
            { label: "Recipients", value: `${unsentCount} Staff`, color: "#0f172a" },
          ],
          primaryText: "Keep Reviewing",
        });
      } else if (!config.navigateAway) {
        const msg = res?.data?.message || config.successMessage || "Action completed successfully!";
        setWorkflowSuccessData({
          type: "success",
          title: config.title || "Action Successful",
          subtitle: typeof config.subtitle === "function" ? config.subtitle(job, { unsentCount }) : config.subtitle,
          message: msg,
          primaryText: "Done",
        });
      }

      if (config.onSuccess) {
        config.onSuccess({ navigate, id, setChangesModalOpen, setWorkflowSuccessData }, navigate, id);
      }
      if (!config.navigateAway) {
        await loadAll();
      }
    } catch (err) {
      setWorkflowSuccessData({
        type: "email_failed",
        title: "Action Failed",
        message: err?.response?.data?.error || err?.response?.data?.message || err?.response?.data?.detail || err.message,
        primaryText: "Close",
      });
    } finally {
      setTransitioning(false);
    }
  };

  // Button Opener Aliases
  const handleSubmitForReview = () => openWorkflowModal("submit_review");
  const handleSendToApprover = () => openWorkflowModal("send_to_approver");
  const handleApproverSkip = () => openWorkflowModal("skip_approval");
  const handleApproverApprove = () => openWorkflowModal("approve_batch");

  // Sort field switcher with smart default order (amounts default to descending)
  const handleSortFieldChange = (newField) => {
    setSortField(newField);
    if (newField === "net_salary" || newField === "gross_salary") {
      setSortOrder("desc");
    } else {
      setSortOrder("asc");
    }
  };

  // Filtered and sorted records
  const filteredRecords = useMemo(() => {
    const list = records.filter((r) => {
      const q = searchTerm.toLowerCase().trim();
      const matchSearch = !q ||
        (r.employee_name || "").toLowerCase().includes(q) ||
        (r.employee_code || "").toLowerCase().includes(q) ||
        (r.employee_designation || "").toLowerCase().includes(q);

      if (!matchSearch) return false;

      if (filterMode === "changed") {
        return !!changesByEmpId[r.employee];
      }
      if (filterMode === "probation") {
        return !!r.is_probation;
      }
      return true;
    });

    return list.slice().sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = (a.employee_name || "").localeCompare(b.employee_name || "", undefined, { sensitivity: "base" });
      } else if (sortField === "code") {
        // Natural alphanumeric sort so INF001 < INF002 < ... < INF010 < INF031
        cmp = (a.employee_code || "").localeCompare(b.employee_code || "", undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "net_salary") {
        cmp = Number(a.net_salary || 0) - Number(b.net_salary || 0);
      } else if (sortField === "gross_salary") {
        cmp = Number(a.earned_salary || 0) - Number(b.earned_salary || 0);
      }

      // Secondary deterministic tie-breaker: Employee Code (natural alphanumeric)
      if (cmp === 0) {
        cmp = (a.employee_code || "").localeCompare(b.employee_code || "", undefined, { numeric: true, sensitivity: "base" });
      }

      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [records, searchTerm, filterMode, changesByEmpId, sortField, sortOrder]);

  // Hotspot 4 / Option 2.C: Keyboard navigation (Arrow Up / Down to traverse records)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;
      if (e.target?.isContentEditable) return;
      if (!filteredRecords || filteredRecords.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRecord((prev) => {
          if (!prev) return filteredRecords[0];
          const currIdx = filteredRecords.findIndex((r) => r.id === prev.id);
          if (currIdx === -1) return filteredRecords[0];
          const nextIdx = Math.min(filteredRecords.length - 1, currIdx + 1);
          return filteredRecords[nextIdx];
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRecord((prev) => {
          if (!prev) return filteredRecords[0];
          const currIdx = filteredRecords.findIndex((r) => r.id === prev.id);
          if (currIdx === -1) return filteredRecords[0];
          const prevIdx = Math.max(0, currIdx - 1);
          return filteredRecords[prevIdx];
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredRecords]);



  // Compute live totals from records: Earned Gross, Base Gross, Deductions, Net
  const totals = useMemo(() => {
    let earnedGross = 0;
    let baseGross = 0;
    let epf = 0;
    let esi = 0;
    let pt = 0;
    let tds = 0;
    let totalDeductions = 0;
    let net = 0;
    records.forEach((r) => {
      earnedGross += Number(r.earned_salary || 0);
      baseGross += Number(r.gross_salary || 0);
      epf += Number(r.epf || 0);
      esi += Number(r.esi || 0);
      pt += Number(r.professional_tax || 0);
      tds += Number(r.tds || 0);
      totalDeductions += Number(r.total_deductions || 0);
      net += Number(r.net_salary || 0);
    });
    return {
      earnedGross,
      baseGross,
      epf,
      esi,
      pt,
      tds,
      totalDeductions,
      net,
      count: records.length,
    };
  }, [records]);

  // Email delivery counts across batch records
  const { sentCount, failedCount, unsentCount } = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let unsent = 0;
    (records || []).forEach((r) => {
      if (r.status === "EMAIL_SENT") sent += 1;
      else if (r.status === "EMAIL_FAILED") failed += 1;
      else unsent += 1;
    });
    return { sentCount: sent, failedCount: failed, unsentCount: unsent };
  }, [records]);

  // Staff records with failed email delivery
  const failedEmailRecords = useMemo(() => {
    return (records || []).filter((r) => r.status === "EMAIL_FAILED");
  }, [records]);

  // Staff records with zero gross salary (requiring structure or audit acknowledgment)
  const zeroGrossRecords = useMemo(() => {
    return (records || []).filter((r) => Number(r.gross_salary || 0) <= 0);
  }, [records]);

  // Staff records with missing email addresses (warning pill during finalization)
  const missingEmailRecords = useMemo(() => {
    return (records || []).filter((r) => !r.employee_email || !String(r.employee_email).trim());
  }, [records]);

  // Micro-Pulse Glow effect on dispatch progress bar whenever another email delivery is confirmed
  const prevSentCountRef = useRef(0);
  const [isPulseGlow, setIsPulseGlow] = useState(false);

  useEffect(() => {
    if (sentCount > prevSentCountRef.current && prevSentCountRef.current > 0) {
      setIsPulseGlow(true);
      const timer = setTimeout(() => setIsPulseGlow(false), 900);
      prevSentCountRef.current = sentCount;
      return () => clearTimeout(timer);
    }
    prevSentCountRef.current = sentCount;
  }, [sentCount]);

  // Celery Live Background Email Queue Polling
  useEffect(() => {
    if (!celeryTracking?.active) return;

    const interval = setInterval(async () => {
      try {
        const recRes = await api.get(`/payroll/jobs/${id}/batch-records/`).catch(() => ({ data: [] }));
        const recs = recRes.data || [];
        setRecords(recs);

        const unsent = recs.filter((r) => r.status !== "EMAIL_SENT" && r.status !== "EMAIL_FAILED").length;
        const failed = recs.filter((r) => r.status === "EMAIL_FAILED");
        const sent = recs.filter((r) => r.status === "EMAIL_SENT").length;

        // When all records finish processing in Celery
        if (unsent === 0) {
          // Cease active polling and transition to 4.5s celebration shelf in footer
          setCeleryTracking((prev) => (prev ? { ...prev, active: false, completed: true } : null));
          setTimeout(() => {
            setCeleryTracking(null);
          }, 4500);

          api.get(`/payroll/jobs/${id}/`).then((j) => setJob(j.data)).catch(() => { });

          if (failed.length === 0) {
            setWorkflowSuccessData({
              type: "email_success",
              title: "🎉 All Payslip Emails Delivered & Verified",
              subtitle: `${job?.client_company_name || ""} • ${job?.month_name || ""} ${job?.year || ""}`,
              message: `All ${sent} employee payslips have been successfully dispatched and delivered to employee inboxes. Audit trail updated and register sealed.`,
              stats: [
                { label: "Total Delivered", value: sent, color: "#166534" },
                { label: "Delivery Rate", value: "100%", color: "#15803d" },
                { label: "Statutory Status", value: "Sealed & Dispatched", color: "#166534" },
              ],
              primaryText: "Done",
            });
          } else {
            setWorkflowSuccessData({
              type: "email_failed",
              title: "⚠️ Email Distribution Completed with Delivery Exceptions",
              subtitle: `${job?.client_company_name || ""} • ${job?.month_name || ""} ${job?.year || ""}`,
              message: `${sent} email(s) were delivered successfully, but ${failed.length} employee delivery exception(s) require review.`,
              details: failed.map((r) => ({
                name: r.employee_name,
                email: r.employee_email,
                error: "Mail server delivery exception",
              })),
              stats: [
                { label: "Delivered", value: sent, color: "#166534" },
                { label: "Exceptions", value: failed.length, color: "#b91c1c" },
              ],
              primaryText: "Review Table",
              secondaryText: "↩️ Return to Maker (Rework)",
              onSecondary: () => handleReworkFailedEmails(failed),
            });
          }
        }
      } catch (e) {
        console.error("Celery polling error:", e);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [celeryTracking, id, job?.client_company_name, job?.month_name, job?.year]);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#64748b", fontFamily: "system-ui" }}>
        Loading Payroll Batch Review Workspace…
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ padding: 48, textAlign: "center", fontFamily: "system-ui" }}>
        <p style={{ color: "#ef4444", fontWeight: 700 }}>Payroll Job not found.</p>
        <button
          onClick={() => navigate("/payroll")}
          style={{ padding: "8px 16px", background: "#1A2F5A", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const taskId = job.task_id || (job.task ? `TASK-${job.task}` : `JOB-${job.id}`);

  return (
    <div style={embedded ? {
      width: "100%",
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: "#f8fafc",
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      color: "#0f172a",
    } : {
      display: "flex",
      flexDirection: "column",
      background: "#f8fafc",
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      color: "#0f172a",
    }}>
      {/* Main Page Content Body */}
      <div className={`flex flex-col flex-1 ${embedded ? "pb-0" : "pb-7"}`}>
        {/* Breadcrumb Navigation - only when standalone page */}
        {!embedded && (
          <div className="text-[12.5px] text-slate-500 mb-2 flex items-center gap-2 shrink-0">
            <span
              onClick={() => navigate("/direct-tax")}
              className="cursor-pointer hover:text-[#1e3a5f] transition-colors"
            >
              Direct Tax
            </span>
            <span className="opacity-50">›</span>
            <span
              onClick={() => navigate("/payroll")}
              className="cursor-pointer hover:text-[#1e3a5f] transition-colors"
            >
              Monthly Payroll
            </span>
            <span className="opacity-50">›</span>
            <span
              onClick={() => navigate(`/payroll/jobs/${id}`)}
              className="cursor-pointer font-semibold text-[#1e3a5f] hover:underline"
            >
              {job.client_name ? job.client_name.toUpperCase() : "CLIENT"} ({taskId})
            </span>
            <span className="opacity-50">›</span>
            <span className="font-bold text-slate-900">Total Batch Review & Verification</span>
          </div>
        )}

        {/* KPI Stat Summary Cards - Streamlined De-Duplicated Executive Strip */}
        <div className={`grid grid-cols-2 sm:grid-cols-3 ${totals.esi > 0 ? "md:grid-cols-6" : "md:grid-cols-5"} gap-2.5 mb-2.5 shrink-0`}>
          <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-[0.04em]">Earned Salary</div>
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                {totals.count} Staff
              </span>
            </div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">{fmtCurrency(totals.earnedGross)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Base Structure: {fmtCurrency(totals.baseGross)}</div>
          </div>
          <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-[0.04em]">Employee PF</div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">{fmtCurrency(totals.epf)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">12% statutory cap</div>
          </div>
          {totals.esi > 0 && (
            <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-[0.04em]">ESI Deducted</div>
              <div className="text-base font-extrabold text-slate-900 mt-0.5">{fmtCurrency(totals.esi)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">0.75% statutory</div>
            </div>
          )}
          <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-[0.04em]">Professional Tax</div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">{fmtCurrency(totals.pt)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">State slab deduction</div>
          </div>
          <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-[0.04em]">TDS Deducted</div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">{fmtCurrency(totals.tds)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Tax withholding</div>
          </div>
          <div className="bg-emerald-50 px-3.5 py-2.5 rounded-lg border border-emerald-300 shadow-2xs">
            <div className="text-[9.5px] font-bold text-emerald-800 uppercase tracking-[0.04em]">Net Disbursal</div>
            <div className="text-base font-extrabold text-emerald-700 mt-0.5">{fmtCurrency(totals.net)}</div>
            <div className="text-[10px] text-emerald-700 mt-0.5">Earned Salary − Deductions</div>
          </div>
        </div>

        {/* Unified Review Workspace Card (Toolbar + Single Table) */}
        <div className={`flex flex-col bg-white rounded-xl border border-slate-300 shadow-sm overflow-visible relative transition-[z-index] ${columnsMenuOpen ? "z-[1050]" : "z-10"}`}>
          {/* Table Filter, Search & View Mode Switcher */}
          <div
            ref={searchToolbarRef}
            className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3 rounded-t-xl relative z-40"
          >
            <div className="flex items-center gap-3 flex-1 max-w-[420px]">
              <div className="relative w-full">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by code, name, designation…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-300 text-[12.5px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 box-border bg-white"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    title="Clear search"
                    className="absolute right-2 top-2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Quick Filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFilterMode("all")}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${filterMode === "all"
                    ? "bg-[#1A2F5A] text-white border border-[#1A2F5A]"
                    : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
                    }`}
                >
                  All ({records.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("changed")}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 ${filterMode === "changed"
                    ? "bg-purple-50 text-purple-700 border border-purple-600"
                    : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
                    }`}
                >
                  <Sparkles size={13} />
                  <span>Changed ({Object.keys(changesByEmpId).length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("probation")}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${filterMode === "probation"
                    ? "bg-amber-50 text-amber-700 border border-amber-600"
                    : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
                    }`}
                >
                  Probation
                </button>
                <button
                  type="button"
                  disabled={!canEditBatch || recalculating}
                  onClick={async () => {
                    if (!canEditBatch || recalculating) return;
                    setRecalculating(true);
                    try {
                      const res = await api.post(`/payroll/jobs/${job.id}/recalculate-batch/`);
                      const recomputedCount = res?.data?.recomputed_count || records.length;
                      setWorkflowSuccessData({
                        type: "recalculate_done",
                        title: "Recalculation Complete",
                        message: `Successfully recalculated ${recomputedCount} payslip records from active salary structures and statutory policies. Staged monthly inputs, TDS, arrears, and variable pay have been preserved.`,
                        primaryText: "Close",
                      });
                      const recRes = await api.get(`/payroll/jobs/${job.id}/batch-records/`).catch(() => ({ data: [] }));
                      setRecords(recRes.data || []);
                      fetchMomVariance(false);
                    } catch (e) {
                      setWorkflowSuccessData({
                        type: "recalculate_error",
                        title: "Recalculation Failed",
                        message: "Recalculation error: " + (e?.response?.data?.error || e.message),
                        primaryText: "Close",
                      });
                    } finally {
                      setRecalculating(false);
                    }
                  }}
                  title={canEditBatch
                    ? "Re-derives earned salary and deductions for all active records from active salary structures without resetting custom upload inputs"
                    : "Batch is locked / finalized — cannot recalculate"
                  }
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${canEditBatch && !recalculating
                    ? "cursor-pointer bg-white text-slate-600 border border-slate-300 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 shadow-2xs"
                    : "cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200"
                    }`}
                >
                  <RotateCcw size={12} className={recalculating ? "animate-spin text-blue-600" : ""} />
                  <span>{recalculating ? "Recalculating..." : "Recalculate"}</span>
                </button>

                {/* Option 2: MoM Net Waterfall Bridge Toolbar Button */}
                {momData?.has_prior_batch ? (
                  <div className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50/70 p-0.5 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => {
                        setAnomalyFilter("all");
                        setMomModalOpen(true);
                      }}
                      className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-indigo-900 hover:text-indigo-950 hover:bg-indigo-100/70 rounded transition-colors"
                      title={`Open MoM Net Waterfall Bridge (${momData.prior_period} → ${momData.current_period})`}
                    >
                      <span className="text-[13px]">📈</span>
                      <span>MoM Waterfall Bridge</span>
                      <span className="text-[10px] font-mono text-indigo-700 bg-white/90 px-1.5 py-0.2 rounded border border-indigo-100 font-semibold">
                        vs {momData.prior_period}
                      </span>
                    </button>
                    {momData.anomalies_count > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAnomalyFilter("anomalies");
                          setMomModalOpen(true);
                        }}
                        className="cursor-pointer inline-flex items-center gap-1 px-1.5 py-0.5 ml-1 bg-amber-500 text-white rounded text-[10.5px] font-extrabold hover:bg-amber-600 transition-colors shadow-2xs"
                        title="Click to view checker alerts"
                      >
                        <AlertTriangle size={11} />
                        <span>{momData.anomalies_count} Alerts</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 ml-1 text-emerald-700 text-[10.5px] font-bold" title="Reconciled without anomalies">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fetchMomVariance(true)}
                    disabled={momLoading}
                    className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-indigo-900 bg-indigo-50/70 border border-indigo-200 hover:bg-indigo-100 rounded-md transition-colors shadow-2xs"
                    title="Check Month-over-Month variance reconciliation bridge"
                  >
                    <span className="text-[13px]">📈</span>
                    <span>{momLoading ? "Loading MoM…" : "MoM Variance"}</span>
                  </button>
                )}

                {/* Salary on Hold Management Pill Button (Relocated beside MoM Variance) */}
                <button
                  type="button"
                  onClick={() => setHoldDrawerOpen(true)}
                  className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold border transition-all shadow-2xs whitespace-nowrap shrink-0 ${holdData.total_on_hold_count > 0
                    ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 shadow-amber-100"
                    : "bg-slate-50/70 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  title={
                    holdData.total_on_hold_count > 0
                      ? `Salary on Hold: ${holdData.total_on_hold_count} staff with ₹${Number(holdData.total_closing_hold_amount || 0).toLocaleString()} held in trust. Click to manage/release.`
                      : "Manage and release salaries on hold (0 currently held)"
                  }
                >
                  <Lock size={13} className={holdData.total_on_hold_count > 0 ? "text-amber-700" : "text-slate-400"} />
                  <span>
                    {holdData.total_on_hold_count > 0
                      ? `${holdData.total_on_hold_count} On Hold (₹${Number(holdData.total_closing_hold_amount || 0).toLocaleString()})`
                      : "Salary on Hold"}
                  </span>
                  {holdData.total_on_hold_count > 0 && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                  )}
                </button>

                {/* Option 1: 1-Click CTC Waterfall Group Toggle */}
                <button
                  type="button"
                  onClick={toggleCtcWaterfall}
                  className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold border transition-all shadow-2xs whitespace-nowrap shrink-0 ${isCtcWaterfallActive
                    ? "bg-indigo-50 text-indigo-700 border-indigo-400 hover:bg-indigo-100"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                  title="Toggle CTC to Base Gross Waterfall columns (Annual CTC, Monthly CTC, Carve-Outs, Base Gross)"
                >
                  <span>📊 CTC Waterfall</span>
                  <span
                    className={`text-[9.5px] font-extrabold px-1.5 py-0.2 rounded leading-none ${isCtcWaterfallActive
                      ? "bg-indigo-200 text-indigo-900"
                      : "bg-slate-100 text-slate-500"
                      }`}
                  >
                    {isCtcWaterfallActive ? "ON" : "OFF"}
                  </span>
                </button>

                {/* Column Visibility Menu Button & Popover */}
                <div className="relative" ref={columnsMenuRef}>
                  <button
                    type="button"
                    onClick={() => setColumnsMenuOpen((v) => !v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-colors ${columnsMenuOpen
                      ? "bg-blue-50 text-blue-700 border border-blue-600"
                      : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
                      }`}
                    title="Show / hide table columns"
                  >
                    <Eye size={13} />
                    <span>Columns ({visibleCount}/{allColumns.length})</span>
                  </button>

                  {columnsMenuOpen && (
                    <div
                      className="absolute top-[calc(100%+6px)] right-0 w-96 max-h-[min(480px,calc(100vh-220px))] bg-white rounded-xl border border-slate-300 shadow-[0_20px_50px_rgba(15,23,42,0.25)] ring-1 ring-slate-900/10 flex flex-col z-[1100] animate-in fade-in zoom-in-95 duration-100"
                    >
                      {/* Popover Header */}
                      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between rounded-t-xl shrink-0">
                        <div className="font-bold text-xs text-slate-800">
                          Visible Columns ({visibleCount}/{allColumns.length})
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={handleShowAllCols}
                            className="bg-transparent border-0 text-blue-600 hover:text-blue-700 cursor-pointer p-0 font-semibold"
                          >
                            Show All
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={handleTotalsOnlyCols}
                            className="bg-transparent border-0 text-slate-500 hover:text-slate-700 cursor-pointer p-0 font-semibold"
                          >
                            Totals Only
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={handleResetDefaultCols}
                            className="bg-transparent border-0 text-amber-600 hover:text-amber-700 cursor-pointer p-0 font-semibold"
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      {/* Smart Filter vs Full List Switcher (Option 3) */}
                      <div className="px-3 py-1.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-1.5 text-[11px] shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowAllUnfilteredCols((prev) => !prev)}
                          className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition-all cursor-pointer flex items-center gap-1 ${showAllUnfilteredCols
                            ? "bg-purple-50 text-purple-700 border-purple-300"
                            : "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                            }`}
                          title={showAllUnfilteredCols ? "Switch back to Smart Zero-Suppression" : "Show all 35+ available columns (including zero-sum columns)"}
                        >
                          <span>{showAllUnfilteredCols ? "Showing All (35+)" : "⚡ Smart Filter Active"}</span>
                        </button>
                        <span className="text-[10px] text-slate-400 font-medium truncate">
                          {showAllUnfilteredCols ? "All client columns" : "Hiding 0 / unconfigured"}
                        </span>
                      </div>

                      {/* Search Filter Input & Quick Group Toggles (Option 4) */}
                      <div className="p-2 border-b border-slate-100 bg-white shrink-0 space-y-1.5">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Filter columns..."
                            value={colSearchQuery}
                            onChange={(e) => setColSearchQuery(e.target.value)}
                            className="w-full pl-7 pr-6 py-1 rounded border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50"
                          />
                          {colSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setColSearchQuery("")}
                              className="absolute right-1.5 top-1 p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                              title="Clear filter"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>

                        {/* Quick Group Toggle Chips */}
                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          {["CTC & Retirals", "Attendance", "Earnings", "Deductions", "Summary"].map((gName) => {
                            const gCols = allColumns.filter((c) => c.group === gName);
                            if (gCols.length === 0) return null;
                            const isGroupOn = gCols.some((c) => isColVisible(c.key));
                            const shortLabel = gName === "CTC & Retirals" ? "CTC" : gName;
                            return (
                              <button
                                key={gName}
                                type="button"
                                onClick={() => {
                                  const nextState = !isGroupOn;
                                  setVisibleCols((prev) => {
                                    const next = { ...prev };
                                    gCols.forEach((c) => { next[c.key] = nextState; });
                                    return next;
                                  });
                                }}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer ${isGroupOn
                                  ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                  : "bg-slate-50 text-slate-400 border-slate-200 line-through hover:bg-slate-100"
                                  }`}
                                title={`${isGroupOn ? "Hide" : "Show"} all ${gName} columns`}
                              >
                                {shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Popover Body with Scroll */}
                      <div className="p-2.5 px-3 overflow-y-auto flex-1 divide-y divide-slate-100 rounded-b-xl">
                        {["CTC & Retirals", "Attendance", "Earnings", "Deductions", "Summary"].map((groupName) => {
                          const allGroupCols = allColumns.filter((c) => c.group === groupName);
                          if (allGroupCols.length === 0) return null;

                          const filteredGroupCols = allGroupCols.filter((c) => {
                            if (!colSearchQuery.trim()) return true;
                            const q = colSearchQuery.toLowerCase();
                            return (
                              c.label.toLowerCase().includes(q) ||
                              (c.fullLabel && c.fullLabel.toLowerCase().includes(q)) ||
                              c.key.toLowerCase().includes(q)
                            );
                          });

                          if (filteredGroupCols.length === 0) return null;

                          const activeCount = allGroupCols.filter((c) => isColVisible(c.key)).length;
                          const allGroupChecked = allGroupCols.every((c) => isColVisible(c.key));

                          return (
                            <div key={groupName} className="py-2 first:pt-0 last:pb-0">
                              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider py-1 mb-1">
                                <span>{groupName} <span className="text-[10px] text-slate-400 font-semibold lowercase">({activeCount}/{allGroupCols.length})</span></span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = !allGroupChecked;
                                    setVisibleCols((prev) => {
                                      const updated = { ...prev };
                                      allGroupCols.forEach((c) => { updated[c.key] = nextVal; });
                                      return updated;
                                    });
                                  }}
                                  className="bg-transparent border-0 text-[10px] text-blue-500 hover:text-blue-600 cursor-pointer p-0 font-semibold"
                                >
                                  {allGroupChecked ? "Hide Group" : "Show Group"}
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                {filteredGroupCols.map((col) => {
                                  const isChecked = isColVisible(col.key);
                                  return (
                                    <label
                                      key={col.key}
                                      className={`flex items-center gap-1.5 text-[11.5px] cursor-pointer py-0.5 px-1 rounded hover:bg-slate-50 select-none transition-colors ${isChecked ? "text-slate-900" : "text-slate-400"
                                        }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleCol(col.key)}
                                        className="cursor-pointer accent-blue-600 rounded"
                                      />
                                      <span title={col.fullLabel} className="inline-flex items-center gap-1 truncate">
                                        <span className="truncate">{col.label}</span>
                                        {col.isCustom && (
                                          <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-0.5 rounded border border-amber-200 shrink-0" title="Custom component">
                                            ✨
                                          </span>
                                        )}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {colSearchQuery && !["CTC & Retirals", "Attendance", "Earnings", "Deductions", "Summary"].some((groupName) =>
                          allColumns.some((c) => c.group === groupName && (
                            c.label.toLowerCase().includes(colSearchQuery.toLowerCase()) ||
                            (c.fullLabel && c.fullLabel.toLowerCase().includes(colSearchQuery.toLowerCase())) ||
                            c.key.toLowerCase().includes(colSearchQuery.toLowerCase())
                          ))
                        ) && (
                            <div className="py-6 text-center text-xs text-slate-400">
                              No columns match "{colSearchQuery}"
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Interactive Sort Switcher (Option 2 Default Name A–Z + Option 3 Controls) */}
                <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-300">
                  <ArrowUpDown size={13} className="text-slate-500 shrink-0" />
                  <span className="text-[11.5px] font-semibold text-slate-500 whitespace-nowrap">
                    Sort:
                  </span>
                  <select
                    value={sortField}
                    onChange={(e) => handleSortFieldChange(e.target.value)}
                    className="border-0 bg-transparent text-xs font-semibold text-slate-800 outline-none cursor-pointer pr-0.5"
                  >
                    <option value="name">Name (A–Z)</option>
                    <option value="code">Employee Code</option>
                    <option value="net_salary">Net Pay</option>
                    <option value="gross_salary">Earned Salary</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                    title={`Current: ${sortOrder === "asc" ? "Ascending (Low-to-High / A-Z)" : "Descending (High-to-Low / Z-A)"}. Click to flip.`}
                    className="inline-flex items-center justify-center bg-white border border-slate-300 rounded px-1.5 py-0.5 cursor-pointer text-[11px] font-bold text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors leading-none"
                  >
                    {sortOrder === "asc" ? "↑ Asc" : "↓ Desc"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live background dispatch console is docked cleanly inside the viewport footer */}

          {/* Master Batch Review Data Table (Detailed Register Grid View with Native Sticky Header) */}
          <div
            ref={tableContainerRef}
            className="rounded-b-xl"
            style={{
              maxHeight: embedded ? "calc(100vh - 304px)" : "calc(100vh - 254px)",
              minHeight: "320px",
              overflow: "auto",
              background: "#ffffff",
            }}
          >
            {/* ── Detailed Register Grid View (All Components, Single Row, Excel-Style Borders) ── */}
            {(() => {
              // Pure cell calculations and row rendering are handled via memoized BatchRegisterRow
              return (
                <table style={{
                  width: "max-content",
                  minWidth: "100%",
                  tableLayout: "fixed",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  emptyCells: "show",
                  fontSize: 12,
                  textAlign: "left",
                  borderLeft: "1px solid #e2e8f0",
                }}>
                  {renderColGroup()}
                  <thead style={{ position: "sticky", top: 0, zIndex: 20, boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)" }}>
                    <tr style={{ background: "#f8fafc" }}>
                      {renderHeaderCells()}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={2 + visibleCount + (showActionsColumn ? 1 : 0)} style={{ padding: 36, textAlign: "center", color: "#94a3b8" }}>
                          No employee records matched the filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((r, idx) => (
                        <BatchRegisterRow
                          key={r.id}
                          record={r}
                          idx={idx}
                          isSelected={selectedRecord?.id === r.id}
                          empChanges={changesByEmpId[r.employee] || changesByEmpId[r.employee_code] || []}
                          empChangedSet={changedFieldsByEmpId[r.employee] || changedFieldsByEmpId[r.employee_code]}
                          isColVisible={isColVisible}
                          fmt={fmt}
                          customEarnings={customEarnings}
                          customDeductions={customDeductions}
                          getRecordCustomValue={getRecordCustomValue}
                          currentMonth={currentMonth}
                          job={job}
                          showActionsColumn={showActionsColumn}
                          canSendPayslip={canSendPayslip}
                          isChecker={isChecker}
                          isSendingEmail={sendingEmailId === r.id}
                          onSelectRecord={setSelectedRecord}
                          onOpenHistoryRecord={setHistoryRecord}
                          onRequestSendSingleEmail={handleRequestSendSingleEmail}
                          onDownloadPDF={downloadPDF}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div> {/* Closes Unified Review Workspace Card */}

        {/* Full-Width Fixed Viewport Action Dock & Live Dispatch Console (Permanently Glued to Screen Floor) */}
        <div
          className="fixed bottom-0 right-0 z-[1000] flex flex-col transition-[left] duration-200 pointer-events-auto"
          style={{ left: embedded ? siderWidth : 0 }}
        >
          {/* Animated Top-Shelf Live Email Queue Tracker */}
          {Boolean(celeryTracking?.active || celeryTracking?.completed) && (() => {
            const totalRecords = records.length || 1;
            const pct = Math.min(100, Math.round((sentCount / totalRecords) * 100));
            const isThread = celeryTracking?.mode === "thread";
            const isCompleted = Boolean(celeryTracking?.completed);

            return (
              <div
                className={`w-full bg-slate-900/95 backdrop-blur-md border-t border-b border-slate-700/80 text-slate-50 px-6 py-2.5 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.3)] flex-wrap gap-3 animate-in slide-in-from-bottom duration-300 ${isCompleted
                  ? "border-l-4 border-l-emerald-500"
                  : isThread
                    ? "border-l-4 border-l-amber-500"
                    : "border-l-4 border-l-sky-400"
                  }`}
              >
                {/* Left: Dispatch Engine status, Live Radar Indicator & Message */}
                <div className="flex items-center gap-3.5 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    {/* Glowing radar ping indicator */}
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCompleted ? "bg-emerald-400" : isThread ? "bg-amber-400" : "bg-sky-400"
                          }`}
                      />
                      <span
                        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isCompleted ? "bg-emerald-500" : isThread ? "bg-amber-500" : "bg-sky-500"
                          }`}
                      />
                    </span>

                    <RotateCcw
                      size={14}
                      className={`animate-spin shrink-0 ${isCompleted ? "text-emerald-400 [animation-play-state:paused]" : isThread ? "text-amber-400" : "text-sky-400"
                        }`}
                    />

                    <span className="font-extrabold text-[13px] text-white tracking-tight">
                      {isCompleted
                        ? "🎉 All Payslip Emails Delivered & Verified"
                        : isThread
                          ? "🛡️ Direct Server Dispatch Active"
                          : "⚡ Automated Enterprise Dispatch Active"}
                    </span>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border tracking-wider uppercase ${isCompleted
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : isThread
                          ? "bg-amber-500/15 text-amber-300 border-amber-500/35"
                          : "bg-sky-400/15 text-sky-300 border-sky-400/35"
                        }`}
                    >
                      {isCompleted
                        ? "Delivered & Sealed"
                        : isThread
                          ? "Direct Dispatch (Failsafe Backup)"
                          : "Enterprise Async Queue"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span>
                      {isCompleted
                        ? "All employee inboxes confirmed"
                        : isThread
                          ? "Delivering payslips via resilient direct dispatch"
                          : "Delivering payslips via automated queue engine"}
                    </span>
                    <span className="opacity-40">•</span>
                    <span>
                      <strong className="text-white font-mono">{sentCount}</strong> of{" "}
                      <strong className="text-white font-mono">{records.length}</strong> delivered ({pct}%)
                    </span>
                  </div>
                </div>

                {/* Right: Progress bar track, Failed pill & Dismiss */}
                <div className="flex items-center gap-3">
                  {/* Horizontal progress bar with live glowing pulse on increment */}
                  <div className="flex items-center gap-2 bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-700/80 shadow-inner">
                    <div className="w-[130px] h-2 bg-slate-800 rounded-full overflow-hidden relative">
                      <div
                        style={{ width: `${pct}%` }}
                        className={`h-full rounded-full transition-all duration-500 ease-out ${isCompleted
                          ? "bg-gradient-to-r from-emerald-500 to-green-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                          : isThread
                            ? "bg-gradient-to-r from-amber-500 to-emerald-500"
                            : "bg-gradient-to-r from-sky-400 via-indigo-500 to-emerald-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]"
                          } ${isPulseGlow ? "brightness-125 ring-2 ring-emerald-400" : ""}`}
                      />
                    </div>
                    <span
                      className={`text-[11px] font-mono font-bold min-w-[32px] text-right ${isCompleted ? "text-emerald-400" : isThread ? "text-amber-400" : "text-sky-400"
                        }`}
                    >
                      {pct}%
                    </span>
                  </div>

                  {failedCount > 0 && (
                    <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded text-[11px] font-bold">
                      ⚠️ {failedCount} Delivery Exceptions
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setCeleryTracking(null)}
                    className="bg-white/10 hover:bg-white/20 border border-white/20 text-slate-200 px-2.5 py-1 rounded-md text-[11.5px] font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    title="Dismiss notification bar"
                  >
                    <span>✕</span>
                    <span>Dismiss</span>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Primary Action Bar */}
          <div className="bg-white/98 backdrop-blur-md border-t border-slate-300 shadow-[0_-4px_20px_-2px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.04)] px-6 py-2.5 min-h-[52px] flex items-center justify-between flex-wrap gap-3.5">
            {/* Left: Audit Details, Reset Batch & Staff Metric Pills */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {isChecker && job?.status !== "Done" && (
                <button
                  type="button"
                  onClick={() => openWorkflowModal("reset_batch")}
                  disabled={transitioning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[12.5px] font-bold cursor-pointer shadow-sm hover:bg-rose-100 hover:border-rose-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Checker authority: Purge all staged inputs and restart batch cleanly from master structures"
                >
                  <RotateCcw size={14} />
                  <span>Reset Batch</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setChangesModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[12.5px] font-bold cursor-pointer shadow-sm hover:bg-emerald-100 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 transition-all"
                title="Inspect staged monthly adjustments and Excel revisions in dedicated modal"
              >
                <span>📝 View Audit Details</span>
                <span
                  className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded-full ${(changes.summary?.pending || 0) > 0
                    ? "bg-amber-200 text-amber-900 animate-pulse"
                    : "bg-emerald-200 text-emerald-900"
                    }`}
                >
                  {changes.summary?.total || 0}
                </span>
              </button>

              {/* Micro-Dashboard Delivery Pill Group */}
              <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                <div className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-600 font-semibold">
                  <Users size={13} className="text-slate-500" />
                  <span><strong className="text-slate-900">{records.length}</strong> Staff</span>
                </div>

                <span className="w-px h-3 bg-slate-300" />

                <div className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${sentCount > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                  <CheckCircle2 size={13} className={sentCount > 0 ? "text-emerald-600" : "text-slate-400"} />
                  <span><strong className={sentCount > 0 ? "text-emerald-800" : "text-slate-600"}>{sentCount}</strong> Emailed</span>
                </div>

                {unsentCount > 0 && (
                  <>
                    <span className="w-px h-3 bg-slate-300" />
                    <div className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Clock size={11} className="text-amber-600" />
                      <span>{unsentCount} Unsent</span>
                    </div>
                  </>
                )}

                {zeroGrossRecords.length > 0 && (
                  <>
                    <span className="w-px h-3 bg-slate-300" />
                    <div
                      title={`Zero Gross Staff (${zeroGrossRecords.length}): ${zeroGrossRecords.map((r) => `${r.employee_code || ""}: ${r.employee_name || "Staff"}`).join(", ")}`}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 cursor-help"
                    >
                      <AlertTriangle size={11} className="text-rose-600" />
                      <span>{zeroGrossRecords.length} with ₹0 Gross</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Primary Action Buttons */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Option 4: Export Official Register (Available strictly once batch is sealed as Done) */}
              {job.status === "Done" && (
                <button
                  type="button"
                  onClick={handleDownloadExcel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white text-slate-700 border border-slate-300 rounded-lg text-[12.5px] font-semibold whitespace-nowrap shrink-0 cursor-pointer shadow-sm hover:bg-slate-50 hover:border-slate-400 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 transition-all"
                  title="Download full detailed multi-column payroll register in Excel format"
                >
                  <FileSpreadsheet size={15} className="text-emerald-600 shrink-0" />
                  <span>Export Register (.xlsx)</span>
                </button>
              )}

              {/* Checker Action: Apply Pending Inputs */}
              {changes.summary?.pending > 0 && isChecker && (
                <button
                  type="button"
                  onClick={handleApplyInputs}
                  disabled={transitioning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-sm hover:bg-emerald-100 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Approve and apply pending Maker adjustments into the batch"
                >
                  <CheckCircle2 size={15} className="shrink-0" />
                  <span>Apply {changes.summary.pending} Pending Changes</span>
                </button>
              )}

              {/* Checker Action: Revert to Maker (when batch is Under Review or Approved) */}
              {isChecker && (job?.status === "Under Review" || job?.status === "Approved") && (
                <button
                  type="button"
                  onClick={() => {
                    if (failedEmailRecords.length > 0) {
                      handleReworkFailedEmails(failedEmailRecords);
                    } else {
                      openWorkflowModal("revert_to_maker");
                    }
                  }}
                  disabled={transitioning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-sm hover:bg-rose-100 hover:border-rose-300 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Checker authority: Revert batch back to Maker for adjustments"
                >
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>Rework</span>
                </button>
              )}

              {/* Admin / Founder Action: Reopen (Strictly when Done) */}
              {job.status === "Done" && isAdminOrFounder && (
                <button
                  type="button"
                  onClick={() => openWorkflowModal("reopen_batch")}
                  disabled={transitioning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white text-amber-700 border border-amber-300 rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-sm hover:bg-amber-50 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-amber-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Only Admins and Founders can reopen a finalized payroll"
                >
                  <RotateCcw size={14} className="shrink-0" />
                  <span>{transitioning ? "Reopening…" : "Reopen Batch"}</span>
                </button>
              )}

              {/* Maker Action during In Progress / To Do / Rework: Submit to Checker for Review */}
              {isMaker && ["In Progress", "To Do", "Rework"].includes(job?.status) && (
                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  disabled={transitioning}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-900 to-blue-600 text-white rounded-lg text-[13px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-md hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Submit completed payroll batch to the assigned Checker for audit and verification"
                >
                  <Send size={15} className="shrink-0" />
                  <span>{transitioning ? "Submitting…" : "Submit for Review"}</span>
                </button>
              )}

              {/* Checker View during In Progress / To Do / Rework: Informational Drafting Badge */}
              {isChecker && ["In Progress", "To Do", "Rework"].includes(job?.status) && (
                <div className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-[12.5px] font-semibold whitespace-nowrap shrink-0">
                  <Clock size={14} className="text-blue-500 shrink-0" />
                  <span>Drafting by Maker — Awaiting Submission for Review</span>
                </div>
              )}

              {/* Under Review & Approved Workflow: Approver Decision & Finalize Gate */}
              {(job?.status === "Under Review" || job?.status === "Approved") && (
                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* State 1: Awaiting Initial Approver Decision (Send vs Skip) - Strictly Checker authority */}
                  {job?.status === "Under Review" && !job?.approver_status?.status && isChecker && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSendToApprover}
                        disabled={transitioning}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Forward batch to Admin or Founder for leadership review & sign-off"
                      >
                        <ShieldCheck size={15} className="shrink-0" />
                        <span>Send to Approver</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleApproverSkip}
                        disabled={transitioning}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white text-slate-600 border border-slate-300 rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Skip Admin / Founder sign-off and directly unlock finalization buttons"
                      >
                        <FastForward size={14} className="shrink-0" />
                        <span>Skip Approval</span>
                      </button>
                    </div>
                  )}

                  {/* State 2: Sent to Approver - Awaiting Admin / Founder Approval */}
                  {job?.status === "Under Review" && job?.approver_status?.status === "SENT_TO_APPROVER" && (
                    <div className="flex items-center gap-2">
                      {isAdminOrFounder ? (
                        <>
                          <button
                            type="button"
                            onClick={handleApproverApprove}
                            disabled={transitioning}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-lg text-[13px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-md hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Leadership sign-off: Approve this payroll batch for finalization and dispatch"
                          >
                            <CheckCircle2 size={16} className="shrink-0" />
                            <span>Approve Batch</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openWorkflowModal("reject_batch")}
                            disabled={transitioning}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white text-rose-700 border border-rose-200 rounded-lg text-[12.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer shadow-sm hover:bg-rose-50 hover:border-rose-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Reject batch and return to Maker in Rework status with required remarks"
                          >
                            <span className="shrink-0">✕</span>
                            <span>Reject Batch</span>
                          </button>
                        </>
                      ) : (
                        <div className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[12.5px] font-semibold whitespace-nowrap shrink-0">
                          <Clock size={14} className="text-amber-600 shrink-0" />
                          <span>⏳ Sent to Approver — Awaiting Admin / Founder Decision</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* State 3: Approved or Skipped - Finalization Buttons Unlocked */}
                  {(job?.status === "Approved" || job?.approver_status?.status === "APPROVER_APPROVED" || job?.approver_status?.status === "APPROVER_SKIPPED") && (
                    isChecker ? (
                      <div className="flex items-center gap-2">
                        {/* Option to Mark Done by skipping email dispatch */}
                        {unsentCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (changes.summary?.pending > 0) {
                                setDialogConfig({
                                  isOpen: true,
                                  type: "alert",
                                  variant: "warning",
                                  title: "Pending Inputs Require Review",
                                  message: `Cannot finalize yet: There are ${changes.summary.pending} pending staged inputs awaiting your decision. Please review and apply or exclude them in the Audit Details modal first.`,
                                  confirmText: "Open Audit Details",
                                  onConfirm: () => {
                                    closeDialog();
                                    setChangesModalOpen(true);
                                  },
                                });
                                return;
                              }
                              openWorkflowModal("finalize_skip_emails");
                            }}
                            disabled={transitioning || (changes.summary?.pending > 0)}
                            className={`inline-flex items-center gap-1.5 px-4 py-2.5 bg-white text-emerald-700 border border-emerald-300 rounded-lg text-[12.5px] font-bold shadow-sm whitespace-nowrap shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 transition-all ${changes.summary?.pending > 0
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer hover:bg-emerald-50 hover:border-emerald-400 hover:-translate-y-0.5"
                              }`}
                            title="Seal batch and mark job as Done without dispatching bulk emails"
                          >
                            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                            <span>Mark Done (Skip Emailing)</span>
                          </button>
                        )}

                        {/* Primary Finalize Button with Modern Gradient & Glow */}
                        <button
                          type="button"
                          onClick={() => {
                            if (changes.summary?.pending > 0) {
                              setDialogConfig({
                                isOpen: true,
                                type: "alert",
                                variant: "warning",
                                title: "Pending Inputs Require Review",
                                message: `Cannot finalize yet: There are ${changes.summary.pending} pending staged inputs awaiting your decision. Please review and apply or exclude them in the Audit Details modal first.`,
                                confirmText: "Open Audit Details",
                                onConfirm: () => {
                                  closeDialog();
                                  setChangesModalOpen(true);
                                },
                              });
                              return;
                            }
                            if (unsentCount === 0) {
                              openWorkflowModal("finalize_skip_emails");
                            } else {
                              openWorkflowModal("finalize_and_send");
                            }
                          }}
                          disabled={transitioning || (changes.summary?.pending > 0)}
                          className={`inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-lg text-[13px] font-bold whitespace-nowrap shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 transition-all ${changes.summary?.pending > 0
                            ? "bg-slate-400 cursor-not-allowed opacity-70"
                            : unsentCount === 0
                              ? "bg-gradient-to-r from-emerald-600 to-emerald-700 cursor-pointer shadow-md hover:-translate-y-0.5 hover:shadow-lg focus:ring-emerald-500"
                              : "bg-gradient-to-r from-blue-900 to-blue-600 cursor-pointer shadow-md hover:-translate-y-0.5 hover:shadow-lg focus:ring-blue-600"
                            }`}
                          title={
                            (changes.summary?.pending > 0)
                              ? "Resolve all pending inputs before finalizing"
                              : unsentCount === 0
                                ? `All ${sentCount} employee payslips delivered. Click to seal batch as Done.`
                                : `Finalize batch and email ${unsentCount} unsent/modified payslip${unsentCount > 1 ? "s" : ""}.`
                          }
                        >
                          {unsentCount === 0 ? (
                            <>
                              <CheckCircle2 size={16} />
                              <span>{transitioning ? "Sealing Batch…" : "Mark as Done (0 Unsent)"}</span>
                            </>
                          ) : (
                            <>
                              <Send size={15} />
                              <span>{transitioning ? "Finalizing…" : `Finalize & Send Emails (${unsentCount} Unsent)`}</span>
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[12.5px] font-semibold">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span>✅ Batch Approved — Ready for Checker to Finalize & Dispatch</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </div> {/* Closes Right Side Action Buttons */}
          </div> {/* Closes Primary Action Bar */}
        </div> {/* Closes Full-Width Fixed Viewport Action Dock & Live Dispatch Console */}
      </div> {/* Closes Main Page Content Body */}

      {/* Full-Featured 740px Ergonomic Inspection Drawer */}
      {selectedRecord && (() => {
        const selectedIndex = filteredRecords.findIndex((r) => r.id === selectedRecord.id);
        const hasPrev = selectedIndex > 0;
        const hasNext = selectedIndex >= 0 && selectedIndex < filteredRecords.length - 1;
        const goPrev = () => { if (hasPrev) setSelectedRecord(filteredRecords[selectedIndex - 1]); };
        const goNext = () => { if (hasNext) setSelectedRecord(filteredRecords[selectedIndex + 1]); };
        const chips = ledgerChipDefs(selectedRecord, job?.client_details);
        const empChanges = changesByEmpId[selectedRecord.employee] || [];
        const empStagedChanges = empChanges.filter((item) => item.source !== "manual_edit");
        const empManualEdits = empChanges.filter((item) => item.source === "manual_edit");
        const activeEditCount = empManualEdits.length > 0 ? empManualEdits.length : (selectedRecord.edit_count || 0);
        const totalAuditEvents = empStagedChanges.length + activeEditCount;
        const isCompleted = job.status === "Done" || job.batch_details?.status === "COMPLETED";

        return (
          <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px] z-[1200] flex justify-end">
            <div
              className="absolute inset-0"
              onClick={() => setSelectedRecord(null)}
            />
            <div className={`relative z-10 bg-white w-full max-w-[min(760px,92vw)] h-full shadow-[-12px_0_35px_rgba(0,0,0,0.18)] flex flex-col ${ledgerModalOpen ? "pointer-events-none" : ""
              }`}>
              {/* Sticky Top Header Navigation Bar */}
              <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-white sticky top-0 z-[5]">
                <div className="flex items-center gap-2">
                  <button
                    disabled={!hasPrev}
                    onClick={goPrev}
                    title="Previous employee"
                    className={`p-1.5 rounded-md border flex items-center transition-colors ${hasPrev
                      ? "border-slate-300 bg-slate-50 text-slate-800 cursor-pointer hover:bg-slate-100"
                      : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    disabled={!hasNext}
                    onClick={goNext}
                    title="Next employee"
                    className={`p-1.5 rounded-md border flex items-center transition-colors ${hasNext
                      ? "border-slate-300 bg-slate-50 text-slate-800 cursor-pointer hover:bg-slate-100"
                      : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div
                    onClick={() => setShowEmpMasterDetails((prev) => !prev)}
                    className={`ml-2 cursor-pointer px-2 py-1 rounded-md transition-colors ${showEmpMasterDetails ? "bg-slate-100" : "bg-transparent hover:bg-slate-50"
                      }`}
                    title="Click to toggle employee master details"
                  >
                    <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5 flex-wrap">
                      <span>{selectedRecord.employee_code}</span>
                      {selectedRecord.is_probation && <span className="text-red-700">· PROBATION</span>}
                      {selectedRecord.salary_structure_snapshot?.change_reason?.includes("Blended Mid-Month Rate") && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold border border-purple-200">
                          📈 Mid-Month Increment
                        </span>
                      )}
                      <span className="text-[10px] text-sky-600 font-semibold">
                        {showEmpMasterDetails ? "▲ hide info" : "▼ show info"}
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold m-0 text-slate-900 mt-0.5">
                      {selectedRecord.employee_name}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {isChecker && (
                    <button
                      onClick={() => handleRequestSendSingleEmail(selectedRecord)}
                      disabled={sendingEmailId === selectedRecord.id || !selectedRecord.employee_email || !canSendPayslip}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all ${selectedRecord.status === "EMAIL_FAILED"
                        ? "border border-amber-300 bg-amber-50 text-amber-700"
                        : canSendPayslip
                          ? "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          : "border border-slate-200 bg-slate-100 text-slate-400"
                        } ${canSendPayslip && selectedRecord.employee_email && sendingEmailId !== selectedRecord.id
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-50"
                        }`}
                      title={
                        !canSendPayslip
                          ? "Only assigned Checkers can dispatch payslips"
                          : selectedRecord.employee_email
                            ? `Send updated salary slip to ${selectedRecord.employee_email}`
                            : "No email address registered"
                      }
                    >
                      <Mail size={13} />
                      <span>{sendingEmailId === selectedRecord.id ? "Sending..." : selectedRecord.status === "EMAIL_FAILED" ? "Retry Email" : (selectedRecord.status === "EMAIL_SENT" ? "Resend Payslip" : "Send Payslip Email")}</span>
                    </button>
                  )}
                  {isChecker && (
                    <button
                      onClick={() => downloadPDF(selectedRecord.id, selectedRecord.employee_name)}
                      className="px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold cursor-pointer flex items-center gap-1.5 hover:bg-emerald-100 transition-colors"
                    >
                      <Download size={13} />
                      <span>Payslip PDF</span>
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="bg-slate-100 border border-slate-300 rounded-md w-[30px] h-[30px] flex items-center justify-center text-base cursor-pointer text-slate-500 hover:bg-slate-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Scrollable Drawer Body */}
              <div className="px-6 py-5 overflow-y-auto flex-1">
                {/* Employee Master & Statutory Strip (Revealed only when employee header is clicked) */}
                {showEmpMasterDetails && (
                  <div className="mb-4 px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-2 gap-2.5 text-[12.5px]">
                    <div>
                      <span className="text-slate-500">Designation:</span> <strong className="text-slate-800">{selectedRecord.employee_designation || "Staff"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Email:</span> <strong className="text-slate-800" title={selectedRecord.employee_email}>{selectedRecord.employee_email || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Annual CTC:</span> <strong className="text-slate-800">{selectedRecord.ctc_annual ? formatCurrency(selectedRecord.ctc_annual) : "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">PF Opted:</span> <strong className={selectedRecord.pf_applicable ? "text-emerald-700" : "text-slate-500"}>{selectedRecord.pf_applicable ? "Yes (12%)" : "No"}</strong>
                      <span className="ml-2.5 text-slate-500">PT:</span> <strong className={selectedRecord.pt_applicable ? "text-emerald-700" : "text-slate-500"}>{selectedRecord.pt_applicable ? "Yes" : "No"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">PAN Number:</span> <strong className="text-slate-800 font-mono">{selectedRecord.pan_number || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">UAN Number:</span> <strong className="text-slate-800 font-mono">{selectedRecord.uan_number || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Joining Date:</span> <strong className="text-slate-800">{selectedRecord.hire_date || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Type:</span> <strong className={selectedRecord.is_intern ? "text-purple-700" : "text-slate-800"}>
                        {selectedRecord.is_intern ? "🎓 Intern (Stipendiary)" : "💼 Regular Staff"}
                      </strong>
                    </div>

                    {selectedRecord.show_payment_mode_in_payslip !== false && (
                      <>
                        <div>
                          <span className="text-slate-500">Payment Mode:</span> <strong className="text-slate-800">{selectedRecord.payment_mode_display || "Wire Transfer"}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Bank Details:</span> <strong className="text-slate-800">
                            {selectedRecord.bank_name
                              ? `${selectedRecord.bank_name} ${selectedRecord.bank_account_masked ? `(${selectedRecord.bank_account_masked})` : ""}`
                              : (selectedRecord.bank_account_masked ? `A/C ${selectedRecord.bank_account_masked}` : "—")}
                          </strong>
                        </div>
                      </>
                    )}

                    {selectedRecord.show_employer_contribution_in_payslip !== false && Number(selectedRecord.employer_pf || 0) > 0 && (
                      <div className="col-span-2 pt-1 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                        <span>🛡️ Employer PF Contribution (Informational):</span>
                        <strong className="text-slate-800 font-mono font-bold">₹{Number(selectedRecord.employer_pf).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                      </div>
                    )}

                    {/* Live CTC Waterfall Reconciliation */}
                    {Number(selectedRecord.ctc_annual || 0) > 0 && (
                      <div className="col-span-2 mt-2 pt-2 border-t border-slate-200">
                        <div className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                          <span>📊 CTC-to-Gross Waterfall Reconciliation</span>
                          <span className="text-slate-500 font-normal">Monthly Pool: ₹{Number(selectedRecord.monthly_ctc || Number(selectedRecord.ctc_annual) / 12).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="bg-indigo-50/60 rounded-md p-2.5 text-xs border border-indigo-100 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-slate-700">
                            <span className="font-semibold">Monthly CTC Pool:</span>
                            <span className="font-bold text-slate-900 font-mono">₹{Number(selectedRecord.monthly_ctc || Number(selectedRecord.ctc_annual) / 12).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                          </div>
                          {Number(selectedRecord.employer_pf_carveout || (selectedRecord.employer_pf_in_ctc !== false ? selectedRecord.employer_pf : 0) || 0) > 0 && (
                            <div className="flex items-center justify-between text-amber-900">
                              <span>— Employer PF Carve-Out:</span>
                              <span className="font-semibold font-mono">-₹{Number(selectedRecord.employer_pf_carveout || selectedRecord.employer_pf).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {Number(selectedRecord.employer_esi_carveout || 0) > 0 && (
                            <div className="flex items-center justify-between text-amber-900">
                              <span>— Employer ESI Carve-Out:</span>
                              <span className="font-semibold font-mono">-₹{Number(selectedRecord.employer_esi_carveout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {Number(selectedRecord.gratuity_carveout || 0) > 0 && (
                            <div className="flex items-center justify-between text-amber-900">
                              <span>— Gratuity Accrual Carve-Out:</span>
                              <span className="font-semibold font-mono">-₹{Number(selectedRecord.gratuity_carveout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {Number(selectedRecord.fbp_carveout || 0) > 0 && (
                            <div className="flex items-center justify-between text-indigo-900">
                              <span>— Flexible Benefit Plan (FBP):</span>
                              <span className="font-semibold font-mono">-₹{Number(selectedRecord.fbp_carveout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {Number(selectedRecord.custom_carveouts_total || 0) > 0 && (
                            <div className="flex items-center justify-between text-purple-900">
                              <span>— Carved Custom Allowances:</span>
                              <span className="font-semibold font-mono">-₹{Number(selectedRecord.custom_carveouts_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          <div className="pt-1.5 mt-1 border-t border-indigo-200/80 flex items-center justify-between font-bold text-blue-900">
                            <span>= Contracted Base Gross:</span>
                            <span className="text-sm font-black text-blue-700 font-mono">₹{Number(selectedRecord.contracted_monthly_gross || selectedRecord.gross_salary || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedRecord.cycle_period_display && (
                      <div className="col-span-2 flex items-center gap-1.5 text-xs text-blue-800 bg-blue-50/80 px-2.5 py-1 rounded border border-blue-200">
                        <span>🗓️ Attendance Cycle:</span>
                        <strong className="font-semibold">{selectedRecord.cycle_period_display}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Interactive Ledgers Row */}
                <div className="mt-4">
                  <div className="text-[11px] font-bold text-slate-500 uppercase mb-2">
                    LEAVE & ADVANCE LEDGERS (CLICK TO AUDIT OR ADJUST)
                  </div>
                  <div className={`grid gap-2 ${chips.length === 4 ? "grid-cols-4" : "grid-cols-2"}`}>
                    {chips.map((chip) => (
                      <StatChip
                        key={chip.key}
                        icon={chip.icon}
                        label={chip.label}
                        value={chip.badge}
                        subtext={chip.subtext}
                        color={chip.color}
                        active={activeLedgerSection === chip.key}
                        onClick={() => setActiveLedgerSection(activeLedgerSection === chip.key ? null : chip.key)}
                      />
                    ))}
                  </div>

                  {/* Expanded Ledger Audit Panel with Adjust Balance Button */}
                  {activeLedgerSection && (
                    <div className="mt-2.5 p-3.5 rounded-lg bg-white border border-blue-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-xs font-extrabold uppercase text-blue-700">
                          {chips.find((c) => c.key === activeLedgerSection)?.label} Ledger Details
                        </span>
                        {canEditBatch && (
                          <button
                            type="button"
                            onClick={() => setLedgerModalOpen(activeLedgerSection)}
                            className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-blue-50 border border-blue-300 text-blue-700 cursor-pointer hover:bg-blue-100 transition-colors"
                          >
                            Adjust Balance
                          </button>
                        )}
                      </div>

                      {activeLedgerSection === "comp_off" && (
                        <div>
                          <InfoLine label="Opening Balance" value={`${selectedRecord.comp_off_opening_balance ?? 0} days`} icon={Clock} />
                          <InfoLine label="Extra Working Days" value={`${selectedRecord.extra_working_days ?? 0} days`} icon={TrendingUp} />
                          <InfoLine label="Days Used / Covered" value={`${selectedRecord.comp_off_days_used ?? 0} days`} icon={ClipboardCheck} />
                          <ClosingBalanceRow
                            value={`${selectedRecord.comp_off_closing_balance ?? 0} days`}
                            isHighlighted={recentlyAdjustedLedger === "comp_off"}
                          />
                        </div>
                      )}
                      {activeLedgerSection === "leave" && (
                        <div>
                          <InfoLine label="Opening Balance" value={`${selectedRecord.leave_opening_balance ?? 0} days`} icon={CalendarClock} />
                          <InfoLine label="Accrued This Month" value={`${selectedRecord.leave_accrued ?? 0} days`} icon={TrendingUp} />
                          <InfoLine label="Paid Leave Days" value={`${selectedRecord.paid_leave_days ?? 0} days`} icon={CalendarClock} />
                          <InfoLine label="Leave Days Used" value={`${selectedRecord.leave_used ?? 0} days`} icon={ClipboardCheck} />
                          <ClosingBalanceRow
                            value={`${selectedRecord.leave_closing_balance ?? 0} days`}
                            isHighlighted={recentlyAdjustedLedger === "leave"}
                          />
                        </div>
                      )}
                      {activeLedgerSection === "salary_advance" && (
                        <div>
                          <InfoLine label="Opening Balance" value={formatCurrency(Math.max(0, Math.abs(Number(selectedRecord.salary_advance_opening_balance ?? 0))))} icon={Wallet} />
                          <InfoLine label="Disbursed This Month" value={formatCurrency(Math.max(0, Number(selectedRecord.salary_advance_disbursed ?? 0)))} icon={TrendingUp} />
                          <InfoLine label="Recovered This Month" value={formatCurrency(Math.max(0, Number(selectedRecord.salary_advance_recovered ?? 0)))} icon={TrendingDown} />
                          <ClosingBalanceRow
                            value={formatCurrency(Math.max(0, Math.abs(Number(selectedRecord.salary_advance_closing_balance ?? 0))))}
                            isHighlighted={recentlyAdjustedLedger === "salary_advance"}
                          />
                        </div>
                      )}
                      {activeLedgerSection === "on_hold" && (
                        <div>
                          <InfoLine label="Opening Balance" value={formatCurrency(Math.max(0, Math.abs(Number(selectedRecord.on_hold_opening_balance ?? 0))))} icon={Lock} />
                          <InfoLine label="Deducted This Month" value={formatCurrency(Math.max(0, Number(selectedRecord.on_hold_deducted ?? 0)))} icon={Lock} />
                          <InfoLine label="Released This Month" value={formatCurrency(Math.max(0, Number(selectedRecord.on_hold_released ?? 0)))} icon={Unlock} />
                          <ClosingBalanceRow
                            value={formatCurrency(Math.max(0, Math.abs(Number(selectedRecord.on_hold_closing_balance ?? 0))))}
                            isHighlighted={recentlyAdjustedLedger === "on_hold"}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Attendance & Summary Headline */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">
                      ATTENDANCE & SALARY BREAKDOWN
                    </span>
                    <button
                      type="button"
                      disabled={!canEditBatch}
                      onClick={() => {
                        if (!canEditBatch) {
                          setDialogConfig({
                            isOpen: true,
                            type: "alert",
                            variant: "warning",
                            title: "Editing Restricted",
                            message: "Permission denied. Only assigned Makers can edit salary and attendance figures while the job is In Progress or in Rework.",
                            confirmText: "Understood",
                            onConfirm: closeDialog,
                          });
                          return;
                        }
                        setBreakdownEditMode(!breakdownEditMode);
                      }}
                      title={
                        !canEditBatch
                          ? job?.status === "Done"
                            ? "Batch is finalized. Admins must reopen batch before editing."
                            : "Editing restricted: Only assigned Makers can edit figures while job is In Progress."
                          : breakdownEditMode
                            ? "Lock editing"
                            : "Edit attendance and salary figures"
                      }
                      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${!canEditBatch
                        ? "border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed opacity-60"
                        : breakdownEditMode
                          ? "border border-red-300 bg-red-50 text-red-700 cursor-pointer hover:bg-red-100"
                          : "border border-blue-200 bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100"
                        }`}
                    >
                      {breakdownEditMode ? <Lock size={12} /> : canEditBatch ? <Edit3 size={12} /> : <Lock size={12} />}
                      <span>{breakdownEditMode ? "Done Editing" : canEditBatch ? "Edit Details" : "Editing Locked (Makers Only)"}</span>
                    </button>
                  </div>

                  {/* Attendance & Summary Strip (Adaptive 4 or 5 columns based on trackLeave) */}
                  <div className={`grid ${isColVisible("paid_leave_days") ? "grid-cols-5" : "grid-cols-4"} gap-2 px-3.5 py-3 rounded-lg transition-all ${breakdownEditMode ? "bg-blue-50 border border-blue-300" : "bg-slate-50 border border-slate-200"
                    }`}>
                    <div>
                      <div className="text-[9.5px] font-bold text-slate-500 uppercase">Worked</div>
                      <div className="mt-0.5 font-bold text-[13px]">
                        <Editable
                          record={selectedRecord}
                          field="actual_working_days"
                          editing={editing}
                          setEditing={setEditing}
                          save={saveCell}
                          locked={!breakdownEditMode}
                          editableHighlight={breakdownEditMode}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[9.5px] font-bold text-slate-500 uppercase">LOP</div>
                      <div className={`mt-0.5 font-bold text-[13px] ${Number(selectedRecord.lop_days) > 0 ? "text-red-700" : "text-slate-900"}`}>
                        <Editable
                          record={selectedRecord}
                          field="lop_days"
                          editing={editing}
                          setEditing={setEditing}
                          save={saveCell}
                          locked={!breakdownEditMode}
                          editableHighlight={breakdownEditMode}
                        />
                      </div>
                    </div>
                    {isColVisible("paid_leave_days") && (
                      <div>
                        <div className="text-[9.5px] font-bold text-slate-500 uppercase">Paid Leave</div>
                        <div className="mt-0.5 font-bold text-[13px]">
                          <Editable
                            record={selectedRecord}
                            field="paid_leave_days"
                            editing={editing}
                            setEditing={setEditing}
                            save={saveCell}
                            locked={!breakdownEditMode}
                            editableHighlight={breakdownEditMode}
                          />
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-[9.5px] font-bold text-slate-500 uppercase">Base Gross</div>
                      <div className="mt-0.5 font-bold text-[13px]">
                        <Editable
                          record={selectedRecord}
                          field="gross_salary"
                          editing={editing}
                          setEditing={setEditing}
                          save={saveCell}
                          money
                          locked={!breakdownEditMode}
                          editableHighlight={breakdownEditMode}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[9.5px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                        Net Pay
                        {Number(selectedRecord.net_salary || 0) === 0 && Number(selectedRecord.earned_salary || 0) > 0 && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-amber-100 text-amber-800 font-bold border border-amber-300">
                            Capped
                          </span>
                        )}
                      </div>
                      <div className={`mt-0.5 font-extrabold text-[13.5px] ${Number(selectedRecord.net_salary || 0) === 0 && Number(selectedRecord.earned_salary || 0) > 0
                        ? "text-amber-700"
                        : "text-emerald-700"
                        }`}>
                        {formatCurrency(selectedRecord.net_salary)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Zero Net Pay / Advance Capped Explanatory Alert */}
                {Number(selectedRecord.net_salary || 0) === 0 && Number(selectedRecord.earned_salary || 0) > 0 && (
                  <div className="mt-2.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2 shadow-sm">
                    <span className="text-base shrink-0 mt-0.5">🛡️</span>
                    <div>
                      <div className="font-bold text-amber-950">Zero-Floor Guard Active · Advance Recovery Capped</div>
                      <div className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                        Total deductions exceeded earned salary. Salary advance recovery was capped at ₹{formatCurrency(selectedRecord.salary_advance_recovered)} to protect take-home pay from going negative. Unrecovered balance (₹{formatCurrency(selectedRecord.salary_advance_closing_balance)}) rolls forward automatically.
                      </div>
                    </div>
                  </div>
                )}

                {/* 2-Column Full Earnings and Deductions Panels */}
                <div className="mt-3.5 grid grid-cols-2 gap-3.5">
                  <BreakdownPanel
                    title="Earnings"
                    record={selectedRecord}
                    editing={editing}
                    setEditing={setEditing}
                    saveCell={saveCell}
                    locked={isCompleted}
                    editMode={breakdownEditMode}
                    fields={drawerEarningFields}
                  />

                  <BreakdownPanel
                    title="Deductions"
                    record={selectedRecord}
                    editing={editing}
                    setEditing={setEditing}
                    saveCell={saveCell}
                    locked={isCompleted}
                    editMode={breakdownEditMode}
                    fields={drawerDeductionFields}
                    deduction
                  />
                </div>

              </div>

              {/* Sticky Drawer Footer */}
              <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between sticky bottom-0 z-[5]">
                <button
                  type="button"
                  onClick={() => setHistoryRecord(selectedRecord)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <Clock size={13} />
                  <span>Audit History ({totalAuditEvents})</span>
                </button>

                <button
                  onClick={() => setSelectedRecord(null)}
                  className="px-5 py-2 bg-[#1A2F5A] text-white rounded-md text-xs font-semibold cursor-pointer hover:bg-[#142445] transition-colors"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          </div>
        );
      })()}



      {/* Ledger Adjustment Modal with Instant State Refresh */}
      {ledgerModalOpen && selectedRecord && (
        <LedgerAdjustmentModal
          key="job-ledger-modal"
          employee={{
            id: selectedRecord.employee,
            full_name: selectedRecord.employee_name,
            employee_code: selectedRecord.employee_code,
          }}
          type={ledgerModalOpen}
          zIndex={1350}
          closingBalance={
            {
              comp_off: selectedRecord.comp_off_closing_balance,
              leave: selectedRecord.leave_closing_balance,
              salary_advance: selectedRecord.salary_advance_closing_balance,
              on_hold: selectedRecord.on_hold_closing_balance,
            }[ledgerModalOpen] ?? 0
          }
          onClose={(res) => {
            const adjustedType = ledgerModalOpen;
            setLedgerModalOpen(null);
            if (res?.saved && adjustedType) {
              setRecentlyAdjustedLedger(adjustedType);
              setTimeout(() => setRecentlyAdjustedLedger(null), 3000);

              // Optimistic balance update for 0ms instant UI feedback
              if (res?.amount && selectedRecord) {
                const delta = Number(res.amount) || 0;
                const fieldMap = {
                  comp_off: "comp_off_closing_balance",
                  leave: "leave_closing_balance",
                  salary_advance: "salary_advance_closing_balance",
                  on_hold: "on_hold_closing_balance",
                };
                const field = fieldMap[adjustedType];
                if (field) {
                  const optimisticVal = (Number(selectedRecord[field]) || 0) + delta;
                  setSelectedRecord((prev) => (prev ? { ...prev, [field]: optimisticVal } : prev));
                  setRecords((prev) =>
                    prev.map((r) => (r.id === selectedRecord.id ? { ...r, [field]: optimisticVal } : r))
                  );
                }
              }
              loadAll(selectedRecord?.id, { silent: true });
            }
          }}
          appliesImmediately
        />
      )}

      {/* Edit History Audit Drawer */}
      {historyRecord && (
        <EditHistoryDrawer
          record={historyRecord}
          changes={changesByEmpId[historyRecord?.employee] || []}
          onClose={() => setHistoryRecord(null)}
        />
      )}

      {/* Unified Workflow Transition Modal */}
      {(() => {
        if (!activeWorkflowModal) return null;
        const cfg = WORKFLOW_DIALOGS[activeWorkflowModal];
        if (!cfg) return null;
        const totalNet = records.reduce((sum, r) => sum + Number(r.net_salary || 0), 0);
        const hasZeroGross = (zeroGrossRecords || []).length > 0;
        const canSubmit = !transitioning && !(cfg.showZeroGrossCheck && hasZeroGross) && !(cfg.requireNotes && !workflowNotes.trim());

        return (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-[1500] flex items-center justify-center p-4 sm:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget && !transitioning) {
                setActiveWorkflowModal(null);
              }
            }}
          >
            <div
              style={{ maxWidth: cfg.maxWidth || 460 }}
              className="bg-white rounded-2xl w-full overflow-hidden shadow-2xl border border-slate-300/80 flex flex-col animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header with crisp border-b */}
              <div
                style={{ background: cfg.theme.bg }}
                className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between"
              >
                <div>
                  <h3
                    style={{ color: cfg.theme.titleColor }}
                    className="text-sm font-extrabold m-0 tracking-tight"
                  >
                    {cfg.title}
                  </h3>
                  <p className="text-[11.5px] text-slate-500 mt-0.5 m-0 font-medium">
                    {typeof cfg.subtitle === "function" ? cfg.subtitle(job, { unsentCount }) : cfg.subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveWorkflowModal(null)}
                  disabled={transitioning}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors border-0 bg-transparent cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 flex flex-col gap-3.5">
                {/* Optional KPI Pill */}
                {cfg.showPill && (
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 shadow-2xs">
                    <span className="font-medium">👥 <strong>{records.length}</strong> Staff</span>
                    <span className="font-medium">Net: <strong className="text-emerald-700 font-bold">💵 {fmtCurrency(totalNet)}</strong></span>
                  </div>
                )}

                {/* Zero Gross Warning or Prompt */}
                {cfg.showZeroGrossCheck && hasZeroGross ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-xs">
                    ⚠️ {zeroGrossRecords.length} staff have ₹0 Gross Salary. Configure salary structures first.
                  </div>
                ) : cfg.prompt ? (
                  <p className="text-xs text-slate-600 m-0 leading-relaxed font-normal">
                    {typeof cfg.prompt === "function" ? cfg.prompt(job, { unsentCount }) : cfg.prompt}
                  </p>
                ) : null}

                {/* Bullet Points List (e.g. Reset Batch) */}
                {Array.isArray(cfg.bulletPoints) && cfg.bulletPoints.length > 0 && (
                  <ul className="text-xs text-slate-600 leading-relaxed pl-5 m-0 list-disc">
                    {cfg.bulletPoints.map((point, idx) => (
                      <li key={idx} className="mb-1">
                        {point}
                      </li>
                    ))}
                  </ul>
                )}

                {/* High Impact Warning Banner (e.g. Reset Batch non-reversible action) */}
                {cfg.warningBanner && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3.5 py-2.5 rounded-xl text-xs font-semibold">
                    {cfg.warningBanner}
                  </div>
                )}

                {/* Missing Email Alert Pill (e.g. Finalize & Send) */}
                {cfg.showMissingEmailCheck && missingEmailRecords.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-900 text-xs flex items-center gap-2">
                    <span>⚠️</span>
                    <span>
                      <strong>{missingEmailRecords.length} staff member{missingEmailRecords.length > 1 ? "s" : ""}</strong> have no registered email address and will only receive generated PDFs.
                    </span>
                  </div>
                )}

                {/* Optional Remarks Textarea */}
                {cfg.notesLabel && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">
                      {cfg.notesLabel}
                    </label>
                    <textarea
                      value={workflowNotes}
                      onChange={(e) => setWorkflowNotes(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSubmit) {
                          e.preventDefault();
                          handleWorkflowConfirm();
                        }
                      }}
                      placeholder={cfg.notesPlaceholder}
                      rows={cfg.requireNotes ? 3 : 2}
                      autoFocus={cfg.requireNotes}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 font-sans resize-none box-border outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                    />
                    <div className="text-[10.5px] text-slate-400 mt-1 flex justify-between">
                      <span>{cfg.requireNotes ? "* Required" : "Optional notes"}</span>
                      <span>Press Ctrl+Enter to submit</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Dedicated Actions Footer Shelf with Top Border */}
              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveWorkflowModal(null)}
                  disabled={transitioning}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 hover:border-slate-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleWorkflowConfirm}
                  disabled={!canSubmit}
                  style={{ background: !canSubmit ? "#94a3b8" : cfg.theme.btnBg }}
                  className="px-4 py-1.5 rounded-lg border-0 text-white text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-xs hover:shadow active:scale-[0.98]"
                >
                  {transitioning ? cfg.loadingText : cfg.confirmText}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unified Multi-Channel Payroll Audit Center Modal */}
      {changesModalOpen && (
        <PayrollJobUnifiedAuditModal
          job={job}
          isMaker={isMaker}
          isChecker={isChecker}
          isAdmin={isAdmin}
          initialTab="all"
          onClose={() => setChangesModalOpen(false)}
          onChanged={() => {
            loadAll();
          }}
          onRework={async (notes, target) => {
            if (target === "client") {
              // Handled internally in PayrollJobUnifiedAuditModal
            } else {
              try {
                await api.post(`/payroll/jobs/${id}/transition-status/`, {
                  action: "rework",
                  notes: (notes || "").trim(),
                });
                setChangesModalOpen(false);
                setWorkflowSuccessData({
                  type: "success",
                  title: "↩️ Batch Returned to Rework",
                  subtitle: "Status changed to Rework",
                  message: "Job returned to Maker in Rework status. Maker now has full access to update figures.",
                  primaryText: "Done",
                });
                await loadAll();
              } catch (err) {
                setWorkflowSuccessData({
                  type: "email_failed",
                  title: "Return to Maker Failed",
                  message: err?.response?.data?.error || err.message,
                  primaryText: "Close",
                });
              }
            }
          }}
          onFinalize={async (options) => {
            await handleFinalizeAndSend(options);
            await loadAll();
          }}
        />
      )}



      {/* Universal Action Result / Email Delivery Success Modal */}
      {workflowSuccessData && (
        <WorkflowSuccessModal
          data={workflowSuccessData}
          onClose={() => setWorkflowSuccessData(null)}
        />
      )}

      {/* ── Modern Common Confirmation / Prompt / Alert Dialog ── */}
      <PayrollDialog {...dialogConfig} onCancel={closeDialog} />

      {/* ── Salary on Hold & Escrow Management Drawer / Modal ── */}
      {holdDrawerOpen && (
        <div className="fixed inset-0 z-[1900] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl border border-slate-300 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-amber-50/80 to-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-lg">
                  🔒
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 m-0">
                    Salary on Hold & Escrow Ledger
                  </h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    Manage withheld salaries, audit escrow balances, and release funds into batch #{job?.batch_details?.id || id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHoldDrawerOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 overflow-y-auto flex flex-col gap-5 flex-1">
              {/* Stat Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 flex flex-col">
                  <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Withheld Employees</span>
                  <span className="text-xl font-black text-amber-950 mt-1">{holdData.total_on_hold_count} Staff</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Current Escrow Balance</span>
                  <span className="text-xl font-black text-slate-900 mt-1">₹{holdData.total_closing_hold_amount.toLocaleString()}</span>
                </div>
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 flex flex-col">
                  <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Released This Month</span>
                  <span className="text-xl font-black text-emerald-950 mt-1">₹{holdData.total_released_amount.toLocaleString()}</span>
                </div>
              </div>

              {/* Table or Empty State */}
              {holdData.records.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-8 text-center flex flex-col items-center justify-center my-4">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                    <CheckCircle2 size={24} className="text-emerald-500" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">No Active Salary Holds</h4>
                  <p className="text-xs text-slate-500 max-w-sm">
                    No employees currently have withheld salaries in this payroll period. All net earnings are eligible for bank disbursement.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3.5 py-2.5">Employee</th>
                        <th className="px-3 py-2.5 text-right">Opening Hold</th>
                        <th className="px-3 py-2.5 text-right">Deducted (New)</th>
                        <th className="px-3 py-2.5 text-right">Released (Paid)</th>
                        <th className="px-3 py-2.5 text-right font-black text-amber-900">Closing Escrow</th>
                        <th className="px-3 py-2.5 text-right">Current Net Pay</th>
                        <th className="px-3.5 py-2.5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {holdData.records.map((r) => (
                        <tr key={r.record_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3.5 py-3">
                            <div className="font-bold text-slate-800">{r.employee_name}</div>
                            <div className="text-[10.5px] font-mono text-slate-500">{r.employee_code}</div>
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-slate-600">₹{r.on_hold_opening_balance.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right font-medium text-amber-700">{r.on_hold_deducted > 0 ? `+₹${r.on_hold_deducted.toLocaleString()}` : "—"}</td>
                          <td className="px-3 py-3 text-right font-medium text-emerald-700">{r.on_hold_released > 0 ? `-₹${r.on_hold_released.toLocaleString()}` : "—"}</td>
                          <td className="px-3 py-3 text-right font-black text-amber-900 bg-amber-50/40">₹{r.on_hold_closing_balance.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right font-bold text-slate-800">₹{r.net_salary.toLocaleString()}</td>
                          <td className="px-3.5 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {r.on_hold_closing_balance > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setHoldActionModal({
                                    open: true,
                                    type: "RELEASE",
                                    record: r,
                                    amount: String(r.on_hold_closing_balance),
                                    reason: "Compliance verified, releasing held salary",
                                    releaseMonth: "",
                                    releaseYear: "",
                                  })}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[11px] shadow-xs cursor-pointer transition-colors"
                                  title="Release held amount back to employee"
                                >
                                  Release
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setHoldActionModal({
                                  open: true,
                                  type: "HOLD",
                                  record: r,
                                  amount: "",
                                  reason: "Pending compliance verification",
                                  releaseMonth: "",
                                  releaseYear: "",
                                })}
                                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold rounded-lg text-[11px] shadow-xs cursor-pointer transition-colors"
                                title="Put additional amount on hold"
                              >
                                + Hold
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Amounts released are immediately credited to the active batch net salary.
              </span>
              <button
                type="button"
                onClick={() => setHoldDrawerOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer shadow-sm transition-all"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-Modal: Prompt for Hold / Release Amount ── */}
      {holdActionModal.open && (
        <div className="fixed inset-0 z-[2100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-300 p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-sm font-extrabold text-slate-900 m-0">
                {holdActionModal.type === "RELEASE" ? "🔓 Release Salary on Hold" : "🔒 Put Salary on Hold"}
              </h4>
              <button
                type="button"
                onClick={() => setHoldActionModal({ open: false, type: "RELEASE", record: null, amount: "", reason: "", releaseMonth: "", releaseYear: "" })}
                className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="text-xs text-slate-600">
              Employee: <strong>{holdActionModal.record?.employee_name}</strong> ({holdActionModal.record?.employee_code})
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Amount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={holdActionModal.amount}
                onChange={(e) => setHoldActionModal(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="e.g. 15000"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {holdActionModal.type === "RELEASE" && holdActionModal.record && (
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setHoldActionModal(prev => ({ ...prev, amount: String(prev.record.on_hold_closing_balance) }))}
                    className="text-[10.5px] font-bold text-indigo-600 hover:underline cursor-pointer"
                  >
                    Full Balance (₹{holdActionModal.record.on_hold_closing_balance.toLocaleString()})
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setHoldActionModal(prev => ({ ...prev, amount: String((prev.record.on_hold_closing_balance / 2).toFixed(2)) }))}
                    className="text-[10.5px] font-bold text-indigo-600 hover:underline cursor-pointer"
                  >
                    50% (₹{(holdActionModal.record.on_hold_closing_balance / 2).toLocaleString()})
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Reason / Explanation
              </label>
              <input
                type="text"
                value={holdActionModal.reason}
                onChange={(e) => setHoldActionModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="State reason for audit trail..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setHoldActionModal({ open: false, type: "RELEASE", record: null, amount: "", reason: "", releaseMonth: "", releaseYear: "" })}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteHoldAction}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm cursor-pointer transition-colors ${holdActionModal.type === "RELEASE" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"
                  }`}
              >
                Confirm {holdActionModal.type === "RELEASE" ? "Release" : "Hold"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 8: MoM Variance Reconciliation Bridge Modal ── */}
      {momModalOpen && (
        <div className="fixed inset-0 z-[2000] bg-slate-900/65 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="relative z-10 bg-white rounded-2xl w-full max-w-5xl h-[90vh] max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg">
                  📈
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900 m-0">
                      Month-over-Month (MoM) Variance Bridge
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {momData?.prior_period || "Prior"} → {momData?.current_period || "Current"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    Checker audit reconciliation comparing active batch against previous finalized payroll
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadMomVarianceXlsx}
                  disabled={downloadingAudit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors disabled:opacity-50"
                  title="Download complete 3-sheet Excel reconciliation workbook"
                >
                  <Download size={14} />
                  <span>{downloadingAudit ? "Exporting…" : "Export XLSX"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadJournalVoucher("xlsx")}
                  disabled={downloadingAudit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs cursor-pointer transition-colors"
                  title="Download double-entry Journal Voucher in Excel"
                >
                  <span>📑 JV (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadJournalVoucher("xml")}
                  disabled={downloadingAudit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs cursor-pointer transition-colors"
                  title="Download Tally Prime XML voucher"
                >
                  <span>🏢 Tally XML</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMomModalOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 cursor-pointer ml-1"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div id="mom-modal-body" className="flex-1 min-h-0 overflow-y-auto bg-slate-50/40 scroll-smooth">
              {momLoading ? (
                <div className="py-16 text-center text-slate-500 text-sm">
                  Loading month-over-month variance audit data…
                </div>
              ) : !momData ? (
                <div className="py-16 text-center text-slate-500 text-sm">
                  No variance data available.
                </div>
              ) : (() => {
                let list = momData.all_items || [];
                if (anomalyFilter === "anomalies") {
                  list = momData.anomalies || [];
                } else if (anomalyFilter === "joiners") {
                  list = list.filter(x => x.status === "JOINER");
                } else if (anomalyFilter === "leavers") {
                  list = list.filter(x => x.status === "LEAVER");
                } else if (anomalyFilter === "swings") {
                  list = list.filter(x => Math.abs(x.pct_net_change) >= 15 && x.status === "CONTINUOUS");
                }

                if (momSearchTerm.trim()) {
                  const q = momSearchTerm.toLowerCase();
                  list = list.filter(x =>
                    (x.employee_name && x.employee_name.toLowerCase().includes(q)) ||
                    (x.employee_code && x.employee_code.toLowerCase().includes(q)) ||
                    (x.department && x.department.toLowerCase().includes(q)) ||
                    (x.primary_driver && x.primary_driver.toLowerCase().includes(q))
                  );
                }

                const MOM_GRID_COLS = "grid grid-cols-[minmax(180px,2fr)_minmax(75px,0.8fr)_minmax(95px,1fr)_minmax(95px,1fr)_minmax(110px,1.1fr)_minmax(75px,0.7fr)_minmax(190px,2fr)] items-center gap-2";

                return (
                  <>
                    {/* Section 1: Executive Summary Cards Deck (Scrolls away to modal top) */}
                    <div className="p-6 pb-3 space-y-4">
                      {/* Collapsible Executive Summary Bridge */}
                      {!waterfallCollapsed ? (
                        <>
                          {/* Summary Deck Header with "Jump to Records" Pill (Option 2) */}
                          <div className="flex items-center justify-between pb-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700">Executive Summary Cards</span>
                              <span className="text-[11px] text-slate-400">Headcount & variance bridge</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const el = document.getElementById("mom-records-workbench");
                                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                              title="Skip past summary cards directly to employee records table"
                            >
                              <span>👇 Jump to Records</span>
                              <span className="text-[10px] bg-indigo-200/70 text-indigo-800 px-1.5 py-0.2 rounded-full font-mono">{momData.all_items.length}</span>
                            </button>
                          </div>

                          {/* Headcount Bridge Cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Prior Active Staff</div>
                              <div className="text-xl font-extrabold text-slate-800 mt-1">{momData.headcount.prev}</div>
                              <div className="text-[10.5px] text-slate-400">{momData.prior_period}</div>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">(+) New Joiners</div>
                              <div className="text-xl font-extrabold text-emerald-700 mt-1">+{momData.headcount.joiners}</div>
                              <div className="text-[10.5px] text-emerald-600">Onboarded this month</div>
                            </div>
                            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wide">(-) Exited Leavers</div>
                              <div className="text-xl font-extrabold text-rose-700 mt-1">-{momData.headcount.leavers}</div>
                              <div className="text-[10.5px] text-rose-600">Excluded from batch</div>
                            </div>
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Continuous Staff</div>
                              <div className="text-xl font-extrabold text-slate-800 mt-1">{momData.headcount.continuous}</div>
                              <div className="text-[10.5px] text-slate-400">In both payroll runs</div>
                            </div>
                            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">Current Active Staff</div>
                              <div className="text-xl font-black text-indigo-800 mt-1">{momData.headcount.curr}</div>
                              <div className="text-[10.5px] text-indigo-600">{momData.current_period}</div>
                            </div>
                          </div>

                          {/* 7-Stage MoM Net Waterfall Bridge Flow (Clean CAOAS Light Theme) */}
                          {momData.waterfall && (
                            <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 shrink-0">
                              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">📈</span>
                                  <span>Net Remittance Waterfall Flow</span>
                                </div>
                                <span className="text-[11px] font-mono text-slate-500 font-semibold">
                                  {momData.prior_period} → {momData.current_period}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5 text-center">
                                {/* 1. Prior Base */}
                                <div className="bg-white rounded-lg p-2.5 border border-slate-200 shadow-2xs">
                                  <div className="text-[9.5px] text-slate-500 uppercase font-bold tracking-wide">Prior Net Base</div>
                                  <div className="text-[13.5px] font-extrabold text-slate-800 mt-0.5">₹{Math.round(momData.waterfall.prev_net).toLocaleString()}</div>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">{momData.headcount.prev} staff</div>
                                </div>

                                {/* 2. Joiners */}
                                <div className="bg-emerald-50/70 rounded-lg p-2.5 border border-emerald-200">
                                  <div className="text-[9.5px] text-emerald-800 uppercase font-bold tracking-wide flex items-center justify-center gap-0.5">
                                    <span>↗</span>
                                    <span>(+) Joiners</span>
                                  </div>
                                  <div className="text-[13.5px] font-extrabold text-emerald-700 mt-0.5">
                                    {momData.waterfall.joiners_net > 0 ? `+₹${Math.round(momData.waterfall.joiners_net).toLocaleString()}` : "₹0"}
                                  </div>
                                  <div className="text-[10px] text-emerald-700 font-mono mt-0.5">+{momData.headcount.joiners} new</div>
                                </div>

                                {/* 3. Leavers */}
                                <div className="bg-rose-50/70 rounded-lg p-2.5 border border-rose-200">
                                  <div className="text-[9.5px] text-rose-800 uppercase font-bold tracking-wide flex items-center justify-center gap-0.5">
                                    <span>↘</span>
                                    <span>(-) Leavers</span>
                                  </div>
                                  <div className="text-[13.5px] font-extrabold text-rose-700 mt-0.5">
                                    {momData.waterfall.leavers_net > 0 ? `-₹${Math.round(momData.waterfall.leavers_net).toLocaleString()}` : "₹0"}
                                  </div>
                                  <div className="text-[10px] text-rose-700 font-mono mt-0.5">-{momData.headcount.leavers} exit</div>
                                </div>

                                {/* 4. Arrears */}
                                <div className="bg-purple-50/70 rounded-lg p-2.5 border border-purple-200">
                                  <div className="text-[9.5px] text-purple-800 uppercase font-bold tracking-wide flex items-center justify-center gap-0.5">
                                    <span>↗</span>
                                    <span>(+) Arrears</span>
                                  </div>
                                  <div className="text-[13.5px] font-extrabold text-purple-700 mt-0.5">
                                    {momData.waterfall.arrears_net > 0 ? `+₹${Math.round(momData.waterfall.arrears_net).toLocaleString()}` : "₹0"}
                                  </div>
                                  <div className="text-[10px] text-purple-600 font-mono mt-0.5">Past dues</div>
                                </div>

                                {/* 5. LOP Delta */}
                                <div className="bg-amber-50/70 rounded-lg p-2.5 border border-amber-200">
                                  <div className="text-[9.5px] text-amber-800 uppercase font-bold tracking-wide flex items-center justify-center gap-0.5">
                                    <span>{momData.waterfall.lop_variance_impact < 0 ? "↘" : "↗"}</span>
                                    <span>(±) LOP Delta</span>
                                  </div>
                                  <div className={`text-[13.5px] font-extrabold mt-0.5 ${momData.waterfall.lop_variance_impact < 0 ? "text-rose-700" : (momData.waterfall.lop_variance_impact > 0 ? "text-emerald-700" : "text-slate-600")}`}>
                                    {momData.waterfall.lop_variance_impact < 0
                                      ? `-₹${Math.abs(Math.round(momData.waterfall.lop_variance_impact)).toLocaleString()}`
                                      : (momData.waterfall.lop_variance_impact > 0 ? `+₹${Math.round(momData.waterfall.lop_variance_impact).toLocaleString()}` : "₹0")}
                                  </div>
                                  <div className="text-[10px] text-amber-700 font-mono mt-0.5">Unpaid days</div>
                                </div>

                                {/* 6. Holds */}
                                <div className="bg-blue-50/70 rounded-lg p-2.5 border border-blue-200">
                                  <div className="text-[9.5px] text-blue-800 uppercase font-bold tracking-wide flex items-center justify-center gap-0.5">
                                    <span>{momData.waterfall.holds_net_impact < 0 ? "↘" : "↗"}</span>
                                    <span>(±) Holds</span>
                                  </div>
                                  <div className={`text-[13.5px] font-extrabold mt-0.5 ${momData.waterfall.holds_net_impact < 0 ? "text-rose-700" : (momData.waterfall.holds_net_impact > 0 ? "text-emerald-700" : "text-slate-600")}`}>
                                    {momData.waterfall.holds_net_impact < 0
                                      ? `-₹${Math.abs(Math.round(momData.waterfall.holds_net_impact)).toLocaleString()}`
                                      : (momData.waterfall.holds_net_impact > 0 ? `+₹${Math.round(momData.waterfall.holds_net_impact).toLocaleString()}` : "₹0")}
                                  </div>
                                  <div className="text-[10px] text-blue-700 font-mono mt-0.5">Escrow delta</div>
                                </div>

                                {/* 7. Current Net */}
                                <div className="bg-emerald-50 rounded-lg p-2.5 border-2 border-emerald-400 shadow-2xs">
                                  <div className="text-[9.5px] text-emerald-900 uppercase font-bold tracking-wide">(=) Current Net</div>
                                  <div className="text-[13.5px] font-black text-emerald-800 mt-0.5">₹{Math.round(momData.waterfall.curr_net).toLocaleString()}</div>
                                  <div className="text-[10px] text-emerald-700 font-mono mt-0.5">{momData.headcount.curr} staff</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Macro Summary Strip */}
                          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 shrink-0">
                            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                              <span>Macro Financial Variance</span>
                              <span className="text-[11px] font-semibold text-slate-500 lowercase">
                                net payout delta: <strong className={momData.macro.diff_net >= 0 ? "text-emerald-700" : "text-rose-700"}>{momData.macro.diff_net > 0 ? `+₹${Math.round(momData.macro.diff_net).toLocaleString()}` : (momData.macro.diff_net < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_net)).toLocaleString()}` : "₹0")} ({momData.macro.pct_net >= 0 ? "+" : ""}{momData.macro.pct_net}%)</strong>
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
                              <div>
                                <div className="text-slate-500">Gross Earned</div>
                                <div className="font-extrabold text-slate-800 text-sm mt-0.5">₹{Math.round(momData.macro.curr_gross).toLocaleString()}</div>
                                <div className="text-[10.5px] text-slate-500">{momData.macro.diff_gross > 0 ? `+₹${Math.round(momData.macro.diff_gross).toLocaleString()}` : (momData.macro.diff_gross < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_gross)).toLocaleString()}` : "₹0")} ({momData.macro.pct_gross}%)</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Total Deductions</div>
                                <div className="font-extrabold text-slate-800 text-sm mt-0.5">₹{Math.round(momData.macro.curr_deductions).toLocaleString()}</div>
                                <div className="text-[10.5px] text-slate-500">{momData.macro.diff_deductions > 0 ? `+₹${Math.round(momData.macro.diff_deductions).toLocaleString()}` : (momData.macro.diff_deductions < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_deductions)).toLocaleString()}` : "₹0")}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Employee PF</div>
                                <div className="font-extrabold text-slate-800 text-sm mt-0.5">₹{Math.round(momData.macro.curr_epf).toLocaleString()}</div>
                                <div className="text-[10.5px] text-slate-500">{momData.macro.diff_epf > 0 ? `+₹${Math.round(momData.macro.diff_epf).toLocaleString()}` : (momData.macro.diff_epf < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_epf)).toLocaleString()}` : "₹0")}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">TDS Withheld</div>
                                <div className="font-extrabold text-slate-800 text-sm mt-0.5">₹{Math.round(momData.macro.curr_tds).toLocaleString()}</div>
                                <div className="text-[10.5px] text-slate-500">{momData.macro.diff_tds > 0 ? `+₹${Math.round(momData.macro.diff_tds).toLocaleString()}` : (momData.macro.diff_tds < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_tds)).toLocaleString()}` : "₹0")}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Reimbursements</div>
                                <div className="font-extrabold text-slate-800 text-sm mt-0.5">₹{Math.round(momData.macro.curr_reimb).toLocaleString()}</div>
                                <div className="text-[10.5px] text-slate-500">{momData.macro.diff_reimb > 0 ? `+₹${Math.round(momData.macro.diff_reimb).toLocaleString()}` : (momData.macro.diff_reimb < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_reimb)).toLocaleString()}` : "₹0")}</div>
                              </div>
                              <div className="bg-emerald-100/60 p-2 rounded-lg border border-emerald-200">
                                <div className="text-emerald-800 font-bold">Net Remittance</div>
                                <div className="font-black text-emerald-900 text-sm mt-0.5">₹{Math.round(momData.macro.curr_net).toLocaleString()}</div>
                                <div className="text-[10.5px] text-emerald-800 font-semibold">{momData.macro.diff_net > 0 ? `+₹${Math.round(momData.macro.diff_net).toLocaleString()}` : (momData.macro.diff_net < 0 ? `-₹${Math.abs(Math.round(momData.macro.diff_net)).toLocaleString()}` : "₹0")}</div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="bg-indigo-50/80 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-indigo-950 font-semibold shrink-0 animate-in fade-in duration-100">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="flex items-center gap-1.5">
                              <span>👥</span>
                              <span>Active Staff: <strong>{momData.headcount.curr}</strong></span>
                              <span className="text-emerald-700 font-bold">(+{momData.headcount.joiners} new)</span>
                              {momData.headcount.leavers > 0 && (
                                <span className="text-rose-700 font-bold">(-{momData.headcount.leavers} exited)</span>
                              )}
                            </span>
                            <span className="text-indigo-300">•</span>
                            <span className="flex items-center gap-1.5">
                              <span>💵</span>
                              <span>Net Remittance: <strong>₹{Math.round(momData.macro.curr_net).toLocaleString()}</strong></span>
                              <span className={momData.macro.diff_net >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                                ({momData.macro.diff_net >= 0 ? "+" : ""}₹{Math.round(momData.macro.diff_net).toLocaleString()} / {momData.macro.pct_net >= 0 ? "+" : ""}{momData.macro.pct_net}%)
                              </span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setWaterfallCollapsed(false)}
                            className="text-[11.5px] font-bold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-100/60 border border-indigo-200 px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                          >
                            📊 Expand Summary Cards
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Section 2: Unified Sticky Dock + Records Workbench */}
                    <div id="mom-records-workbench">
                      {/* Pinned Sticky Control & Header Deck */}
                      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs px-6 pt-3 pb-3 border-y border-slate-200 shadow-xs space-y-2.5">
                        {/* Toolbar Row: Filter Pills + Search + Counter Badge + Focus Table toggle */}
                        <div className="flex items-center justify-between flex-wrap gap-2.5">
                          {/* Left: Filter Buttons */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setAnomalyFilter("all")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${anomalyFilter === "all" ? "bg-slate-800 text-white shadow-xs" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                }`}
                            >
                              All Staff ({momData.all_items.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnomalyFilter("anomalies")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${anomalyFilter === "anomalies" ? "bg-amber-600 text-white shadow-xs" : "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                                }`}
                            >
                              ⚠️ Checker Alerts ({momData.anomalies_count})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnomalyFilter("joiners")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${anomalyFilter === "joiners" ? "bg-emerald-600 text-white shadow-xs" : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                                }`}
                            >
                              New Joiners ({momData.headcount.joiners})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnomalyFilter("leavers")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${anomalyFilter === "leavers" ? "bg-rose-600 text-white shadow-xs" : "bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100"
                                }`}
                            >
                              Exited ({momData.headcount.leavers})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnomalyFilter("swings")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${anomalyFilter === "swings" ? "bg-indigo-600 text-white shadow-xs" : "bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100"
                                }`}
                            >
                              Swings ≥ ±15% ({momData.all_items.filter(x => Math.abs(x.pct_net_change) >= 15 && x.status === "CONTINUOUS").length})
                            </button>
                          </div>

                          {/* Right: Counter Badge + Search Input + Focus Table Button */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg shrink-0">
                              Showing <strong className="text-slate-800">{list.length}</strong> of <strong className="text-slate-800">{momData.all_items.length}</strong> staff
                            </span>
                            <div className="relative w-56">
                              <Search size={14} className="absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
                              <input
                                type="text"
                                placeholder="Search employee or driver…"
                                value={momSearchTerm}
                                onChange={(e) => setMomSearchTerm(e.target.value)}
                                className="w-full pl-8 pr-7 py-1 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                              {momSearchTerm && (
                                <button
                                  type="button"
                                  onClick={() => setMomSearchTerm("")}
                                  className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>
                            {/* Option 1: Floating Back to Top Pill */}
                            <button
                              type="button"
                              onClick={() => {
                                const modalBody = document.getElementById("mom-modal-body");
                                if (modalBody) modalBody.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-300 text-xs font-semibold cursor-pointer transition-colors shadow-2xs shrink-0"
                              title="Scroll back up to the Executive Summary Waterfall Deck"
                            >
                              <span>☝️</span>
                              <span>Back to Deck</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setWaterfallCollapsed(!waterfallCollapsed)}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
                              title="Toggle between full summary view and focused table view"
                            >
                              {waterfallCollapsed ? "📊 Show Summary" : "📐 Focus Table"}
                            </button>
                          </div>
                        </div>

                        {/* Pinned Column Headers Bar */}
                        <div className="bg-slate-100 text-slate-700 font-bold border border-slate-200 rounded-xl px-3.5 py-2 text-xs shadow-2xs">
                          <div className={MOM_GRID_COLS}>
                            <div>Employee</div>
                            <div className="text-center">Status</div>
                            <div className="text-right">Prior Net</div>
                            <div className="text-right">Current Net</div>
                            <div className="text-right">Net Variance</div>
                            <div className="text-center">% Swing</div>
                            <div>Primary Driver & Attribution</div>
                          </div>
                        </div>
                      </div>

                      {/* Records List Area */}
                      <div className="px-6 py-4 pb-8">
                        {list.length === 0 ? (
                          <div className="py-12 text-center text-slate-500 text-xs border border-dashed border-slate-200 rounded-xl bg-white">
                            No employees matching the current filter.
                          </div>
                        ) : (
                          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white divide-y divide-slate-100">
                            {list.map((item, idx) => {
                              const isPositive = item.diff_net > 0;
                              const isNegative = item.diff_net < 0;
                              const isEven = idx % 2 === 0;
                              return (
                                <div
                                  key={item.employee_id}
                                  className={`px-3.5 py-2.5 text-xs transition-colors ${item.is_anomaly
                                    ? "bg-amber-50/30 hover:bg-amber-50/60 border-l-2 border-l-amber-500"
                                    : (isEven ? "bg-white hover:bg-indigo-50/30" : "bg-slate-50/60 hover:bg-indigo-50/30")
                                    }`}
                                >
                                  <div className={MOM_GRID_COLS}>
                                    {/* Col 1: Employee */}
                                    <div className="min-w-0 pr-2">
                                      <div
                                        onClick={() => handleJumpToEmployeeRow(item.employee_id)}
                                        className="font-bold text-slate-800 flex items-center gap-1.5 cursor-pointer hover:text-indigo-600 hover:underline group truncate"
                                        title="Click to jump to this employee in the main review workspace"
                                      >
                                        <span className="truncate">{item.employee_name}</span>
                                        <span className="text-[10px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">↗</span>
                                        {item.is_anomaly && (
                                          <span className="text-[10px] text-amber-600 shrink-0" title={item.anomaly_reasons.join(", ")}>
                                            ⚠️
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono truncate">
                                        {item.employee_code} · {item.department}
                                      </div>
                                    </div>

                                    {/* Col 2: Status */}
                                    <div className="text-center">
                                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${item.status === "JOINER"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : (item.status === "LEAVER" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600")
                                        }`}>
                                        {item.status}
                                      </span>
                                    </div>

                                    {/* Col 3: Prior Net */}
                                    <div className="text-right font-mono text-slate-600">
                                      {item.status === "JOINER" ? "—" : `₹${Math.round(item.prev_net).toLocaleString()}`}
                                    </div>

                                    {/* Col 4: Current Net */}
                                    <div className="text-right font-mono font-bold text-slate-900">
                                      {item.status === "LEAVER" ? "—" : `₹${Math.round(item.curr_net).toLocaleString()}`}
                                    </div>

                                    {/* Col 5: Net Variance */}
                                    <div className={`text-right font-mono font-extrabold ${isPositive ? "text-emerald-700" : (isNegative ? "text-rose-700" : "text-slate-500")
                                      }`}>
                                      {isPositive ? `+₹${Math.round(item.diff_net).toLocaleString()}` : (isNegative ? `-₹${Math.abs(Math.round(item.diff_net)).toLocaleString()}` : "₹0")}
                                    </div>

                                    {/* Col 6: % Swing */}
                                    <div className="text-center font-mono text-[11px] font-semibold text-slate-700">
                                      {item.pct_net_change !== 0 ? `${item.pct_net_change > 0 ? "+" : ""}${item.pct_net_change}%` : "0%"}
                                    </div>

                                    {/* Col 7: Primary Driver & Attribution */}
                                    <div className="text-slate-600 text-[11.5px] truncate" title={item.primary_driver}>
                                      <span className="truncate">{item.primary_driver}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">
                Total Line Items: <strong>{momData?.all_items?.length || 0}</strong> ({momData?.anomalies_count || 0} flagged exceptions)
              </span>
              <button
                type="button"
                onClick={() => setMomModalOpen(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer shadow-sm transition-all"
              >
                Close Audit Sheet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Supporting Modal Components ──────────────────────────────────────

function WorkflowSuccessModal({ data, onClose }) {
  // Hooks must be declared unconditionally at the top of the component (React Rules of Hooks)
  const [timeLeft, setTimeLeft] = useState(5);
  const [isHovered, setIsHovered] = useState(false);

  const {
    type = "success", // "success" | "email_success" | "email_failed" | "celery_queued"
    title,
    subtitle,
    message,
    details = [],
    stats = null,
    primaryText = "Done",
    onPrimary,
    secondaryText,
    onSecondary,
  } = data || {};

  const isWarning = type === "email_failed";
  const isCelery = type === "celery_queued";

  const theme = isWarning
    ? { bg: "#fffbeb", border: "#fde68a", titleColor: "#92400e", btnBg: "#d97706" }
    : isCelery
      ? { bg: "#eff6ff", border: "#bfdbfe", titleColor: "#1e3a8a", btnBg: "#2563eb" }
      : { bg: "#f0fdf4", border: "#bbf7d0", titleColor: "#166534", btnBg: "#15803d" };

  // Option 4: Auto-close countdown (only on standard success notifications without exceptions)
  const canAutoClose = !isWarning && (details || []).length === 0 && !isCelery;

  useEffect(() => {
    if (!data || !canAutoClose) return;
    if (timeLeft <= 0) {
      if (onPrimary) onPrimary();
      onClose();
      return;
    }
    if (isHovered) return;

    const timer = setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [data, canAutoClose, timeLeft, isHovered, onPrimary, onClose]);

  // Option 2: Keyboard shortcut listener (Enter / Space / Esc)
  useEffect(() => {
    if (!data) return;
    const handleKeyDown = (e) => {
      if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        if (onPrimary) onPrimary();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data, onPrimary, onClose]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-[1600] flex items-center justify-center p-4 sm:p-6"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="bg-white rounded-2xl w-full max-w-[460px] overflow-hidden shadow-2xl border border-slate-300/80 flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header with crisp border-b */}
        <div
          style={{ background: theme.bg }}
          className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between"
        >
          <div>
            <h3
              style={{ color: theme.titleColor }}
              className="text-base font-extrabold m-0 tracking-tight"
            >
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11.5px] text-slate-500 mt-0.5 m-0 font-medium">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors border-0 bg-transparent cursor-pointer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3.5">
          {message && (
            <p className="text-xs text-slate-700 leading-relaxed m-0 font-normal">
              {message}
            </p>
          )}

          {/* Stats Bar */}
          {stats && (
            <div className="flex items-center justify-around bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs shadow-2xs">
              {stats.map((s, idx) => (
                <div key={idx} className="text-center">
                  <div className="text-[11px] text-slate-500">{s.label}</div>
                  <div
                    style={{ color: s.color || "#0f172a" }}
                    className="text-sm font-extrabold"
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detail List (e.g. failed employee list) */}
          {details.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-40 overflow-y-auto">
              <div className="text-[11.5px] font-bold text-red-800 mb-1.5">
                ⚠️ Failed Deliveries ({details.length}):
              </div>
              <ul className="m-0 pl-4.5 text-[11.5px] text-red-900 leading-relaxed list-disc">
                {details.map((d, idx) => (
                  <li key={idx}>
                    <strong>{d.name || d.employee_name || "Staff"}</strong> ({d.email || d.employee_email || "No email"}): {d.error || "Delivery failed"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Dedicated Actions Footer Shelf */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between gap-3">
          {/* Option 4: Auto-Dismiss countdown or keyboard hint */}
          <div className="text-[11.5px] text-slate-400 font-medium select-none flex items-center gap-1.5">
            {canAutoClose ? (
              <span>{isHovered ? "Auto-close paused" : `Auto-dismiss in ${timeLeft}s`}</span>
            ) : (
              <span>Press <kbd className="font-mono text-[10px] bg-slate-200/80 px-1.5 py-0.5 rounded text-slate-600">Enter</kbd> or <kbd className="font-mono text-[10px] bg-slate-200/80 px-1.5 py-0.5 rounded text-slate-600">Esc</kbd></span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {secondaryText && (
              <button
                type="button"
                onClick={() => {
                  if (onSecondary) onSecondary();
                  onClose();
                }}
                className="h-9 px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 hover:border-slate-400 active:scale-[0.98] transition-all shadow-xs inline-flex items-center justify-center"
              >
                {secondaryText}
              </button>
            )}

            {/* Option 1: Enterprise Primary Action Button */}
            <button
              type="button"
              onClick={() => {
                if (onPrimary) onPrimary();
                onClose();
              }}
              style={{ background: theme.btnBg }}
              className="h-9 px-5 min-w-[104px] rounded-xl border-0 text-white text-xs font-bold cursor-pointer hover:brightness-105 active:scale-[0.98] transition-all shadow-md hover:shadow-lg inline-flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-600/40"
            >
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{primaryText}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export default PayrollJobBatchReview;
