import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { PuffLoader } from "react-spinners";
import {
  X,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Minus,
  Search,
  Check,
} from "lucide-react";
import { api } from "../../services/api";

// All payroll endpoints live under /api/payroll/... — see hrms_backend/payroll/urls.py
export function apiPath(path) {
  const clean = String(path).replace(/^\/+/, "");
  return `payroll/${clean}`;
}

export { api };

/* ── Scoped Payroll Design Tokens (Consolidated from theme.css) ────────── */
export const PAYROLL_THEME_CSS = `
.payroll-scope {
  --text-strong: #0f172a;
  --text-primary: #1e293b;
  --text-body: #334155;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --text-subtle: #94a3b8;
  --text-tertiary: #94a3b8;
  --text-faint: #cbd5e1;
  --text-white: #ffffff;

  --surface-1: #ffffff;
  --surface-2: #f8fafc;
  --surface-3: #f1f5f9;
  --surface-5: #e2e8f0;
  --surface-8: #cbd5e1;

  --border-1: #f8fafc;
  --border-2: #f1f5f9;
  --border-3: #e2e8f0;
  --border-4: #cbd5e1;
  --border-5: #94a3b8;

  --sidebar-bg: #001f3f;
  --table-header-bg: #f8fafc;
  --modal-panel-bg: #ffffff;

  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-xl: 0 20px 40px rgba(15, 23, 42, 0.16);

  --blue-bg: #eff6ff;
  --blue-bg-subtle: #f5f9ff;
  --blue-bg-strong: #dbeafe;
  --blue-border: #bfdbfe;
  --blue-solid: #2563eb;
  --blue-text: #1d4ed8;
  --blue-text-strong: #1e3a8a;

  --green-bg: #f0fdf4;
  --green-bg-subtle: #f6fef9;
  --green-bg-strong: #dcfce7;
  --green-border: #bbf7d0;
  --green-solid: #16a34a;
  --green-solid-dark: #15803d;
  --green-text: #15803d;
  --green-text-strong: #14532d;

  --amber-bg: #fffbeb;
  --amber-bg-subtle: #fffdf5;
  --amber-bg-strong: #fef3c7;
  --amber-border: #fde68a;
  --amber-solid: #d97706;
  --amber-text: #b45309;
  --amber-text-strong: #92400e;

  --red-bg: #fef2f2;
  --red-bg-subtle: #fffafa;
  --red-bg-strong: #fee2e2;
  --red-border: #fecaca;
  --red-solid: #dc2626;
  --red-text: #b91c1c;
  --red-text-strong: #991b1b;

  --purple-bg: #faf5ff;
  --purple-bg-subtle: #fdfbff;
  --purple-bg-strong: #f3e8ff;
  --purple-border: #e9d5ff;
  --purple-text: #7e22ce;
  --purple-text-strong: #581c87;

  --chip-blue-wash: #eff6ff;
  --chip-blue-icon: #2563eb;
  --chip-green-wash: #f0fdf4;
  --chip-green-icon: #16a34a;
  --chip-amber-wash: #fffbeb;
  --chip-amber-icon: #d97706;
  --chip-purple-wash: #faf5ff;
  --chip-purple-icon: #7e22ce;
  --chip-red-icon: #dc2626;

  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-blur: blur(8px);
}
`;

if (typeof document !== "undefined") {
  const STYLE_ID = "payroll-scope-theme";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PAYROLL_THEME_CSS;
    document.head.appendChild(style);
  }
}

