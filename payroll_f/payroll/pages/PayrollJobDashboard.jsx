import React, { useState, useEffect, useMemo, useRef } from "react";
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
  JobWorkspaceShell,
  DocumentsTab,
  AuditTrailTab,
  TeamTab,
  DocCard,
  WsCard,
  Notice,
} from "../../IncomeTaxPage/JobWorkspaceCommon";
import { ClientDocRequestPanel, PAYROLL_DOC_CHECKLIST } from '../../IncomeTaxPage/ClientDocRequests';
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
import { PortalUsers } from "./PayrollWorkspace";
import {
  PayrollJobBatchReview,
  extractCustomColumns,
  getRecordCustomValue,
} from "./PayrollJobBatchReview";
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
  SearchableEmployeeSelect,
  PAYROLL_ITEM_REGISTRY,
} from "../PayrollRoutes";

async function unpackBlobError(err, fallback = "Download failed") {
  if (err?.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const json = JSON.parse(text);
      return json.error || json.detail || json.message || fallback;
    } catch (_) { }
  }
  return err?.response?.data?.error || err?.response?.data?.detail || err?.message || fallback;
}

const EVENT_META = {
  CREATED: {
    label: "Job Initialized",
    badge: "INITIALIZED",
    icon: "✨",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    color: "#047857",
    barColor: "#10b981",
  },
  ASSIGNED: {
    label: "Makers & Checkers Assigned",
    badge: "ASSIGNED",
    icon: "👥",
    bg: "#eff6ff",
    border: "#bfdbfe",
    color: "#1d4ed8",
    barColor: "#3b82f6",
  },
  STARTED: {
    label: "Preparation Work Started",
    badge: "IN PROGRESS",
    icon: "🛠️",
    bg: "#eff6ff",
    border: "#bfdbfe",
    color: "#0284c7",
    barColor: "#0284c7",
  },
  SUBMITTED: {
    label: "Submitted for Checker Review",
    badge: "SUBMITTED",
    icon: "🚀",
    bg: "#f5f3ff",
    border: "#ddd6fe",
    color: "#6d28d9",
    barColor: "#7c3aed",
  },
  SENT_TO_APPROVER: {
    label: "Forwarded to Leadership Approver",
    badge: "PENDING APPROVAL",
    icon: "🏛️",
    bg: "#faf5ff",
    border: "#e9d5ff",
    color: "#7e22ce",
    barColor: "#9333ea",
  },
  BATCH_GENERATED: {
    label: "Initial Batch Generated",
    badge: "BATCH GENERATED",
    icon: "⚡",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    color: "#047857",
    barColor: "#10b981",
  },
  PORTAL_UPDATES_APPLIED: {
    label: "Portal Adjustments Applied",
    badge: "PORTAL UPDATES",
    icon: "🌐",
    bg: "#eff6ff",
    border: "#bfdbfe",
    color: "#1d4ed8",
    barColor: "#3b82f6",
  },
  EMAILS_SENT: {
    label: "Payslip Emails Dispatched",
    badge: "EMAILS SENT",
    icon: "✉️",
    bg: "#faf5ff",
    border: "#e9d5ff",
    color: "#7e22ce",
    barColor: "#9333ea",
  },
  EMAILS_FAILED: {
    label: "Email Delivery Issues",
    badge: "DELIVERY FAILED",
    icon: "⚠️",
    bg: "#fff1f2",
    border: "#fecaca",
    color: "#9f1239",
    barColor: "#e11d48",
  },
  JOB_REOPENED: {
    label: "Finalized Job Reopened",
    badge: "JOB REOPENED",
    icon: "🔓",
    bg: "#fffbeb",
    border: "#fde68a",
    color: "#92400e",
    barColor: "#f59e0b",
  },
  ITEM_EXCLUDED: {
    label: "Adjustment Excluded from Batch",
    badge: "EXCLUDED",
    icon: "🚫",
    bg: "#fff1f2",
    border: "#fecdd3",
    color: "#be123c",
    barColor: "#f43f5e",
  },
  ITEM_RESTORED: {
    label: "Adjustment Restored to Queue",
    badge: "RESTORED",
    icon: "↩️",
    bg: "#f0fdfa",
    border: "#99f6e4",
    color: "#0f766e",
    barColor: "#14b8a6",
  },
};

/**
 * Humanizes audit notes and decodes JSON telemetry payloads into clean English sentences.
 */
function parseAuditNote(rawNotes, eventType) {
  if (!rawNotes) return "";
  let str = String(rawNotes).trim();

  // Try parsing JSON if notes start and end with { } or [ ]
  if ((str.startsWith("{") && str.endsWith("}")) || (str.startsWith("[") && str.endsWith("]"))) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === "object") {
        if (eventType === "PORTAL_UPDATES_APPLIED" || "applied_items_count" in parsed) {
          const applied = parsed.applied_items_count ?? 0;
          const created = parsed.new_records_created ?? 0;
          const batchId = parsed.batch_id ? ` (Batch #${parsed.batch_id})` : "";
          const createdPart = created > 0 ? ` and created ${created} new employee record${created === 1 ? "" : "s"}` : " (0 new employee records created)";
          return `Applied ${applied} monthly portal adjustment item${applied === 1 ? "" : "s"} to payroll batch${batchId}${createdPart}.`;
        }

        if (eventType === "EXCEL_UPLOADED" || "file_name" in parsed) {
          const fileName = parsed.file_name || "Payroll Workbook";
          const count = parsed.records_count != null ? ` with ${parsed.records_count} record(s)` : "";
          const source = parsed.source ? ` via ${parsed.source.replace(/_/g, " ")}` : "";
          return `Uploaded workbook "${fileName}"${count}${source}.`;
        }

        if (!Array.isArray(parsed)) {
          const pairs = Object.entries(parsed)
            .filter(([_, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => {
              const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              return `${label}: ${v}`;
            });
          if (pairs.length > 0) {
            return pairs.join(" • ");
          }
        }
      }
    } catch {
      // If parsing fails, fall through to text sanitization
    }
  }

  if (str.includes("[ZERO_GROSS_ACKNOWLEDGED:")) {
    str = str.replace(/\[ZERO_GROSS_ACKNOWLEDGED:\s*(true|false)\]/gi, "(Zero-gross employees explicitly acknowledged)");
  }

  return str;
}


/* ==========================================================================
   PART 1: DASHBOARD UI HELPERS & STATUS CONFIG
   ========================================================================== */

// Status color map merging firm-wide defaults with payroll-specific stages
const PAYROLL_STATUS_MAP = {
  ...STATUS_COLORS,
  "Client Docs Pending": { bg: "#FFF4E6", color: "#A05A00" },
  Approved: { bg: "#E8F7F3", color: "#0D6B52" },
  Done: { bg: "#E8F7F3", color: "#0D6B52" },
};

const getPillLabel = (st) => {
  if (!st) return "TO DO";
  if (st === "Closed") return "DONE";
  return st.toUpperCase();
};

// Minimalist uppercase word pill (Option 2) for client portal activity
function getPortalPill(job) {
  const portalPending = Number(job?.pending_portal_items_count || 0);
  const pInfo = job?.portal_submission_info;
  const portalInfoPending = Number(pInfo?.portal_pending_count || 0);
  const isPortalSubmitted = portalPending > 0 || portalInfoPending > 0;

  if (isPortalSubmitted) {
    const count = portalPending || portalInfoPending;
    return (
      <span
        title={`${count > 0 ? count + " " : ""}client adjustment(s) submitted via portal awaiting checker review`}
        style={{
          padding: "2px 9px",
          borderRadius: 99,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          background: "#FFF4E6",
          color: "#A05A00",
          border: "1px solid #FFE0B2",
          whiteSpace: "nowrap",
          display: "inline-block",
        }}
      >
        PORTAL
      </span>
    );
  }

  // If applied or no pending adjustments from client portal, show no pill (zero clutter)
  return null;
}

/* ==========================================================================
   PART 2: JOB DETAIL UI HELPERS & AUDIT FORMATTERS
   ========================================================================== */



/* ==========================================================================
   PART 2.5: PAYROLL JOB BATCH REVIEW (Extracted to ./PayrollJobBatchReview.jsx)
   ========================================================================== */

export const fmt = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n || 0));
export const fmtCurrency = (n) => `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))}`;

export {
  PayrollJobBatchReview,
  extractCustomColumns,
  getRecordCustomValue,
};

/* ==========================================================================
   PART 3: INDIVIDUAL JOB DETAIL WORKSPACE VIEW
   ========================================================================== */

/* ==========================================================================
   JOB MODALS WORKBENCH (EXCEL UPLOAD, MONTHLY INPUT, UNIFIED AUDIT)
   ========================================================================== */

/* ==========================================================================
   PART 1: PAYROLL JOB EXCEL UPLOAD MODAL
   ========================================================================== */

const EXCEL_SHEET_TABS = [
  { key: "ALL", label: "All Items" },
  { key: "NEW_EMPLOYEE", label: "New Joiners", tone: "#1d4ed8", bg: "#eff6ff" },
  { key: "REVISION", label: "Salary Revisions", tone: "#7e22ce", bg: "#faf5ff" },
  { key: "EXIT", label: "Exits", tone: "#be123c", bg: "#fff1f2" },
  { key: "SALARY_HOLD", label: "Salary Holds", tone: "#4338ca", bg: "#eef2ff" },
  { key: "REIMBURSEMENT", label: "Reimbursements", tone: "#0284c7", bg: "#f0f9ff" },
  { key: "LOP", label: "Loss of Pay", tone: "#b45309", bg: "#fffbeb" },
  { key: "ARREARS", label: "Arrears", tone: "#15803d", bg: "#f0fdf4" },
  { key: "TDS", label: "TDS (Tax)", tone: "#c2410c", bg: "#fff7ed" },
  { key: "ADVANCE", label: "Advances / Loans", tone: "#b45309", bg: "#fffbeb" },
  { key: "ONE_TIME_EARNING", label: "Extra Earnings", tone: "#059669", bg: "#ecfdf5" },
  { key: "ONE_TIME_DEDUCTION", label: "Deductions", tone: "#b91c1c", bg: "#fef2f2" },
  { key: "CUSTOM_COMPONENT", label: "Custom Components", tone: "#0d9488", bg: "#f0fdfa" },
  { key: "NOTE", label: "Memos & Notes", tone: "#0369a1", bg: "#f0f9ff" },
];