/* ── Shared Payroll Utilities (Consolidated from utils.js) ─────────────── */
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatCurrency(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(value) {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    return dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTenure(hireDate) {
  if (!hireDate) return null;
  let d;
  if (typeof hireDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
    const [y, m, day] = hireDate.split("-");
    d = new Date(Number(y), Number(m) - 1, Number(day));
  } else {
    d = new Date(hireDate);
  }
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  if (d > now) return "Upcoming";

  let years = now.getFullYear() - d.getFullYear();
  let months = now.getMonth() - d.getMonth();
  if (now.getDate() < d.getDate()) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years === 0 && months === 0) return "< 1 mo";
  if (years === 0) return `${months} mo${months > 1 ? "s" : ""}`;
  if (months === 0) return `${years} yr${years > 1 ? "s" : ""}`;
  return `${years} yr${years > 1 ? "s" : ""} ${months} mo${months > 1 ? "s" : ""}`;
}

export function unwrapList(data) {
  if (!data) return [];
  const payload = data?.data !== undefined ? data.data : data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export function useSmartBack(fallback = "/payroll") {
  const navigate = useNavigate();
  return () => {
    if (window.history.length > 2) navigate(-1);
    else navigate(fallback);
  };
}

export function sanitizeFileNamePart(str, fallback = "File") {
  return String(str || fallback).trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function Spinner({ size = "md", className = "" }) {
  const sizeCls = size === "sm" ? "w-4 h-4 border-2" : size === "lg" ? "w-9 h-9 border-[3px]" : "w-7 h-7 border-[3px]";
  return (
    <div
      className={`rounded-full border-blue-500/20 border-t-blue-600 animate-spin ${sizeCls} ${className}`}
      aria-label="Loading"
    />
  );
}

export const PAYROLL_ITEM_REGISTRY = {
  NEW_EMPLOYEE: { key: "NEW_EMPLOYEE", label: "New Employee", emoji: "👤", accent: "#06b6d4", bg: "#eff6ff", border: "#dbeafe", tone: "blue" },
  REVISION:     { key: "REVISION", label: "Salary Revision", emoji: "📈", accent: "#10b981", bg: "#ecfdf5", border: "#d1fae5", tone: "green" },
  EXIT:         { key: "EXIT", label: "Exit / Resignation", emoji: "📕", accent: "#f43f5e", bg: "#fff1f2", border: "#ffe4e6", tone: "red" },
  SALARY_HOLD:  { key: "SALARY_HOLD", label: "Salary Hold", emoji: "⏸️", accent: "#3b82f6", bg: "#fffbeb", border: "#fef3c7", tone: "amber" },
  REIMBURSEMENT:{ key: "REIMBURSEMENT", label: "Reimbursement", emoji: "💳", accent: "#0ea5e9", bg: "#ecfeff", border: "#cffafe", tone: "blue" },
  LOP:          { key: "LOP", label: "Loss of Pay (LOP)", emoji: "📅", accent: "#f43f5e", bg: "#fff1f2", border: "#ffe4e6", tone: "red" },
  ARREARS:      { key: "ARREARS", label: "Salary Arrears", emoji: "⏱️", accent: "#10b981", bg: "#ecfdf5", border: "#d1fae5", tone: "green" },
  TDS:          { key: "TDS", label: "TDS (Income Tax)", emoji: "🧾", accent: "#ef4444", bg: "#fef2f2", border: "#fee2e2", tone: "red", adminOnly: true },
  ADVANCE:      { key: "ADVANCE", label: "Advance / Loan", emoji: "💰", accent: "#f59e0b", bg: "#fffbeb", border: "#fef3c7", tone: "amber" },
  ONE_TIME_EARNING: { key: "ONE_TIME_EARNING", label: "One-time Earning", emoji: "➕", accent: "#8b5cf6", bg: "#f5f3ff", border: "#ede9fe", tone: "purple" },
  ONE_TIME_DEDUCTION: { key: "ONE_TIME_DEDUCTION", label: "One-time Deduction", emoji: "➖", accent: "#ef4444", bg: "#fff1f2", border: "#ffe4e6", tone: "red" },
  CUSTOM_COMPONENT: { key: "CUSTOM_COMPONENT", label: "Custom Component", emoji: "🧩", accent: "#0d9488", bg: "#f0fdfa", border: "#ccfbf1", tone: "green" },
  NOTE:         { key: "NOTE", label: "Note for CA Team", emoji: "💬", accent: "#3b82f6", bg: "#eff6ff", border: "#dbeafe", tone: "blue" },
};

export const PAYROLL_ITEM_LIST = Object.values(PAYROLL_ITEM_REGISTRY);
export const PAYROLL_TYPE_LABEL = Object.fromEntries(PAYROLL_ITEM_LIST.map((t) => [t.key, t.label]));

/* ── Badge ─────────────────────────────────────────────────────────────── */
export const TONE_CLASSES = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-rose-50 text-rose-700 border-rose-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
};

export function Badge({ tone = "slate", className = "", style = {}, children, ...rest }) {
  const toneCls = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${toneCls} ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ── Button ────────────────────────────────────────────────────────────── */
export function Button({ variant = "primary", size = "md", className = "", style, children, ...rest }) {
  const sizeCls = size === "sm" ? "text-xs px-2.5 py-1.5" : "text-sm px-3.5 py-2";
  const isSecondary = String(variant).toLowerCase() === "secondary";
  const base = {
    background: isSecondary ? "var(--surface-2)" : "#001F5B",
    color: isSecondary ? "var(--text-primary)" : "var(--text-white)",
    border: isSecondary ? "1px solid var(--border-3)" : "1px solid transparent",
  };
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${className}`}
      style={{ ...base, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */
const CARD_BORDER_TONE = {
  slate: "var(--border-3)",
  blue: "var(--blue-border)",
  green: "var(--green-border)",
  amber: "var(--amber-border)",
  red: "var(--red-border)",
  purple: "var(--purple-border)",
};

export function Card({ tone, className = "", style = {}, children, ...rest }) {
  const borderColor = tone ? (CARD_BORDER_TONE[tone] || CARD_BORDER_TONE.slate) : undefined;
  const defaultBg = tone ? "var(--glass-bg)" : undefined;
  const hasPadding = /\bp-\d+\b/.test(className);
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${hasPadding ? "" : "p-4"} ${className}`}
      style={{
        ...(defaultBg ? { background: defaultBg, backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)" } : {}),
        ...(borderColor ? { borderColor } : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── ErrorState ────────────────────────────────────────────────────────── */
export function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ color: "var(--text-muted)" }}>
      <AlertTriangle size={28} style={{ color: "var(--red-solid)" }} />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────── */
export function Skeleton({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: "var(--surface-3)" }}
    />
  );
}

/* ── Modal ─────────────────────────────────────────────────────────────── */
export function Modal({
  title,
  onClose,
  size = "m",
  width,
  height,
  maxWidth = "",
  zIndex = 1300,
  footer,
  overlayClassName = "",
  panelClassName = "",
  children,
}) {
  const isWide = panelClassName.includes("modal-panel-wide") || panelClassName.includes("max-w-");
  const sizeWidth = maxWidth || width || (isWide ? "max-w-4xl" : size === "xl" ? "max-w-4xl" : size === "l" ? "max-w-3xl" : size === "s" ? "max-w-sm" : "max-w-xl");
  const panelHeight = height || (panelClassName.includes("h-") ? "" : "max-h-[90vh]");

  // Keyboard accessibility - Escape key listener
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`payroll-scope fixed inset-0 flex items-center justify-center p-4 animate-in fade-in duration-150 ${overlayClassName}`.trim()}
      style={{
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex,
      }}
      onClick={onClose}
    >
      <div
        className={`w-full ${sizeWidth} ${panelHeight} bg-white rounded-2xl p-5 sm:p-6 flex flex-col border border-slate-200/90 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.35),0_0_0_1px_rgba(15,23,42,0.06)] animate-in zoom-in-95 duration-150 ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        style={{
          background: "#ffffff",
          backgroundColor: "#ffffff",
          width: width || undefined,
          maxWidth: (maxWidth || width) || undefined,
          height: height || undefined,
          maxHeight: height || "calc(100vh - 2rem)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 shrink-0">
          <div className="text-base font-semibold" style={{ color: "var(--text-strong, #0f172a)" }}>
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors border-none bg-transparent"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0"
          style={
            height
              ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }
              : { overflowY: "auto", minHeight: 0, paddingRight: 4 }
          }
        >
          {children}
        </div>
        {footer && (
          <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end gap-2 shrink-0 bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ── SearchableEmployeeSelect Combobox ─────────────────────────────────── */
export function SearchableEmployeeSelect({
  employees = [],
  value,
  onChange,
  placeholder = "Search employee by name, code, or department…",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const wrapperRef = useRef(null);

  const selectedEmp = useMemo(() => {
    if (!value) return null;
    return employees.find((e) => String(e.id) === String(value)) || null;
  }, [employees, value]);

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase().trim();
    return employees.filter((e) => {
      const name = `${e.first_name || ""} ${e.last_name || ""}`.toLowerCase();
      const code = (e.employee_code || "").toLowerCase();
      const dept = (e.department || "").toLowerCase();
      const pos = (e.position || "").toLowerCase();
      return name.includes(q) || code.includes(q) || dept.includes(q) || pos.includes(q);
    });
  }, [employees, searchQuery]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* Trigger Bar */}
      <div
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-between px-2.5 py-1 rounded-lg bg-white cursor-pointer min-h-[33px] transition-all duration-150 ${
          isOpen
            ? "border-[1.5px] border-blue-600 ring-2 ring-blue-600/15"
            : "border border-slate-300"
        }`}
      >
        {selectedEmp ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10.5px] font-bold flex-shrink-0">
              {selectedEmp.employee_code || "EMP"}
            </span>
            <span className="text-xs font-semibold text-slate-900 truncate">
              {[selectedEmp.first_name, selectedEmp.last_name].filter(Boolean).join(" ")}
            </span>
            {(selectedEmp.department || selectedEmp.position) && (
              <span className="text-[11px] text-slate-500 truncate">
                ({selectedEmp.department || selectedEmp.position})
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-slate-400 text-[11.5px]">
            <Search size={13} className="text-slate-400" />
            <span>{placeholder}</span>
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {selectedEmp && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSearchQuery("");
              }}
              className="p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors"
              title="Clear selection"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`text-slate-500 transition-transform duration-150 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white rounded-lg border border-slate-300 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.05)] z-[1400] overflow-hidden flex flex-col max-h-[220px]">
          {/* Search Input Box */}
          <div className="px-2 py-1.5 border-b border-slate-100 bg-slate-50 flex items-center gap-1.5">
            <Search size={13} className="text-slate-400 flex-shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, code, or department…"
              className="border-none bg-transparent w-full text-[11.5px] text-slate-900 outline-none placeholder:text-slate-400"
              onClick={(e) => e.stopPropagation()}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Results List */}
          <div className="overflow-y-auto flex-1 max-h-[175px]">
            {filteredEmployees.length === 0 ? (
              <div className="p-3 text-center text-slate-400 text-[11.5px]">
                No matching staff found
              </div>
            ) : (
              filteredEmployees.map((e) => {
                const isSelected = String(e.id) === String(value);
                const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
                return (
                  <div
                    key={e.id}
                    onClick={() => {
                      onChange(e.id);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className={`px-2.5 py-1.5 flex items-center justify-between cursor-pointer border-b border-slate-50 transition-colors duration-150 ${
                      isSelected
                        ? "bg-blue-50 font-bold"
                        : "hover:bg-slate-100 font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                          isSelected ? "bg-blue-200 text-blue-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {e.employee_code || "EMP"}
                      </span>
                      <span className="text-xs text-slate-900 truncate">{name}</span>
                      {(e.department || e.position) && (
                        <span className="text-[10.5px] text-slate-500 truncate">
                          • {e.department || e.position}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={14} className="text-blue-600 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inputs ────────────────────────────────────────────────────────────── */
export const Input = forwardRef(function Input({ className = "", style, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${className}`}
      style={{ border: "1px solid var(--border-4)", background: "var(--surface-1)", color: "var(--text-primary)", ...style }}
      {...rest}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = "", style, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${className}`}
      style={{ border: "1px solid var(--border-4)", background: "var(--surface-1)", color: "var(--text-primary)", ...style }}
      {...rest}
    />
  );
});

export function IconBtn({ title, onClick, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition-colors"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)" }}
    >
      {children}
    </button>
  );
}

/* ── EmptyState ────────────────────────────────────────────────────────── */
export function EmptyState({ emoji = "📭", message = "Nothing here yet." }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <span style={{ fontSize: 32 }}>{emoji}</span>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {message}
      </p>
    </div>
  );
}

/* ── Table Header Style ────────────────────────────────────────────────── */
export const tableHeaderRowStyle = {
  background: "var(--table-header-bg)",
  borderBottom: "1px solid var(--border-3)",
};

/* ── WorkspaceHeader ───────────────────────────────────────────────────── */
export function WorkspaceHeader({ title, companyName, subtitle, onBack, actions }) {
  const displayTitle = title || companyName;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-2 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-lg p-1.5"
            style={{ border: "1px solid var(--border-3)", background: "var(--surface-1)" }}
            aria-label="Back"
          >
            <ArrowLeft size={16} style={{ color: "var(--text-primary)" }} />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate" style={{ color: "var(--text-strong)" }}>
            {displayTitle}
          </h2>
          {subtitle && (
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/* ── Pagination ────────────────────────────────────────────────────────── */
export function Pagination({ currentPage, totalPages, pageSize, totalCount, onPageChange, noun = "items" }) {
  if (!totalPages || totalPages <= 1) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalCount);

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
      style={{ borderTop: "1px solid var(--border-3)", color: "var(--text-muted)" }}
    >
      <span>
        {start}-{end} of {totalCount} {noun}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-md px-2 py-1 disabled:opacity-40"
          style={{ border: "1px solid var(--border-3)" }}
        >
          Prev
        </button>
        <span>
          {currentPage} / {totalPages}
        </span>
        <button
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-md px-2 py-1 disabled:opacity-40"
          style={{ border: "1px solid var(--border-3)" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ── Breadcrumb ────────────────────────────────────────────────────────── */
export function Breadcrumb({ items = [] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] w-fit self-start"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-3)",
        fontSize: "13px",
        lineHeight: "1.2",
      }}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-2" style={{ fontSize: "13px", lineHeight: "1.2" }}>
            {i > 0 && (
              <span style={{ color: "var(--text-faint)", userSelect: "none", fontSize: "13px" }} aria-hidden="true">
                ›
              </span>
            )}
            {item.icon && <span style={{ fontSize: "13px" }}>{item.icon}</span>}
            {item.onClick && !isLast ? (
              <button
                type="button"
                onClick={item.onClick}
                title={`Go to ${typeof item.label === "string" ? item.label : "page"}`}
                className="transition-all hover:text-blue-700 hover:underline"
                style={{
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                  fontSize: "13px",
                  lineHeight: "1.2",
                  fontWeight: 500,
                  padding: 0,
                }}
              >
                {item.label}
              </button>
            ) : (
              <span
                style={{
                  color: isLast ? "var(--text-strong)" : "var(--text-muted)",
                  fontWeight: isLast ? 600 : 400,
                  fontSize: "13px",
                  lineHeight: "1.2",
                }}
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* ── GlassDropdown ─────────────────────────────────────────────────────── */
export function GlassDropdown({ value, onChange, options = [], placeholder = "Select", width = "w-40" }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (
        ref.current && !ref.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open || !ref.current) return;
    const updateRect = () => setRect(ref.current.getBoundingClientRect());
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${width}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between rounded-lg px-3 text-sm"
        style={{ background: "var(--border-1)", border: "1px solid var(--border-4)", color: "var(--text-primary)" }}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          className="payroll-scope overflow-hidden rounded-lg"
          style={{
            position: "fixed",
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            zIndex: 1200, // Elevated above global sticky header (1001) per AGENTS.md §5.3
            background: "var(--surface-1)",
            border: "1px solid var(--border-3)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <button
            className="block w-full px-3 py-2 text-left text-sm"
            style={{ color: "var(--text-muted)" }}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              className="block w-full px-3 py-2 text-left text-sm"
              style={{ color: "var(--text-primary)" }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── ClientLogo & Helpers ──────────────────────────────────────────────── */
const WASHES = [
  { bg: "var(--blue-bg-strong)", fg: "var(--blue-text)" },
  { bg: "var(--green-bg-strong)", fg: "var(--green-text)" },
  { bg: "var(--amber-bg-strong)", fg: "var(--amber-text)" },
  { bg: "var(--purple-bg-strong)", fg: "var(--purple-text)" },
  { bg: "var(--red-bg-strong)", fg: "var(--red-text)" },
];

export function clientInitials(name) {
  const words = String(name || "")
    .replace(/[^\p{L}\p{N}\s&.-]/gu, " ")
    .split(/[\s.&-]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function washFor(name) {
  const key = String(name || "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 9973;
  return WASHES[hash % WASHES.length];
}

export function ClientLogo({ name, logo, size = 40, rounded = 12, className = "" }) {
  const wash = washFor(name);
  const box = {
    width: size,
    height: size,
    borderRadius: rounded,
    border: "1px solid var(--border-3)",
    flexShrink: 0,
    overflow: "hidden",
  };

  if (logo) {
    return (
      <img
        src={logo}
        alt={name ? `${name} logo` : "Client logo"}
        className={`shrink-0 object-contain select-none ${className}`}
        style={{
          height: size,
          maxWidth: Math.round(size * 2.5),
          width: "auto",
        }}
        loading="lazy"
        title={name || ""}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center font-semibold ${className}`}
      style={{
        ...box,
        background: wash.bg,
        color: wash.fg,
        fontSize: Math.max(11, Math.round(size * 0.36)),
        letterSpacing: 0.3,
      }}
      title={name || ""}
      aria-label={name || "Client"}
    >
      {clientInitials(name)}
    </div>
  );
}




/* ── ConfirmDialog ─────────────────────────────────────────────────────── */
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((options) => {
    setState(options);
  }, []);

  const close = () => setState(null);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.5)", zIndex: 1350 }}
          onClick={close}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: "var(--modal-panel-bg)", boxShadow: "var(--shadow-xl)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-strong)" }}>
              {state.title || "Are you sure?"}
            </h3>
            {state.description && (
              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                {state.description}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                style={state.variant === "danger" ? { background: "var(--red-solid)" } : undefined}
                onClick={async () => {
                  close();
                  if (state.onConfirm) await state.onConfirm();
                }}
              >
                {state.confirmLabel || "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Falls back to a no-provider-mounted confirm so pages don't crash if
    // used outside <ConfirmProvider> — logs instead of blocking silently.
    return (options) => {
      // eslint-disable-next-line no-console
      console.warn("useConfirm() used outside <ConfirmProvider>", options);
      if (options?.onConfirm) options.onConfirm();
    };
  }
  return ctx;
}

/* ── MonthYearPicker ───────────────────────────────────────────────────── */
export function MonthYearPicker({ month, year, onChange }) {
  const [viewYear, setViewYear] = useState(year);
  const [mode, setMode] = useState("month"); // "month" | "year"

  // decade base: floor to nearest 12
  const decadeBase = Math.floor(viewYear / 12) * 12;
  const yearGrid = Array.from({ length: 12 }, (_, i) => decadeBase + i);

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)" }}>
      {/* nav row */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={() => mode === "month" ? setViewYear((y) => y - 1) : setViewYear((y) => y - 12)}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
          style={{ background: "var(--border-1)", border: "1px solid var(--border-3)", color: "var(--text-secondary)" }}
        >
          <ChevronLeft size={14} />
        </button>

        <button
          type="button"
          onClick={() => setMode((m) => m === "month" ? "year" : "month")}
          className="text-sm font-semibold px-2 py-0.5 rounded-lg transition-colors"
          style={{
            color: "var(--text-primary)",
            background: mode === "year" ? "var(--blue-bg)" : "transparent",
            border: mode === "year" ? "1px solid var(--blue-border)" : "1px solid transparent",
          }}
        >
          {mode === "month" ? viewYear : `${decadeBase} – ${decadeBase + 11}`}
        </button>

        <button
          type="button"
          onClick={() => mode === "month" ? setViewYear((y) => y + 1) : setViewYear((y) => y + 12)}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
          style={{ background: "var(--border-1)", border: "1px solid var(--border-3)", color: "var(--text-secondary)" }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {mode === "month" ? (
        <div className="grid grid-cols-4 gap-1.5">
          {MONTHS.map((m, i) => {
            const isSelected = i + 1 === month && viewYear === year;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange(i + 1, viewYear)}
                className={`rounded-lg py-1.5 text-xs font-medium transition-all myp-btn ${isSelected ? "is-selected" : ""}`}
                style={{
                  background: isSelected ? "var(--blue-border)" : "var(--surface-2)",
                  border: isSelected ? "1px solid var(--blue-border)" : "1px solid var(--border-2)",
                  color: isSelected ? "var(--blue-text-strong)" : "var(--text-muted)",
                }}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {yearGrid.map((y) => {
            const isSelected = y === year;
            return (
              <button
                key={y}
                type="button"
                onClick={() => { setViewYear(y); setMode("month"); }}
                className={`rounded-lg py-1.5 text-xs font-medium transition-all myp-btn ${isSelected ? "is-selected" : ""}`}
                style={{
                  background: isSelected ? "var(--blue-border)" : "var(--surface-2)",
                  border: isSelected ? "1px solid var(--blue-border)" : "1px solid var(--border-2)",
                  color: isSelected ? "var(--blue-text-strong)" : "var(--text-muted)",
                }}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── PageHero ──────────────────────────────────────────────────────────── */
/**
 * pages/payroll/PageHero.jsx
 *
 * Dark navy hero banner with an eyebrow label, title, subtitle, and a
 * right-aligned action slot — with a row of white stat cards that
 * overlap the bottom edge of the banner. Matches the visual language of
 * the reference "Reimbursements" screen (dark header + floating stat
 * cards + rounded white content cards below), reused across the payroll
 * pages instead of the flatter WorkspaceHeader look.
 */
export function PageHero({ eyebrow, title, subtitle, onBack, action, stats = [] }) {
  return (
    <div>
      <div
        className="relative overflow-hidden rounded-2xl px-6 pt-6"
        style={{
          background: "linear-gradient(135deg, #0b1220 0%, #0f1c3f 60%, #12224a 100%)",
          paddingBottom: stats.length ? 56 : 24,
        }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(96,165,250,0.12) 0%, transparent 70%)" }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className="mt-1 flex items-center justify-center rounded-lg p-1.5"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                aria-label="Back"
              >
                <ArrowLeft size={16} color="#fff" />
              </button>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {eyebrow}
                </p>
              )}
              <h1 className="text-2xl font-bold truncate" style={{ color: "#fff" }}>
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </div>

      {stats.length > 0 && (
        <div
          className="grid gap-4 px-1"
          style={{
            marginTop: -40,
            gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="relative rounded-xl p-4"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-3)", boxShadow: "var(--shadow-md)" }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                    {s.label}
                  </p>
                  <p className="text-2xl font-bold mt-1" style={{ color: "var(--text-strong)" }}>
                    {s.value}
                  </p>
                  {s.hint && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {s.hint}
                    </p>
                  )}
                </div>
                {s.icon && (
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{ background: `var(--chip-${s.tone || "blue"}-wash)`, color: `var(--chip-${s.tone || "blue"}-icon)` }}
                  >
                    <s.icon size={18} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────────────────── */
const CARD_ICON_WASH_TONE = {
  slate: { background: "var(--surface-3)", color: "var(--text-secondary)" },
  blue: { background: "var(--chip-blue-wash)", color: "var(--chip-blue-icon)" },
  amber: { background: "var(--chip-amber-wash)", color: "var(--chip-amber-icon)" },
  green: { background: "var(--chip-green-wash)", color: "var(--chip-green-icon)" },
  red: { background: "var(--red-bg)", color: "var(--chip-red-icon)" },
  purple: { background: "var(--chip-purple-wash)", color: "var(--chip-purple-icon)" },
};

const STAT_CARD_BORDER_TONE = {
  slate: "var(--border-3)",
  blue: "var(--blue-border)",
  amber: "var(--amber-border)",
  green: "var(--green-border)",
  red: "var(--red-border)",
  purple: "var(--purple-border)",
};

const CARD_TOP_BORDER_HOVER_TONE = {
  slate: "var(--border-5)",
  blue: "var(--blue-solid)",
  amber: "var(--amber-solid)",
  green: "var(--green-solid)",
  red: "var(--red-solid)",
  purple: "var(--purple-text)",
};

export function StatCard({ icon: Icon, label, value, tone, accent, compact, active, highlight, onClick, ...rest }) {
  const resolvedTone = accent || tone || "blue";
  const borderColor = STAT_CARD_BORDER_TONE[resolvedTone] || STAT_CARD_BORDER_TONE.blue;
  const topBorderHoverColor = CARD_TOP_BORDER_HOVER_TONE[resolvedTone] || CARD_TOP_BORDER_HOVER_TONE.blue;
  const iconWash = CARD_ICON_WASH_TONE[resolvedTone] || CARD_ICON_WASH_TONE.blue;
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl transition-colors ${compact ? "p-3" : "p-4"}`}
      style={{
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: `1px solid ${borderColor}`,
        borderTop: `1px solid ${borderColor}`,
        boxShadow: active ? `0 0 0 2px ${borderColor}` : undefined,
        cursor: onClick ? "pointer" : "default",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderTop = `3px solid ${topBorderHoverColor}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderTop = `1px solid ${borderColor}`; }}
      {...rest}
    >
      {Icon && (
        <span
          className="flex items-center justify-center rounded-lg p-2"
          style={iconWash}
        >
          <Icon size={compact ? 16 : 18} />
        </span>
      )}
      <div className="min-w-0">
        <div className={`${compact ? "text-base" : "text-lg"} font-semibold truncate`} style={{ color: "var(--text-strong)" }}>
          {value}
          {highlight && (
            <span
              className="inline-block rounded-full ml-1.5"
              style={{ width: 6, height: 6, background: borderColor, verticalAlign: "middle" }}
            />
          )}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
      </div>
    </div>
  );
}

/* ── PayrollDialog ─────────────────────────────────────────────────────── */
/**
 * Enterprise Payroll Modal Dialog (Confirm, Prompt & Alert)
 * 
 * Replaces native browser window.confirm, window.prompt, and alert with an
 * accessible, keyboard-ergonomic, glassmorphic in-app dialog card.
 *
 * @param {boolean} isOpen Whether dialog is visible
 * @param {'confirm'|'prompt'|'alert'} type Dialog behavior mode
 * @param {string} title Dialog header title
 * @param {string|React.ReactNode} message Descriptive prompt/message body
 * @param {'primary'|'danger'|'warning'|'success'} variant Color styling scheme
 * @param {string} confirmText Label on affirmative button
 * @param {string} cancelText Label on dismissal button
 * @param {string} defaultValue Initial text value for prompt inputs
 * @param {string} placeholder Input placeholder for prompt inputs
 * @param {boolean} multiline Whether prompt renders a textarea instead of single-line input
 * @param {boolean} loading Disables buttons and shows spinner while processing
 * @param {number} zIndex Layer stacking order (defaults to 1350, above all modals)
 * @param {(value?: string) => void} onConfirm Callback when user confirms
 * @param {() => void} onCancel Callback when user cancels or dismisses
 */
export function PayrollDialog({
  isOpen,
  type = "confirm",
  title = "Confirmation Required",
  message = "",
  variant = "primary",
  confirmText,
  cancelText = "Cancel",
  defaultValue = "",
  placeholder = "",
  multiline = false,
  loading = false,
  zIndex = 1350,
  onConfirm,
  onCancel,
}) {
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef(null);

  // Synchronize defaultValue whenever dialog opens
  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultValue || "");
      // Option 1: Auto-focus the input on prompt dialogs
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (typeof inputRef.current.select === "function") {
            inputRef.current.select();
          }
        }
      }, 50);
    }
  }, [isOpen, defaultValue, type]);

  // Option 1: Keyboard ergonomics (Escape to cancel, Enter to submit for single-line)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!loading && onCancel) onCancel();
      } else if (e.key === "Enter" && !multiline && type !== "alert") {
        if (e.target.tagName !== "BUTTON") {
          e.preventDefault();
          if (!loading && onConfirm) onConfirm(inputValue);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, multiline, type, inputValue, onConfirm, onCancel]);

  if (!isOpen) return null;

  // Visual Scheme Tokens
  const schemes = {
    primary: {
      icon: <HelpCircle size={22} style={{ color: "#1d4ed8" }} />,
      iconBg: "#eff6ff",
      iconBorder: "#bfdbfe",
      confirmBg: "#1d4ed8",
      confirmHover: "#1e40af",
      confirmText: "#ffffff",
      defaultConfirm: "Confirm",
    },
    danger: {
      icon: <AlertTriangle size={22} style={{ color: "#dc2626" }} />,
      iconBg: "#fef2f2",
      iconBorder: "#fecaca",
      confirmBg: "#dc2626",
      confirmHover: "#b91c1c",
      confirmText: "#ffffff",
      defaultConfirm: "Delete",
    },
    warning: {
      icon: <AlertCircle size={22} style={{ color: "#d97706" }} />,
      iconBg: "#fffbeb",
      iconBorder: "#fde68a",
      confirmBg: "#d97706",
      confirmHover: "#b45309",
      confirmText: "#ffffff",
      defaultConfirm: "Proceed",
    },
    success: {
      icon: <CheckCircle2 size={22} style={{ color: "#059669" }} />,
      iconBg: "#ecfdf5",
      iconBorder: "#a7f3d0",
      confirmBg: "#059669",
      confirmHover: "#047857",
      confirmText: "#ffffff",
      defaultConfirm: "Apply",
    },
  };

  const scheme = schemes[variant] || schemes.primary;
  const resolvedConfirmLabel =
    confirmText || (type === "alert" ? "Understood" : scheme.defaultConfirm);

  const handleAffirmative = () => {
    if (loading) return;
    if (onConfirm) {
      if (type === "prompt") {
        onConfirm(inputValue);
      } else {
        onConfirm();
      }
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="payroll-scope"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payroll-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        // Option 2: Modern subtle backdrop blur
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        animation: "payrollDialogFadeIn 0.15s ease-out",
      }}
      onClick={() => {
        if (!loading && onCancel) onCancel();
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 14,
          width: "min(480px, 94vw)",
          boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.8)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "payrollDialogScaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: "18px 20px 14px 20px",
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: scheme.iconBg,
              border: `1px solid ${scheme.iconBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {scheme.icon}
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <h3
              id="payroll-dialog-title"
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h3>
            {message && (
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#475569",
                  marginTop: 6,
                  wordBreak: "break-word",
                }}
              >
                {message}
              </div>
            )}
          </div>

          {!loading && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 4,
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.15s ease",
              }}
              title="Close (Esc)"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Prompt Input Form Field */}
        {type === "prompt" && (
          <div style={{ padding: "0 20px 16px 20px" }}>
            {multiline ? (
              <textarea
                ref={inputRef}
                rows={3}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={placeholder}
                disabled={loading}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 8,
                  border: "1.5px solid #cbd5e1",
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "#0f172a",
                  outline: "none",
                  fontFamily: "inherit",
                  resize: "vertical",
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#2563eb";
                  e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#cbd5e1";
                  e.target.style.boxShadow = "none";
                }}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={placeholder}
                disabled={loading}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 8,
                  border: "1.5px solid #cbd5e1",
                  padding: "9px 12px",
                  fontSize: 13,
                  color: "#0f172a",
                  outline: "none",
                  fontFamily: "inherit",
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#2563eb";
                  e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#cbd5e1";
                  e.target.style.boxShadow = "none";
                }}
              />
            )}
          </div>
        )}

        {/* Action Buttons Footer */}
        <div
          style={{
            padding: "12px 20px 16px 20px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          {type !== "alert" && (
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              style={{
                padding: "8px 16px",
                borderRadius: 7,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            onClick={handleAffirmative}
            disabled={loading}
            style={{
              padding: "8px 18px",
              borderRadius: 7,
              border: "none",
              background: scheme.confirmBg,
              color: scheme.confirmText,
              fontSize: 13,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
              transition: "all 0.15s ease",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            <span>{resolvedConfirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Ledger Adjustment Primitive Modal & Helpers ────────────────────────── */
export const LEDGER_TYPE_CONFIG = {
  comp_off: { label: "Comp-Off", endpoint: "comp-off-adjustments/", unit: "days", grantWord: "Grant", deductWord: "Deduct" },
  leave: { label: "Leave", endpoint: "leave-adjustments/", unit: "days", grantWord: "Grant", deductWord: "Deduct" },
  salary_advance: { label: "Salary Advance", endpoint: "salary-advance-adjustments/", unit: "₹", grantWord: "Grant Advance", deductWord: "Record Recovery" },
  on_hold: { label: "On-Hold", endpoint: "on-hold-adjustments/", unit: "₹", grantWord: "Put On Hold", deductWord: "Release" },
};
const TYPE_CONFIG = LEDGER_TYPE_CONFIG;

export function formatBalanceValue(value, isMoney) {
  const num = Number(value) || 0;
  return isMoney
    ? `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${num.toFixed(2)} days`;
}

export function LedgerAdjustmentModal({ employee, type, onClose, closingBalance = 0, pendingTotal = 0, zIndex = 1350 }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.leave;
  const isMoney = config.unit === "₹";
  const isSalaryAdvance = type === "salary_advance";
  const effectiveBalance = Number(closingBalance || 0) + Number(pendingTotal || 0);

  const [direction, setDirection] = useState("grant"); // "grant" | "deduct"
  const [advanceMode, setAdvanceMode] = useState("one_time"); // "one_time" | "emi" — salary_advance grants only
  const [amount, setAmount] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEmiGrant = isSalaryAdvance && direction === "grant" && advanceMode === "emi";

  const submit = async () => {
    if (!amount || Number(amount) <= 0 || !reason.trim()) {
      setError("A positive amount and reason are both required.");
      return;
    }
    if (isEmiGrant && (!tenureMonths || Number(tenureMonths) < 1)) {
      setError("Number of months is required for an EMI plan.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isEmiGrant) {
        await api.post(apiPath("salary-advances/"), {
          employee: employee?.id,
          total_amount: amount,
          tenure_months: tenureMonths,
          reason: reason.trim(),
        });
        onClose({ saved: true, amount: Number(amount) || 0, isEmi: true, type });
      } else {
        const signedAmount = direction === "deduct" ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
        await api.post(apiPath(config.endpoint), {
          employee: employee?.id,
          amount: signedAmount,
          reason: reason.trim(),
        });
        onClose({ saved: true, amount: signedAmount, isEmi: false, type });
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save adjustment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Adjust ${config.label} Balance`} onClose={onClose} size="s" zIndex={zIndex}>
      <div className="flex flex-col gap-3">
        {/* Staff Identity & Ledger Chip */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-900 text-xs font-medium">
          <span className="font-extrabold text-blue-700">{employee?.employee_code || employee?.code || "EMP"}</span>
          <span className="opacity-40">•</span>
          <span className="font-semibold text-slate-800">{employee?.full_name || employee?.name || "Employee"}</span>
          <span className="opacity-40">•</span>
          <span className="text-[11px] text-blue-600 font-bold uppercase">{config.label} Ledger</span>
        </div>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Choose whether to {config.grantWord.toLowerCase()} or {config.deductWord.toLowerCase()}, then enter the
          amount. Takes effect on the next payroll batch.
        </p>

        <div
          className="rounded-lg px-3 py-2 flex items-center justify-between"
          style={{ border: "1px solid var(--border-4)", background: "var(--surface-2)" }}
        >
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Current {config.label} Balance
          </span>
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-strong)" }}>
            {formatBalanceValue(effectiveBalance, isMoney)}
          </span>
        </div>
        {pendingTotal !== 0 && (
          <p className="text-[10px] -mt-2" style={{ color: "var(--amber-text-strong)" }}>
            Includes {formatBalanceValue(pendingTotal, isMoney)} from adjustments not yet applied to a batch.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("grant")}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
            style={{
              border: `1px solid ${direction === "grant" ? "var(--green-border)" : "var(--border-4)"}`,
              background: direction === "grant" ? "var(--green-bg-subtle)" : "var(--surface-1)",
              color: direction === "grant" ? "var(--green-text-strong)" : "var(--text-secondary)",
            }}
          >
            <Plus size={13} /> {config.grantWord}
          </button>
          <button
            type="button"
            onClick={() => setDirection("deduct")}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
            style={{
              border: `1px solid ${direction === "deduct" ? "var(--red-border)" : "var(--border-4)"}`,
              background: direction === "deduct" ? "var(--red-bg-subtle)" : "var(--surface-1)",
              color: direction === "deduct" ? "var(--red-text-strong)" : "var(--text-secondary)",
            }}
          >
            <Minus size={13} /> {config.deductWord}
          </button>
        </div>

        {isSalaryAdvance && direction === "grant" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAdvanceMode("one_time")}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                border: `1px solid ${advanceMode === "one_time" ? "var(--blue-border)" : "var(--border-4)"}`,
                background: advanceMode === "one_time" ? "var(--blue-bg-subtle)" : "var(--surface-1)",
                color: advanceMode === "one_time" ? "var(--blue-text-strong)" : "var(--text-secondary)",
              }}
            >
              One-Time
            </button>
            <button
              type="button"
              onClick={() => setAdvanceMode("emi")}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                border: `1px solid ${advanceMode === "emi" ? "var(--blue-border)" : "var(--border-4)"}`,
                background: advanceMode === "emi" ? "var(--blue-bg-subtle)" : "var(--surface-1)",
                color: advanceMode === "emi" ? "var(--blue-text-strong)" : "var(--text-secondary)",
              }}
            >
              EMI (Monthly)
            </button>
          </div>
        )}

        <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {isMoney ? "Amount (₹)" : "Amount (days)"}
        </label>
        <input
          type="number"
          min="0"
          step={isMoney ? "1" : "0.5"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter a positive amount"
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={{ border: "1px solid var(--border-4)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />

        {isEmiGrant && (
          <>
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Number of Months
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={tenureMonths}
              onChange={(e) => setTenureMonths(e.target.value)}
              placeholder="e.g. 6"
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--border-4)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            />
            {amount && tenureMonths > 0 && (
              <div className="rounded-lg p-2.5 text-xs bg-blue-50/80 border border-blue-200 text-blue-900 flex items-center justify-between">
                <span>Monthly Deduction:</span>
                <span className="font-bold tabular-nums text-blue-700">
                  ≈ ₹{(Number(amount) / Number(tenureMonths)).toFixed(2)} / month for {tenureMonths} mo
                </span>
              </div>
            )}
          </>
        )}

        <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Reason
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={{ border: "1px solid var(--border-4)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        />

        {error && (
          <p className="text-xs" style={{ color: "var(--red-text)" }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save Adjustment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


/* ── Payroll Sub-Router & Lazy Routes ──────────────────────────────────── */

const PayrollJobDashboard = lazy(() => import("./pages/PayrollJobDashboard"));
const PayrollJobBatchReview = lazy(() => import("./pages/PayrollJobBatchReview"));
const PayrollWorkspace = lazy(() => import("./pages/PayrollWorkspace"));
const ClientWorkspace = lazy(() => import("./pages/PayrollWorkspace").then((m) => ({ default: m.ClientWorkspace })));
const BatchReviewRedirect = lazy(() => import("./pages/PayrollWorkspace").then((m) => ({ default: m.BatchReviewRedirect })));
const EmployeeWorkspace = lazy(() => import("./pages/PayrollWorkspace").then((m) => ({ default: m.EmployeeWorkspace })));
const PortalAdmin = lazy(() => import("./pages/PayrollWorkspace").then((m) => ({ default: m.PortalAdmin })));

const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
    <PuffLoader color="#001F5B" size={48} />
  </div>
);

/**
 * pages/payroll/PayrollRoutes.jsx
 *
 * Mounts every payroll sub-page internally, so App.js only needs one line:
 *   <Route path="/payroll/*" element={<PrivateRoute ...><PayrollRoutes /></PrivateRoute>} />
 * Paths here are RELATIVE to that mount point (no leading "/payroll"),
 * since this is itself nested under "/payroll/*" in the parent router.
 */
export default function PayrollRoutes() {
  return (
    <div className="payroll-scope min-h-full">
      <ConfirmProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<PayrollJobDashboard />} />
            <Route path="jobs" element={<PayrollJobDashboard />} />
            <Route path="jobs/:id" element={<PayrollJobDashboard />} />
            <Route path="jobs/:id/review" element={<PayrollJobBatchReview />} />
            <Route path="workspace" element={<PayrollWorkspace />} />
            <Route path="clients/:id" element={<ClientWorkspace />} />
            <Route path="batches/:id" element={<BatchReviewRedirect />} />
            <Route path="firm-details" element={<PayrollWorkspace initialView="clients" />} />
            <Route path="employees" element={<Navigate to="/payroll/workspace" replace />} />
            <Route path="employees/:id" element={<EmployeeWorkspace />} />
            <Route path="email-logs" element={<Navigate to="/payroll/workspace" replace />} />
            <Route path="email-logs/:batchId" element={<Navigate to="/payroll/workspace" replace />} />
            <Route path="portal" element={<PortalAdmin />} />
            <Route path="portal-users" element={<PortalAdmin />} />
          </Routes>
        </Suspense>
      </ConfirmProvider>
    </div>
  );
}