const TYPE_CONFIG = {
  NEW_EMPLOYEE: { label: "New Joiner", tone: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  REVISION: { label: "Salary Revision", tone: "#7e22ce", bg: "#faf5ff", border: "#e9d5ff" },
  EXIT: { label: "Exit / Resignation", tone: "#be123c", bg: "#fff1f2", border: "#fecdd3" },
  SALARY_HOLD: { label: "Salary Hold", tone: "#4338ca", bg: "#eef2ff", border: "#c7d2fe" },
  REIMBURSEMENT: { label: "Reimbursement", tone: "#0284c7", bg: "#f0f9ff", border: "#bae6fd" },
  LOP: { label: "Loss of Pay", tone: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  ARREARS: { label: "Salary Arrears", tone: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  TDS: { label: "TDS (Tax)", tone: "#c2410c", bg: "#fff7ed", border: "#fed7aa" },
  ADVANCE: { label: "Advance / Loan", tone: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  ONE_TIME_EARNING: { label: "Extra Payment", tone: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
  ONE_TIME_DEDUCTION: { label: "Deduction", tone: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  CUSTOM_COMPONENT: { label: "Custom Component", tone: "#0d9488", bg: "#f0fdfa", border: "#99f6e4" },
  NOTE: { label: "Note", tone: "#0369a1", bg: "#f0f9ff", border: "#bae6fd" },
};

const fmtINR = (n) => new Intl.NumberFormat("en-IN").format(Number(n || 0));

function normalizeUploadPayload(type, p) {
  const clean = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === "" || v === null || v === undefined) continue;
    clean[k] = v;
  }
  if ("employee_id" in clean) clean.employee_id = Number(clean.employee_id);
  if ("tenure_months" in clean) clean.tenure_months = Number(clean.tenure_months);
  if ("release_month" in clean) clean.release_month = Number(clean.release_month);
  if ("release_year" in clean) clean.release_year = Number(clean.release_year);
  if ("amount" in clean) clean.amount = Number(clean.amount);
  if ("total_amount" in clean) clean.total_amount = Number(clean.total_amount);
  if ("ctc_annual" in clean) clean.ctc_annual = Number(clean.ctc_annual);
  if ("nps_allowance" in clean) clean.nps_allowance = Number(clean.nps_allowance);
  if ("fbp" in clean) clean.fbp = Number(clean.fbp);
  if ("vpf" in clean) clean.vpf = Number(clean.vpf);
  if ("days" in clean) clean.days = Number(clean.days);
  if ("pan_number" in clean) clean.pan_number = String(clean.pan_number).toUpperCase().trim();
  if ("uan_number" in clean) clean.uan_number = String(clean.uan_number).replace(/\D/g, "").slice(0, 12);
  if ("esi_opted" in clean) clean.esi_opted = Boolean(clean.esi_opted);
  if ("esi_number" in clean) clean.esi_number = String(clean.esi_number).trim();
  if ("bank_account_number" in clean) clean.bank_account_number = String(clean.bank_account_number).replace(/\D/g, "");
  if ("bank_ifsc_code" in clean) clean.bank_ifsc_code = String(clean.bank_ifsc_code).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
  if ("bank_name" in clean) clean.bank_name = String(clean.bank_name).trim();
  if ("payment_mode" in clean) clean.payment_mode = String(clean.payment_mode).trim();
  if ("employment_type" in clean) clean.employment_type = String(clean.employment_type).trim();
  return clean;
}

function employeeLabel(empId, employees = []) {
  if (!empId) return "—";
  const match = employees.find((e) => String(e.id) === String(empId));
  if (!match) return `Employee #${empId}`;
  const name = match.full_name || [match.first_name, match.last_name].filter(Boolean).join(" ");
  return `${match.employee_code || "EMP"} — ${name}`;
}

function itemSummary(item, employees = []) {
  const p = item.payload || {};
  const bits = [];
  if (item.item_type === "NEW_EMPLOYEE") {
    if (p.ctc_annual) bits.push(`Annual CTC: ₹${fmtINR(p.ctc_annual)}`);
    if (p.department) bits.push(p.department);
    if (p.hire_date) bits.push(`Joining: ${p.hire_date}`);
  } else if (item.item_type === "REVISION") {
    if (p.ctc_annual) bits.push(`Revised CTC: ₹${fmtINR(p.ctc_annual)}`);
    if (p.effective_from) bits.push(`From: ${p.effective_from}`);
    if (p.change_reason) bits.push(`(${p.change_reason})`);
  } else if (item.item_type === "EXIT") {
    if (p.last_working_date) bits.push(`LWD: ${p.last_working_date}`);
    if (p.reason) bits.push(`(${p.reason})`);
  } else if (item.item_type === "SALARY_HOLD") {
    if (p.amount) bits.push(`Hold: ₹${fmtINR(p.amount)}`);
    if (p.release_month) {
      const mStr = MONTHS[(Number(p.release_month) || 1) - 1] || p.release_month;
      bits.push(`Release: ${mStr} ${p.release_year || ""}`);
    }
  } else if (item.item_type === "LOP") {
    if (p.days) bits.push(`${p.days} day(s) LOP`);
    if (p.reason) bits.push(`(${p.reason})`);
  } else if (item.item_type === "ADVANCE") {
    if (p.total_amount) bits.push(`Advance: ₹${fmtINR(p.total_amount)}`);
    if (p.tenure_months) bits.push(`Tenure: ${p.tenure_months} mo`);
    if (p.label) bits.push(`(${p.label})`);
  } else {
    if (p.amount) bits.push(`Amount: ₹${fmtINR(p.amount)}`);
    if (p.description) bits.push(p.description);
    if (p.note) bits.push(p.note);
    if (p.reason) bits.push(p.reason);
  }
  return bits.join(" • ") || "—";
}

export function PayrollJobExcelUploadModal(props) {
  return <PayrollJobUnifiedInputsView {...props} />;
}


/* ==========================================================================
   PART 2: PAYROLL JOB MONTHLY INPUT MODAL
   ========================================================================== */

const INPUT_ITEM_TYPES = [
  { key: "NEW_EMPLOYEE", label: "New Joiner", desc: "Joiner with CTC & PAN", emoji: "👤", wash: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" } },
  { key: "REVISION", label: "Salary Revision", desc: "CTC revision & appraisal", emoji: "📈", wash: { bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce" } },
  { key: "EXIT", label: "Exit", desc: "Resignation & Last working day", emoji: "🚪", wash: { bg: "#fff1f2", border: "#fecdd3", text: "#be123c" } },
  { key: "SALARY_HOLD", label: "Salary Hold", desc: "Withheld payout release", emoji: "⏸️", wash: { bg: "#eef2ff", border: "#c7d2fe", text: "#4338ca" } },
  { key: "TDS", label: "TDS", desc: "Monthly tax deduction", emoji: "🧾", wash: { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" } },
  { key: "LOP", label: "LOP", desc: "Unpaid absence / loss of pay", emoji: "📅", wash: { bg: "#fefce8", border: "#fef08a", text: "#a16207" } },
  { key: "ARREARS", label: "Salary Arrears", desc: "Retroactive pay & back-hike", emoji: "↗️", wash: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" } },
  { key: "REIMBURSEMENT", label: "Reimbursement", desc: "Expense claim payout", emoji: "💳", wash: { bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1" } },
  { key: "ADVANCE", label: "Advance / Loan", desc: "Disbursement & monthly EMIs", emoji: "💰", wash: { bg: "#fffbeb", border: "#fde68a", text: "#b45309" } },
  { key: "ONE_TIME_EARNING", label: "Bonus", desc: "Bonus, incentive, or stipend", emoji: "➕", wash: { bg: "#f5f3ff", border: "#ddd6fe", text: "#6d28d9" } },
  { key: "ONE_TIME_DEDUCTION", label: "Deduction", desc: "One-time penalty or recovery", emoji: "➖", wash: { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" } },
  { key: "CUSTOM_COMPONENT", label: "Custom Component", desc: "Variable allowance or deduction", emoji: "🧩", wash: { bg: "#f0fdfa", border: "#99f6e4", text: "#0d9488" } },
  { key: "NOTE", label: "Note", desc: "Instructions for payroll team", emoji: "📝", wash: { bg: "#fefce8", border: "#fef08a", text: "#854d0e" } },
];

const DEFAULT_PAYLOAD = {
  NEW_EMPLOYEE: {
    employee_code: "",
    first_name: "",
    last_name: "",
    hire_date: "",
    effective_from: "",
    ctc_annual: "",
    department: "",
    position: "",
    employment_type: "REGULAR",
    payment_mode: "WIRE_TRANSFER",
    bank_name: "",
    bank_account_number: "",
    bank_ifsc_code: "",
    pf_opted: true,
    uan_number: "",
    esi_opted: false,
    esi_number: "",
    pan_number: "",
    email: "",
    nps_allowance: "",
    fbp: "",
    vpf: "",
  },
  REVISION: { employee_id: "", effective_from: "", ctc_annual: "", pf_opted: true, change_reason: "" },
  EXIT: { employee_id: "", last_working_date: "" },
  SALARY_HOLD: { employee_id: "", amount: "", release_month: "", release_year: "", reason: "" },
  TDS: { employee_id: "", amount: "", note: "" },
  LOP: { employee_id: "", days: "", reason: "" },
  ARREARS: { employee_id: "", amount: "", description: "" },
  REIMBURSEMENT: { employee_id: "", amount: "", description: "" },
  ADVANCE: { employee_id: "", total_amount: "", tenure_months: "", label: "" },
  ONE_TIME_EARNING: { employee_id: "", amount: "", description: "" },
  ONE_TIME_DEDUCTION: { employee_id: "", amount: "", description: "" },
  CUSTOM_COMPONENT: { employee_id: "", component_code: "", amount: "", description: "" },
  NOTE: { text: "" },
};

function normalizeInputPayload(p) {
  const clean = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === "" || v === null || v === undefined) continue;
    clean[k] = v;
  }
  if ("employee_id" in clean) clean.employee_id = Number(clean.employee_id);
  if ("tenure_months" in clean) clean.tenure_months = Number(clean.tenure_months);
  if ("release_month" in clean) clean.release_month = Number(clean.release_month);
  if ("release_year" in clean) clean.release_year = Number(clean.release_year);
  if ("amount" in clean) clean.amount = Number(clean.amount);
  if ("total_amount" in clean) clean.total_amount = Number(clean.total_amount);
  if ("ctc_annual" in clean) clean.ctc_annual = Number(clean.ctc_annual);
  if ("nps_allowance" in clean) clean.nps_allowance = Number(clean.nps_allowance);
  if ("fbp" in clean) clean.fbp = Number(clean.fbp);
  if ("vpf" in clean) clean.vpf = Number(clean.vpf);
  if ("days" in clean) clean.days = Number(clean.days);
  if ("pf_opted" in clean) clean.pf_opted = Boolean(clean.pf_opted);
  if ("pan_number" in clean) clean.pan_number = String(clean.pan_number).toUpperCase().trim();
  if ("uan_number" in clean) clean.uan_number = String(clean.uan_number).replace(/\D/g, "").slice(0, 12);
  if ("esi_opted" in clean) clean.esi_opted = Boolean(clean.esi_opted);
  if ("esi_number" in clean) clean.esi_number = String(clean.esi_number).trim();
  if ("bank_account_number" in clean) clean.bank_account_number = String(clean.bank_account_number).replace(/\D/g, "");
  if ("bank_ifsc_code" in clean) clean.bank_ifsc_code = String(clean.bank_ifsc_code).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
  if ("bank_name" in clean) clean.bank_name = String(clean.bank_name).trim();
  if ("payment_mode" in clean) clean.payment_mode = String(clean.payment_mode).trim();
  if ("employment_type" in clean) clean.employment_type = String(clean.employment_type).trim();
  return clean;
}

// fmt reused from shared scope

function getQueueItemDetails(item, employees = []) {
  const p = item.payload || {};
  let empName = "—";
  let empCode = "";

  if (p.employee_code && !p.employee_id) {
    empCode = p.employee_code;
    empName = [p.first_name, p.last_name].filter(Boolean).join(" ") || "New Joiner";
  } else if (p.employee_id) {
    const emp = employees.find((e) => String(e.id) === String(p.employee_id));
    if (emp) {
      empCode = emp.employee_code || `EMP#${p.employee_id}`;
      empName = [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim() || emp.full_name || "Employee";
    } else {
      empCode = `EMP#${p.employee_id}`;
      empName = `Staff #${p.employee_id}`;
    }
  }

  const pills = [];
  if (item.item_type === "NEW_EMPLOYEE") {
    if (p.position) pills.push({ label: p.position, bg: "#f1f5f9", text: "#475569" });
    if (p.employment_type && p.employment_type !== "REGULAR") {
      const typeLabels = { INTERN: "Intern (Stipend)", CONSULTANT: "Consultant" };
      pills.push({ label: typeLabels[p.employment_type] || p.employment_type, bg: "#fef3c7", text: "#92400e" });
    }
    if (p.ctc_annual) pills.push({ label: `CTC: ₹${fmt(p.ctc_annual)}`, bg: "#eff6ff", text: "#1d4ed8" });
    if (p.hire_date) pills.push({ label: `Join: ${p.hire_date}`, bg: "#f1f5f9", text: "#475569" });
    if (p.pan_number) pills.push({ label: `PAN: ${p.pan_number}`, bg: "#f1f5f9", text: "#475569" });
    if (p.bank_account_number) {
      const masked = `••••${String(p.bank_account_number).slice(-4)}`;
      pills.push({
        label: p.bank_name ? `🏦 ${p.bank_name} (${masked})` : `🏦 A/C ${masked}`,
        bg: "#f0fdf4",
        text: "#15803d",
      });
    }
    if (p.uan_number) pills.push({ label: `UAN: ${p.uan_number}`, bg: "#eff6ff", text: "#1d4ed8" });
  } else if (item.item_type === "REVISION") {
    if (p.ctc_annual) pills.push({ label: `New CTC: ₹${fmt(p.ctc_annual)}`, bg: "#faf5ff", text: "#7e22ce" });
    if (p.effective_from) pills.push({ label: `Eff: ${p.effective_from}`, bg: "#f1f5f9", text: "#475569" });
  } else if (item.item_type === "EXIT") {
    if (p.last_working_date) pills.push({ label: `LWD: ${p.last_working_date}`, bg: "#fff1f2", text: "#be123c" });
  } else if (item.item_type === "SALARY_HOLD") {
    if (p.amount) pills.push({ label: `Hold: ₹${fmt(p.amount)}`, bg: "#eef2ff", text: "#4338ca" });
    if (p.release_month) pills.push({ label: `Rel: ${p.release_month}/${p.release_year}`, bg: "#f1f5f9", text: "#475569" });
  } else if (item.item_type === "TDS") {
    if (p.amount) pills.push({ label: `TDS: ₹${fmt(p.amount)}`, bg: "#fff7ed", text: "#c2410c" });
  } else if (item.item_type === "LOP") {
    if (p.days != null) pills.push({ label: `${p.days} day(s) LOP`, bg: "#fefce8", text: "#a16207" });
  } else if (item.item_type === "ARREARS") {
    if (p.amount) pills.push({ label: `+ ₹${fmt(p.amount)}`, bg: "#f0fdf4", text: "#15803d" });
  } else if (item.item_type === "REIMBURSEMENT") {
    if (p.amount) pills.push({ label: `Claim: ₹${fmt(p.amount)}`, bg: "#f0f9ff", text: "#0369a1" });
  } else if (item.item_type === "ADVANCE") {
    if (p.total_amount) pills.push({ label: `Adv: ₹${fmt(p.total_amount)} (${p.tenure_months || 1} mo)`, bg: "#fffbeb", text: "#b45309" });
  } else if (item.item_type === "ONE_TIME_EARNING") {
    if (p.amount) pills.push({ label: `+ ₹${fmt(p.amount)}`, bg: "#f5f3ff", text: "#6d28d9" });
  } else if (item.item_type === "ONE_TIME_DEDUCTION") {
    if (p.amount) pills.push({ label: `- ₹${fmt(p.amount)}`, bg: "#fef2f2", text: "#b91c1c" });
  } else if (item.item_type === "NOTE") {
    if (p.text) pills.push({ label: `"${p.text.slice(0, 35)}${p.text.length > 35 ? '...' : ''}"`, bg: "#fefce8", text: "#854d0e" });
  }

  const note = p.description || p.reason || p.note || p.change_reason || p.label || "";
  return { empCode, empName, pills, note };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED PAYROLL INPUTS & UPLOADS WORKBENCH VIEW
// Consolidates Multi-Sheet Excel Uploads and Monthly Adjustments with Option 2A: Direct Inline Row Editing
// ─────────────────────────────────────────────────────────────────────────────
export function PayrollJobUnifiedInputsView({
  job,
  isMaker,
  isChecker,
  isAdmin,
  onClose,
  onSuccess,
  embedded = true,
}) {
  const clientId = job?.client;
  const clientName = job?.client_name || "Client";
  const month = job?.month || new Date().getMonth() + 1;
  const year = job?.year || new Date().getFullYear();

  // Context: portal submission & active staff
  const [submission, setSubmission] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loadingContext, setLoadingContext] = useState(true);

  // Excel file & upload state
  const [file, setFile] = useState(null);
  const [uploadedFileInfo, setUploadedFileInfo] = useState({ file_path: null, file_name: null });
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const fileInputRef = useRef(null);

  // Staged adjustments state (shared across Excel parse & manual additions)
  const [stagedItems, setStagedItems] = useState([]);
  const [notes, setNotes] = useState("");

  // Filtering & search
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Manual Adjustment Modal state
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualType, setManualType] = useState("ONE_TIME_EARNING");
  const [manualForm, setManualForm] = useState(DEFAULT_PAYLOAD["ONE_TIME_EARNING"] || {});
  const [manualError, setManualError] = useState("");
  const [clientComponents, setClientComponents] = useState([]);

  // Excel Upload Modal state
  const [excelModalOpen, setExcelModalOpen] = useState(false);

  // Commit & feedback state
  const [committing, setCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Initialize context on mount
  useEffect(() => {
    let active = true;
    const init = async () => {
      if (!clientId) return;
      setLoadingContext(true);
      setErrorMsg("");
      try {
        const subRes = await api.post(apiPath("portal-submissions/ensure/"), {
          client_id: clientId,
          month,
          year,
        });
        if (active) {
          setSubmission(subRes.data);
          if (subRes.data?.notes && !notes) {
            setNotes(subRes.data.notes);
          }
        }
      } catch (err) {
        console.warn("Could not ensure submission:", err);
      }
      try {
        const empRes = await api.get(apiPath("employees/"), { params: { client: clientId } });
        if (active) setEmployees(unwrapList(empRes));
      } catch (err) {
        console.warn("Could not load employees:", err);
      }
      try {
        const compRes = await api.get(apiPath("components/"), { params: { client: clientId } });
        if (active) setClientComponents(unwrapList(compRes));
      } catch (err) {
        console.warn("Could not load client components:", err);
      } finally {
        if (active) setLoadingContext(false);
      }
    };
    init();
    return () => { active = false; };
  }, [clientId, month, year]);

  // Option 2A: Direct in-table inline field edit handlers
  const handleUpdateField = (itemIdx, field, val) => {
    setStagedItems((prev) => {
      const next = [...prev];
      const target = next[itemIdx];
      if (!target) return prev;
      next[itemIdx] = {
        ...target,
        payload: {
          ...target.payload,
          [field]: val,
        },
      };
      return next;
    });
  };

  const handleDeleteItem = (itemIdx) => {
    setStagedItems((prev) => prev.filter((_, idx) => idx !== itemIdx));
  };

  // Excel template downloader
  const handleDownloadTemplate = async () => {
    if (!submission) return;
    setDownloading(true);
    setErrorMsg("");
    try {
      const res = await api.get(apiPath(`portal-submissions/${submission.id}/template/`), {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      const cleanName = (clientName || "Client").replace(/\s+/g, "_");
      link.download = `Payroll_Template_${cleanName}_${String(month).padStart(2, "0")}_${year}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || err.message || "Failed to download template.");
    } finally {
      setDownloading(false);
    }
  };

  // Excel file drag-drop & selection
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setErrorMsg("");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setErrorMsg("");
    }
  };

  // Parse Excel file and merge items directly into staged workbench table
  const handleParse = async () => {
    if (!file) {
      setErrorMsg("Please select or drop an Excel workbook (.xlsx) first.");
      return;
    }
    if (!submission) {
      setErrorMsg("Submission context not ready. Please wait a moment.");
      return;
    }
    setParsing(true);
    setErrorMsg("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(apiPath(`portal-submissions/${submission.id}/parse-excel/`), formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = res.data || {};
      const parsed = Array.isArray(data.items) ? data.items : [];
      const labeledItems = parsed.map((it, idx) => ({
        id: `excel_${Date.now()}_${idx}`,
        item_type: it.item_type,
        payload: {
          ...(it.payload || {}),
          _source: "excel_upload",
        },
        source: "excel",
      }));

      setStagedItems((prev) => [...prev, ...labeledItems]);
      if (data.notes) {
        setNotes((prev) => (prev ? `${prev}\n${data.notes}` : data.notes));
      }
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setUploadedFileInfo({
        file_path: data.file_path || null,
        file_name: data.file_name || file?.name || null,
      });
      setSuccessMsg(`✓ Successfully parsed and loaded ${labeledItems.length} adjustment(s) from ${file.name}.`);
      setTimeout(() => setSuccessMsg(""), 4500);
      setExcelModalOpen(false);
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || err.message || "Failed to parse Excel workbook.");
    } finally {
      setParsing(false);
    }
  };

  // Open manual adjustment modal
  const openManualModal = (typeKey = "ONE_TIME_EARNING") => {
    setManualType(typeKey);
    const base = { ...(DEFAULT_PAYLOAD[typeKey] || {}) };
    if (typeKey === "SALARY_HOLD") {
      base.release_month = String(month === 12 ? 1 : month + 1);
      base.release_year = String(month === 12 ? year + 1 : year);
    }
    setManualForm(base);
    setManualError("");
    setManualModalOpen(true);
  };

  // Add item from manual modal into staged table
  const handleAddManualItem = () => {
    setManualError("");
    const payload = normalizeInputPayload(manualForm);

    if (manualType === "NEW_EMPLOYEE") {
      if (!payload.employee_code || !payload.first_name || !payload.ctc_annual) {
        setManualError("Employee Code, First Name, and Annual CTC are required.");
        return;
      }
    } else if (manualType === "CUSTOM_COMPONENT") {
      if (!payload.employee_id) {
        setManualError("Please choose an employee from the dropdown.");
        return;
      }
      if (!payload.component_code) {
        setManualError("Please select which custom component to adjust.");
        return;
      }
      if (!payload.amount) {
        setManualError("Amount is required.");
        return;
      }
    } else if (manualType !== "NOTE") {
      if (!payload.employee_id) {
        setManualError("Please choose an employee from the dropdown.");
        return;
      }
    }

    const newItem = {
      id: `manual_${Date.now()}_${Math.random()}`,
      item_type: manualType,
      payload: {
        ...payload,
        _source: "monthly_input",
      },
      source: "manual",
    };

    setStagedItems((prev) => [...prev, newItem]);
    setManualModalOpen(false);
    setSuccessMsg(`✓ Added 1 manual adjustment to staged table.`);
    setTimeout(() => setSuccessMsg(""), 3500);
  };

  // Filter calculations
  const UNIFIED_FILTER_TABS = [
    { key: "ALL", label: "All Items" },
    { key: "NEW_EMPLOYEE", label: "Joiners" },
    { key: "REVISION", label: "Salary Revisions" },
    { key: "EXIT", label: "Exits" },
    { key: "LOP", label: "Loss of Pay" },
    { key: "EARNINGS", label: "Earnings / Arrears" },
    { key: "DEDUCTIONS", label: "Deductions / TDS" },
    { key: "CUSTOM_COMPONENT", label: "Custom Components" },
    { key: "SALARY_HOLD", label: "Salary Holds" },
    { key: "ADVANCE", label: "Advances / Loans" },
    { key: "REIMBURSEMENT", label: "Reimbursements" },
    { key: "NOTE", label: "Notes" },
  ];

  const getFilteredCount = (tabKey) => {
    if (tabKey === "ALL") return stagedItems.length;
    if (tabKey === "EARNINGS") {
      return stagedItems.filter((it) => ["ONE_TIME_EARNING", "ARREARS", "REIMBURSEMENT"].includes(it.item_type)).length;
    }
    if (tabKey === "DEDUCTIONS") {
      return stagedItems.filter((it) => ["ONE_TIME_DEDUCTION", "TDS"].includes(it.item_type)).length;
    }
    if (tabKey === "NOTE") {
      return stagedItems.filter((it) => it.item_type === "NOTE").length + (notes ? 1 : 0);
    }
    return stagedItems.filter((it) => it.item_type === tabKey).length;
  };

  const indexedItems = useMemo(() => {
    return stagedItems.map((item, originalIndex) => ({ item, originalIndex }));
  }, [stagedItems]);

  const filteredItems = useMemo(() => {
    let list = indexedItems;
    if (activeTab !== "ALL") {
      if (activeTab === "EARNINGS") {
        list = list.filter(({ item }) => ["ONE_TIME_EARNING", "ARREARS", "REIMBURSEMENT"].includes(item.item_type));
      } else if (activeTab === "DEDUCTIONS") {
        list = list.filter(({ item }) => ["ONE_TIME_DEDUCTION", "TDS"].includes(item.item_type));
      } else if (activeTab === "NOTE") {
        list = list.filter(({ item }) => item.item_type === "NOTE");
      } else {
        list = list.filter(({ item }) => item.item_type === activeTab);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(({ item }) => {
        const p = item.payload || {};
        const emp = employeeLabel(p.employee_id, employees).toLowerCase();
        const code = String(p.employee_code || "").toLowerCase();
        const name = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
        const desc = String(p.description || p.reason || p.note || p.change_reason || p.label || p.text || "").toLowerCase();
        return emp.includes(q) || code.includes(q) || name.includes(q) || desc.includes(q);
      });
    }
    return list;
  }, [indexedItems, activeTab, searchQuery, employees]);

  // Master commit handler
  const handleCommit = async (autoApply = false) => {
    if (!submission) return;
    if (stagedItems.length === 0) {
      setErrorMsg("No staged adjustments to commit.");
      return;
    }
    setCommitting(true);
    setErrorMsg("");
    try {
      const cleanItems = stagedItems.map((it) => {
        const itemSource = it.source === "excel" ? "excel_upload" : "monthly_input";
        const normPayload = normalizeUploadPayload(it.item_type, it.payload || {});
        normPayload._source = itemSource;
        return {
          item_type: it.item_type,
          payload: normPayload,
          source: it.source || (itemSource === "excel_upload" ? "excel" : "manual"),
        };
      });

      await api.post(apiPath(`portal-submissions/${submission.id}/commit-excel/`), {
        items: cleanItems,
        notes: notes.trim(),
        file_path: uploadedFileInfo?.file_path,
        file_name: uploadedFileInfo?.file_name || file?.name,
        auto_apply: Boolean(autoApply),
      });

      if (!autoApply && job?.id) {
        try {
          await api.post(`/payroll/jobs/${job.id}/transition-status/`, {
            action: "submit_for_review",
            notes: `Submitted ${cleanItems.length} adjustment(s) for Checker review.`,
          });
        } catch (err) {
          console.warn("Status transition note:", err);
        }
      }

      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || err.message || "Failed to commit monthly inputs.");
    } finally {
      setCommitting(false);
    }
  };

  const activeMeta = INPUT_ITEM_TYPES.find((t) => t.key === manualType);

  const viewContent = (
    <div
      className={
        embedded
          ? "bg-white rounded-2xl w-full h-full border border-slate-200/90 overflow-hidden flex flex-col shadow-sm"
          : "bg-white rounded-2xl w-[min(1240px,96vw)] h-[min(820px,92vh)] overflow-hidden flex flex-col shadow-2xl border border-slate-200"
      }
    >
      {/* ── Top Master Header ── */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50 flex-shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center text-lg shadow-sm flex-shrink-0">
            📥
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-slate-900 m-0 truncate">
              Monthly Inputs & Uploads Workbench
            </h3>
            <p className="text-xs text-slate-500 m-0 mt-0.5 truncate">
              {clientName} · Period: {job?.period || `${MONTHS[month - 1]} ${year}`} · Upload Excel spreadsheets & stage inline adjustments
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={downloading || !submission}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            title="Download blank multi-sheet Excel template for this client"
          >
            <Download size={13} />
            <span>{downloading ? "Preparing…" : "Download Template"}</span>
          </button>

          {isMaker ? (
            <>
              <button
                type="button"
                onClick={() => setExcelModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-all cursor-pointer"
                title="Upload monthly attendance and adjustments Excel workbook"
              >
                <Upload size={13} strokeWidth={2.5} />
                <span>Upload Excel</span>
              </button>

              <button
                type="button"
                onClick={() => openManualModal("ONE_TIME_EARNING")}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
              >
                <Plus size={14} strokeWidth={2.5} />
                <span>Add Manual Adjustment</span>
              </button>
            </>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium" title="Only assigned Makers can upload or add monthly inputs">
              <span>🔒</span>
              <span>Maker-Only Input Mode</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Notification & Alert Banners ── */}
      {errorMsg && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 px-6 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg("")} className="text-red-700 hover:text-red-900 font-bold">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 px-6 py-2 text-xs font-semibold flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg("")} className="text-emerald-700 hover:text-emerald-900 font-bold">✕</button>
        </div>
      )}

      {/* ── Main Scrollable Body ── */}
      <div className="flex-1 overflow-y-auto p-5 bg-white flex flex-col gap-4">
        {/* ── Parser Warnings Box (if any) ── */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 mb-1">
              <AlertTriangle size={14} />
              <span>{warnings.length} Parsing Warning{warnings.length > 1 ? "s" : ""} Flagged</span>
            </div>
            <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
              {warnings.map((w, idx) => {
                const isObj = typeof w === "object" && w !== null;
                const sheet = isObj ? w.sheet : "";
                const row = isObj ? w.row : "";
                const msg = isObj ? w.message || JSON.stringify(w) : String(w);
                return (
                  <div key={idx} className="text-[11px] text-amber-900 flex items-baseline gap-1.5">
                    <span className="text-amber-500">•</span>
                    {sheet && <span className="font-bold bg-amber-100 text-amber-800 px-1 py-0.2 rounded text-[10px]">{sheet}{row ? ` · R${row}` : ""}</span>}
                    <span>{msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Toolbar: Category Filter Tabs & Instant Search ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
            {UNIFIED_FILTER_TABS.map((tab) => {
              const count = getFilteredCount(tab.key);
              if (tab.key !== "ALL" && count === 0) return null;
              const isActive = activeTab === tab.key;
              return (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 whitespace-nowrap transition-colors ${isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${isActive ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[220px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, staff, remarks…"
              className="w-full pl-8 pr-7 py-1 text-xs rounded-lg border border-slate-300 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer p-0.5"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ── Staged Adjustments Table with Option 2A: Direct Inline Row Editing ── */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col flex-1 min-h-[280px]">
          {filteredItems.length === 0 ? (
            <div className="p-10 text-center flex flex-col items-center justify-center my-auto">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-xl mb-2">
                📋
              </div>
              <div className="text-sm font-bold text-slate-800">
                {stagedItems.length === 0 ? "No Monthly Adjustments Staged Yet" : "No adjustments match this filter"}
              </div>
              <div className="text-xs text-slate-500 max-w-sm mt-1 mb-4 leading-relaxed">
                {stagedItems.length === 0
                  ? "Drop an attendance Excel workbook above or click '+ Add Manual Adjustment' to stage bonuses, LOP, or revisions."
                  : "Try clearing your search query or selecting 'All Items'."}
              </div>
              {stagedItems.length === 0 && (
                <button
                  type="button"
                  onClick={() => openManualModal("ONE_TIME_EARNING")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Add First Adjustment</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3 w-24">Source</th>
                    <th className="py-2.5 px-3 w-36">Category</th>
                    <th className="py-2.5 px-3 min-w-[180px]">Employee</th>
                    <th className="py-2.5 px-3 w-36">Amount (₹)</th>
                    <th className="py-2.5 px-3 w-28">LOP Days</th>
                    <th className="py-2.5 px-3 w-36">Dates / Details</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Remarks / Note</th>
                    <th className="py-2.5 px-3 w-12 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredItems.map(({ item, originalIndex }, rowIdx) => {
                    const p = item.payload || {};
                    const cfg = TYPE_CONFIG[item.item_type] || { label: item.item_type, tone: "#334155", bg: "#f1f5f9", border: "#cbd5e1" };

                    // Determine amount field if applicable
                    const amtKey = "amount" in p ? "amount" : ("total_amount" in p ? "total_amount" : ("ctc_annual" in p ? "ctc_annual" : null));
                    // Determine remarks field
                    const remarkKey = "description" in p ? "description" : ("reason" in p ? "reason" : ("note" in p ? "note" : ("change_reason" in p ? "change_reason" : ("label" in p ? "label" : ("text" in p ? "text" : "description")))));

                    return (
                      <tr key={item.id || originalIndex} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                          {rowIdx + 1}
                        </td>

                        {/* Source Badge */}
                        <td className="py-2 px-3">
                          {item.source === "excel" || item.payload?._source === "excel_upload" ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              📁 Excel
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                              📝 Manual
                            </span>
                          )}
                        </td>

                        {/* Category Badge */}
                        <td className="py-2 px-3">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-extrabold whitespace-nowrap"
                            style={{
                              background: cfg.bg,
                              color: cfg.tone,
                              border: `1px solid ${cfg.border}`,
                            }}
                          >
                            {cfg.label}
                          </span>
                        </td>

                        {/* Employee Identity */}
                        <td className="py-2 px-3">
                          {item.item_type === "NEW_EMPLOYEE" ? (
                            <div>
                              <div className="font-bold text-slate-900">
                                {p.employee_code || "NEW"} — {[p.first_name, p.last_name].filter(Boolean).join(" ") || "New Joiner"}
                              </div>
                              <div className="text-[10.5px] text-blue-600 font-semibold">
                                New Joiner · CTC ₹{fmtINR(p.ctc_annual)}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-slate-900">
                                {employeeLabel(p.employee_id, employees)}
                              </div>
                              {p.department && (
                                <div className="text-[10.5px] text-slate-400">
                                  {p.department}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Amount (Option 2A: Direct Inline Numeric Input) */}
                        <td className="py-2 px-3">
                          {amtKey ? (
                            isMaker ? (
                              <div className="flex items-center gap-1">
                                <span className="text-slate-400 font-semibold text-[11px]">₹</span>
                                <input
                                  type="number"
                                  value={p[amtKey] !== undefined && p[amtKey] !== null ? p[amtKey] : ""}
                                  onChange={(e) => handleUpdateField(originalIndex, amtKey, e.target.value)}
                                  placeholder="0"
                                  className="w-28 px-2 py-1 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                />
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-800">
                                ₹{fmtINR(p[amtKey])}
                              </span>
                            )
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>

                        {/* LOP Days (Option 2A: Direct Inline Numeric Input) */}
                        <td className="py-2 px-3">
                          {item.item_type === "LOP" || "days" in p ? (
                            isMaker ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.5"
                                  value={p.days !== undefined && p.days !== null ? p.days : ""}
                                  onChange={(e) => handleUpdateField(originalIndex, "days", e.target.value)}
                                  placeholder="0"
                                  className="w-18 px-2 py-1 text-xs font-bold text-amber-900 bg-amber-50/60 border border-amber-300 rounded focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                />
                                <span className="text-amber-700 font-semibold text-[11px]">d</span>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                {p.days || 0} d
                              </span>
                            )
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>

                        {/* Dates / Attributes */}
                        <td className="py-2 px-3 text-[11px] text-slate-600">
                          {p.effective_from && <div>Eff: {p.effective_from}</div>}
                          {p.last_working_date && <div>LWD: {p.last_working_date}</div>}
                          {p.hire_date && <div>Join: {p.hire_date}</div>}
                          {p.release_month && <div>Rel: {p.release_month}/{p.release_year}</div>}
                          {p.tenure_months && <div>Tenure: {p.tenure_months} mo</div>}
                          {!p.effective_from && !p.last_working_date && !p.hire_date && !p.release_month && !p.tenure_months && (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Remarks / Description (Option 2A: Direct Inline Text Input) */}
                        <td className="py-2 px-3">
                          {isMaker ? (
                            <input
                              type="text"
                              value={p[remarkKey] || ""}
                              onChange={(e) => handleUpdateField(originalIndex, remarkKey, e.target.value)}
                              placeholder="Add remarks or notes…"
                              className="w-full min-w-[160px] px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-300"
                            />
                          ) : (
                            <span className="text-xs text-slate-600">
                              {p[remarkKey] || "—"}
                            </span>
                          )}
                        </td>

                        {/* Action: Delete */}
                        <td className="py-2 px-3 text-center">
                          {isMaker ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(originalIndex)}
                              className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Remove adjustment"
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Master Footer & Commit Bar ── */}
      <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex-shrink-0">
        <div className="flex items-center gap-3">
          {stagedItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear all staged adjustments?")) {
                  setStagedItems([]);
                }
              }}
              disabled={committing}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold cursor-pointer transition-colors"
            >
              Clear All Staged ({stagedItems.length})
            </button>
          )}
          <span className="text-xs text-slate-500">
            <strong className="text-slate-800">{stagedItems.length}</strong> adjustment(s) verified & ready to commit
          </span>
        </div>

        {isChecker ? (
          /* Checker Dual Controls: Stage vs Immediate Apply */
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleCommit(false)}
              disabled={committing || stagedItems.length === 0}
              className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-colors disabled:opacity-50"
              title="Stage verified items as pending without immediate calculation into batch"
            >
              Stage as Pending
            </button>
            <button
              type="button"
              onClick={() => handleCommit(true)}
              disabled={committing || stagedItems.length === 0}
              className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer shadow-md transition-colors disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              <span>{committing ? "Applying…" : `Approve & Apply to Batch (${stagedItems.length})`}</span>
            </button>
          </div>
        ) : isMaker ? (
          /* Maker View: Forward to Checker */
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleCommit(false)}
              disabled={committing || stagedItems.length === 0}
              className="inline-flex items-center gap-2 bg-[#1A2F5A] hover:bg-[#152547] text-white px-5 py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer shadow-md transition-colors disabled:opacity-50"
            >
              <span>🚀</span>
              <span>{committing ? "Submitting…" : `Submit to Checker for Review (${stagedItems.length})`}</span>
            </button>
          </div>
        ) : (
          /* Non-Maker / Non-Checker View (Admin or Viewer): View Only */
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
            <span>👁️</span>
            <span>View-Only Mode · Only Makers can submit adjustments</span>
          </div>
        )}
      </div>

      {/* ── Add Manual Adjustment Modal Popover ── */}
      {manualModalOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-[1400] flex items-center justify-center p-4"
          onClick={() => setManualModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-[700px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 m-0 flex items-center gap-2">
                  <span>➕</span>
                  <span>Add Manual Monthly Adjustment</span>
                </h3>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  Select a category and key in the adjustment details
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="bg-transparent border-none text-slate-400 hover:text-slate-700 text-lg cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
              {manualError && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{manualError}</span>
                </div>
              )}

              {/* 12 Category Selector Tiles */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  1. Choose Adjustment Category
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {INPUT_ITEM_TYPES.map((t) => {
                    const isSelected = manualType === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          setManualType(t.key);
                          const base = { ...(DEFAULT_PAYLOAD[t.key] || {}) };
                          if (t.key === "SALARY_HOLD") {
                            base.release_month = String(month === 12 ? 1 : month + 1);
                            base.release_year = String(month === 12 ? year + 1 : year);
                          }
                          setManualForm(base);
                        }}
                        className="h-[36px] text-left px-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 border"
                        style={{
                          background: isSelected ? t.wash.bg : "#ffffff",
                          borderColor: isSelected ? t.wash.text : "#e2e8f0",
                          borderWidth: isSelected ? "2px" : "1px",
                        }}
                      >
                        <span className="text-sm flex-shrink-0">{t.emoji}</span>
                        <span
                          className="text-[11px] font-bold truncate"
                          style={{ color: isSelected ? t.wash.text : "#334155" }}
                        >
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Form Area */}
              <div
                className="rounded-xl p-4 border flex flex-col gap-3 flex-1"
                style={{
                  background: activeMeta?.wash.bg || "#f8fafc",
                  borderColor: activeMeta?.wash.border || "#e2e8f0",
                }}
              >
                <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: activeMeta?.wash.text }}>
                  <span>{activeMeta?.emoji}</span>
                  <span>2. Key In {activeMeta?.label} Details</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {manualType === "NEW_EMPLOYEE" ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Employee Code *</label>
                        <Input
                          value={manualForm.employee_code || ""}
                          onChange={(e) => setManualForm({ ...manualForm, employee_code: e.target.value })}
                          placeholder="e.g. KSPL900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">First Name *</label>
                        <Input
                          value={manualForm.first_name || ""}
                          onChange={(e) => setManualForm({ ...manualForm, first_name: e.target.value })}
                          placeholder="First name"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Last Name</label>
                        <Input
                          value={manualForm.last_name || ""}
                          onChange={(e) => setManualForm({ ...manualForm, last_name: e.target.value })}
                          placeholder="Last name"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Hire Date</label>
                        <Input
                          type="date"
                          value={manualForm.hire_date || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualForm((prev) => ({
                              ...prev,
                              hire_date: val,
                              effective_from: prev.effective_from ? prev.effective_from : val,
                            }));
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Effective From</label>
                        <Input
                          type="date"
                          value={manualForm.effective_from || ""}
                          onChange={(e) => setManualForm({ ...manualForm, effective_from: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Annual CTC (₹) *</label>
                        <Input
                          type="number"
                          value={manualForm.ctc_annual || ""}
                          onChange={(e) => setManualForm({ ...manualForm, ctc_annual: e.target.value })}
                          placeholder="600000"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Department</label>
                        <Input
                          value={manualForm.department || ""}
                          onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })}
                          placeholder="e.g. Engineering"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Position</label>
                        <Input
                          value={manualForm.position || ""}
                          onChange={(e) => setManualForm({ ...manualForm, position: e.target.value })}
                          placeholder="e.g. Associate"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">PAN</label>
                        <Input
                          value={manualForm.pan_number || ""}
                          onChange={(e) => setManualForm({ ...manualForm, pan_number: e.target.value.toUpperCase() })}
                          placeholder="ABCDE1234F"
                          maxLength={10}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Email</label>
                        <Input
                          type="email"
                          value={manualForm.email || ""}
                          onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                          placeholder="name@company.com"
                        />
                      </div>
                      <div className="flex items-center pt-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={manualForm.pf_opted !== false}
                            onChange={(e) => setManualForm({ ...manualForm, pf_opted: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>PF opted (EPF)</span>
                        </label>
                      </div>
                      {manualForm.pf_opted !== false && (
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                            UAN Number (12-digit EPF)
                          </label>
                          <Input
                            value={manualForm.uan_number || ""}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                              setManualForm({ ...manualForm, uan_number: val });
                            }}
                            placeholder="e.g. 100123456789"
                            maxLength={12}
                          />
                        </div>
                      )}
                      <div className="flex items-center pt-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(manualForm.esi_opted)}
                            onChange={(e) => setManualForm({ ...manualForm, esi_opted: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>ESI opted (Gross ≤ ₹21k)</span>
                        </label>
                      </div>
                      {Boolean(manualForm.esi_opted) && (
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                            ESI Number (10-digit IP)
                          </label>
                          <Input
                            value={manualForm.esi_number || ""}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                              setManualForm({ ...manualForm, esi_number: val });
                            }}
                            placeholder="e.g. 1234567890"
                            maxLength={10}
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">NPS Allowance (₹)</label>
                        <Input
                          type="number"
                          value={manualForm.nps_allowance || ""}
                          onChange={(e) => setManualForm({ ...manualForm, nps_allowance: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">FBP (₹)</label>
                        <Input
                          type="number"
                          value={manualForm.fbp || ""}
                          onChange={(e) => setManualForm({ ...manualForm, fbp: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">VPF (₹)</label>
                        <Input
                          type="number"
                          value={manualForm.vpf || ""}
                          onChange={(e) => setManualForm({ ...manualForm, vpf: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Employment Type</label>
                        <select
                          value={manualForm.employment_type || "REGULAR"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualForm({
                              ...manualForm,
                              employment_type: val,
                              pf_opted: val === "INTERN" ? false : manualForm.pf_opted,
                              esi_opted: val === "INTERN" ? false : manualForm.esi_opted,
                            });
                          }}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-800 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="REGULAR">Regular (Full-time)</option>
                          <option value="INTERN">Intern / Apprentice (Stipend)</option>
                          <option value="CONSULTANT">Consultant / Contractor</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Payment Mode</label>
                        <select
                          value={manualForm.payment_mode || "WIRE_TRANSFER"}
                          onChange={(e) => setManualForm({ ...manualForm, payment_mode: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-800 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="WIRE_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                          <option value="CHEQUE">Cheque</option>
                          <option value="CASH">Cash</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Bank Account Number</label>
                        <Input
                          value={manualForm.bank_account_number || ""}
                          onChange={(e) => setManualForm({ ...manualForm, bank_account_number: e.target.value.replace(/\D/g, "") })}
                          placeholder="e.g. 50100234567890"
                          className="font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Bank IFSC Code</label>
                        <Input
                          value={manualForm.bank_ifsc_code || ""}
                          onChange={(e) => {
                            const ifsc = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
                            const updates = { bank_ifsc_code: ifsc };
                            if (!manualForm.bank_name && ifsc.length >= 4) {
                              const bankMap = {
                                HDFC: "HDFC Bank", SBIN: "State Bank of India", ICIC: "ICICI Bank",
                                UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", BARB: "Bank of Baroda",
                                PUNB: "Punjab National Bank", IDFB: "IDFC FIRST Bank", YESB: "Yes Bank",
                              };
                              if (bankMap[ifsc.slice(0, 4)]) updates.bank_name = bankMap[ifsc.slice(0, 4)];
                            }
                            setManualForm({ ...manualForm, ...updates });
                          }}
                          placeholder="e.g. HDFC0001234"
                          maxLength={11}
                          className="font-mono text-xs uppercase"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Bank Name</label>
                        <Input
                          value={manualForm.bank_name || ""}
                          onChange={(e) => setManualForm({ ...manualForm, bank_name: e.target.value })}
                          placeholder="e.g. HDFC Bank"
                          className="text-xs"
                        />
                      </div>
                    </>
                  ) : manualType === "NOTE" ? (
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Instruction Memo *</label>
                      <Textarea rows={4} value={manualForm.text || ""} onChange={(e) => setManualForm({ ...manualForm, text: e.target.value })} placeholder="Note for Checker..." />
                    </div>
                  ) : (
                    <>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Select Employee *</label>
                        <SearchableEmployeeSelect
                          employees={employees}
                          value={manualForm.employee_id}
                          onChange={(id) => setManualForm({ ...manualForm, employee_id: id })}
                        />
                      </div>

                      {manualType === "CUSTOM_COMPONENT" && (
                        <>
                          <div className="col-span-2">
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Custom Component *</label>
                            <select
                              value={manualForm.component_code || ""}
                              onChange={(e) => {
                                const selectedCode = e.target.value;
                                const compObj = (clientComponents || []).find((c) => c.code === selectedCode);
                                setManualForm({
                                  ...manualForm,
                                  component_code: selectedCode,
                                  amount: manualForm.amount || (compObj?.default_value ? String(compObj.default_value) : ""),
                                });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 outline-none focus:border-teal-500 font-medium"
                            >
                              <option value="">— Choose a custom perk / allowance —</option>
                              {(clientComponents || [])
                                .filter((c) => c.is_active && !c.code?.startsWith("__"))
                                .map((c) => (
                                  <option key={c.id || c.code} value={c.code}>
                                    {c.name} ({c.code}) — {c.component_type === "EARNING" ? "Addition ➕" : "Deduction ➖"}
                                    {c.is_monthly_variable ? " [Variable 📊]" : " [Fixed 🔒]"}
                                  </option>
                                ))}
                            </select>
                            {clientComponents.length === 0 && (
                              <p className="text-[10.5px] text-amber-600 mt-1">
                                No custom components configured for this client yet. Add them in the Salary Structuring Policy tab first.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Amount (₹) *</label>
                            <Input
                              type="number"
                              value={manualForm.amount || ""}
                              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                              placeholder="e.g. 5000"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Description / Remarks</label>
                            <Input
                              value={manualForm.description || ""}
                              onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                              placeholder="e.g. Oct Fuel Claim, Project Bonus"
                            />
                          </div>
                        </>
                      )}

                      {manualType === "REVISION" && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Revised Annual CTC (₹) *</label>
                            <Input type="number" value={manualForm.ctc_annual || ""} onChange={(e) => setManualForm({ ...manualForm, ctc_annual: e.target.value })} placeholder="720000" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Effective Date *</label>
                            <Input type="date" value={manualForm.effective_from || ""} onChange={(e) => setManualForm({ ...manualForm, effective_from: e.target.value })} />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Change Reason</label>
                            <Input value={manualForm.change_reason || ""} onChange={(e) => setManualForm({ ...manualForm, change_reason: e.target.value })} placeholder="Annual appraisal" />
                          </div>
                        </>
                      )}

                      {manualType === "EXIT" && (
                        <div className="col-span-2">
                          <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Last Working Date (LWD) *</label>
                          <Input type="date" value={manualForm.last_working_date || ""} onChange={(e) => setManualForm({ ...manualForm, last_working_date: e.target.value })} />
                        </div>
                      )}

                      {manualType === "SALARY_HOLD" && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Amount to Hold (₹) *</label>
                            <Input type="number" value={manualForm.amount || ""} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} placeholder="25000" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Release Month & Year *</label>
                            <div className="grid grid-cols-[1.2fr_1fr] gap-1">
                              <select
                                className="rounded-lg px-2 py-1 text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none"
                                value={manualForm.release_month || ""}
                                onChange={(e) => setManualForm({ ...manualForm, release_month: e.target.value })}
                              >
                                {MONTHS.map((m, idx) => <option key={idx + 1} value={idx + 1}>{m}</option>)}
                              </select>
                              <Input type="number" value={manualForm.release_year || ""} onChange={(e) => setManualForm({ ...manualForm, release_year: e.target.value })} />
                            </div>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Reason</label>
                            <Input value={manualForm.reason || ""} onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })} placeholder="Notice period hold" />
                          </div>
                        </>
                      )}

                      {manualType === "LOP" && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">LOP / Absence Days *</label>
                            <Input type="number" step="0.5" value={manualForm.days || ""} onChange={(e) => setManualForm({ ...manualForm, days: e.target.value })} placeholder="2.0" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Reason</label>
                            <Input value={manualForm.reason || ""} onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })} placeholder="Unapproved leave" />
                          </div>
                        </>
                      )}

                      {manualType === "ADVANCE" && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Advance Amount (₹) *</label>
                            <Input type="number" value={manualForm.total_amount || ""} onChange={(e) => setManualForm({ ...manualForm, total_amount: e.target.value })} placeholder="30000" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Tenure (Months) *</label>
                            <Input type="number" value={manualForm.tenure_months || ""} onChange={(e) => setManualForm({ ...manualForm, tenure_months: e.target.value })} placeholder="3" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Description</label>
                            <Input value={manualForm.label || ""} onChange={(e) => setManualForm({ ...manualForm, label: e.target.value })} placeholder="Salary advance / Festive loan" />
                          </div>
                        </>
                      )}

                      {["ONE_TIME_EARNING", "ONE_TIME_DEDUCTION", "ARREARS", "REIMBURSEMENT", "TDS"].includes(manualType) && (
                        <>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Amount (₹) *</label>
                            <Input type="number" value={manualForm.amount || ""} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} placeholder="5000" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Description / Note</label>
                            <Input
                              value={manualForm.description || manualForm.note || ""}
                              onChange={(e) => setManualForm({ ...manualForm, description: e.target.value, note: e.target.value })}
                              placeholder="e.g. Performance bonus / Arrears"
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 flex-shrink-0 shadow-[0_-2px_6px_rgba(0,0,0,0.04)]">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddManualItem}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-sm transition-colors"
              >
                ➕ Add to Staged Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dedicated Excel Upload Modal Popover ── */}
      {excelModalOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-[1400] flex items-center justify-center p-4"
          onClick={() => {
            if (!parsing) setExcelModalOpen(false);
          }}
        >
          <div
            className="bg-white rounded-2xl w-[560px] max-w-[94vw] overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-base font-bold">
                  📤
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 m-0">
                    Upload Monthly Excel Workbook
                  </h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    {clientName} · Period: {job?.period || `${MONTHS[month - 1]} ${year}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!parsing) setExcelModalOpen(false);
                }}
                disabled={parsing}
                className="bg-transparent border-none text-slate-400 hover:text-slate-700 text-lg cursor-pointer p-1 disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col gap-4">
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Dropzone container */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 transition-all duration-150 flex flex-col items-center justify-center text-center gap-3 ${dragOver
                  ? "border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/20"
                  : file
                    ? "border-emerald-400 bg-emerald-50/30"
                    : "border-slate-300 bg-slate-50/60 hover:bg-slate-50"
                  }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                />

                {!file ? (
                  <div
                    className="flex flex-col items-center gap-2.5 cursor-pointer py-4"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  >
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-sm">
                      <Upload size={22} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        Drop Monthly Excel Workbook here, or <span className="text-emerald-700 underline font-extrabold">Browse Files</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 max-w-sm">
                        Supports multi-sheet template containing Attendance, LOP, Overtime, Arrears, Deductions, and Joiners/Exits.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-3 w-full">
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-sm">
                      <FileCheck2 size={24} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 flex items-center justify-center gap-2">
                        <span>{file.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Ready to parse and stage into the adjustments table.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      disabled={parsing}
                      className="mt-1 px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Change File
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
                <span className="font-bold text-slate-800">💡 Quick Tip:</span> You can download the latest pre-formatted multi-sheet workbook using the <strong>Download Template</strong> button before filling in values.
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 flex-shrink-0 shadow-[0_-2px_6px_rgba(0,0,0,0.04)]">
              <button
                type="button"
                onClick={() => {
                  if (!parsing) setExcelModalOpen(false);
                }}
                disabled={parsing}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleParse}
                disabled={!file || parsing}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={13} />
                <span>{parsing ? "Parsing Workbook…" : "Parse Workbook & Stage Rows →"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return viewContent;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[1200] flex items-center justify-center p-4">
      {viewContent}
    </div>
  );
}

export function PayrollJobMonthlyInputModal(props) {
  return <PayrollJobUnifiedInputsView {...props} />;
}



/* ==========================================================================
   PART 3: PAYROLL JOB UNIFIED AUDIT MODAL
   ========================================================================== */

const AUDIT_ITEM_TYPES = [
  { key: "NEW_EMPLOYEE", label: "New Joiner", emoji: "👤", wash: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" } },
  { key: "REVISION", label: "Salary Revision", emoji: "📈", wash: { bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce" } },
  { key: "EXIT", label: "Exit / Resignation", emoji: "🚪", wash: { bg: "#fff1f2", border: "#fecdd3", text: "#be123c" } },
  { key: "SALARY_HOLD", label: "Salary Hold", emoji: "⏸️", wash: { bg: "#eef2ff", border: "#c7d2fe", text: "#4338ca" } },
  { key: "TDS", label: "TDS (Income Tax)", emoji: "🧾", wash: { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" } },
  { key: "LOP", label: "LOP / Unpaid Leave", emoji: "📅", wash: { bg: "#fefce8", border: "#fef08a", text: "#a16207" } },
  { key: "ARREARS", label: "Salary Arrears", emoji: "↗️", wash: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" } },
  { key: "REIMBURSEMENT", label: "Reimbursement", emoji: "💳", wash: { bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1" } },
  { key: "ADVANCE", label: "Advance / Loan", emoji: "💰", wash: { bg: "#fffbeb", border: "#fde68a", text: "#b45309" } },
  { key: "ONE_TIME_EARNING", label: "Bonus / Earning", emoji: "➕", wash: { bg: "#f5f3ff", border: "#ddd6fe", text: "#6d28d9" } },
  { key: "ONE_TIME_DEDUCTION", label: "Deduction", emoji: "➖", wash: { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" } },
  { key: "CUSTOM_COMPONENT", label: "Custom Component", emoji: "🧩", wash: { bg: "#f0fdfa", border: "#99f6e4", text: "#0d9488" } },
  { key: "NOTE", label: "Note / Memo", emoji: "📝", wash: { bg: "#fefce8", border: "#fef08a", text: "#854d0e" } },
];

// fmt reused from shared scope

function itemSummaryBadges(item, employees = [], clientComponents = []) {
  const p = item.payload || {};
  const badges = [];

  if (item.item_type === "NEW_EMPLOYEE") {
    if (p.ctc_annual) badges.push(`Annual CTC: ₹${fmt(p.ctc_annual)}`);
    if (p.department) badges.push(`Dept: ${p.department}`);
    if (p.hire_date) badges.push(`Joining: ${p.hire_date}`);
    if (p.pan_number || p.pan) badges.push(`PAN: ${p.pan_number || p.pan}`);
    if (p.uan_number || p.uan) badges.push(`UAN: ${p.uan_number || p.uan}`);
    if (p.bank_account_number || p.bank_account_no) badges.push(`A/C: ${p.bank_account_number || p.bank_account_no}`);
    if (p.bank_ifsc_code || p.bank_ifsc || p.ifsc) badges.push(`IFSC: ${p.bank_ifsc_code || p.bank_ifsc || p.ifsc}`);
    if (p.email) badges.push(`Email: ${p.email}`);
  } else if (item.item_type === "REVISION") {
    if (p.ctc_annual) badges.push(`Revised CTC: ₹${fmt(p.ctc_annual)}`);
    if (p.effective_from) badges.push(`From: ${p.effective_from}`);
    if (p.change_reason) badges.push(`Reason: ${p.change_reason}`);
  } else if (item.item_type === "EXIT") {
    if (p.last_working_date) badges.push(`LWD: ${p.last_working_date}`);
    if (p.reason) badges.push(`Reason: ${p.reason}`);
  } else if (item.item_type === "SALARY_HOLD") {
    if (p.amount) badges.push(`Hold: ₹${fmt(p.amount)}`);
    if (p.release_month) {
      const mStr = MONTHS[(Number(p.release_month) || 1) - 1] || p.release_month;
      badges.push(`Release: ${mStr} ${p.release_year || ""}`);
    }
    if (p.reason) badges.push(`Reason: ${p.reason}`);
  } else if (item.item_type === "LOP") {
    if (p.days != null) badges.push(`LOP: ${p.days} day(s)`);
    if (p.reason) badges.push(`Reason: ${p.reason}`);
  } else if (item.item_type === "ADVANCE") {
    if (p.total_amount) badges.push(`Advance: ₹${fmt(p.total_amount)}`);
    if (p.tenure_months) badges.push(`Tenure: ${p.tenure_months} mo`);
    if (p.label) badges.push(`Label: ${p.label}`);
  } else if (item.item_type === "REIMBURSEMENT") {
    if (p.amount) badges.push(`Claim: ₹${fmt(p.amount)}`);
    if (p.description) badges.push(p.description);
  } else if (item.item_type === "ARREARS") {
    if (p.amount) badges.push(`Arrears: ₹${fmt(p.amount)}`);
    if (p.description || p.reason) badges.push(p.description || p.reason);
  } else if (item.item_type === "TDS") {
    if (p.amount) badges.push(`TDS: ₹${fmt(p.amount)}`);
    if (p.note || p.reason) badges.push(p.note || p.reason);
  } else if (item.item_type === "ONE_TIME_EARNING") {
    if (p.amount) badges.push(`Bonus: ₹${fmt(p.amount)}`);
    if (p.description) badges.push(p.description);
  } else if (item.item_type === "ONE_TIME_DEDUCTION") {
    if (p.amount) badges.push(`Deduction: ₹${fmt(p.amount)}`);
    if (p.description) badges.push(p.description);
  } else if (item.item_type === "CUSTOM_COMPONENT") {
    const compCode = (p.component_code || p.code || p.abbr || "").toUpperCase();
    const compObj = (clientComponents || []).find((c) => (c.code || "").toUpperCase() === compCode || (c.abbr || "").toUpperCase() === compCode);
    const compName = compObj?.name || p.component_name || (compCode ? compCode.replace(/_/g, " ") : "Custom Component");
    badges.push(`Component: ${compName}${compCode ? ` (${compCode})` : ""}`);
    if (p.amount != null && p.amount !== "") badges.push(`Amount: ₹${fmt(p.amount)}`);
    if (compObj?.component_type) {
      badges.push(compObj.component_type === "DEDUCTION" ? "Deduction ➖" : "Earning ➕");
    }
    if (p.description || p.reason) badges.push(p.description || p.reason);
  } else if (item.item_type === "NOTE") {
    if (p.text || p.note) badges.push(`Memo: ${p.text || p.note}`);
  }

  return badges;
}

// Determines the originating channel of an item
function getItemChannel(item) {
  if (!item) return "manual";

  // 0. Direct Cell Edits on PayslipRecord
  if (item.source === "manual_edit" || item.edit_id != null) {
    return "cell_revision";
  }

  // 1. Client Portal: matches serializer `source: "portal"`, changes `source: "portal_input"`,
  //    flag `is_client_submission: true`, `created_by_email`, or foreign key `created_by`
  if (
    item.source === "portal" ||
    item.source === "portal_input" ||
    item.is_client_submission === true ||
    item.created_by != null ||
    item.created_by_id != null ||
    Boolean(item.created_by_email) ||
    item.payload?._source === "portal" ||
    item.payload?._source === "portal_input"
  ) {
    return "portal";
  }

  // 2. Multi-Sheet Excel Workbook (only when not explicitly marked as manual or monthly_input)
  if (
    (item.source === "excel" || item.source === "excel_upload" || item.payload?._source === "excel_upload") &&
    item.source !== "manual" &&
    item.source !== "monthly_input" &&
    item.payload?._source !== "monthly_input"
  ) {
    return "excel";
  }

  // 3. Fallback: Internal Firm manual adjustments / monthly key-ins
  return "manual";
}

export function PayrollJobUnifiedAuditModal({
  job,
  isMaker,
  isChecker,
  isAdmin,
  initialTab = "all", // 'all' | 'excel' | 'portal' | 'manual'
  onClose,
  onChanged,
  onRework,
  onFinalize,
}) {
  const navigate = useNavigate();
  const clientId = job?.client;
  const clientName = job?.client_name || "Client";
  const month = job?.month || new Date().getMonth() + 1;
  const year = job?.year || new Date().getFullYear();

  // Active Channel Tab
  const [activeTab, setActiveTab] = useState(initialTab || "all");

  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState(null);
  const [items, setItems] = useState([]);
  const [cellEdits, setCellEdits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [clientComponents, setClientComponents] = useState([]);



  // Status Filter & Search
  const [statusFilter, setStatusFilter] = useState("ALL"); // 'ALL' | 'PENDING' | 'APPLIED' | 'SKIPPED'
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [applyingBulk, setApplyingBulk] = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Maker: Modify Excluded Adjustment State
  const [editingItem, setEditingItem] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

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

  // Bell Notification Popover & Mark as Read State
  const [bellOpen, setBellOpen] = useState(false);
  const reworkKey = job?.id && job?.reviewed_at ? `job_notes_read_${job.id}_${job.reviewed_at}` : (job?.id ? `job_notes_read_${job.id}` : null);
  const [isNotesRead, setIsNotesRead] = useState(() => {
    if (!reworkKey) return false;
    try {
      return localStorage.getItem(reworkKey) === "true";
    } catch {
      return false;
    }
  });

  const handleToggleReadNotes = (e) => {
    e?.stopPropagation?.();
    const nextState = !isNotesRead;
    setIsNotesRead(nextState);
    if (reworkKey) {
      try {
        if (nextState) {
          localStorage.setItem(reworkKey, "true");
        } else {
          localStorage.removeItem(reworkKey);
        }
      } catch (err) {
        console.warn("Could not save notes read state:", err);
      }
    }
  };

  const loadData = async () => {
    if (!clientId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      // 1. Ensure submission for this client, month, and year
      const subRes = await api.post(apiPath("portal-submissions/ensure/"), {
        client_id: clientId,
        month,
        year,
      });
      const sub = subRes.data;
      setSubmission(sub);

      // 2. Fetch ALL items across all 3 sources (no source param = qs.all())
      try {
        const itemsRes = await api.get(apiPath(`portal-submissions/${sub.id}/items/`));
        setItems(unwrapList(itemsRes));
      } catch (err) {
        console.warn("Could not load submission items:", err);
      }

      // 3. Fetch active employees
      try {
        const empRes = await api.get(apiPath("employees/"), { params: { client: clientId } });
        setEmployees(unwrapList(empRes));
      } catch (err) {
        console.warn("Could not load employees:", err);
      }

      // 3b. Fetch client custom components catalog for specific component name resolution
      try {
        const compRes = await api.get(apiPath("components/"), { params: { client: clientId } });
        setClientComponents(unwrapList(compRes));
      } catch (err) {
        console.warn("Could not load client components:", err);
      }

      // 4. Fetch in-batch direct cell revisions / manual edits
      if (job?.id) {
        try {
          const chgRes = await api.get(`/payroll/jobs/${job.id}/changes/`);
          const allChgItems = chgRes.data?.items || [];
          const cellRevs = allChgItems.filter((x) => x.source === "manual_edit" && x.edit_id);
          setCellEdits(cellRevs);
        } catch (err) {
          console.warn("Could not load batch changes / cell revisions:", err);
        }
      }
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || "Failed to load audit items.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, month, year]);

  // Combined pool of all audited items (staged portal/excel/firm inputs + direct batch cell revisions)
  const allAuditedItems = useMemo(() => {
    return [...items, ...cellEdits];
  }, [items, cellEdits]);

  // Channel Groups
  const portalItems = useMemo(() => allAuditedItems.filter((it) => getItemChannel(it) === "portal"), [allAuditedItems]);
  const firmItems = useMemo(() => allAuditedItems.filter((it) => {
    const ch = getItemChannel(it);
    return ch === "manual" || ch === "excel";
  }), [allAuditedItems]);
  const cellRevisionItems = useMemo(() => allAuditedItems.filter((it) => getItemChannel(it) === "cell_revision"), [allAuditedItems]);

  // Visible items across all audited channels (Internal Firm, Portal, and Cell Revisions)
  const visibleItems = allAuditedItems;

  // Current tab items before status/search filters
  const currentTabBaseItems = useMemo(() => {
    if (activeTab === "portal") return portalItems;
    if (activeTab === "manual" || activeTab === "excel" || activeTab === "firm") return firmItems;
    if (activeTab === "cell_revision") return cellRevisionItems;
    return visibleItems;
  }, [activeTab, portalItems, firmItems, cellRevisionItems, visibleItems]);

  // Overall Global Counts
  const globalPending = visibleItems.filter(
    (it) => it.status === "PENDING" || (!it.status && it.status !== "APPLIED" && it.status !== "SKIPPED")
  ).length;
  const globalApplied = visibleItems.filter((it) => it.status === "APPLIED").length;
  const globalSkipped = visibleItems.filter((it) => it.status === "SKIPPED").length;

  // Tab-specific pending counts for tab badges
  const portalPending = portalItems.filter((it) => it.status !== "APPLIED" && it.status !== "SKIPPED").length;
  const firmPending = firmItems.filter((it) => it.status !== "APPLIED" && it.status !== "SKIPPED").length;

  // Filtered items
  const filteredItems = useMemo(() => {
    return currentTabBaseItems.filter((item) => {
      const isPending =
        item.status === "PENDING" || (!item.status && item.status !== "APPLIED" && item.status !== "SKIPPED");
      const isApplied = item.status === "APPLIED";
      const isSkipped = item.status === "SKIPPED";

      if (statusFilter === "PENDING" && !isPending) return false;
      if (statusFilter === "APPLIED" && !isApplied) return false;
      if (statusFilter === "SKIPPED" && !isSkipped) return false;
      if (categoryFilter !== "ALL" && item.item_type !== categoryFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const p = item.payload || {};
        const emp = employees.find((e) => String(e.id) === String(p.employee_id || item.employee_id));
        const empName = (emp?.full_name || item.employee_name || `${p.first_name || ""} ${p.last_name || ""}`).toLowerCase();
        const empCode = (emp?.employee_code || item.employee_code || p.employee_code || "").toLowerCase();
        const typeStr = (p.field_name || item.item_type || "").toLowerCase();
        const desc = (p.description || p.reason || p.note || p.text || item.error || "").toLowerCase();
        return empName.includes(q) || empCode.includes(q) || typeStr.includes(q) || desc.includes(q);
      }
      return true;
    });
  }, [currentTabBaseItems, statusFilter, categoryFilter, searchQuery, employees]);

  // Master Action: Apply all pending (either globally or for current tab)
  const executeApplyAllPending = async (countToApply, scopeName) => {
    setApplyingBulk(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      if (job?.id && activeTab === "all") {
        const res = await api.post(`/payroll/jobs/${job.id}/apply-inputs/`);
        const count = res.data?.summary?.applied_count ?? res.data?.summary?.applied ?? countToApply;
        setSuccessMsg(`Merged & applied ${count} adjustment(s) across all channels into the batch calculation!`);
      } else {
        const sourceParam = activeTab === "all" ? undefined : activeTab === "portal" ? "portal" : "internal";
        const res = await api.post(apiPath(`portal-submissions/${submission.id}/apply-pending/`), {
          source: sourceParam,
        });
        const summary = res.data?.summary || {};
        const count = summary.applied_count ?? summary.applied ?? countToApply;
        setSuccessMsg(`Merged & applied ${count} adjustment(s) into the batch calculation!`);
      }

      // Reload all items
      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
      onChanged?.();
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      setErrorMsg(err?.response?.data?.error || err?.response?.data?.detail || err.message || "Failed to apply pending adjustments.");
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleApplyAllPending = () => {
    if (!submission) return;
    const countToApply = activeTab === "all" ? globalPending : currentTabBaseItems.filter(it => it.status !== "APPLIED" && it.status !== "SKIPPED").length;
    if (countToApply === 0) return;

    const scopeName =
      activeTab === "all"
        ? "all sources (Portal and Internal Firm)"
        : activeTab === "portal"
          ? "Client Portal"
          : "Internal Firm (Manual Key-ins & Excel)";

    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "success",
      title: "Approve & Apply Adjustments",
      message: `Approve and apply all ${countToApply} pending adjustments from ${scopeName} into the payroll batch calculation now?`,
      confirmText: `Merge & Apply All (${countToApply})`,
      cancelText: "Cancel",
      onConfirm: () => {
        closeDialog();
        executeApplyAllPending(countToApply, scopeName);
      },
    });
  };

  // Single Item: Apply
  const handleApplySingleItem = async (itemId) => {
    if (!submission) return;
    setActionInProgressId(itemId);
    setErrorMsg("");
    try {
      await api.post(apiPath(`portal-submissions/${submission.id}/items/${itemId}/apply/`));
      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
      setSuccessMsg("Adjustment approved & applied to batch calculation!");
      setTimeout(() => setSuccessMsg(""), 3500);
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || "Could not apply item.");
    } finally {
      setActionInProgressId(null);
    }
  };

  // Single Item: Don't Apply (Exclude) or Re-include
  const executeSkipOrUnskipItem = async (itemId, actionType, reason) => {
    setActionInProgressId(itemId);
    setErrorMsg("");
    try {
      await api.post(`/payroll/jobs/${job.id}/skip-item/`, {
        item_id: itemId,
        action: actionType,
        reason: (reason || "").trim(),
      });
      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
      setSuccessMsg(
        actionType === "skip"
          ? "Adjustment excluded from batch calculation."
          : "Adjustment re-included into pending queue."
      );
      setTimeout(() => setSuccessMsg(""), 3000);
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.response?.data?.error || err.message || "Failed to update item exclusion state.");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleSkipOrUnskipItem = (itemId, actionType) => {
    if (!job?.id) return;
    if (actionType === "skip") {
      setDialogConfig({
        isOpen: true,
        type: "prompt",
        variant: "danger",
        title: "Exclude Adjustment from Batch",
        message: "Provide a reason for not applying this input into the batch (this will be recorded in the audit trail):",
        defaultValue: "Excluded by Checker",
        placeholder: "e.g. Ineligible reimbursement, superseded by later claim...",
        confirmText: "Exclude Item",
        cancelText: "Cancel",
        onConfirm: (enteredReason) => {
          closeDialog();
          executeSkipOrUnskipItem(itemId, actionType, enteredReason);
        },
      });
    } else {
      executeSkipOrUnskipItem(itemId, actionType, "");
    }
  };

  // Single Item: Remove unapproved draft adjustment
  const executeDeleteSingleItem = async (itemId) => {
    setActionInProgressId(itemId);
    try {
      await api.delete(apiPath(`portal-submissions/${submission.id}/items/${itemId}/`));
      setItems((prev) => prev.filter((it) => it.id !== itemId));
      setSuccessMsg("Adjustment removed.");
      setTimeout(() => setSuccessMsg(""), 2500);
      onChanged?.();
      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || "Could not remove item.");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteSingleItem = (itemId, isExcluded = false) => {
    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "danger",
      title: isExcluded ? "Delete Excluded Adjustment" : "Remove Draft Adjustment",
      message: isExcluded
        ? "Permanently delete this excluded adjustment? It will be removed from the audit record."
        : "Are you sure you want to remove this unapproved adjustment? It will be permanently removed from the pending list.",
      confirmText: "Delete Adjustment",
      cancelText: "Cancel",
      onConfirm: () => {
        closeDialog();
        executeDeleteSingleItem(itemId);
      },
    });
  };

  // Maker Action: Open modal to modify excluded adjustment
  const handleOpenEditExcludedItem = (item) => {
    const p = item.payload || {};
    setEditingItem(item);
    setEditFormData({
      amount: p.amount !== undefined ? p.amount : (p.total_amount !== undefined ? p.total_amount : (p.ctc_annual || "")),
      days: p.days !== undefined ? p.days : "",
      remarks: p.description || p.reason || p.note || p.change_reason || p.text || "",
      last_working_date: p.last_working_date || "",
      effective_from: p.effective_from || "",
      bank_account_number: p.bank_account_number || p.bank_account_no || "",
      bank_ifsc_code: p.bank_ifsc_code || p.bank_ifsc || p.ifsc || "",
      bank_name: p.bank_name || "",
      employment_type: p.employment_type || "REGULAR",
      payment_mode: p.payment_mode || "WIRE_TRANSFER",
    });
  };

  // Maker Action: Save modified adjustment & resubmit to Pending
  const handleSaveEditExcludedItem = async () => {
    if (!editingItem || !submission) return;
    setSavingEdit(true);
    setErrorMsg("");
    try {
      const p = editingItem.payload || {};
      const updatedPayload = { ...p };

      if ("amount" in p) updatedPayload.amount = Number(editFormData.amount || 0);
      else if ("total_amount" in p) updatedPayload.total_amount = Number(editFormData.amount || 0);
      else if ("ctc_annual" in p) updatedPayload.ctc_annual = Number(editFormData.amount || 0);

      if ("days" in p || editingItem.item_type === "LOP") {
        updatedPayload.days = Number(editFormData.days || 0);
      }

      if (editingItem.item_type === "NEW_EMPLOYEE") {
        if (editFormData.bank_account_number !== undefined) updatedPayload.bank_account_number = String(editFormData.bank_account_number).replace(/\D/g, "");
        if (editFormData.bank_ifsc_code !== undefined) updatedPayload.bank_ifsc_code = String(editFormData.bank_ifsc_code).toUpperCase().slice(0, 11);
        if (editFormData.bank_name !== undefined) updatedPayload.bank_name = editFormData.bank_name;
        if (editFormData.employment_type !== undefined) updatedPayload.employment_type = editFormData.employment_type;
        if (editFormData.payment_mode !== undefined) updatedPayload.payment_mode = editFormData.payment_mode;
      }

      if ("description" in p) updatedPayload.description = editFormData.remarks;
      else if ("reason" in p) updatedPayload.reason = editFormData.remarks;
      else if ("note" in p) updatedPayload.note = editFormData.remarks;
      else if ("change_reason" in p) updatedPayload.change_reason = editFormData.remarks;
      else if ("text" in p) updatedPayload.text = editFormData.remarks;
      else updatedPayload.description = editFormData.remarks;

      if ("last_working_date" in p && editFormData.last_working_date) {
        updatedPayload.last_working_date = editFormData.last_working_date;
      }
      if ("effective_from" in p && editFormData.effective_from) {
        updatedPayload.effective_from = editFormData.effective_from;
      }

      await api.post(apiPath(`portal-submissions/${submission.id}/items/${editingItem.id}/update/`), {
        payload: updatedPayload,
      });

      setSuccessMsg("✓ Excluded adjustment modified and resubmitted to Pending for Checker review!");
      setTimeout(() => setSuccessMsg(""), 4000);
      setEditingItem(null);
      onChanged?.();

      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || err?.response?.data?.error || err.message || "Failed to update adjustment.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Single Item: Revert applied adjustment back to Pending
  const executeRevertSingleItem = async (itemId) => {
    setActionInProgressId(itemId);
    setErrorMsg("");
    try {
      await api.post(apiPath(`portal-submissions/${submission.id}/items/${itemId}/revert/`));
      const itemsRes = await api.get(apiPath(`portal-submissions/${submission.id}/items/`));
      setItems(unwrapList(itemsRes));
      setSuccessMsg("Adjustment reverted and rolled back from batch calculations.");
      setTimeout(() => setSuccessMsg(""), 3500);
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || "Could not revert item.");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRevertSingleItem = (itemId) => {
    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "warning",
      title: "Revert Applied Adjustment",
      message: "Revert this applied adjustment? This will rollback the money from the employee's payslip calculation and restore it to Pending.",
      confirmText: "Revert Adjustment",
      cancelText: "Cancel",
      onConfirm: () => {
        closeDialog();
        executeRevertSingleItem(itemId);
      },
    });
  };

  // Direct Cell Revision: Revert a manual cell edit on PayslipRecord back to old_value
  const executeRevertCellEdit = async (editId, empName, fieldName, oldVal) => {
    const fieldLabel = (fieldName || "field").replace(/_/g, " ");
    setActionInProgressId(`edit_${editId}`);
    setErrorMsg("");
    try {
      await api.post(`/payroll/jobs/${job.id}/revert-edit/`, { edit_id: editId });
      setSuccessMsg(`Successfully reverted ${fieldLabel} back to ${oldVal}. Salary recomputed!`);
      setTimeout(() => setSuccessMsg(""), 3500);

      await loadData();
      onChanged?.();
    } catch (err) {
      setErrorMsg(err?.response?.data?.error || err?.response?.data?.detail || err.message || "Failed to revert cell edit.");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRevertCellEdit = (editId, empName, fieldName, oldVal) => {
    if (!job?.id) return;
    if (!(isChecker || isMaker) || job?.status === "Done") {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "warning",
        title: "Permission Notice",
        message: "Only assigned Makers and Checkers can revert manual revisions before a job is completed.",
        confirmText: "Understood",
        onConfirm: closeDialog,
      });
      return;
    }
    const fieldLabel = (fieldName || "field").replace(/_/g, " ");
    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "warning",
      title: "Revert Cell Revision",
      message: `Revert "${fieldLabel}" for ${empName || "this employee"} back to "${oldVal}"? This will automatically recalculate the employee's gross, deductions, and net salary.`,
      confirmText: "Revert Revision",
      cancelText: "Cancel",
      onConfirm: () => {
        closeDialog();
        executeRevertCellEdit(editId, empName, fieldName, oldVal);
      },
    });
  };



  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-5 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-[min(1240px,96vw)] h-[90vh] min-h-[640px] overflow-hidden flex flex-col shadow-2xl border border-slate-200/90">
        {/* ── Master Header Row ── */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center text-lg shrink-0 shadow-sm">
              📑
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-extrabold text-slate-900 uppercase tracking-tight m-0">
                  {clientName}
                </h2>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${isChecker
                    ? "bg-purple-50 text-purple-700 border-purple-200"
                    : isMaker
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                >
                  {isChecker ? "🛡️ Unified Audit Center (Checker)" : (isMaker ? "✏️ Maker Prep Workspace" : "👁️ Read-Only View")}
                </span>
              </div>
              <p className="text-xs text-slate-500 m-0 mt-0.5">
                Monthly Payroll Audit & Submissions Command Center · <strong className="text-slate-800">{MONTHS[month - 1]} {year}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">


            {/* Checker Header Action: Merge & Apply All Pending Inputs */}
            {isChecker && globalPending > 0 && (
              <button
                type="button"
                onClick={handleApplyAllPending}
                disabled={applyingBulk}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                title="Merge and calculate all pending inputs into this batch"
              >
                {applyingBulk ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Merging…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Merge & Apply All ({globalPending})
                  </>
                )}
              </button>
            )}

            {/* ── MAKER VIEW: Active orange alert bell — action required ── */}
            {job?.rework_notes && isMaker && (
              <div
                className="relative"
                onMouseEnter={() => setBellOpen(true)}
                onMouseLeave={() => setBellOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => setBellOpen((prev) => !prev)}
                  className={`relative cursor-pointer p-1.5 rounded-lg inline-flex items-center justify-center transition-all shadow-sm ${isNotesRead
                    ? "bg-slate-100 border border-slate-300 text-slate-500 hover:bg-slate-200"
                    : "bg-amber-50 border-[1.5px] border-amber-500 text-amber-700 hover:bg-amber-100 ring-2 ring-amber-400/20"
                    }`}
                  title={isNotesRead ? "Correction Instructions (Read)" : "Active Correction Instructions from Checker"}
                >
                  <Bell size={17} />
                  {!isNotesRead && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white shadow-sm ring-1 ring-rose-500/50" />
                  )}
                </button>

                {/* Floating Notification Popover on Hover / Click */}
                {bellOpen && (
                  <div className="absolute top-[calc(100%+6px)] right-0 w-[340px] bg-white border border-amber-200 rounded-xl shadow-xl z-[1300] p-4 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">↩️</span>
                        <div>
                          <div className="text-[12.5px] font-extrabold text-amber-900 leading-tight">
                            Correction Instructions
                          </div>
                          <div className="text-[11px] text-amber-700 font-medium">
                            From {job.reviewed_by_name || "Checker"}
                          </div>
                        </div>
                      </div>
                      {job.reviewed_at && (
                        <span className="text-[11px] text-slate-400 font-semibold">
                          {new Date(job.reviewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-amber-950 leading-relaxed whitespace-pre-wrap bg-amber-50 p-2.5 rounded-lg border border-amber-200/80 mb-2.5 max-h-40 overflow-y-auto">
                      {job.rework_notes}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <span className={`text-[11px] font-semibold flex items-center gap-1 ${isNotesRead ? "text-emerald-600" : "text-slate-500"}`}>
                        {isNotesRead ? "✓ Marked as Read" : "● Unread Notification"}
                      </span>
                      <button
                        type="button"
                        onClick={handleToggleReadNotes}
                        className={`px-2.5 py-1 rounded text-[11.5px] font-bold cursor-pointer transition-all shadow-sm ${isNotesRead
                          ? "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                          : "border border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200"
                          }`}
                      >
                        {isNotesRead ? "Mark as Unread" : "✓ Mark as Read"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CHECKER VIEW: Grey/dimmed read-only bell — informational confirmation ── */}
            {/* Disappears automatically when Maker resubmits — backend clears rework_notes to "" on submit_for_review */}
            {job?.rework_notes && isChecker && !isMaker && (
              <div
                className="relative"
                onMouseEnter={() => setBellOpen(true)}
                onMouseLeave={() => setBellOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => setBellOpen((prev) => !prev)}
                  className="relative bg-slate-50 border border-slate-300 cursor-pointer p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 inline-flex items-center justify-center transition-all opacity-85 shadow-sm"
                  title="Sent Correction Instructions to Maker"
                >
                  <Bell size={17} />
                </button>

                {/* Floating Read-Only Popover for Checker */}
                {bellOpen && (
                  <div className="absolute top-[calc(100%+6px)] right-0 w-[340px] bg-white border border-slate-200 rounded-xl shadow-xl z-[1300] p-4 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📤</span>
                        <div>
                          <div className="text-[12.5px] font-extrabold text-slate-700 leading-tight">
                            Sent Correction Instructions
                          </div>
                          <div className="text-[11px] text-slate-400 font-medium">
                            Sent to Maker — awaiting rework
                          </div>
                        </div>
                      </div>
                      {job.reviewed_at && (
                        <span className="text-[11px] text-slate-400 font-semibold">
                          {new Date(job.reviewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>

                    {/* Note content — muted palette, read-only */}
                    <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 p-2.5 rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
                      {job.rework_notes}
                    </div>

                    {/* Footer: read-only label, no Mark-as-Read toggle */}
                    <div className="pt-2 mt-2 border-t border-slate-100">
                      <span className="text-[11px] text-slate-400 font-semibold">
                        🛈 Read-only — visible only to you as Checker
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center border-none bg-transparent"
              title="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── KPI Counter Strip ── */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap shrink-0">
          {/* Status Metric Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-300 text-xs font-bold text-slate-700 shadow-sm">
              <span>Total Items:</span>
              <span className="text-slate-900 font-extrabold">{visibleItems.length}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 shadow-sm">
              <span>Pending Review:</span>
              <span className="font-extrabold">{globalPending}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 shadow-sm">
              <span>Applied to Batch:</span>
              <span className="font-extrabold">{globalApplied}</span>
            </span>
            {globalSkipped > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 shadow-sm">
                <span>Excluded:</span>
                <span className="font-extrabold">{globalSkipped}</span>
              </span>
            )}
          </div>

          {/* Channel Breakdown */}
          <div className="text-[11.5px] text-slate-500 flex items-center gap-1.5">
            <span>Sources:</span>
            <span className="font-semibold text-purple-700">📝 Internal Firm ({firmItems.length})</span>
            <span className="text-slate-300">•</span>
            <span className="font-semibold text-sky-700">🌐 Portal ({portalItems.length})</span>
            <span className="text-slate-300">•</span>
            <span className="font-semibold text-amber-700">✏️ Cell Edits ({cellRevisionItems.length})</span>
          </div>
        </div>

        {/* ── Alerts Strip (Errors / Success) ── */}
        {errorMsg && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center gap-2 shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-700 flex items-center gap-2 shrink-0">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}



        {/* ── Major Channel Tabs Bar ── */}
        <div className="px-5 border-b border-slate-200 flex items-center gap-2 overflow-x-auto scrollbar-none bg-white shrink-0">
          {/* Tab 0: Combined Feed */}
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-3.5 py-2.5 text-[12.5px] font-bold cursor-pointer border-0 border-b-[2.5px] transition-all inline-flex items-center gap-1.5 ${activeTab === "all"
              ? "border-[#1A2F5A] text-[#1A2F5A] bg-slate-50/50"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50/30"
              }`}
          >
            <Layers size={14} />
            <span>Combined Overview</span>
            <span
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === "all" ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-600"
                }`}
            >
              {visibleItems.length}
            </span>
            {globalPending > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full font-extrabold ring-1 ring-amber-400/30">
                {globalPending}
              </span>
            )}
          </button>

          {/* Tab 1: Internal Firm Adjustments (Manual key-ins + Multi-Sheet Excel uploads) */}
          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`px-3.5 py-2.5 text-[12.5px] font-bold cursor-pointer border-0 border-b-[2.5px] transition-all inline-flex items-center gap-1.5 ${activeTab === "manual" || activeTab === "excel" || activeTab === "firm"
              ? "border-purple-700 text-purple-700 bg-purple-50/30"
              : "border-transparent text-slate-500 hover:text-purple-700 hover:bg-purple-50/10"
              }`}
          >
            <FileText size={14} />
            <span>Internal Firm</span>
            <span
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === "manual" || activeTab === "excel" || activeTab === "firm" ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-600"
                }`}
            >
              {firmItems.length}
            </span>
            {firmPending > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full font-extrabold ring-1 ring-amber-400/30">
                {firmPending}
              </span>
            )}
          </button>

          {/* Tab 2: Client Portal Submissions */}
          <button
            type="button"
            onClick={() => setActiveTab("portal")}
            className={`px-3.5 py-2.5 text-[12.5px] font-bold cursor-pointer border-0 border-b-[2.5px] transition-all inline-flex items-center gap-1.5 ${activeTab === "portal"
              ? "border-sky-600 text-sky-700 bg-sky-50/30"
              : "border-transparent text-slate-500 hover:text-sky-700 hover:bg-sky-50/10"
              }`}
          >
            <Globe size={14} />
            <span>Client Portal</span>
            <span
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === "portal" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"
                }`}
            >
              {portalItems.length}
            </span>
            {portalPending > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full font-extrabold ring-1 ring-amber-400/30">
                {portalPending}
              </span>
            )}
          </button>

          {/* Tab 3: Cell Revisions */}
          <button
            type="button"
            onClick={() => setActiveTab("cell_revision")}
            className={`px-3.5 py-2.5 text-[12.5px] font-bold cursor-pointer border-0 border-b-[2.5px] transition-all inline-flex items-center gap-1.5 ${activeTab === "cell_revision"
              ? "border-amber-600 text-amber-700 bg-amber-50/30"
              : "border-transparent text-slate-500 hover:text-amber-700 hover:bg-amber-50/10"
              }`}
          >
            <Edit3 size={14} />
            <span>Cell Revisions</span>
            <span
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === "cell_revision" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                }`}
            >
              {cellRevisionItems.length}
            </span>
          </button>
        </div>

        {/* ── Sub-Filter Bar: Status Tabs + Category Filter + Search ── */}
        <div className="px-5 py-2 flex items-center justify-between gap-3 flex-wrap bg-slate-50 border-b border-slate-200 shrink-0">
          {/* Status Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-bold cursor-pointer transition-all shadow-sm ${statusFilter === "ALL"
                ? "bg-slate-900 text-white border border-slate-900"
                : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
                }`}
            >
              All ({currentTabBaseItems.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("PENDING")}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-bold cursor-pointer transition-all shadow-sm ${statusFilter === "PENDING"
                ? "bg-amber-100 text-amber-900 border border-amber-400 ring-1 ring-amber-400/30"
                : "bg-white text-slate-600 border border-slate-300 hover:bg-amber-50/50"
                }`}
            >
              Pending ({currentTabBaseItems.filter(it => it.status !== "APPLIED" && it.status !== "SKIPPED").length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("APPLIED")}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-bold cursor-pointer transition-all shadow-sm ${statusFilter === "APPLIED"
                ? "bg-emerald-100 text-emerald-900 border border-emerald-400 ring-1 ring-emerald-400/30"
                : "bg-white text-slate-600 border border-slate-300 hover:bg-emerald-50/50"
                }`}
            >
              Applied ({currentTabBaseItems.filter(it => it.status === "APPLIED").length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("SKIPPED")}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-bold cursor-pointer transition-all shadow-sm ${statusFilter === "SKIPPED"
                ? "bg-rose-100 text-rose-900 border border-rose-400 ring-1 ring-rose-400/30"
                : "bg-white text-slate-600 border border-slate-300 hover:bg-rose-50/50"
                }`}
            >
              Excluded ({currentTabBaseItems.filter(it => it.status === "SKIPPED").length})
            </button>
          </div>

          {/* Category Dropdown & Search Input */}
          <div className="flex items-center gap-2.5">
            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1 rounded-md border border-slate-300 text-xs bg-white text-slate-700 outline-none cursor-pointer shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
            >
              <option value="ALL">All Categories</option>
              {AUDIT_ITEM_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.emoji} {t.label}
                </option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search employee, type, code…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-7 py-1 rounded-md border border-slate-300 text-xs bg-white text-slate-800 outline-none shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer border-none bg-transparent"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable Body / Compact Audit Roster ── */}
        <div className="flex-1 overflow-y-auto flex flex-col bg-white">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-16">
              <Loader2 size={32} className="animate-spin mb-3 text-[#1A2F5A]" />
              <div className="text-sm font-bold text-slate-700">Loading payroll audit items…</div>
              <p className="text-xs text-slate-400 mt-1">Fetching inputs across Excel, Portal, and firm ledgers</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-slate-500 my-auto">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-sm font-bold text-slate-800">
                No items match your filter criteria
              </div>
              <div className="text-xs text-slate-400 mt-1.5 max-w-sm">
                {items.length === 0
                  ? "No inputs or adjustments have been staged yet for this client in this period."
                  : "Try clearing search keywords or switching status filters."}
              </div>
            </div>
          ) : (
            <div className="w-full">
              {/* Table Column Headers */}
              <div className="sticky top-0 z-[2] bg-slate-100 border-b border-slate-300 grid grid-cols-[110px_95px_150px_180px_1fr_180px] px-4 py-2 text-[11px] font-bold text-slate-600 tracking-wider uppercase shadow-xs">
                <div>Status</div>
                <div>Source</div>
                <div>Adjustment Type</div>
                <div>Employee</div>
                <div>Details & Financial Impact</div>
                <div className="text-right">Actions</div>
              </div>

              {/* Rows */}
              {filteredItems.map((item, idx) => {
                const isCellEdit = item.source === "manual_edit" || item.edit_id != null;
                const p = item.payload || {};

                // Resolve specific custom component details if applicable
                const isCustomItem = item.item_type === "CUSTOM_COMPONENT";
                const rawFieldName = item.payload?.field_name || "";
                const isCustomCellEdit = isCellEdit && (rawFieldName.startsWith("custom_") || rawFieldName.startsWith("custom_earnings_") || rawFieldName.startsWith("custom_deductions_"));
                let customCompObj = null;
                if (isCustomItem) {
                  const compCode = (p.component_code || p.code || p.abbr || "").toUpperCase();
                  customCompObj = (clientComponents || []).find((c) => (c.code || "").toUpperCase() === compCode || (c.abbr || "").toUpperCase() === compCode);
                } else if (isCustomCellEdit) {
                  const customCode = rawFieldName.replace(/^custom_(earnings_|deductions_)?/, "").toUpperCase();
                  customCompObj = (clientComponents || []).find((c) => (c.code || "").toUpperCase() === customCode || (c.abbr || "").toUpperCase() === customCode);
                }

                const typeConfig = isCellEdit
                  ? {
                    label: isCustomCellEdit
                      ? (customCompObj?.name || rawFieldName.replace(/^custom_(earnings_|deductions_)?/, "").replace(/_/g, " ").toUpperCase())
                      : (item.payload?.field_name || item.item_type || "Cell Edit").replace(/_/g, " ").toUpperCase(),
                    emoji: isCustomCellEdit ? "🧩" : "✏️",
                    wash: isCustomCellEdit && customCompObj?.component_type === "DEDUCTION"
                      ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" }
                      : isCustomCellEdit
                        ? { bg: "#f0fdfa", border: "#99f6e4", text: "#0d9488" }
                        : { bg: "#fffbeb", border: "#fde68a", text: "#b45309" },
                  }
                  : isCustomItem
                    ? {
                      label: customCompObj?.name || p.component_name || (p.component_code ? p.component_code.replace(/_/g, " ") : "Custom Component"),
                      emoji: "🧩",
                      wash: customCompObj?.component_type === "DEDUCTION"
                        ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" }
                        : { bg: "#f0fdfa", border: "#99f6e4", text: "#0d9488" },
                    }
                    : AUDIT_ITEM_TYPES.find((t) => t.key === item.item_type) || {
                      label: item.item_type,
                      emoji: "📄",
                      wash: { bg: "#f1f5f9", border: "#cbd5e1", text: "#475569" },
                    };
                const channel = getItemChannel(item);
                const emp = employees.find((e) => String(e.id) === String(p.employee_id || item.employee_id));
                const empName = item.employee_name || emp?.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
                const empCode = item.employee_code || emp?.employee_code || p.employee_code;
                const badges = isCellEdit ? [] : itemSummaryBadges(item, employees, clientComponents);

                const isApplied = item.status === "APPLIED";
                const isSkipped = item.status === "SKIPPED";
                const isPending = !isApplied && !isSkipped;

                // Status border accent
                const leftAccent = isCellEdit ? "#d97706" : isSkipped ? "#ef4444" : isApplied ? "#10b981" : "#f59e0b";

                return (
                  <div
                    key={item.id}
                    className={`grid grid-cols-[110px_95px_150px_180px_1fr_180px] px-4 py-2.5 items-center border-b border-slate-100 text-xs transition-colors border-l-4 ${isSkipped
                      ? "bg-rose-50/30 hover:bg-rose-50/70"
                      : isApplied
                        ? "bg-emerald-50/20 hover:bg-emerald-50/60"
                        : idx % 2 === 0
                          ? "bg-white hover:bg-slate-50"
                          : "bg-slate-50/40 hover:bg-slate-50"
                      }`}
                    style={{ borderLeftColor: leftAccent }}
                  >
                    {/* Col 1: Status */}
                    <div>
                      {isCellEdit ? (
                        <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1 shadow-xs">
                          <Check size={10} /> Live Edit
                        </span>
                      ) : (
                        <span
                          className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 shadow-xs border ${isSkipped
                            ? "bg-rose-50 text-rose-800 border-rose-200"
                            : isPending
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                            }`}
                        >
                          {isSkipped ? (
                            <>
                              <Ban size={10} /> Excluded
                            </>
                          ) : isPending ? (
                            <>
                              <Clock size={10} /> Pending
                            </>
                          ) : (
                            <>
                              <Check size={10} /> Applied
                            </>
                          )}
                        </span>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5 pl-0.5 font-mono">
                        #{item.id}
                      </div>
                    </div>

                    {/* Col 2: Channel (Option 3: High-contrast pill badges) */}
                    <div>
                      {channel === "cell_revision" ? (
                        <span
                          className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1 shadow-xs"
                          title="Direct cell edit on batch payslip record"
                        >
                          <span>✏️ Cell Edit</span>
                        </span>
                      ) : (
                        <span
                          className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 shadow-xs ${channel === "excel"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : channel === "portal"
                              ? "bg-sky-50 text-sky-800 border-sky-200"
                              : "bg-purple-50 text-purple-800 border-purple-200"
                            }`}
                          title={
                            channel === "excel"
                              ? "Multi-Sheet Excel Workbook"
                              : channel === "portal"
                                ? `Client Portal${item.created_by_email ? ` (${item.created_by_email})` : ""}`
                                : "Internal Firm Staging"
                          }
                        >
                          <span>{channel === "excel" ? "📁 Excel" : channel === "portal" ? "🌐 Portal" : "📝 Firm"}</span>
                        </span>
                      )}
                    </div>

                    {/* Col 3: Adjustment Type (10% dynamic wash retention) */}
                    <div>
                      <span
                        className="text-[11px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 max-w-[140px] truncate shadow-xs"
                        style={{
                          background: typeConfig.wash.bg,
                          color: typeConfig.wash.text,
                          borderColor: typeConfig.wash.border,
                        }}
                        title={typeConfig.label}
                      >
                        <span className="shrink-0">{typeConfig.emoji}</span>
                        <span className="truncate">{typeConfig.label}</span>
                      </span>
                    </div>

                    {/* Col 4: Employee */}
                    <div className="min-w-0 pr-2">
                      <div className="text-[12.5px] font-bold text-slate-900 truncate">
                        {empName || "Batch Input"}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {empCode || "—"}
                      </div>
                    </div>

                    {/* Col 5: Details & Financial Impact */}
                    <div className="min-w-0 pr-3">
                      {isCellEdit ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isCustomCellEdit && (
                              <span className="text-[11px] font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                {customCompObj ? `${customCompObj.name} (${customCompObj.code})` : rawFieldName.replace(/^custom_(earnings_|deductions_)?/, "").replace(/_/g, " ")}:
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500">Previous:</span>
                            <span className="text-[11.5px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300 line-through">
                              {p.old_value !== undefined && p.old_value !== "" ? p.old_value : "0"}
                            </span>
                            <ArrowRight size={12} className="text-slate-400" />
                            <span className="text-[11px] text-emerald-700 font-medium">Updated:</span>
                            <span className="text-[11.5px] font-bold text-slate-900 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-300">
                              {p.new_value !== undefined && p.new_value !== "" ? p.new_value : "0"}
                            </span>
                            {(() => {
                              const oNum = Number(p.old_value || 0);
                              const nNum = Number(p.new_value || 0);
                              if (!isNaN(oNum) && !isNaN(nNum) && (p.old_value !== undefined || p.new_value !== undefined)) {
                                const delta = nNum - oNum;
                                if (delta !== 0) {
                                  return (
                                    <span className={`text-[10.5px] font-bold px-1 rounded ${delta > 0 ? "text-emerald-700 bg-emerald-50 border border-emerald-200" : "text-rose-700 bg-rose-50 border border-rose-200"}`}>
                                      ({delta > 0 ? "+" : ""}{delta})
                                    </span>
                                  );
                                }
                              }
                              return null;
                            })()}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            <span>Edited by <strong className="text-slate-700">{item.applied_by_name || "Maker"}</strong></span>
                            {item.created_at && (
                              <span className="ml-1.5 text-slate-400">
                                · {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {badges.length > 0 ? (
                            <div className="flex flex-wrap gap-1 items-center">
                              {badges.map((b, i) => (
                                <span
                                  key={i}
                                  className="bg-white px-1.5 py-0.5 rounded border border-slate-300 text-[11px] font-semibold text-slate-800 shadow-xs"
                                >
                                  {b}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-700">
                              {p.amount ? <strong>₹{fmt(p.amount)} </strong> : null}
                              <span>{p.description || p.reason || p.note || p.text || "—"}</span>
                            </div>
                          )}

                          {/* Excluded Reason */}
                          {isSkipped && item.error && (
                            <div className="mt-1 text-[11px] text-rose-700 flex items-center gap-1 font-medium">
                              <Ban size={10} className="shrink-0" />
                              <span><strong>Reason:</strong> {item.error}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Col 6: Actions */}
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Cell Revision: Revert directly to old value (only assigned Checker, before job is Done) */}
                      {isCellEdit ? (
                        isChecker && job?.status !== "Done" ? (
                          <button
                            type="button"
                            onClick={() => handleRevertCellEdit(item.edit_id, empName, p.field_name, p.old_value)}
                            disabled={actionInProgressId === `edit_${item.edit_id}`}
                            className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors disabled:opacity-60"
                            title="Revert this cell edit back to its old value and automatically recalculate salary"
                          >
                            {actionInProgressId === `edit_${item.edit_id}` ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <RotateCcw size={11} />
                            )}
                            Revert
                          </button>
                        ) : null
                      ) : (
                        <>
                          {/* Checker Action: Apply Single Item */}
                          {isPending && isChecker && (
                            <button
                              type="button"
                              onClick={() => handleApplySingleItem(item.id)}
                              disabled={actionInProgressId === item.id || applyingBulk}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors disabled:opacity-60"
                              title="Approve and apply this input into the batch"
                            >
                              {actionInProgressId === item.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Check size={11} />
                              )}
                              Apply
                            </button>
                          )}

                          {/* Checker Action: Don't Apply (Exclude) */}
                          {isPending && isChecker && (
                            <button
                              type="button"
                              onClick={() => handleSkipOrUnskipItem(item.id, "skip")}
                              disabled={actionInProgressId === item.id}
                              className="px-2.5 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors disabled:opacity-60"
                              title="Do not apply this input into the payroll batch (retains history)"
                            >
                              <Ban size={11} /> Exclude
                            </button>
                          )}

                          {/* Checker Action: Revert Applied Item */}
                          {isApplied && isChecker && (
                            <button
                              type="button"
                              onClick={() => handleRevertSingleItem(item.id)}
                              disabled={actionInProgressId === item.id}
                              className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors disabled:opacity-60"
                              title="Revert this applied change, rollback from payslip calculations, and return to Pending"
                            >
                              <RotateCcw size={11} /> Revert
                            </button>
                          )}

                          {/* Checker Action: Re-include */}
                          {isSkipped && isChecker && (
                            <button
                              type="button"
                              onClick={() => handleSkipOrUnskipItem(item.id, "unskip")}
                              disabled={actionInProgressId === item.id}
                              className="px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors disabled:opacity-60"
                              title="Restore this input back to Pending Review"
                            >
                              <RotateCcw size={11} /> Re-include
                            </button>
                          )}

                          {/* Maker Actions on Excluded Change: Modify or Delete */}
                          {isSkipped && isMaker && !isChecker && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenEditExcludedItem(item)}
                                className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10.5px] font-bold cursor-pointer inline-flex items-center gap-1 shadow-xs transition-colors"
                                title="Modify this excluded adjustment and resubmit to Pending for review"
                              >
                                <Pencil size={10} /> Modify
                              </button>
                              {getItemChannel(item) !== "portal" && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSingleItem(item.id, true)}
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer border-none bg-transparent transition-colors"
                                  title="Permanently delete this excluded adjustment"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          )}

                          {/* Delete single draft item (firm manual adjustments only, never portal client submissions - Maker only, never Checker) */}
                          {isPending && isMaker && !isChecker && getItemChannel(item) !== "portal" && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSingleItem(item.id, false)}
                              className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer border-none bg-transparent transition-colors"
                              title="Remove this adjustment"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            Showing <strong className="text-slate-800">{filteredItems.length}</strong> of <strong className="text-slate-800">{currentTabBaseItems.length}</strong> item
            {currentTabBaseItems.length === 1 ? "" : "s"} in {activeTab === "all" ? "All Channels" : activeTab === "portal" ? "Client Portal" : activeTab === "cell_revision" ? "Cell Revisions" : "Internal Firm"}.
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer shadow-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>


      {/* ── Modern Common Confirmation / Prompt / Alert Dialog ── */}
      <PayrollDialog {...dialogConfig} onCancel={closeDialog} />

      {/* ── Modal: Maker Modify Excluded Adjustment ── */}
      {editingItem && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-[min(540px,94vw)] shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">✏️</span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 m-0">Modify Excluded Adjustment</h3>
                  <p className="text-[11px] text-slate-500 m-0 mt-0.5">
                    Correction & Resubmission to Checker Review Queue
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer border-none bg-transparent"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col gap-3.5 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
              {/* Checker reason notice */}
              {editingItem.error && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-600" />
                  <div>
                    <strong className="font-bold">Checker's Reason for Exclusion:</strong>
                    <div className="text-[11.5px] mt-0.5 text-rose-900 whitespace-pre-wrap">{editingItem.error}</div>
                  </div>
                </div>
              )}

              {/* Employee Summary Card */}
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Target Employee</div>
                  <div className="text-xs font-bold text-slate-900 mt-0.5">
                    {editingItem.employee_name || "Batch Adjustment"}
                  </div>
                  {editingItem.employee_code && (
                    <div className="text-[10.5px] text-slate-500 font-mono">{editingItem.employee_code}</div>
                  )}
                </div>
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700">
                  {editingItem.item_type?.replace(/_/g, " ")}
                </span>
              </div>

              {/* Amount Field (if amount/ctc exists) */}
              {("amount" in (editingItem.payload || {}) || "total_amount" in (editingItem.payload || {}) || "ctc_annual" in (editingItem.payload || {})) && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {editingItem.item_type === "REVISION" ? "Revised Annual CTC (₹)" : editingItem.item_type === "NEW_EMPLOYEE" ? "Annual CTC (₹)" : "Amount (₹)"}
                  </label>
                  <input
                    type="number"
                    value={editFormData.amount}
                    onChange={(e) => setEditFormData({ ...editFormData, amount: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="0"
                  />
                </div>
              )}

              {/* LOP Days Field (if LOP) */}
              {(editingItem.item_type === "LOP" || "days" in (editingItem.payload || {})) && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Loss of Pay (LOP Days)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editFormData.days}
                    onChange={(e) => setEditFormData({ ...editFormData, days: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="0.0"
                  />
                </div>
              )}

              {/* Effective From / Last Working Date if applicable */}
              {"effective_from" in (editingItem.payload || {}) && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Effective From Date</label>
                  <input
                    type="date"
                    value={editFormData.effective_from}
                    onChange={(e) => setEditFormData({ ...editFormData, effective_from: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}

              {"last_working_date" in (editingItem.payload || {}) && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Last Working Date</label>
                  <input
                    type="date"
                    value={editFormData.last_working_date}
                    onChange={(e) => setEditFormData({ ...editFormData, last_working_date: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}

              {editingItem.item_type === "NEW_EMPLOYEE" && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Employment Type</label>
                    <select
                      value={editFormData.employment_type || "REGULAR"}
                      onChange={(e) => setEditFormData({ ...editFormData, employment_type: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="REGULAR">Regular (Full-time)</option>
                      <option value="INTERN">Intern / Apprentice (Stipend)</option>
                      <option value="CONSULTANT">Consultant / Contractor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Payment Mode</label>
                    <select
                      value={editFormData.payment_mode || "WIRE_TRANSFER"}
                      onChange={(e) => setEditFormData({ ...editFormData, payment_mode: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="WIRE_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      value={editFormData.bank_account_number}
                      onChange={(e) => setEditFormData({ ...editFormData, bank_account_number: e.target.value.replace(/\D/g, "") })}
                      placeholder="e.g. 50100234567890"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Bank IFSC Code</label>
                    <input
                      type="text"
                      value={editFormData.bank_ifsc_code}
                      onChange={(e) => {
                        const ifsc = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
                        const updates = { bank_ifsc_code: ifsc };
                        if (!editFormData.bank_name && ifsc.length >= 4) {
                          const bankMap = {
                            HDFC: "HDFC Bank", SBIN: "State Bank of India", ICIC: "ICICI Bank",
                            UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", BARB: "Bank of Baroda",
                            PUNB: "Punjab National Bank", IDFB: "IDFC FIRST Bank", YESB: "Yes Bank",
                          };
                          if (bankMap[ifsc.slice(0, 4)]) updates.bank_name = bankMap[ifsc.slice(0, 4)];
                        }
                        setEditFormData({ ...editFormData, ...updates });
                      }}
                      placeholder="e.g. HDFC0001234"
                      maxLength={11}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={editFormData.bank_name}
                      onChange={(e) => setEditFormData({ ...editFormData, bank_name: e.target.value })}
                      placeholder="e.g. HDFC Bank"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}

              {/* Remarks / Reason */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Remarks & Correction Note for Checker
                </label>
                <textarea
                  rows={2}
                  value={editFormData.remarks}
                  onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value })}
                  placeholder="Add explanation or correction details for Checker..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 leading-relaxed"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                disabled={savingEdit}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditExcludedItem}
                disabled={savingEdit}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 shadow-sm disabled:opacity-60"
              >
                {savingEdit ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={13} /> Save & Resubmit to Pending
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




export function PayrollJobDetailView({ jobId: propJobId, onBack } = {}) {
  const { id: paramId } = useParams();
  const id = propJobId || paramId;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "client";
  const setActiveTab = (tabKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tabKey);
      return next;
    }, { replace: false });
  };

  // Modals state
  const [portalUsersOpen, setPortalUsersOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [monthlyInputModalOpen, setMonthlyInputModalOpen] = useState(false);
  const [unifiedAuditModalOpen, setUnifiedAuditModalOpen] = useState(false);
  const [auditActiveTab, setAuditActiveTab] = useState("all");
  const [reworkModalOpen, setReworkModalOpen] = useState(false);
  const [reworkNotes, setReworkNotes] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [selectedExcelIdx, setSelectedExcelIdx] = useState(0);
  const [correctionHovered, setCorrectionHovered] = useState(false);
  const [openBatchModalOpen, setOpenBatchModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

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
  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // URL safeguard: If activeTab points to an input tab that is disabled or hidden, fall back to review
  useEffect(() => {
    if (job) {
      const isInputTab = activeTab === "inputs";
      if (isInputTab) {
        const isMakerUser = (job.makers_list || []).some((m) => m.id === user?.id) || user?.is_superuser;
        const isClosed = ["Done", "Under Review", "Approved"].includes(job.status);
        if (!isMakerUser || isClosed) {
          setActiveTab("review");
        }
      }
    }
  }, [job?.status, activeTab, user?.id]);

  // Client Portal credentials for this job's client
  const [portalUsers, setPortalUsers] = useState([]);
  const [loadingPortalUsers, setLoadingPortalUsers] = useState(false);

  const fetchPortalUsers = (clientId) => {
    const targetClient = clientId || job?.client;
    if (!targetClient) return;
    setLoadingPortalUsers(true);
    api.get(`/payroll/portal-users/`, { params: { client: targetClient } })
      .then((res) => {
        const data = res?.data;
        const list = Array.isArray(data) ? data : (data?.results || []);
        setPortalUsers(list);
      })
      .catch((err) => {
        console.error("Failed to load portal users for client:", err);
      })
      .finally(() => {
        setLoadingPortalUsers(false);
      });
  };

  const fetchJob = () => {
    setLoading(true);
    Promise.all([
      api.get(`/payroll/jobs/${id}/`),
    ])
      .then(([jobRes]) => {
        setJob(jobRes.data);
        if (jobRes.data?.client) {
          fetchPortalUsers(jobRes.data.client);
        }
      })
      .catch((err) => {
        console.error("Failed to load payroll job:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (job?.client) {
      fetchPortalUsers(job.client);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.client]);

  const handleTransition = async (action, notes = "") => {
    setTransitioning(true);
    try {
      const res = await api.post(`/payroll/jobs/${id}/transition-status/`, {
        action,
        notes,
      });
      setJob(res.data);
      if (reworkModalOpen) {
        setReworkModalOpen(false);
        setReworkNotes("");
      }
    } catch (err) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Status Transition Failed",
        message: "Status transition failed: " + (err?.response?.data?.error || err.message),
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setTransitioning(false);
    }
  };

  const executeReopenJob = async (reason) => {
    setTransitioning(true);
    try {
      const res = await api.post(`/payroll/jobs/${id}/reopen/`, { notes: reason.trim() });
      setJob(res.data);
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "success",
        title: "Job Reopened",
        message: "Payroll job reopened successfully and returned to In Progress status.",
        confirmText: "OK",
        onConfirm: closeDialog,
      });
    } catch (err) {
      setDialogConfig({
        isOpen: true,
        type: "alert",
        variant: "danger",
        title: "Reopen Failed",
        message: "Failed to reopen job: " + (err?.response?.data?.error || err?.response?.data?.detail || err.message),
        confirmText: "Close",
        onConfirm: closeDialog,
      });
    } finally {
      setTransitioning(false);
    }
  };

  const handleReopenJob = () => {
    setDialogConfig({
      isOpen: true,
      type: "prompt",
      variant: "warning",
      title: "Reopen Finalized Payroll Job",
      message: "Please state the reason for reopening this finalized payroll job (this will be recorded in the permanent audit trail):",
      defaultValue: "",
      placeholder: "e.g. Retroactive salary adjustment or client request...",
      confirmText: "Reopen Job",
      cancelText: "Cancel",
      onConfirm: (reason) => {
        if (!reason || !reason.trim()) {
          setDialogConfig({
            isOpen: true,
            type: "alert",
            variant: "warning",
            title: "Reason Required",
            message: "A valid explanation is required to reopen a finalized payroll job.",
            confirmText: "Understood",
            onConfirm: closeDialog,
          });
          return;
        }
        closeDialog();
        executeReopenJob(reason);
      },
    });
  };


  const handleDownloadExcel = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-excel/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Payroll");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `${cleanName}_${cleanPeriod}_Payroll_Register.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Excel register");
      alert(errMsg);
    }
  };

  const handleDownloadAttendanceExcel = async (sheet = null) => {
    try {
      const params = {};
      if (sheet?.id && sheet.id !== "primary") {
        params.event_id = sheet.id;
      }
      if (sheet?.file_path) {
        params.path = sheet.file_path;
      }
      const res = await api.get(`/payroll/jobs/${id}/download-attendance-excel/`, {
        params,
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanClient = sanitizeFileNamePart(job?.client_name, "Client");
      const fileName = sheet?.file_name || job?.batch_details?.source_file_name || `${cleanClient}_Attendance.xlsx`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Attendance download unavailable");
      if (err?.response?.status === 404 || errMsg.includes("No attendance Excel file")) {
        alert("This batch was initialized directly from active employee structures / portal inputs without an uploaded Excel file. You can download the Calculation Register or view records in the Review tab.");
      } else {
        alert(errMsg);
      }
    }
  };

  const handleDownloadEmailLogs = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-email-logs/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Payroll");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `${cleanName}_${cleanPeriod}_Payslip_Email_Distribution_Logs.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export email logs");
      alert(errMsg);
    }
  };

  const [downloadingZip, setDownloadingZip] = useState(false);
  const [ecrPreviewOpen, setEcrPreviewOpen] = useState(false);
  const [ecrPreviewText, setEcrPreviewText] = useState("");
  const [ecrPreviewLoading, setEcrPreviewLoading] = useState(false);
  const [ecrCopied, setEcrCopied] = useState(false);
  const handleDownloadAllPayslipsZip = async () => {
    setDownloadingZip(true);
    try {
      const res = await api.get(`/payroll/jobs/${id}/download-payslips-zip/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Payroll");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `${cleanName}_${cleanPeriod}_All_Payslips.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to download payslips ZIP");
      alert(errMsg);
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadEpfoEcrTxt = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-epfo-ecr/?format=txt&file_format=txt`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `EPFO_ECR_${cleanName}_${cleanPeriod}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export EPFO ECR text file");
      alert(errMsg);
    }
  };

  const handleDownloadEpfoEcrXlsx = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-epfo-ecr/?format=xlsx&file_format=xlsx`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `EPFO_ECR_Summary_${cleanName}_${cleanPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export EPFO ECR summary sheet");
      alert(errMsg);
    }
  };

  const handleDownloadEsicMonthly = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-esic-monthly/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `ESIC_Monthly_${cleanName}_${cleanPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export ESIC monthly return");
      alert(errMsg);
    }
  };

  const handleDownloadPtStatement = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-pt-statement/`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `PT_Statement_${cleanName}_${cleanPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Professional Tax statement");
      alert(errMsg);
    }
  };

  const handleDownloadBankPayoutXlsx = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-bank-payout/?format=xlsx&file_format=xlsx`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `Bank_Disbursement_${cleanName}_${cleanPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Bank Payout Schedule");
      alert(errMsg);
    }
  };

  const handleDownloadBankPayoutCsv = async () => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-bank-payout/?format=csv&file_format=csv`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      link.download = `Bank_NetBanking_Payout_${cleanName}_${cleanPeriod}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Corporate NetBanking CSV");
      alert(errMsg);
    }
  };

  const handleDownloadMomVariance = async () => {
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
      alert(errMsg);
    }
  };

  const handleDownloadJournalVoucher = async (format = "xlsx") => {
    try {
      const res = await api.get(`/payroll/jobs/${id}/export-journal-voucher/?format=${format}&file_format=${format}`, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      const cleanName = sanitizeFileNamePart(job?.client_name, "Client");
      const cleanPeriod = sanitizeFileNamePart(job?.period, "Period");
      const ext = format === "xml" ? "xml" : "xlsx";
      link.download = `Payroll_Journal_Voucher_${cleanName}_${cleanPeriod}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const errMsg = await unpackBlobError(err, "Failed to export Journal Voucher");
      alert(errMsg);
    }
  };

  const handleCreateOrLinkBatch = async () => {
    setTransitioning(true);
    try {
      const res = await api.post(`/payroll/jobs/${id}/create-or-link-batch/`);
      setJob(res.data.job);
      setOpenBatchModalOpen(false);
      showToast(res.data.message || "Payroll batch generated and job opened in In Progress!");
    } catch (err) {
      showToast("Failed to initialize batch: " + (err?.response?.data?.error || err?.response?.data?.detail || err.message));
    } finally {
      setTransitioning(false);
    }
  };

  if (!job) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "#ef4444", fontWeight: 600 }}>Payroll Job not found.</p>
        <button
          onClick={onBack || (() => navigate("/payroll/jobs"))}
          style={{
            marginTop: 12,
            padding: "8px 16px",
            background: "#1A2F5A",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // Maker-Checker role detection
  const currentUserId = user?.id;
  const userRole = (user?.role || "").toLowerCase();
  const isAdmin = ["admin", "founder", "manager", "team lead"].includes(userRole) || user?.is_superuser;
  const isAdminOrFounder = ["admin", "founder"].includes(userRole) || user?.is_superuser;
  const isAssignedChecker =
    (job.checkers || []).some((c) => String(c?.id ?? c) === String(currentUserId)) ||
    (job.checkers_list || []).some((c) => String(c?.id) === String(currentUserId));
  const isAssignedMaker =
    (job.makers || []).some((m) => String(m?.id ?? m) === String(currentUserId)) ||
    (job.makers_list || []).some((m) => String(m?.id) === String(currentUserId));

  // Strict separation of duties:
  // Only explicitly assigned Makers can prepare/upload/add inputs.
  // Only explicitly assigned Checkers can review and apply inputs / approve.
  // Team Lead, Admin, Founder, Manager cannot make changes unless assigned as Maker or Checker.
  const isChecker = isAssignedChecker;
  const isMaker = isAssignedMaker;

  const client = job.client_details || {};
  const spocName =
    client.spoc_name ||
    client.primary_spoc_name ||
    (typeof client.spoc === "object" ? client.spoc?.name : "") ||
    job.spoc_name ||
    "";
  const spocEmail =
    client.spoc_email ||
    client.primary_spoc_email ||
    (typeof client.spoc === "object" ? client.spoc?.email : "") ||
    job.spoc_email ||
    "";
  const spocPhone =
    client.spoc_phone ||
    client.primary_spoc_phone ||
    (typeof client.spoc === "object" ? client.spoc?.phone : "") ||
    job.spoc_phone ||
    "";
  const taskId = job.task_id || (job.task ? `TASK-${job.task}` : `JOB-${job.id}`);

  const displayStatus = job.status || "To Do";

  const getStatusBadge = (status) => {
    switch (status) {
      case "To Do":
        return { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1" };
      case "In Progress":
        return { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" };
      case "Rework":
        return { bg: "#fff1f2", color: "#be123c", border: "#fecaca" };
      case "Client Docs Pending":
        return { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" };
      case "Under Review":
        return { bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" };
      case "Approved":
        return { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" };
      case "Done":
        return { bg: "#f0fdf4", color: "#15803d", border: "#86efac" };
      default:
        return { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" };
    }
  };

  const statusBadge = getStatusBadge(displayStatus);

  const getUserRoleBadge = () => {
    if (isAdminOrFounder && job.approver_status?.status === "SENT_TO_APPROVER") {
      return { label: "Approver (Sign-Off Needed)", icon: "🏛️", bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" };
    }
    if (displayStatus === "Approved" && isChecker) {
      return { label: "Checker (Ready to Finalize)", icon: "✅", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" };
    }
    if (displayStatus === "Rework" && isMaker) {
      return { label: "Maker (Rework Required)", icon: "⚠️", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" };
    }
    if (isMaker && isChecker) {
      return { label: "Maker & Checker", icon: "⚡", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" };
    }
    if (isChecker) {
      return { label: "Checker", icon: "🔍", bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" };
    }
    if (isMaker) {
      return { label: "Maker", icon: "🛠️", bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" };
    }
    return { label: "Viewer", icon: "👁️", bg: "#f1f5f9", color: "#475569", border: "#cbd5e1" };
  };
  const roleBadge = getUserRoleBadge();

  const isBatchOpen = ["In Progress", "Rework"].includes(job?.status);
  const isBatchToDo = displayStatus === "To Do";
  const isBatchClosed = ["Done", "Under Review", "Approved"].includes(job?.status);

  const tabs = [
    { key: "client", label: "Client Details", icon: "👤" },
    { key: "docs", label: "Documents", icon: "📁" },
    ...(isMaker && !isBatchClosed ? [
      {
        key: "inputs",
        label: "Monthly Inputs",
        icon: "📥",
      },
    ] : []),
    { key: "review", label: "Review", icon: "📝" },
    { key: "audit", label: "Audit Trail", icon: "⏱️" },
    { key: "team", label: "Team", icon: "👥" },
  ];

  const rawTaskPk = typeof job.task === "object" ? job.task?.id : job.task;
  const taskPk = typeof rawTaskPk === "number" ? rawTaskPk : (typeof rawTaskPk === "string" && /^\d+$/.test(rawTaskPk) ? Number(rawTaskPk) : null);

  const isFullWorkspaceTab = ["review", "inputs"].includes(activeTab);

  return (
    <div className={isFullWorkspaceTab ? "payroll-workspace-tab-active" : ""}>
      {isFullWorkspaceTab && (
        <style>{`
          .payroll-workspace-tab-active > div > div[style*="sticky"] {
            position: static !important;
          }
          .payroll-docked-canvas {
            position: sticky;
            top: 48px;
            height: calc(100vh - 126px);
            min-height: calc(100vh - 126px);
            max-height: calc(100vh - 126px);
            margin-bottom: 14px;
            box-sizing: border-box;
          }
          @media (max-width: 768px) {
            .payroll-docked-canvas {
              position: sticky;
              top: 24px;
              height: calc(100vh - 98px);
              min-height: calc(100vh - 98px);
              max-height: calc(100vh - 98px);
              margin-bottom: 10px;
            }
          }
        `}</style>
      )}
      <JobWorkspaceShell
        breadcrumb={[
          { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
          { label: "Monthly Payroll", onClick: onBack || (() => navigate("/payroll/jobs")) },
          { label: job.client_name ? job.client_name.toUpperCase() : "CLIENT" },
        ]}
        title={job.client_name ? job.client_name.toUpperCase() : "CLIENT NAME"}
        statusLabel={displayStatus}
        statusTone={statusBadge}
        chips={[job.period]}
        rightChip={roleBadge ? `${roleBadge.icon} ${roleBadge.label}` : "💼 Payroll"}
        task={{
          id: taskPk,
          label: job.stt_task_id || taskId,
        }}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(k) => {
          const target = tabs.find((t) => t.key === k);
          if (target?.disabled) return;
          setActiveTab(k);
          const el = document.querySelector(".ant-layout-content");
          if (el) el.scrollTo({ top: 0, behavior: "instant" });
        }}
        isTabLocked={(k) => tabs.find((t) => t.key === k)?.disabled}
        style={{
          minHeight: "100%",
          padding: isFullWorkspaceTab ? "16px 20px 0 20px" : "16px 20px 24px 20px",
          background: "#f8fafc",
        }}
      >

        {/* Quick Info Summary Cards — only visible on Client Details tab */}
        {activeTab === "client" && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5 mb-4">
              <div className="bg-white rounded-xl p-3.5 px-4.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] text-slate-500 font-semibold tracking-wide uppercase">Task ID</div>
                <div className="text-sm font-bold text-slate-900 mt-1">
                  {taskId}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3.5 px-4.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] text-slate-500 font-semibold tracking-wide uppercase">Period</div>
                <div className="text-sm font-bold text-slate-900 mt-1">
                  {job.period || "—"}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3.5 px-4.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] text-slate-500 font-semibold tracking-wide uppercase">Due Date</div>
                <div className="text-sm font-bold text-slate-900 mt-1">
                  {fmtDate(job.due_date)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3.5 px-4.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] text-slate-500 font-semibold tracking-wide uppercase">Sub-Service</div>
                <div className="text-sm font-bold text-slate-900 mt-1">
                  {job.sub_service_name || "Monthly Payroll Processing"}
                </div>
              </div>
            </div>

            {/* Blue Notice Banner */}
            <div className="bg-sky-50 border border-sky-200 rounded-lg py-2.5 px-4 text-xs text-sky-800 flex items-center gap-2 mb-5">
              <span className="font-extrabold text-sky-500">|</span>
              <span>Auto-filled from client master. Edit to update.</span>
            </div>
          </>
        )}

        {/* Tab 1: Client Details */}
        {activeTab === "client" && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-sm">
            <h2 className="text-xs font-extrabold text-slate-500 tracking-wider uppercase mb-5">
              CLIENT INFORMATION
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-y-5 gap-x-8">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CLIENT NAME *</div>
                <div className="text-[13.5px] font-bold text-slate-900 mt-1">
                  {client.name ? client.name.toUpperCase() : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">EMAIL</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                  {client.email || "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">PHONE</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                  {client.phone || "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CONTACT PERSON</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                  {client.contact_person ? client.contact_person.toUpperCase() : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">GSTIN</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                  {client.gstin || "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">PAN</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                  {client.pan || "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CLIENT SPOC</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                  {spocName ? (
                    <span title={spocPhone ? `Phone: ${spocPhone}` : undefined}>
                      {spocName} {spocEmail ? <span className="text-slate-500 font-normal">({spocEmail})</span> : ""}
                    </span>
                  ) : (
                    <span className="text-slate-400 font-normal">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">ADDRESS</div>
                <div className="text-[13px] text-slate-700 mt-1 leading-relaxed">
                  {client.address || "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Documents — using standard DocumentsTab from JobWorkspaceCommon */}
        {activeTab === "docs" && (
          <div className="payroll-documents-tab-wrap">
            <style>{`
            .payroll-documents-tab-wrap div[style*="gridTemplateColumns"] {
              grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
              gap: 14px !important;
              align-items: stretch !important;
            }
            .payroll-documents-tab-wrap div[style*="gridTemplateColumns"] > div {
              height: 100% !important;
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
            }
          `}</style>

            {/* Request documents from the client — upload link, reminders, accept / reject uploads */}
            <ClientDocRequestPanel module="payroll" jobId={job.id} checklist={PAYROLL_DOC_CHECKLIST} />

            {(() => {
              const uploadedExcels = job.uploaded_excels?.length
                ? job.uploaded_excels
                : (job.batch_details?.source_file_name
                  ? [{
                    id: "primary",
                    file_name: job.batch_details.source_file_name,
                    file_path: job.batch_details.source_file_url || "",
                    uploaded_by: "Staff",
                    created_at: job.batch_details.created_at,
                    event_type: "EXCEL_UPLOADED",
                    records_count: job.batch_details.total_employees,
                  }]
                  : []);
              const hasExcels = uploadedExcels.length > 0;
              const batch = job.batch_details || job.batch;

              // Dynamically build attendance checklist items:
              // If multiple excels are uploaded, each gets its own dedicated card.
              const attendanceChecklist = !hasExcels
                ? [{
                  key: "attendance_0",
                  icon: "⏱️",
                  label: "Attendance Sheet",
                  note: "Monthly attendance & LOP",
                  required: true,
                }]
                : uploadedExcels.map((sh, idx) => {
                  const isLatest = idx === 0;
                  const note = isLatest ? "Monthly attendance & LOP" : "Prior uploaded revision";
                  return {
                    key: `attendance_${idx}`,
                    icon: "⏱️",
                    label: "Attendance Sheet",
                    note,
                    required: isLatest,
                  };
                });

              const payrollChecklist = [
                ...attendanceChecklist,
                {
                  key: "master_register",
                  icon: "📗",
                  label: "Payroll Register",
                  note: "Calculation & statutory register",
                  required: false,
                },
                {
                  key: "epfo_ecr_txt",
                  icon: "🏛️",
                  label: "EPFO ECR (.txt)",
                  note: "Direct Unified Portal upload (#~# delimited)",
                  required: false,
                },
                {
                  key: "epfo_ecr_xlsx",
                  icon: "📊",
                  label: "EPFO ECR Audit Sheet (.xlsx)",
                  note: "Detailed reconciliation with A/c 1, 2, 10, 21 splits",
                  required: false,
                },
                {
                  key: "esic_monthly",
                  icon: "🏥",
                  label: "ESIC Monthly File (.xlsx)",
                  note: "Direct ESIC portal upload with IP numbers",
                  required: false,
                },
                {
                  key: "pt_statement",
                  icon: "📜",
                  label: "Professional Tax Statement (.xlsx)",
                  note: "State PT filing return & challan summary",
                  required: false,
                },
                {
                  key: "bank_payout_schedule",
                  icon: "💳",
                  label: "Bank Payout Schedule (.xlsx)",
                  note: "NEFT / RTGS salary disbursement & hold audit splits",
                  required: false,
                },
                {
                  key: "bank_payout_csv",
                  icon: "📄",
                  label: "Corporate NetBanking (.csv)",
                  note: "Direct bulk payment upload file for bank portals",
                  required: false,
                },
                {
                  key: "mom_variance_sheet",
                  icon: "📈",
                  label: "MoM Variance & Reconciliation (.xlsx)",
                  note: "Month-over-month salary & headcount audit bridge",
                  required: false,
                },
                {
                  key: "journal_voucher",
                  icon: "📑",
                  label: "Accounting Journal Voucher (.xlsx)",
                  note: "Balanced double-entry debit/credit payroll posting for ERP/Tally",
                  required: false,
                },
                {
                  key: "email_logs",
                  icon: "✉️",
                  label: "Email Audit Log",
                  note: "Delivery & dispatch audit",
                  required: false,
                },
                {
                  key: "payslips_zip",
                  icon: "📦",
                  label: "Payslips Archive",
                  note: "All employee PDF slips (.zip)",
                  required: false,
                },
              ];

              const loadDocs = () => {
                const out = {};
                if (hasExcels) {
                  uploadedExcels.forEach((sh, idx) => {
                    const isLatest = idx === 0;
                    const revNum = uploadedExcels.length - idx;
                    const badgeLabel = isLatest
                      ? "Latest"
                      : (uploadedExcels.length > 2 ? `Initial (${revNum})` : "Initial");

                    out[`attendance_${idx}`] = {
                      filename: sh.file_name || "Attendance.xlsx",
                      url: sh.file_path || "",
                      label: "Attendance Sheet",
                      filled: true,
                      sheet: sh,
                      viewable: false,
                      badge: {
                        label: badgeLabel,
                        tone: isLatest ? "ok" : "grey",
                      },
                    };
                  });
                } else if (batch) {
                  const cleanPeriod = sanitizeFileNamePart(job.period, "batch");
                  out.attendance_0 = {
                    filename: batch.source_file_name || `Attendance_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "Attendance Sheet",
                    filled: true,
                    viewable: false,
                    badge: {
                      label: batch.source_file_name ? "Uploaded" : "Master / Portal",
                      tone: batch.source_file_name ? "ok" : "blue",
                    },
                  };
                }

                if (batch) {
                  const isFinalized = job.status === "Done";
                  const cleanPeriod = (job.period || "batch").replace(/[^a-zA-Z0-9_-]/g, "_");
                  const draftBadge = { label: "Draft", tone: "warn" };

                  out.master_register = {
                    filename: `PayrollRegister_${cleanPeriod}.xlsx`,
                    url: batch.register_url || "",
                    label: "Payroll Register",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: batch.status || "Finalized",
                      tone: "ok",
                    } : draftBadge,
                  };

                  out.epfo_ecr_txt = {
                    filename: `EPFO_ECR_${cleanPeriod}.txt`,
                    url: "",
                    label: "EPFO ECR (.txt)",
                    filled: true,
                    viewable: true,
                    badge: isFinalized ? {
                      label: "Unified Portal (.txt)",
                      tone: "blue",
                    } : draftBadge,
                  };

                  out.epfo_ecr_xlsx = {
                    filename: `EPFO_ECR_Summary_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "EPFO ECR Audit Sheet",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "A/c Splits",
                      tone: "purple",
                    } : draftBadge,
                  };

                  out.esic_monthly = {
                    filename: `ESIC_Monthly_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "ESIC Monthly File",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "ESIC Portal (.xlsx)",
                      tone: "emerald",
                    } : draftBadge,
                  };

                  out.pt_statement = {
                    filename: `PT_Statement_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "Professional Tax Statement",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "State Slabs",
                      tone: "amber",
                    } : draftBadge,
                  };

                  out.bank_payout_schedule = {
                    filename: `Bank_Disbursement_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "Bank Payout Schedule",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "NEFT / RTGS",
                      tone: "blue",
                    } : draftBadge,
                  };

                  out.bank_payout_csv = {
                    filename: `Bank_NetBanking_Payout_${cleanPeriod}.csv`,
                    url: "",
                    label: "Corporate NetBanking CSV",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "Bulk Upload",
                      tone: "emerald",
                    } : draftBadge,
                  };

                  out.mom_variance_sheet = {
                    filename: `MoM_Variance_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "MoM Variance Bridge",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "Audit Bridge",
                      tone: "purple",
                    } : draftBadge,
                  };

                  out.journal_voucher = {
                    filename: `Payroll_JV_${cleanPeriod}.xlsx`,
                    url: "",
                    label: "Accounting Journal Voucher",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "Balanced JV",
                      tone: "emerald",
                    } : draftBadge,
                  };

                  out.email_logs = {
                    filename: `EmailLog_${cleanPeriod}.xlsx`,
                    url: batch.email_log_url || "",
                    label: "Email Audit Log",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "Dispatched",
                      tone: "ok",
                    } : draftBadge,
                  };

                  out.payslips_zip = {
                    filename: `Payslips_${cleanPeriod}.zip`,
                    url: batch.zip_url || "",
                    label: "Payslips Archive",
                    filled: true,
                    viewable: false,
                    badge: isFinalized ? {
                      label: "PDF Bundle",
                      tone: "purple",
                    } : draftBadge,
                  };
                }

                return Promise.resolve(out);
              };

              const handleDocDownload = (doc) => {
                const k = doc?._key || doc?.key;
                if (doc?.sheet) {
                  handleDownloadAttendanceExcel(doc.sheet);
                } else if (k === "master_register") {
                  handleDownloadExcel();
                } else if (k === "epfo_ecr_txt") {
                  handleDownloadEpfoEcrTxt();
                } else if (k === "epfo_ecr_xlsx") {
                  handleDownloadEpfoEcrXlsx();
                } else if (k === "esic_monthly") {
                  handleDownloadEsicMonthly();
                } else if (k === "pt_statement") {
                  handleDownloadPtStatement();
                } else if (k === "bank_payout_schedule") {
                  handleDownloadBankPayoutXlsx();
                } else if (k === "bank_payout_csv") {
                  handleDownloadBankPayoutCsv();
                } else if (k === "mom_variance_sheet") {
                  handleDownloadMomVariance();
                } else if (k === "journal_voucher") {
                  handleDownloadJournalVoucher();
                } else if (k === "email_logs") {
                  handleDownloadEmailLogs();
                } else if (k === "payslips_zip") {
                  handleDownloadAllPayslipsZip();
                } else if (doc?.url) {
                  window.open(doc.url, "_blank");
                }
              };

              const handleDocView = async (doc) => {
                const k = doc?._key || doc?.key;
                if (k === "epfo_ecr_txt") {
                  setEcrPreviewLoading(true);
                  setEcrPreviewOpen(true);
                  try {
                    const res = await api.get(`/payroll/jobs/${id}/export-epfo-ecr/?format=txt&file_format=txt`, {
                      responseType: "text",
                    });
                    setEcrPreviewText(typeof res.data === "string" ? res.data : String(res.data || ""));
                  } catch (err) {
                    alert("Failed to load EPFO ECR preview: " + (err?.message || err));
                    setEcrPreviewOpen(false);
                  } finally {
                    setEcrPreviewLoading(false);
                  }
                } else if (doc?.url) {
                  window.open(doc.url, "_blank");
                }
              };

              return (
                <DocumentsTab
                  title="Payroll Workbooks & Excel Registers"
                  checklist={payrollChecklist}
                  load={loadDocs}
                  reloadKey={`${job.id}_${job.batch_details?.id}_${job.status}_${job.batch_details?.total_employees}_${job.uploaded_excels?.length || 0}`}
                  onDownload={handleDocDownload}
                  onView={handleDocView}
                />
              );
            })()}
          </div>
        )}

        {/* Option 1: Smart EPFO ECR Text Preview Modal */}
        {ecrPreviewOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] z-[1500] flex items-center justify-center p-4 animate-in fade-in"
            onClick={() => setEcrPreviewOpen(false)}
          >
            <div
              className="bg-white rounded-2xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🏛️</span>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 m-0">
                      EPFO ECR Text Preview (#~# Delimited)
                    </h3>
                    <p className="text-xs text-slate-500 m-0 mt-0.5">
                      Unified Portal upload format · {ecrPreviewText.split("\n").filter(l => l.trim()).length} member records
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(ecrPreviewText);
                      setEcrCopied(true);
                      setTimeout(() => setEcrCopied(false), 2000);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${ecrCopied
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                  >
                    {ecrCopied ? "✓ Copied!" : "📋 Copy All Text"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadEpfoEcrTxt}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1A2F5A] text-white hover:bg-[#152547] cursor-pointer"
                  >
                    ⬇️ Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={() => setEcrPreviewOpen(false)}
                    className="text-slate-400 hover:text-slate-700 p-1 text-lg font-bold cursor-pointer ml-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="p-4 overflow-auto flex-1 bg-slate-950 font-mono text-[11.5px] text-emerald-400 leading-relaxed whitespace-pre select-all">
                {ecrPreviewLoading ? "Loading EPFO ECR preview…" : (ecrPreviewText || "No records in batch")}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Monthly Inputs & Uploads — Maker unified embedded workspace */}
        {activeTab === "inputs" && isMaker && !isBatchClosed && (
          <div className="payroll-docked-canvas flex flex-col flex-1 overflow-hidden">
            {isBatchToDo ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 p-8 sm:p-12 text-center shadow-sm flex flex-col items-center justify-center my-auto max-w-2xl mx-auto">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center text-3xl mb-4 shadow-sm">
                  ⚡
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wider mb-2">
                  Job Status: To Do
                </span>
                <h3 className="text-xl font-extrabold text-slate-900 mb-2">
                  Start Payroll Job & Initialize Batch
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto mb-6 leading-relaxed">
                  Initialize this month's payroll batch for <strong>{job.client_name || "Client"}</strong> ({job.period || "Current Period"}). This pulls all active employees, locks baseline salary masters, and unlocks the monthly inputs workbench.
                </p>

                <button
                  type="button"
                  onClick={handleCreateOrLinkBatch}
                  disabled={transitioning}
                  className="inline-flex items-center gap-2 py-3 px-8 bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-500 hover:to-sky-600 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>⚡</span>
                  <span>{transitioning ? "Generating Batch & Starting Job…" : "Generate Batch & Start Job"}</span>
                </button>

                {/* 3-Step Process Flow Preview */}
                <div className="grid grid-cols-3 gap-3 w-full mt-10 pt-8 border-t border-slate-100 text-left">
                  <div className="p-3 rounded-lg bg-sky-50/70 border border-sky-100">
                    <div className="text-[10.5px] font-bold text-sky-800 uppercase">Step 1 (Now)</div>
                    <div className="text-xs font-bold text-slate-800 mt-0.5">Start Job</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Pull active staff masters</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10.5px] font-bold text-slate-400 uppercase">Step 2</div>
                    <div className="text-xs font-bold text-slate-700 mt-0.5">Monthly Inputs</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Excel upload & inline edits</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10.5px] font-bold text-slate-400 uppercase">Step 3</div>
                    <div className="text-xs font-bold text-slate-700 mt-0.5">Review & Finalize</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Checker review & payslips</div>
                  </div>
                </div>
              </div>
            ) : (
              <PayrollJobUnifiedInputsView
                job={job}
                isMaker={isMaker}
                isChecker={isChecker}
                isAdmin={isAdminOrFounder}
                onClose={() => setActiveTab("review")}
                onSuccess={() => {
                  fetchJob();
                  setActiveTab("review");
                }}
                embedded={true}
              />
            )}
          </div>
        )}

        {/* Tab: Review — render PayrollJobBatchReview directly */}
        {activeTab === "review" && (
          <div className="mb-6 min-h-[calc(100vh-220px)] flex flex-col flex-1">
            {!job.batch_details ? (
              <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center shadow-sm">
                <div className="text-4xl mb-3">📋</div>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Payroll Batch Not Generated Yet
                </h3>
                <p className="text-xs text-slate-500 mx-auto max-w-[460px] leading-relaxed">
                  {isMaker
                    ? "The payroll batch has not been initialized for this period yet. Open the Monthly Inputs & Uploads tab to generate the batch and stage monthly adjustments."
                    : "The assigned Maker has not generated the payroll batch for this period yet."}
                </p>
              </div>
            ) : (
              <PayrollJobBatchReview
                jobId={id}
                embedded={true}
                onJobUpdated={(updatedJob) => {
                  setJob(updatedJob);
                  if (updatedJob?.client) {
                    fetchPortalUsers(updatedJob.client);
                  }
                }}
              />
            )}
          </div>
        )}

        {/* Tab 4: Audit Trail — using AuditTrailTab from JobWorkspaceCommon */}
        {activeTab === "audit" && (
          <div>
            <AuditTrailTab
              title="Maker-Checker Event Timeline & Audit Trail"
              reloadKey={id}
              load={() => Promise.resolve(
                [...(job.events || [])].reverse().map((ev) => {
                  const meta = EVENT_META[ev.event_type] || {};
                  const eventLabel = (ev.event_type || 'EVENT').replace(/_/g, ' ');
                  const formattedBadge = meta.badge || eventLabel;
                  const formattedAction = meta.label || eventLabel;
                  const formattedNote = parseAuditNote(ev.notes, ev.event_type);

                  return {
                    id: ev.id,
                    action: formattedAction,
                    user: ev.performed_by_name || 'System',
                    created_at: ev.created_at,
                    note: formattedNote,
                    section: formattedBadge,
                    tone: meta.bg && meta.color ? { bg: meta.bg, color: meta.color } : { bg: '#f1f5f9', color: '#475569' },
                  };
                })
              )}
              searchPlaceholder="Search events…"
            />
          </div>
        )}


        {/* Tab 5: Team — using TeamTab from JobWorkspaceCommon */}
        {activeTab === "team" && (
          <TeamTab
            makers={Array.from(new Map((job.makers_list || []).map((m) => [m.id, m])).values())}
            checkers={Array.from(new Map((job.checkers_list || []).map((c) => [c.id, c])).values())}
            linkedTask={[
              ['Task ID', taskId],
              ['Period', job.period || '—'],
              ['Sub-Service', job.sub_service_name || 'Monthly Payroll Processing'],
              ['Due Date', fmtDate(job.due_date)],
            ]}
            assignedBy={job.assigned_by_name ? { name: job.assigned_by_name, at: job.assigned_at } : undefined}
          />
        )}



        {/* Rework Modal */}
        {reworkModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 z-[1200] flex items-center justify-center p-6 backdrop-blur-[2px]">
            <div className="bg-white rounded-xl w-full max-w-[500px] overflow-hidden shadow-2xl border border-slate-200">
              <div className="p-4 px-5 border-b border-rose-200 bg-rose-50 flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-bold text-rose-800 m-0">
                    Send Back for Rework
                  </h3>
                  <p className="text-xs text-rose-700 m-0 mt-0.5">
                    Provide specific reasons / corrections needed for the Maker
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReworkModalOpen(false)}
                  className="bg-transparent border-none text-lg cursor-pointer text-slate-500 hover:text-slate-800 transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="p-5">
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Review Remarks / Feedback *
                </label>
                <textarea
                  value={reworkNotes}
                  onChange={(e) => setReworkNotes(e.target.value)}
                  placeholder="e.g. Please check LOP days for Employee #104, PF cap was exceeded, or bonus amount mismatch."
                  rows={4}
                  className="w-full p-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all box-border resize-y"
                />
                <div className="flex justify-end gap-2.5 mt-4">
                  <button
                    type="button"
                    onClick={() => setReworkModalOpen(false)}
                    className="px-3.5 py-2 bg-white border border-slate-300 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!reworkNotes.trim()) {
                        alert("Please enter review remarks.");
                        return;
                      }
                      handleTransition("rework", reworkNotes);
                    }}
                    disabled={transitioning}
                    className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-md text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                  >
                    {transitioning ? "Sending…" : "Send Back for Rework"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Multi-Sheet Payroll Excel Upload Modal (from Client Portal) */}
        {uploadModalOpen && (
          <PayrollJobExcelUploadModal
            job={job}
            isMaker={isMaker}
            isChecker={isChecker}
            isAdmin={isAdmin}
            onClose={() => setUploadModalOpen(false)}
            onSuccess={() => {
              setUploadModalOpen(false);
              fetchJob();
            }}
          />
        )}




        {/* Scoped Portal Users Modal */}
        {portalUsersOpen && (
          <div className="fixed inset-0 bg-slate-900/60 z-[1200] flex items-center justify-center p-6 backdrop-blur-[2px]">
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between p-4 px-6 border-b border-slate-200 bg-slate-50">
                <div>
                  <h3 className="text-base font-bold m-0 text-slate-900">
                    Client Portal Users · {job.client_name}
                  </h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    Manage client portal logins, invite contacts, and reset passwords
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPortalUsersOpen(false);
                    if (job?.client) fetchPortalUsers(job.client);
                  }}
                  className="bg-transparent border-none text-xl cursor-pointer text-slate-500 hover:text-slate-800 p-1 transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <PortalUsers embedded lockedClientId={job.client} />
              </div>
            </div>
          </div>
        )}

        {/* Unified Multi-Channel Payroll Audit Center Modal */}
        {unifiedAuditModalOpen && (
          <PayrollJobUnifiedAuditModal
            job={job}
            isMaker={isMaker}
            isChecker={isChecker}
            isAdmin={isAdmin}
            initialTab={auditActiveTab}
            onClose={() => setUnifiedAuditModalOpen(false)}
            onChanged={() => {
              fetchJob();
            }}
            onRework={(notes, target) => {
              if (target === "client") {
                // handled inside modal
              } else {
                handleTransition("rework", notes);
              }
            }}
            onFinalize={async () => {
              await handleTransition("approve", "Approved and finalized monthly payroll.");
              fetchJob();
            }}
          />
        )}

        {/* Monthly Adjustments & Inputs Staging Modal */}
        {monthlyInputModalOpen && (
          <PayrollJobMonthlyInputModal
            job={job}
            onClose={() => setMonthlyInputModalOpen(false)}
            onChanged={() => fetchJob()}
          />
        )}

        {/* Open & Generate Batch Confirmation Dialog Box */}
        {openBatchModalOpen && (
          <div
            className="fixed inset-0 bg-slate-900/65 z-[1300] flex items-center justify-center p-5 backdrop-blur-[2px]"
            onClick={() => {
              if (!transitioning) setOpenBatchModalOpen(false);
            }}
          >
            <div
              className="bg-white rounded-xl w-full max-w-[480px] overflow-hidden shadow-2xl border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 px-5 border-b border-sky-100 bg-gradient-to-r from-sky-50 to-blue-50 flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-extrabold m-0 text-sky-800 flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>Generate & Open Payroll Batch</span>
                  </h3>
                  <p className="text-xs text-sky-700 m-0 mt-0.5">
                    {job.client_name ? job.client_name.toUpperCase() : "CLIENT"} · {job.period || "Current Period"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenBatchModalOpen(false)}
                  disabled={transitioning}
                  className="bg-transparent border-none text-lg cursor-pointer text-slate-500 hover:text-slate-800 transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="p-5">
                {/* Info Pill */}
                <div className="flex items-center justify-between p-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs mb-4">
                  <div>
                    <span className="text-slate-500">Status Transition:</span>{" "}
                    <strong className="text-slate-700">To Do</strong>{" "}
                    <span className="text-sky-600">➔</span>{" "}
                    <strong className="text-sky-700">In Progress</strong>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    OPENING BATCH
                  </span>
                </div>

                <p className="text-xs text-slate-700 m-0 mb-3.5 leading-relaxed">
                  Starting work on this payroll job will execute the following automated steps:
                </p>

                {/* Action Checklist */}
                <div className="flex flex-col gap-2.5 mb-4">
                  <div className="flex items-start gap-2.5 text-xs text-slate-600">
                    <span className="text-sm">👥</span>
                    <div>
                      <strong className="text-slate-900">Load Active Employees:</strong> Pulls all active staff members and baseline salary masters for this company.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-slate-600">
                    <span className="text-sm">📥</span>
                    <div>
                      <strong className="text-slate-900">Fold Portal Inputs:</strong> Automatically applies any approved monthly employee adjustments submitted from the Client Portal.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-slate-600">
                    <span className="text-sm">🔓</span>
                    <div>
                      <strong className="text-slate-900">Unlock Maker Workspaces:</strong> Changes status to <em>In Progress</em>, immediately unlocking <strong>Upload Excel</strong> and <strong>Monthly Input</strong> tabs.
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end gap-2.5 mt-5">
                  <button
                    type="button"
                    onClick={() => setOpenBatchModalOpen(false)}
                    disabled={transitioning}
                    className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateOrLinkBatch}
                    disabled={transitioning}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg border-none bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-500 hover:to-sky-600 text-white text-xs font-bold shadow-md hover:shadow-lg active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <span>⚡</span>
                    <span>{transitioning ? "Generating Batch…" : "Generate Batch & Start Job"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* In-Page Toast Notification */}
        {toastMsg && (
          <div className="fixed bottom-6 right-6 z-[1600] bg-slate-900/95 text-white py-3 px-5 rounded-lg shadow-2xl border border-slate-800 flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md">
            <span className="text-emerald-400 font-bold">✓</span>
            <span>{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="bg-transparent border-none text-slate-400 hover:text-slate-200 cursor-pointer text-sm ml-2 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Modern Common Confirmation / Prompt / Alert Dialog ── */}
        <PayrollDialog {...dialogConfig} onCancel={closeDialog} />
      </JobWorkspaceShell>
    </div>
  );
}

/* ==========================================================================
   PART 4: PAYROLL JOBS SCHEDULE DASHBOARD & LIST VIEW
   ========================================================================== */

export function PayrollJobListView({ onOpenJob } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const isJobsRoute = location.pathname.endsWith("/jobs") || searchParams.get("view") === "jobs";
  const [viewMode, setViewMode] = useState(isJobsRoute ? "jobs" : "dashboard");

  useEffect(() => {
    if (location.pathname.endsWith("/jobs") || searchParams.get("view") === "jobs") {
      setViewMode("jobs");
    } else {
      setViewMode("dashboard");
    }
  }, [location.pathname, searchParams]);

  const [stats, setStats] = useState({
    total_jobs: 0,
    active_jobs: 0,
    overdue_jobs: 0,
    my_pending_tasks: 0,
    todo: 0,
    in_progress: 0,
    client_docs_pending: 0,
    under_review: 0,
    rework: 0,
    done: 0,
  });
  const [pendingTasks, setPendingTasks] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [allJobs, setAllJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // All Jobs view state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [jobListViewMode, setJobListViewMode] = useState("grid"); // 'grid' | 'list'
  const [assignJob, setAssignJob] = useState(null);

  const userRole = (user?.role || "").toLowerCase();
  const canAccessClientMaster =
    ["admin", "founder", "manager", "team lead", "maker", "checker"].includes(userRole) ||
    user?.is_superuser ||
    Boolean(user);
  const canAssignMC =
    ["admin", "founder", "manager", "team lead", "teamlead", "ceo", "director"].includes(userRole) ||
    user?.is_superuser;

  const loadData = () => {
    let alive = true;
    setLoading(true);

    Promise.all([
      api.get("/payroll/jobs/stats/").catch(() => ({ data: {} })),
      api.get("/payroll/jobs/?my_tasks=true").catch(() => ({ data: [] })),
      api.get("/payroll/jobs/?all=true").catch(() => ({ data: [] })),
    ])
      .then(([statsRes, pendingRes, recentRes]) => {
        if (!alive) return;
        if (statsRes.data && typeof statsRes.data === "object") {
          setStats((prev) => ({ ...prev, ...statsRes.data }));
        }

        const toList = (d) => (Array.isArray(d) ? d : d?.results || []);
        const pList = toList(pendingRes.data);
        const rList = toList(recentRes.data);

        setPendingTasks(pList);
        setRecentJobs(rList);
        setAllJobs(rList);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    const cleanup = loadData();
    const interval = setInterval(loadData, 60000);
    const onFocus = () => loadData();
    window.addEventListener("focus", onFocus);
    return () => {
      if (typeof cleanup === "function") cleanup();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Workflow cues for pending tasks
  const getJobRoleBadge = (job) => {
    const uid = user?.id;
    const role = (user?.role || "").toLowerCase();
    const isAdminOrFounder = ["admin", "founder"].includes(role) || user?.is_superuser;
    const isMaker = (job.makers || []).includes(uid) || (job.makers_list || []).some((m) => m.id === uid);
    const isChecker = (job.checkers || []).includes(uid) || (job.checkers_list || []).some((c) => c.id === uid);
    const isApproverPending = isAdminOrFounder && job.approver_status?.status === "SENT_TO_APPROVER";

    const pInfo = job.portal_submission_info;
    const portalPending = Number(job?.pending_portal_items_count || 0);
    const isPortalSubmitted = portalPending > 0 || Number(pInfo?.portal_pending_count || 0) > 0;

    if (isApproverPending) {
      return { text: "Approver: Sign-Off Needed", bg: PL, color: P };
    }
    if (isChecker && isPortalSubmitted) {
      return { text: "Checker: Portal Review Needed", bg: "#FFF4E6", color: "#A05A00" };
    }
    if (job.status === "Under Review" && isChecker) {
      return { text: "Checker: Review Needed", bg: PURL, color: PUR };
    }
    if (job.status === "Approved" && isChecker) {
      return { text: "Checker: Ready to Finalize", bg: "#E8F7F3", color: GR };
    }
    if (job.status === "Rework" && isMaker) {
      return { text: "Maker: Rework Required", bg: "#FEF2F2", color: RED };
    }
    if (job.status === "To Do" && isMaker) {
      return { text: "Maker: Start Preparation", bg: "#F3F4F6", color: MUT };
    }
    if (job.status === "In Progress" && isMaker) {
      return { text: "Maker: Preparing", bg: PL, color: P };
    }
    return null;
  };

  // Top 4 High-Level Stat Cards using shared palette tokens
  const top4StatCards = [
    {
      icon: "📊",
      value: stats.total_jobs,
      label: "Total Jobs",
      subtext: "all filing jobs",
      color: P,
      filterStatus: "All",
    },
    {
      icon: "🔄",
      value: stats.active_jobs,
      label: "Active",
      subtext: "in progress & review",
      color: GR,
      filterStatus: "Active",
    },
    {
      icon: "⏰",
      value: stats.overdue_jobs,
      label: "Overdue",
      subtext: "past due date",
      color: stats.overdue_jobs > 0 ? RED : MUT,
      filterStatus: "Overdue",
    },
    {
      icon: "📌",
      value: stats.my_pending_tasks,
      label: "My Pending Tasks",
      subtext: "assigned action items",
      color: AMB,
      filterStatus: "My Tasks",
    },
  ];

  // Pipeline Status Breakdown Definitions
  const pipelineStatuses = [
    { label: "To Do", key: "todo", count: stats.todo, color: "#64748b", filterKey: "To Do" },
    { label: "In Progress (Maker)", key: "in_progress", count: stats.in_progress, color: "#0284c7", filterKey: "In Progress" },
    { label: "Rework", key: "rework", count: stats.rework || 0, color: "#e11d48", filterKey: "Rework" },
    { label: "Under Review (Checker)", key: "under_review", count: stats.under_review || 0, color: "#7c3aed", filterKey: "Under Review" },
    { label: "Approved", key: "approved", count: stats.approved || 0, color: "#059669", filterKey: "Approved" },
    { label: "Finalized / Done", key: "done", count: stats.done, color: "#10b981", filterKey: "Done" },
  ];

  const statusBreakdownData = useMemo(() => {
    return pipelineStatuses.map((st) => ({
      label: st.label,
      value: st.count || 0,
      color: st.color,
      filterKey: st.filterKey,
    }));
  }, [stats]);

  const portalPendingJobsCount = useMemo(() => {
    return allJobs.filter((job) => {
      const portalPending = Number(job?.pending_portal_items_count || 0);
      const pInfo = job?.portal_submission_info;
      return portalPending > 0 || Number(pInfo?.portal_pending_count || 0) > 0;
    }).length;
  }, [allJobs]);

  // Filtered jobs in All Jobs view
  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      // Status filter
      if (statusFilter === "Portal Pending") {
        const portalPending = Number(job?.pending_portal_items_count || 0);
        const pInfo = job?.portal_submission_info;
        const isSubmitted = portalPending > 0 || Number(pInfo?.portal_pending_count || 0) > 0;
        if (!isSubmitted) return false;
      } else if (statusFilter === "Active") {
        if (["Done", "Closed", "done", "closed"].includes(job.status)) return false;
      } else if (statusFilter === "Overdue") {
        if (job.status === "Done" || job.status === "Closed") return false;
        if (!job.due_date) return false;
        if (new Date(job.due_date) >= new Date()) return false;
      } else if (statusFilter === "My Tasks") {
        const uid = user?.id;
        const role = (user?.role || "").toLowerCase();
        const isAdminOrFounder = ["admin", "founder"].includes(role) || user?.is_superuser;
        const isMaker = (job.makers || []).includes(uid) || (job.makers_list || []).some((m) => m.id === uid);
        const isChecker = (job.checkers || []).includes(uid) || (job.checkers_list || []).some((c) => c.id === uid);
        const isApproverPending = isAdminOrFounder && job.approver_status?.status === "SENT_TO_APPROVER";

        const portalPending = Number(job?.pending_portal_items_count || 0);
        const pInfo = job?.portal_submission_info;
        const isPortalSubmitted = portalPending > 0 || Number(pInfo?.portal_pending_count || 0) > 0;

        const isMakerPending = isMaker && ["To Do", "In Progress", "Client Docs Pending", "Rework"].includes(job.status);
        const isCheckerPending = isChecker && (["Under Review", "Approved"].includes(job.status) || isPortalSubmitted);

        if (!isMakerPending && !isCheckerPending && !isApproverPending) return false;
      } else if (statusFilter !== "All") {
        if (job.status !== statusFilter) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const clientName = (job.client_name || "").toLowerCase();
        const taskId = (job.task_id || "").toLowerCase();
        const period = (job.period || "").toLowerCase();
        const status = (job.status || "").toLowerCase();
        if (!clientName.includes(q) && !taskId.includes(q) && !period.includes(q) && !status.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [allJobs, statusFilter, searchQuery, user?.id, user?.role, user?.is_superuser]);

  const handleOpenAllJobs = (initialFilter = "All") => {
    setStatusFilter(initialFilter);
    setViewMode("jobs");
    if (!location.pathname.endsWith("/jobs")) {
      navigate("/payroll/jobs");
    }
  };

  const handleBackToDashboard = () => {
    setViewMode("dashboard");
    if (location.pathname.endsWith("/jobs")) {
      navigate("/payroll");
    }
  };

  // Breadcrumb navigation steps
  const breadcrumbSteps = useMemo(() => {
    if (viewMode === "jobs") {
      return [
        { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
        { label: "Monthly Payroll", onClick: handleBackToDashboard },
        { label: "All Jobs" },
      ];
    }
    return [
      { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
      { label: "Monthly Payroll" },
    ];
  }, [viewMode, navigate]);

  // Unified cardConfig for JobCard (Grid and List views)
  const payrollCardConfig = useMemo(
    () => ({
      getName: (job) => job.client_name || "Client Job",
      getSubtitle: (job, compact) => {
        const portalPill = getPortalPill(job);
        if (compact) {
          const makers = job.makers_list || [];
          const checkers = job.checkers_list || [];
          const hasTeam = makers.length > 0 || checkers.length > 0;
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Monthly Payroll · 📅 {job.period || "Current Period"}</span>
              {hasTeam ? (
                <TeamBadges makers={makers} checkers={checkers} />
              ) : (
                <span style={{ fontSize: 10, color: AMB, fontWeight: 600 }}>⚠️ Unassigned Team</span>
              )}
              {portalPill}
            </span>
          );
        }
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Monthly Payroll · 📅 {job.period || "Current Period"}</span>
            {portalPill}
          </span>
        );
      },
      getIdBadge: (job) => job.task_id || `CKPSCA-PAY-${String(job.id).padStart(4, "0")}`,
      getExtraBadge: (job) => {
        const makers = job.makers_list || [];
        const checkers = job.checkers_list || [];
        const hasTeam = makers.length > 0 || checkers.length > 0;
        const portalPill = getPortalPill(job);
        if (!hasTeam || portalPill) {
          return (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {!hasTeam && (
                <span style={{ fontSize: 10, color: AMB, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 2 }}>
                  ⚠️ Unassigned Team
                </span>
              )}
              {portalPill}
            </div>
          );
        }
        return null;
      },
      getAccentColor: (job) => {
        const portalPending = Number(job?.pending_portal_items_count || 0);
        const pInfo = job?.portal_submission_info;
        const isSubmitted = portalPending > 0 || Number(pInfo?.portal_pending_count || 0) > 0;
        if (isSubmitted) return "#A05A00";
        return null;
      },
      getMakers: (job) => job.makers_list || [],
      getCheckers: (job) => job.checkers_list || [],
      getStatus: (job) => job.status,
      statusBadgeMap: PAYROLL_STATUS_MAP,
      getLabel: getPillLabel,
      assignLabelGrid: "M/C",
      assignLabelCompact: "M/C",
      showFooterIfEmpty: true,
    }),
    []
  );

  return (
    <div className="min-h-full p-6 sm:p-8 bg-slate-50 text-slate-900 font-sans">
      {/* ─────────────────────────────────────────────────────────────
          BREADCRUMB (JobUiCommon component)
      ───────────────────────────────────────────────────────────── */}
      <Breadcrumb steps={breadcrumbSteps} />

      {/* ─────────────────────────────────────────────────────────────
          PAGE HEADER
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold m-0 text-slate-900 tracking-tight">
            {viewMode === "jobs" ? "Monthly Payroll Jobs" : "Monthly Payroll"}
          </h1>
          <p className="text-xs text-slate-500 m-0 mt-1">
            {stats.total_jobs} total jobs · {stats.active_jobs} active in pipeline
          </p>
        </div>

        {viewMode === "dashboard" && (
          <div className="flex gap-2.5 items-center flex-wrap">
            <button
              onClick={() => handleOpenAllJobs("All")}
              style={{
                background: P,
                color: WH,
                borderRadius: 10,
                border: "none",
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "inherit",
              }}
            >
              <span>📋</span> All Jobs
            </button>

            {canAccessClientMaster && (
              <button
                onClick={() => navigate("/payroll/workspace")}
                title="Central client master: manage client profiles, employee rosters, salary structures, and portal access"
                style={{
                  background: WH,
                  color: INK,
                  borderRadius: 10,
                  border: `1.5px solid ${BRD}`,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "inherit",
                }}
              >
                🏢 Client Master
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          DASHBOARD VIEW (JobUiCommon StatCard + Panels)
      ───────────────────────────────────────────────────────────── */}
      {viewMode === "dashboard" && (
        <>
          {/* Top 4 Stat Cards in 4-Column Grid using JobUiCommon's StatCard */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 20, alignItems: "stretch" }}>
            {top4StatCards.map((card, idx) => (
              <StatCard
                key={idx}
                label={card.label}
                value={card.value ?? 0}
                color={card.color}
                icon={card.icon}
                sub={card.subtext}
                onClick={() => handleOpenAllJobs(card.filterStatus)}
              />
            ))}
          </div>

          {/* 3 Bottom Summary Panels using JobUiCommon's Panel */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 0 }}>
            {/* Panel 1: PIPELINE STATUS BREAKDOWN (JobUiCommon StatusBreakdown) */}
            <Panel
              title="PIPELINE STATUS BREAKDOWN"
              subtitle="click row to filter"
              height={360}
            >
              <StatusBreakdown
                data={statusBreakdownData}
                onSliceClick={(label) => {
                  const match = pipelineStatuses.find((s) => s.label === label);
                  handleOpenAllJobs(match ? match.filterKey : "All");
                }}
              />
            </Panel>

            {/* Panel 2: MY PENDING TASKS (JobUiCommon Panel + Pill) */}
            <Panel
              title="MY PENDING TASKS"
              count={pendingTasks.length}
              countColor={AMB}
              height={360}
            >
              {pendingTasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: MUT }}>
                  <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>No pending tasks assigned to you</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pendingTasks.slice(0, 8).map((job) => {
                    const roleBadge = getJobRoleBadge(job);
                    return (
                      <div
                        key={job.id}
                        onClick={() => onOpenJob ? onOpenJob(job) : navigate(`/payroll/jobs/${job.id}`)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 11px",
                          borderRadius: 9,
                          border: `1px solid ${BRD}`,
                          background: WH,
                          cursor: "pointer",
                          transition: "all .15s",
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = P;
                          e.currentTarget.style.background = PL;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = BRD;
                          e.currentTarget.style.background = WH;
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: INK,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {job.client_name || "Client Job"}
                          </div>
                          <div style={{ fontSize: 10, color: MUT, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>{job.period || "Current Period"}</span>
                            {roleBadge && (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: roleBadge.bg,
                                  color: roleBadge.color,
                                }}
                              >
                                {roleBadge.text}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          {getPortalPill(job)}
                          <Pill
                            status={job.status}
                            statusBadgeMap={PAYROLL_STATUS_MAP}
                            getLabel={getPillLabel}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* Panel 3: RECENT JOBS (JobUiCommon Panel + TeamBadges + Pill) */}
            <Panel
              title={canAccessClientMaster ? "ALL RECENT JOBS" : "MY RECENT JOBS"}

              height={360}
            >
              {recentJobs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: MUT }}>
                  <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>📂</div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>No recent jobs found</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {recentJobs.slice(0, 8).map((job) => {
                    const makers = job.makers_list || [];
                    const checkers = job.checkers_list || [];
                    const hasTeam = makers.length > 0 || checkers.length > 0;
                    return (
                      <div
                        key={job.id}
                        onClick={() => onOpenJob ? onOpenJob(job) : navigate(`/payroll/jobs/${job.id}`)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 11px",
                          borderRadius: 9,
                          border: `1px solid ${BRD}`,
                          background: WH,
                          cursor: "pointer",
                          transition: "all .15s",
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = P;
                          e.currentTarget.style.background = PL;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = BRD;
                          e.currentTarget.style.background = WH;
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: INK,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {job.client_name || "Client Job"}
                          </div>
                          <div style={{ fontSize: 10, color: MUT, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>
                              {job.period || "Current Period"} · <code>{job.task_id || `JOB-${job.id}`}</code>
                            </span>
                            {hasTeam ? (
                              <TeamBadges makers={makers} checkers={checkers} />
                            ) : (
                              <span style={{ fontSize: 9, color: AMB, fontWeight: 600 }}>⚠️ Unassigned</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          {getPortalPill(job)}
                          <Pill
                            status={job.status}
                            statusBadgeMap={PAYROLL_STATUS_MAP}
                            getLabel={getPillLabel}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          ALL JOBS VIEW (JobUiCommon JobCard for Grid / List)
      ───────────────────────────────────────────────────────────── */}
      {viewMode === "jobs" && (
        <div>
          {/* Controls Bar: Search, Status Filter, Mode Switcher */}
          <div
            style={{
              background: WH,
              borderRadius: 12,
              border: `1.5px solid ${BRD}`,
              padding: "10px 16px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap", minWidth: 260 }}>
              {/* Status Filter Dropdown */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1.5px solid ${BRD}`,
                  fontSize: 13,
                  background: WH,
                  color: INK,
                  outline: "none",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                <option value="All">All statuses ({allJobs.length})</option>
                <option value="Active">Active ({stats.active_jobs})</option>
                <option value="Portal Pending">Portal Pending ({portalPendingJobsCount})</option>
                <option value="To Do">To Do ({stats.todo})</option>
                <option value="In Progress">In Progress ({stats.in_progress})</option>
                <option value="Rework">Rework ({stats.rework || 0})</option>
                <option value="Under Review">Under Review ({stats.under_review || 0})</option>
                <option value="Approved">Approved ({stats.approved || 0})</option>
                <option value="Done">Finalized / Done ({stats.done})</option>
                <option value="Overdue">Overdue ({stats.overdue_jobs})</option>
                <option value="My Tasks">My Pending Tasks ({stats.my_pending_tasks})</option>
              </select>

              {/* Search Input */}
              <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 380 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: MUT }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search client, task ID, period…"
                  style={{
                    width: "100%",
                    padding: "8px 12px 8px 32px",
                    borderRadius: 8,
                    border: `1.5px solid ${BRD}`,
                    fontSize: 13,
                    background: WH,
                    color: INK,
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: MUT,
                      padding: 2,
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {(statusFilter !== "All" || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("All");
                    setSearchQuery("");
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1.5px solid ${BRD}`,
                    background: BG,
                    color: MUT,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  ✕ Clear filters
                </button>
              )}
            </div>

            {/* Right: Count + Grid/List Mode Toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 12, color: MUT, fontWeight: 500 }}>
                {filteredJobs.length} of {allJobs.length} jobs
              </span>

              <div style={{ display: "flex", border: `1.5px solid ${BRD}`, borderRadius: 8, overflow: "hidden", background: WH }}>
                {[
                  { k: "grid", icon: <LayoutGrid size={14} />, label: "Grid" },
                  { k: "list", icon: <ListIcon size={14} />, label: "List" },
                ].map(({ k, icon, label }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setJobListViewMode(k)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "none",
                      background: jobListViewMode === k ? P : WH,
                      color: jobListViewMode === k ? WH : MUT,
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all .15s",
                    }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Jobs Listing */}
          {filteredJobs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "5rem 2rem", color: MUT, background: WH, border: `1.5px solid ${BRD}`, borderRadius: 14 }}>
              <div style={{ fontSize: 36, opacity: 0.25, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>No jobs found</div>
              <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>
                No payroll processing jobs match the selected filters or search terms.
              </div>
              {(statusFilter !== "All" || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("All");
                    setSearchQuery("");
                  }}
                  style={{
                    marginTop: 16,
                    padding: "8px 18px",
                    background: P,
                    color: WH,
                    borderRadius: 8,
                    border: "none",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : jobListViewMode === "grid" ? (
            /* ─── GRID VIEW (JobUiCommon JobCard) ─────────────────── */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14, alignItems: "stretch" }}>
              {filteredJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  cardConfig={payrollCardConfig}
                  onOpen={() => onOpenJob ? onOpenJob(job) : navigate(`/payroll/jobs/${job.id}`)}
                  onAssign={() => setAssignJob(job)}
                  canAssign={canAssignMC}
                />
              ))}
            </div>
          ) : (
            /* ─── LIST VIEW (JobUiCommon JobCard compact) ─────────── */
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  compact
                  cardConfig={payrollCardConfig}
                  onOpen={() => onOpenJob ? onOpenJob(job) : navigate(`/payroll/jobs/${job.id}`)}
                  onAssign={() => setAssignJob(job)}
                  canAssign={canAssignMC}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MAKER / CHECKER ASSIGNMENT MODAL (JobUiCommon AssignModal)
      ───────────────────────────────────────────────────────────── */}
      {assignJob && (
        <AssignModal
          title="Assign Team"
          subtitle={`Assign makers & checkers (max 2 each) · ${assignJob.client_name || "Client Job"}`}
          maxPerRole={2}
          fetchUsers={() => fetchAssignableEmployees(api, "/payroll/jobs/assignable-users/")}
          fetchInitial={() =>
            Promise.resolve({
              makers: (assignJob.makers || assignJob.makers_list || []).map((m) => String(m?.id ?? m)),
              checkers: (assignJob.checkers || assignJob.checkers_list || []).map((c) => String(c?.id ?? c)),
            })
          }
          onSave={async ({ makers, checkers }) => {
            const res = await api.post(`/payroll/jobs/${assignJob.id}/assign-mc/`, {
              maker_ids: makers.map(Number),
              checker_ids: checkers.map(Number),
            });
            return res.data;
          }}
          onClose={() => setAssignJob(null)}
          onSaved={(updated) => {
            setAssignJob(null);
            // Update local state smoothly
            const updateItem = (item) => (item.id === updated.id ? { ...item, ...updated } : item);
            setAllJobs((prev) => prev.map(updateItem));
            setRecentJobs((prev) => prev.map(updateItem));
            setPendingTasks((prev) => prev.map(updateItem));
          }}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   MASTER CONTROLLER: PayrollJobDashboard
   Unified container for Jobs Schedule Dashboard and Job Detail Workspace
   ========================================================================== */
export default function PayrollJobDashboard() {
  const { id: paramId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryJobId = searchParams.get("job");
  const jobId = paramId || queryJobId;
  const navigate = useNavigate();

  const handleBack = () => {
    if (queryJobId) {
      const p = new URLSearchParams(searchParams);
      p.delete("job");
      setSearchParams(p);
    } else {
      navigate("/payroll/jobs");
    }
  };

  if (jobId) {
    return <PayrollJobDetailView jobId={jobId} onBack={handleBack} />;
  }

  return (
    <PayrollJobListView
      onOpenJob={(job) => {
        navigate(`/payroll/jobs/${job.id}`);
      }}
    />
  );
}

export {
  PayrollJobDashboard,
  PayrollJobDetailView as PayrollJobDetail,
  PayrollJobListView as PayrollServiceDashboard,
};
