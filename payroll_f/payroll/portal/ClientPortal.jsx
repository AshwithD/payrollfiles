import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  Modal,
  Card,
  Badge,
  Spinner,
  formatCurrency,
  SearchableEmployeeSelect,
  sanitizeFileNamePart,
  PAYROLL_ITEM_LIST,
  PAYROLL_TYPE_LABEL,
} from "../PayrollRoutes";
import {
  AlertCircle, AlertTriangle, ArrowUpRight, Ban, Briefcase, CalendarDays, CalendarX,
  Check, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock,
  CreditCard, Download, Eye, EyeOff, FileDown, FileSpreadsheet, FileText, Filter,
  Info, Layers, LayoutList, Lock, LogIn, LogOut, Mail, MessageSquareText, Minus,
  MinusCircle, MoreVertical, PauseCircle, Pencil, Plus, Receipt, Search, Send,
  Square, Star, Trash2, TrendingUp, Upload, UserMinus, UserPlus, Users, Wallet, X,
} from "lucide-react";
const CALENDAR_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function MonthYearPicker({ month, year, onChange }) {
  const [viewYear, setViewYear] = useState(year);
  const [mode, setMode] = useState("month");

  const decadeBase = Math.floor(viewYear / 12) * 12;
  const yearGrid = Array.from({ length: 12 }, (_, i) => decadeBase + i);

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-2, #f8fafc)", border: "1px solid var(--border-3, #e2e8f0)" }}>
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={() => mode === "month" ? setViewYear((y) => y - 1) : setViewYear((y) => y - 12)}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer"
          style={{ background: "var(--border-1, #f8fafc)", border: "1px solid var(--border-3, #e2e8f0)", color: "var(--text-secondary, #475569)" }}
        >
          <ChevronLeft size={14} />
        </button>

        <button
          type="button"
          onClick={() => setMode((m) => m === "month" ? "year" : "month")}
          className="text-sm font-semibold px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
          style={{
            color: "var(--text-primary, #1e293b)",
            background: mode === "year" ? "var(--blue-bg, #eff6ff)" : "transparent",
            border: mode === "year" ? "1px solid var(--blue-border, #bfdbfe)" : "1px solid transparent",
          }}
        >
          {mode === "month" ? viewYear : `${decadeBase} – ${decadeBase + 11}`}
        </button>

        <button
          type="button"
          onClick={() => mode === "month" ? setViewYear((y) => y + 1) : setViewYear((y) => y + 12)}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer"
          style={{ background: "var(--border-1, #f8fafc)", border: "1px solid var(--border-3, #e2e8f0)", color: "var(--text-secondary, #475569)" }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {mode === "month" ? (
        <div className="grid grid-cols-4 gap-1.5">
          {CALENDAR_MONTHS.map((m, i) => {
            const isSelected = i + 1 === month && viewYear === year;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange(i + 1, viewYear)}
                className={`rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer ${isSelected ? "is-selected font-bold" : ""}`}
                style={{
                  background: isSelected ? "var(--blue-border, #bfdbfe)" : "var(--surface-2, #f8fafc)",
                  border: isSelected ? "1px solid var(--blue-border, #bfdbfe)" : "1px solid var(--border-2, #f1f5f9)",
                  color: isSelected ? "var(--blue-text-strong, #1e3a8a)" : "var(--text-muted, #64748b)",
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
                className={`rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer ${isSelected ? "is-selected font-bold" : ""}`}
                style={{
                  background: isSelected ? "var(--blue-border, #bfdbfe)" : "var(--surface-2, #f8fafc)",
                  border: isSelected ? "1px solid var(--blue-border, #bfdbfe)" : "1px solid var(--border-2, #f1f5f9)",
                  color: isSelected ? "var(--blue-text-strong, #1e3a8a)" : "var(--text-muted, #64748b)",
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
/* ── Client Portal API Client & Token Management (Self-Contained) ────────── */
const isLocalhost =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const API_BASE = isLocalhost
  ? "http://localhost:8000/api"
  : "https://api.ckpsca.in/api";

const TOKEN_KEY = "portal_token";
const USER_KEY = "portal_user";

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY)); } catch { return null; }
};
export const setSession = (token, user) => {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  // Remove any legacy localStorage copies from the old "stay signed in"
  // behaviour so they can't resurrect a session.
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};
export const clearSession = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

function errorMessage(data, status) {
  if (data && typeof data === "object") {
    if (typeof data.detail === "string") return data.detail;
    const firstKey = Object.keys(data)[0];
    if (firstKey) {
      const v = data[firstKey];
      if (Array.isArray(v) && v.length) return `${firstKey}: ${v[0]}`;
      if (typeof v === "string") return `${firstKey}: ${v}`;
    }
  }
  return `Request failed (${status}).`;
}

export async function apiRequest(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    clearSession();
    // ClientPortal listens for this and drops back to the login screen.
    window.dispatchEvent(new CustomEvent("portal:unauthorized"));
    const data = await res.json().catch(() => null);
    throw new Error(errorMessage(data, res.status));
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return data;
}

export async function uploadFile(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent("portal:unauthorized"));
    const data = await res.json().catch(() => null);
    throw new Error(errorMessage(data, res.status));
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return data;
}

export async function downloadBlob(path, defaultFilename = "download.xlsx") {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers,
  });

  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent("portal:unauthorized"));
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(errorMessage(data, res.status));
  }

  const blob = await res.blob();
  let filename = defaultFilename;
  const disposition = res.headers.get("content-disposition");
  if (disposition && disposition.indexOf("filename=") !== -1) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1];
  }

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
  return true;
}

export const api = {
  get: (path) => apiRequest("GET", path),
  post: (path, body) => apiRequest("POST", path, body),
  patch: (path, body) => apiRequest("PATCH", path, body),
  del: (path) => apiRequest("DELETE", path),
  upload: (path, formData) => uploadFile(path, formData),
  download: (path, defaultFilename) => downloadBlob(path, defaultFilename),
};



/* ── Lightweight Login UI Helpers (Native Tailwind) ──────────────────────── */
function Button({ variant = "primary", size, className = "", children, ...rest }) {
  const isSecondary = variant === "secondary";
  const isGhost = variant === "ghost";
  const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "h-12 px-6 text-base" : "px-4 py-2 text-sm";
  const variantCls = isGhost
    ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
    : isSecondary
      ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 shadow-sm"
      : "bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${sizeCls} ${variantCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  const text =
    typeof message === "object"
      ? message.detail || message.message || JSON.stringify(message)
      : String(message);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
      <span className="text-sm">⚠️</span>
      <span>{text}</span>
    </div>
  );
}

/* ── Payroll Brand Logo (SVG) ───────────────────────────────────────────── */
function PayrollBrandLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="44"
      height="44"
      viewBox="0 0 128 128"
      fill="none"
    >
      <defs>
        <linearGradient
          id="primary"
          x1="24"
          y1="16"
          x2="94"
          y2="108"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4387F5" />
          <stop offset="1" stopColor="#174FC4" />
        </linearGradient>
      </defs>

      {/* Payroll statement */}
      <rect
        x="22"
        y="14"
        width="72"
        height="96"
        rx="10"
        fill="#FFFFFF"
        stroke="#C9D9F5"
        strokeWidth="2.5"
      />

      {/* Monthly calendar header */}
      <path
        d="M32 14H84C89.523 14 94 18.477 94 24V39H22V24C22 18.477 26.477 14 32 14Z"
        fill="url(#primary)"
      />

      {/* Calendar glyph */}
      <rect
        x="33"
        y="23"
        width="17"
        height="13"
        rx="2.5"
        stroke="#FFFFFF"
        strokeWidth="2"
      />
      <path
        d="M33 28H50M37 20V25M46 20V25"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Payslip heading and rows */}
      <rect x="34" y="48" width="39" height="4" rx="2" fill="#315FAD" />
      <rect x="34" y="57" width="27" height="3" rx="1.5" fill="#B5C9E9" />

      {/* Salary summary */}
      <rect
        x="32"
        y="68"
        width="52"
        height="25"
        rx="5"
        fill="#F0F5FF"
        stroke="#D8E5FA"
        strokeWidth="1.5"
      />

      <text
        x="43"
        y="85"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="18"
        fontWeight="700"
        fill="#2463D5"
      >
        ₹
      </text>

      <path
        d="M57 77H75M57 83H70"
        stroke="#86A7DF"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Payroll breakdown */}
      <path
        d="M34 101H57M65 101H82"
        stroke="#B7C9E6"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Approval indicator integrated with document */}
      <circle
        cx="91"
        cy="91"
        r="19"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth="4"
      />
      <circle cx="91" cy="91" r="15" fill="#0DAB78" />
      <path
        d="M84 91L89 96L99 86"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Portal Emblem & Word Mark (SVG) ─────────────────────────────────────── */
function PortalEmblemLogo({ className = "", viewBox = "310 190 1145 565", ...props }) {
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <defs>
        {/* 2. Circular Emblem: Translucent 3D Glass Layers & Reflective Edges */}
        <linearGradient id="v4-swoosh-3d-depth" x1="396" y1="660" x2="795" y2="250" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#021868" />
          <stop offset="50%" stopColor="#0638a8" />
          <stop offset="100%" stopColor="#0c78dc" />
        </linearGradient>
        <linearGradient id="v4-swoosh-base" x1="396" y1="560" x2="795" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0634be" stopOpacity="0.94" />
          <stop offset="28%" stopColor="#0c5ee8" stopOpacity="0.92" />
          <stop offset="58%" stopColor="#14a2fc" stopOpacity="0.92" />
          <stop offset="84%" stopColor="#2ee0ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#6ef8ff" stopOpacity="0.98" />
        </linearGradient>
        <radialGradient id="v4-swoosh-top-cyan" cx="710" cy="285" r="250" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#84faff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#28deff" stopOpacity="0.75" />
          <stop offset="82%" stopColor="#0a94f4" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0452d8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="v4-swoosh-bottom-cyan" cx="685" cy="645" r="190" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#64f4ff" stopOpacity="0.88" />
          <stop offset="50%" stopColor="#1cbcff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0648c8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="v4-swoosh-left-depth" cx="402" cy="465" r="160" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#031e8a" stopOpacity="0.82" />
          <stop offset="55%" stopColor="#0942cc" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#1268ec" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="v4-crescent-white-glass" x1="425" y1="320" x2="435" y2="565" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#78e8ff" stopOpacity="0.35" />
          <stop offset="22%" stopColor="#e8fbff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="78%" stopColor="#daf8ff" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#58d8ff" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="v4-swoosh-rim-light" x1="396" y1="243" x2="792" y2="678" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="35%" stopColor="#84f4ff" stopOpacity="0.85" />
          <stop offset="70%" stopColor="#38d4ff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#dbfaff" stopOpacity="0.9" />
        </linearGradient>

        {/* 3. Gear & Shield: Glossy Translucent Blue Materials & Layered Glass Borders */}
        <linearGradient id="v4-gear-3d-side" x1="452" y1="308" x2="758" y2="614" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0c52c8" stopOpacity="0.75" />
          <stop offset="50%" stopColor="#06389e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#032272" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="v4-gear-glass-fill" x1="460" y1="585" x2="740" y2="335" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2c84ec" stopOpacity="0.82" />
          <stop offset="42%" stopColor="#4cb4fc" stopOpacity="0.86" />
          <stop offset="78%" stopColor="#76dcfe" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#b4f6ff" stopOpacity="0.94" />
        </linearGradient>
        <linearGradient id="v4-gear-rim-grad" x1="452" y1="315" x2="758" y2="600" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="50%" stopColor="#8cecff" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#e0fbff" stopOpacity="0.88" />
        </linearGradient>
        <linearGradient id="v4-gear-recess-grad" x1="490" y1="545" x2="715" y2="365" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1456c8" stopOpacity="0.8" />
          <stop offset="52%" stopColor="#2482ea" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#48befe" stopOpacity="0.82" />
        </linearGradient>

        {/* Shield Layered Glass Borders & Deep-Blue Glass Core */}
        <linearGradient id="v4-shield-3d-edge" x1="494" y1="341" x2="717" y2="588" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#24b8ff" />
          <stop offset="50%" stopColor="#0c6ce0" />
          <stop offset="100%" stopColor="#043498" />
        </linearGradient>
        <linearGradient id="v4-shield-white-frame" x1="494" y1="341" x2="717" y2="588" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#ecfaff" />
          <stop offset="100%" stopColor="#bceeff" />
        </linearGradient>
        <linearGradient id="v4-shield-left" x1="550" y1="568" x2="565" y2="358" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#011978" />
          <stop offset="38%" stopColor="#022ca2" />
          <stop offset="75%" stopColor="#064cd4" />
          <stop offset="100%" stopColor="#0e6ef0" />
        </linearGradient>
        <linearGradient id="v4-shield-right" x1="608" y1="570" x2="678" y2="362" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0350d0" />
          <stop offset="38%" stopColor="#0884ee" />
          <stop offset="74%" stopColor="#16c2fe" />
          <stop offset="100%" stopColor="#44ecff" />
        </linearGradient>
        <linearGradient id="v4-shield-glass-curve" x1="510" y1="348" x2="645" y2="478" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="48%" stopColor="#b8f2ff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="v4-dollar-3d-bevel" x1="560" y1="378" x2="650" y2="544" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7ce4ff" />
          <stop offset="50%" stopColor="#2898f0" />
          <stop offset="100%" stopColor="#0952b8" />
        </linearGradient>

        {/* 4. Typography: Pure White PAYROLL & Bright Cyan PORTAL with Subtle 3D Depth */}
        <linearGradient id="v4-payroll-face" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#f8fdff" />
          <stop offset="100%" stopColor="#dff4ff" />
        </linearGradient>
        <linearGradient id="v4-payroll-extrude" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#58c4f8" />
          <stop offset="50%" stopColor="#1e82e8" />
          <stop offset="100%" stopColor="#0748b4" />
        </linearGradient>
        <linearGradient id="v4-portal-face" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#84f4ff" />
          <stop offset="48%" stopColor="#32d0ff" />
          <stop offset="100%" stopColor="#10a6fc" />
        </linearGradient>
        <linearGradient id="v4-portal-extrude" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1282ea" />
          <stop offset="100%" stopColor="#03389c" />
        </linearGradient>

        {/* Restrained Luminous Highlights Around Circular Emblem */}
        <radialGradient id="v4-glint-flare" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
          <stop offset="22%" stopColor="#e0fbff" stopOpacity="0.82" />
          <stop offset="55%" stopColor="#38d8ff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#38d8ff" stopOpacity="0" />
        </radialGradient>

        {/* Single-Pass Fast Studio Filters */}
        <filter id="v4-neon-glass-glow" x="-12%" y="-12%" width="124%" height="128%">
          <feDropShadow dx="0" dy="5" stdDeviation="5.5" floodColor="#001248" floodOpacity="0.58" />
        </filter>
        <filter id="v4-shield-bloom" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="6.5" floodColor="#38e8ff" floodOpacity="0.55" />
        </filter>

        <clipPath id="v4-swoosh-clip">
          <path clipRule="evenodd" d="M604 243L577 246 564 248 549 252 521 263 499 275 472 295 456 310 439 330 424 353 412 377 403 404 398 429 396 459 398 487 402 510 411 538 424 566 441 592 455 608 472 625 488 637 500 645 528 660 552 669 576 675 602 678 629 677 652 674 680 666 696 660 710 653 736 637 747 628 759 618 777 597 792 576 775 576 765 590 754 603 743 615 739 617 756 598 772 576 761 575 758 574 747 574 729 595 708 615 686 631 663 643 639 651 619 655 597 657 572 655 558 653 540 648 514 637 499 628 483 617 471 607 462 598 462 597 463 598 477 610 488 618 504 627 517 633 533 639 548 644 564 648 580 649 594 650 611 649 628 646 648 641 672 631 697 616 695 616 676 625 659 632 645 635 629 638 611 639 591 638 573 635 560 632 540 625 525 618 508 608 495 599 481 588 465 574 450 556 440 542 429 522 420 499 415 479 412 458 411 438 414 414 419 393 425 376 433 359 441 345 454 326 458 321 459 321 448 337 440 351 433 366 429 377 424 393 420 413 418 431 418 444 419 463 421 476 424 490 428 503 434 518 442 533 451 547 460 559 460 557 450 541 442 525 436 505 432 487 430 471 430 446 432 430 436 411 442 392 450 374 462 352 475 333 491 315 510 298 528 285 541 278 558 271 571 267 585 263 601 260 612 259 628 259 647 261 659 263 675 267 690 272 705 279 714 284 732 296 750 311 759 320 740 305 730 298 713 288 696 280 682 275 662 270 641 267 623 266 605 267 588 269 571 273 555 279 538 287 523 297 503 312 499 316 498 318 512 308 529 297 550 288 567 283 582 280 602 278 617 278 637 280 657 284 678 292 693 299 713 312 731 327 742 338 749 347 763 368 800 368 802 367 798 357 788 340 781 330 767 313 747 294 732 282 720 274 708 267 691 259 661 249 631 244Z" />
        </clipPath>
        <clipPath id="v4-inner-shield-clip">
          <path clipRule="evenodd" d="M605 356L594 363 564 377 541 385 509 392 508 394 507 408 508 428 512 458 519 482 523 492 530 507 542 524 550 534 559 543 569 551 584 562 596 569 604 573 606 573 627 562 642 551 652 543 662 533 671 522 682 504 690 488 696 471 699 459 703 435 703 426 704 421 704 400 703 392 676 386 653 379 634 371Z" />
        </clipPath>
      </defs>

      {/* Master Glassmorphic Logo Group (Preserving 100% Exact Geometry, Proportions & Alignment) */}
      <g id="logo-master" transform="translate(-170, -98) scale(1.24)">
        {/* Rotating 12-Tooth Translucent Frosted Glass Gear (with 3D Bevel Depth) */}
        <g id="rotating-gear">
          <path transform="translate(1.8, 3.2)" fill="url(#v4-gear-3d-side)" d="M739.7 439.2L757.7 445.5 757.7 476.5 739.7 482.8 736.8 496.3 732.6 509.5 745.0 523.9 729.5 550.8 710.8 547.3 701.5 557.5 691.3 566.8 694.8 585.5 667.9 601.0 653.5 588.6 640.3 592.8 626.8 595.7 620.5 613.7 589.5 613.7 583.2 595.7 569.7 592.8 556.5 588.6 542.1 601.0 515.2 585.5 518.7 566.8 508.5 557.5 499.2 547.3 480.5 550.8 465.0 523.9 477.4 509.5 473.2 496.3 470.3 482.8 452.3 476.5 452.3 445.5 470.3 439.2 473.2 425.7 477.4 412.5 465.0 398.1 480.5 371.2 499.2 374.7 508.5 364.5 518.7 355.2 515.2 336.5 542.1 321.0 556.5 333.4 569.7 329.2 583.2 326.3 589.5 308.3 620.5 308.3 626.8 326.3 640.3 329.2 653.5 333.4 667.9 321.0 694.8 336.5 691.3 355.2 701.5 364.5 710.8 374.7 729.5 371.2 745.0 398.1 732.6 412.5 736.8 425.7Z" />
          <path fill="url(#v4-gear-glass-fill)" stroke="url(#v4-gear-rim-grad)" strokeWidth="2" strokeLinejoin="round" d="M739.7 439.2L757.7 445.5 757.7 476.5 739.7 482.8 736.8 496.3 732.6 509.5 745.0 523.9 729.5 550.8 710.8 547.3 701.5 557.5 691.3 566.8 694.8 585.5 667.9 601.0 653.5 588.6 640.3 592.8 626.8 595.7 620.5 613.7 589.5 613.7 583.2 595.7 569.7 592.8 556.5 588.6 542.1 601.0 515.2 585.5 518.7 566.8 508.5 557.5 499.2 547.3 480.5 550.8 465.0 523.9 477.4 509.5 473.2 496.3 470.3 482.8 452.3 476.5 452.3 445.5 470.3 439.2 473.2 425.7 477.4 412.5 465.0 398.1 480.5 371.2 499.2 374.7 508.5 364.5 518.7 355.2 515.2 336.5 542.1 321.0 556.5 333.4 569.7 329.2 583.2 326.3 589.5 308.3 620.5 308.3 626.8 326.3 640.3 329.2 653.5 333.4 667.9 321.0 694.8 336.5 691.3 355.2 701.5 364.5 710.8 374.7 729.5 371.2 745.0 398.1 732.6 412.5 736.8 425.7Z" />
          <circle cx="605" cy="461" r="131" fill="url(#v4-gear-recess-grad)" stroke="#c8f8ff" strokeOpacity="0.72" strokeWidth="1.6" />
          <circle cx="605" cy="461" r="125" fill="none" stroke="#083898" strokeOpacity="0.38" strokeWidth="2" />
          <animateTransform attributeName="transform" type="rotate" from="0 605 461" to="360 605 461" dur="12s" repeatCount="indefinite" />
        </g>

        {/* 2. Circular Emblem: Translucent 3D Glass Rings & Exact Crescent Highlights */}
        <g filter="url(#v4-neon-glass-glow)">
          {/* Subtle 3D Glass Dimensional Under-Layer */}
          <path transform="translate(-1.5, 3)" fillRule="evenodd" fill="url(#v4-swoosh-3d-depth)" opacity="0.75" d="M604 243L577 246 564 248 549 252 521 263 499 275 472 295 456 310 439 330 424 353 412 377 403 404 398 429 396 459 398 487 402 510 411 538 424 566 441 592 455 608 472 625 488 637 500 645 528 660 552 669 576 675 602 678 629 677 652 674 680 666 696 660 710 653 736 637 747 628 759 618 777 597 792 576 775 576 765 590 754 603 743 615 739 617 756 598 772 576 761 575 758 574 747 574 729 595 708 615 686 631 663 643 639 651 619 655 597 657 572 655 558 653 540 648 514 637 499 628 483 617 471 607 462 598 462 597 463 598 477 610 488 618 504 627 517 633 533 639 548 644 564 648 580 649 594 650 611 649 628 646 648 641 672 631 697 616 695 616 676 625 659 632 645 635 629 638 611 639 591 638 573 635 560 632 540 625 525 618 508 608 495 599 481 588 465 574 450 556 440 542 429 522 420 499 415 479 412 458 411 438 414 414 419 393 425 376 433 359 441 345 454 326 458 321 459 321 448 337 440 351 433 366 429 377 424 393 420 413 418 431 418 444 419 463 421 476 424 490 428 503 434 518 442 533 451 547 460 559 460 557 450 541 442 525 436 505 432 487 430 471 430 446 432 430 436 411 442 392 450 374 462 352 475 333 491 315 510 298 528 285 541 278 558 271 571 267 585 263 601 260 612 259 628 259 647 261 659 263 675 267 690 272 705 279 714 284 732 296 750 311 759 320 740 305 730 298 713 288 696 280 682 275 662 270 641 267 623 266 605 267 588 269 571 273 555 279 538 287 523 297 503 312 499 316 498 318 512 308 529 297 550 288 567 283 582 280 602 278 617 278 637 280 657 284 678 292 693 299 713 312 731 327 742 338 749 347 763 368 800 368 802 367 798 357 788 340 781 330 767 313 747 294 732 282 720 274 708 267 691 259 661 249 631 244Z" />
          {/* Clipped Translucent Glass Ring Layers (Preserving 100% Exact Ring Geometry) */}
          <g clipPath="url(#v4-swoosh-clip)">
            <rect x="390" y="240" width="420" height="445" fill="url(#v4-swoosh-base)" />
            <rect x="390" y="240" width="420" height="445" fill="url(#v4-swoosh-top-cyan)" />
            <rect x="390" y="240" width="420" height="445" fill="url(#v4-swoosh-bottom-cyan)" />
            <rect x="390" y="240" width="420" height="445" fill="url(#v4-swoosh-left-depth)" />
            {/* Luminous Ice-White Glass Left Crescent Band (Exact Native Vertices 107..136) */}
            <path fill="url(#v4-crescent-white-glass)" d="M459 321L448 337 440 351 433 366 429 377 424 393 420 413 418 431 418 444 419 463 421 476 424 490 428 503 434 518 442 533 451 547 460 559 460 557 450 541 442 525 436 505 432 487 430 471 430 446 432 430 436 411 442 392 450 374 462 352 475 333Z" />
          </g>
          {/* Bright Cyan & Ice-White Reflective Glass Edges Along Exact Ring Curves */}
          <path fill="none" stroke="url(#v4-swoosh-rim-light)" strokeWidth="1.5" d="M604 243L577 246 564 248 549 252 521 263 499 275 472 295 456 310 439 330 424 353 412 377 403 404 398 429 396 459 398 487 402 510 411 538 424 566 441 592 455 608 472 625 488 637 500 645 528 660 552 669 576 675 602 678 629 677 652 674 680 666 696 660 710 653 736 637 747 628 759 618 777 597 792 576" />
          <path fill="none" stroke="#ffffff" strokeOpacity="0.82" strokeWidth="1.3" d="M459 321L448 337 440 351 433 366 429 377 424 393 420 413 418 431 418 444 419 463 421 476 424 490 428 503 434 518 442 533 451 547 460 559" />
          <path fill="none" stroke="#9cf8ff" strokeOpacity="0.72" strokeWidth="1.2" d="M498 318L512 308 529 297 550 288 567 283 582 280 602 278 617 278 637 280 657 284 678 292 693 299 713 312 731 327 742 338 749 347 763 368 800 368" />
          <path fill="none" stroke="#8cf4ff" strokeOpacity="0.68" strokeWidth="1.2" d="M772 576L761 575 758 574 747 574 729 595 708 615 686 631 663 643 639 651 619 655 597 657 572 655 558 653 540 648 514 637 499 628 483 617 471 607 462 598" />
        </g>

        {/* 3. Shield with Layered 3D Glass Borders & Deep-Blue Glass Core */}
        {/* 3D Outer Cyan-Blue Glass Bevel Under-Layer */}
        <path transform="translate(0, 3.2)" fill="url(#v4-shield-3d-edge)" d="M604 341L589 350 577 356 557 365 533 373 496 381 495 387 494 410 496 442 498 456 501 470 504 480 508 491 513 503 521 517 528 527 538 540 556 558 569 568 588 580 604 588 607 588 634 573 647 564 656 557 672 542 679 533 687 522 695 508 702 495 709 473 712 465 715 444 717 426 717 413 717 394 716 386 715 381 684 374 660 367 649 363 634 356 619 348 607 341Z" />
        {/* Luminous White-Ice Glass Shield Frame */}
        <path filter="url(#v4-shield-bloom)" fill="url(#v4-shield-white-frame)" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" d="M604 341L589 350 577 356 557 365 533 373 496 381 495 387 494 410 496 442 498 456 501 470 504 480 508 491 513 503 521 517 528 527 538 540 556 558 569 568 588 580 604 588 607 588 634 573 647 564 656 557 672 542 679 533 687 522 695 508 702 495 709 473 712 465 715 444 717 426 717 413 717 394 716 386 715 381 684 374 660 367 649 363 634 356 619 348 607 341Z" />
        <g clipPath="url(#v4-inner-shield-clip)">
          <rect x="494" y="340" width="111" height="250" fill="url(#v4-shield-left)" />
          <rect x="605" y="340" width="115" height="250" fill="url(#v4-shield-right)" />
          {/* Subtle Center Facet Seam Highlight */}
          <line x1="605" y1="354" x2="605" y2="574" stroke="#6ce8ff" strokeOpacity="0.28" strokeWidth="1.2" />
          {/* Curved Diagonal Specular Glass Refraction Across Shield */}
          <path fill="url(#v4-shield-glass-curve)" d="M490 340 L720 340 L720 432 Q615 478 490 415 Z" />
          <path fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1" d="M490 415 Q615 478 720 432" />
        </g>
        {/* Layered Inner Cyan-Glass Rim Border */}
        <path fill="none" stroke="#38bdf8" strokeOpacity="0.88" strokeWidth="2" d="M605 356L594 363 564 377 541 385 509 392 508 394 507 408 508 428 512 458 519 482 523 492 530 507 542 524 550 534 559 543 569 551 584 562 596 569 604 573 606 573 627 562 642 551 652 543 662 533 671 522 682 504 690 488 696 471 699 459 703 435 703 426 704 421 704 400 703 392 676 386 653 379 634 371Z" />

        {/* Slightly Embossed White Dollar Symbol ($) */}
        <g id="embossed-dollar">
          <path transform="translate(2, 4.2)" fill="#011558" opacity="0.52" d="M596 378L598 378 616 378 616 379 617 396 618 396 628 398 637 401 645 405 649 408 650 409 642 424 639 429 624 422 617 420 608 419 599 420 593 422 589 425 587 429 587 433 588 436 590 439 593 441 600 444 627 452 636 456 642 460 646 464 649 468 652 475 654 482 654 489 653 497 651 502 647 508 642 513 635 518 627 521 617 524 616 525 616 543 614 543 606 544 597 543 596 543 595 526 594 524 579 521 570 518 561 513 555 509 554 508 556 504 566 487 576 493 584 497 593 500 600 501 609 501 617 499 623 495 625 491 626 487 625 484 623 481 621 479 615 476 588 468 577 463 570 458 565 453 562 449 560 444 559 437 559 430 561 421 563 416 569 408 577 402 584 399 595 396 595 394Z" />
          <path transform="translate(1, 2.2)" fill="url(#v4-dollar-3d-bevel)" d="M596 378L598 378 616 378 616 379 617 396 618 396 628 398 637 401 645 405 649 408 650 409 642 424 639 429 624 422 617 420 608 419 599 420 593 422 589 425 587 429 587 433 588 436 590 439 593 441 600 444 627 452 636 456 642 460 646 464 649 468 652 475 654 482 654 489 653 497 651 502 647 508 642 513 635 518 627 521 617 524 616 525 616 543 614 543 606 544 597 543 596 543 595 526 594 524 579 521 570 518 561 513 555 509 554 508 556 504 566 487 576 493 584 497 593 500 600 501 609 501 617 499 623 495 625 491 626 487 625 484 623 481 621 479 615 476 588 468 577 463 570 458 565 453 562 449 560 444 559 437 559 430 561 421 563 416 569 408 577 402 584 399 595 396 595 394Z" />
          <path fill="url(#v4-payroll-face)" stroke="#ffffff" strokeWidth="0.9" d="M596 378L598 378 616 378 616 379 617 396 618 396 628 398 637 401 645 405 649 408 650 409 642 424 639 429 624 422 617 420 608 419 599 420 593 422 589 425 587 429 587 433 588 436 590 439 593 441 600 444 627 452 636 456 642 460 646 464 649 468 652 475 654 482 654 489 653 497 651 502 647 508 642 513 635 518 627 521 617 524 616 525 616 543 614 543 606 544 597 543 596 543 595 526 594 524 579 521 570 518 561 513 555 509 554 508 556 504 566 487 576 493 584 497 593 500 600 501 609 501 617 499 623 495 625 491 626 487 625 484 623 481 621 479 615 476 588 468 577 463 570 458 565 453 562 449 560 444 559 437 559 430 561 421 563 416 569 408 577 402 584 399 595 396 595 394Z" />
        </g>

        {/* 4. Typography: Pure White PAYROLL with Subtle 3D Depth & Restrained Luminous Edges */}
        <g filter="url(#v4-neon-glass-glow)">
          <path transform="translate(1.4, 3.4)" fillRule="evenodd" fill="url(#v4-payroll-extrude)" d="M1113 390L1106 391 1096 395 1088 400 1082 407 1076 417 1075 421 1073 428 1074 437 1076 446 1078 452 1082 458 1089 465 1097 470 1102 472 1112 474 1121 474 1128 473 1137 470 1144 466 1152 458 1157 450 1160 442 1160 427 1159 419 1157 414 1150 404 1144 398 1134 393 1128 391 1120 390ZM763 392L763 394 763 472 764 473 769 473 780 473 782 472 782 451 783 449 806 448 814 446 821 442 825 438 829 433 831 425 831 416 829 409 826 404 823 400 819 397 814 394 807 392 788 391 765 391ZM863 392L862 392 860 396 827 472 829 473 846 473 847 471 853 457 855 456 881 455 888 455 890 456 896 471 898 473 914 473 917 472 882 392 879 391ZM908 392L908 393 936 442 937 445 937 471 938 473 954 473 956 472 957 443 969 423 987 393 987 392 968 392 960 404 951 420 948 424 946 423 928 392ZM996 392L995 393 995 395 995 472 997 473 1014 472 1014 470 1015 449 1017 449 1026 449 1029 449 1030 450 1045 472 1046 473 1053 473 1063 473 1065 472 1049 446 1049 445 1055 441 1059 437 1062 432 1064 427 1064 414 1062 408 1060 404 1057 401 1052 397 1046 394 1039 392 1030 391ZM1173 392L1172 394 1173 472 1174 473 1177 473 1228 473 1230 472 1230 471 1230 458 1230 457 1194 456 1192 455 1192 450 1191 392 1188 391ZM1241 392L1240 395 1241 472 1242 473 1243 473 1298 472 1299 471 1299 463 1299 458 1298 457 1261 456 1260 452 1260 392 1258 391ZM1114 407L1120 407 1124 408 1133 413 1137 417 1138 420 1140 425 1141 430 1140 439 1138 444 1135 449 1132 452 1128 454 1124 456 1119 457 1114 457 1110 456 1105 454 1102 452 1098 448 1096 444 1093 434 1093 429 1094 424 1096 419 1099 415 1106 410ZM782 408L785 407 799 407 804 408 807 410 811 414 812 419 811 425 809 429 806 431 801 432 783 432 782 430ZM1015 408L1017 407 1031 407 1036 408 1040 410 1044 415 1045 419 1044 425 1041 429 1038 431 1033 432 1015 432 1014 430ZM872 413L872 413 873 414 883 439 882 440 873 440 862 440 861 439Z" />
          <path fillRule="evenodd" fill="url(#v4-payroll-face)" stroke="#ffffff" strokeWidth="0.9" d="M1113 390L1106 391 1096 395 1088 400 1082 407 1076 417 1075 421 1073 428 1074 437 1076 446 1078 452 1082 458 1089 465 1097 470 1102 472 1112 474 1121 474 1128 473 1137 470 1144 466 1152 458 1157 450 1160 442 1160 427 1159 419 1157 414 1150 404 1144 398 1134 393 1128 391 1120 390ZM763 392L763 394 763 472 764 473 769 473 780 473 782 472 782 451 783 449 806 448 814 446 821 442 825 438 829 433 831 425 831 416 829 409 826 404 823 400 819 397 814 394 807 392 788 391 765 391ZM863 392L862 392 860 396 827 472 829 473 846 473 847 471 853 457 855 456 881 455 888 455 890 456 896 471 898 473 914 473 917 472 882 392 879 391ZM908 392L908 393 936 442 937 445 937 471 938 473 954 473 956 472 957 443 969 423 987 393 987 392 968 392 960 404 951 420 948 424 946 423 928 392ZM996 392L995 393 995 395 995 472 997 473 1014 472 1014 470 1015 449 1017 449 1026 449 1029 449 1030 450 1045 472 1046 473 1053 473 1063 473 1065 472 1049 446 1049 445 1055 441 1059 437 1062 432 1064 427 1064 414 1062 408 1060 404 1057 401 1052 397 1046 394 1039 392 1030 391ZM1173 392L1172 394 1173 472 1174 473 1177 473 1228 473 1230 472 1230 471 1230 458 1230 457 1194 456 1192 455 1192 450 1191 392 1188 391ZM1241 392L1240 395 1241 472 1242 473 1243 473 1298 472 1299 471 1299 463 1299 458 1298 457 1261 456 1260 452 1260 392 1258 391ZM1114 407L1120 407 1124 408 1133 413 1137 417 1138 420 1140 425 1141 430 1140 439 1138 444 1135 449 1132 452 1128 454 1124 456 1119 457 1114 457 1110 456 1105 454 1102 452 1098 448 1096 444 1093 434 1093 429 1094 424 1096 419 1099 415 1106 410ZM782 408L785 407 799 407 804 408 807 410 811 414 812 419 811 425 809 429 806 431 801 432 783 432 782 430ZM1015 408L1017 407 1031 407 1036 408 1040 410 1044 415 1045 419 1044 425 1041 429 1038 431 1033 432 1015 432 1014 430ZM872 413L872 413 873 414 883 439 882 440 873 440 862 440 861 439Z" />
        </g>

        {/* 4. Typography: Bright Cyan PORTAL with Subtle 3D Depth & Restrained Luminous Edges */}
        <g filter="url(#v4-neon-glass-glow)">
          <path transform="translate(1.2, 3)" fillRule="evenodd" fill="url(#v4-portal-extrude)" d="M846 493L840 495 834 498 830 502 826 507 824 511 822 518 822 526 823 531 824 535 828 541 832 545 836 548 840 550 847 552 854 553 861 552 867 550 871 548 876 544 881 539 883 534 885 525 884 515 882 509 878 503 875 500 871 497 866 495 859 493 852 492ZM763 494L763 547 763 551 766 552 777 551 777 550 778 537 778 536 795 535 801 533 805 531 810 527 812 523 813 518 813 512 812 507 809 501 806 499 802 496 794 494 776 493ZM897 494L897 515 897 548 897 551 911 551 911 550 912 536 914 535 921 535 922 536 933 551 943 552 949 551 937 533 937 532 941 529 944 526 946 522 947 519 947 510 946 506 943 502 941 499 937 497 929 494 919 493ZM955 494L954 495 954 502 954 504 955 505 970 505 972 506 972 548 973 551 984 552 986 551 987 533 987 506 989 505 1004 505 1005 501 1005 494 998 493ZM1031 494L1029 498 1005 551 1007 552 1018 552 1020 551 1024 542 1026 540 1044 540 1051 541 1055 550 1056 551 1068 552 1070 551 1045 494 1043 493ZM1080 494L1080 495 1080 501 1080 551 1082 552 1122 551 1123 550 1123 547 1123 541 1122 540 1096 539 1095 539 1094 495 1092 493ZM778 505L790 505 794 506 796 508 798 510 799 515 798 518 796 521 790 523 780 523 778 523 777 508ZM850 505L857 505 862 507 868 513 870 519 870 527 867 533 862 538 856 540 853 540 848 539 844 537 839 532 837 525 837 518 839 512 845 507ZM912 506L914 505 924 505 929 507 932 510 933 514 932 518 930 521 925 523 912 523 912 519ZM1037 509L1038 509 1045 527 1045 528 1044 529 1038 529 1031 528 1030 527Z" />
          <path fillRule="evenodd" fill="url(#v4-portal-face)" stroke="#bef8ff" strokeWidth="0.85" d="M846 493L840 495 834 498 830 502 826 507 824 511 822 518 822 526 823 531 824 535 828 541 832 545 836 548 840 550 847 552 854 553 861 552 867 550 871 548 876 544 881 539 883 534 885 525 884 515 882 509 878 503 875 500 871 497 866 495 859 493 852 492ZM763 494L763 547 763 551 766 552 777 551 777 550 778 537 778 536 795 535 801 533 805 531 810 527 812 523 813 518 813 512 812 507 809 501 806 499 802 496 794 494 776 493ZM897 494L897 515 897 548 897 551 911 551 911 550 912 536 914 535 921 535 922 536 933 551 943 552 949 551 937 533 937 532 941 529 944 526 946 522 947 519 947 510 946 506 943 502 941 499 937 497 929 494 919 493ZM955 494L954 495 954 502 954 504 955 505 970 505 972 506 972 548 973 551 984 552 986 551 987 533 987 506 989 505 1004 505 1005 501 1005 494 998 493ZM1031 494L1029 498 1005 551 1007 552 1018 552 1020 551 1024 542 1026 540 1044 540 1051 541 1055 550 1056 551 1068 552 1070 551 1045 494 1043 493ZM1080 494L1080 495 1080 501 1080 551 1082 552 1122 551 1123 550 1123 547 1123 541 1122 540 1096 539 1095 539 1094 495 1092 493ZM778 505L790 505 794 506 796 508 798 510 799 515 798 518 796 521 790 523 780 523 778 523 777 508ZM850 505L857 505 862 507 868 513 870 519 870 527 867 533 862 538 856 540 853 540 848 539 844 537 839 532 837 525 837 518 839 512 845 507ZM912 506L914 505 924 505 929 507 932 510 933 514 932 518 930 521 925 523 912 523 912 519ZM1037 509L1038 509 1045 527 1045 528 1044 529 1038 529 1031 528 1030 527Z" />
        </g>

        {/* 5. Small Luminous Edge Highlights Around the Circular Emblem */}
        <g id="specular-glints">
          <ellipse cx="401" cy="412" rx="4.5" ry="14" transform="rotate(14 401 412)" fill="url(#v4-glint-flare)" />
          <ellipse cx="515" cy="266" rx="14" ry="4.5" transform="rotate(-26 515 266)" fill="url(#v4-glint-flare)" />
          <ellipse cx="718" cy="272" rx="14" ry="4.5" transform="rotate(28 718 272)" fill="url(#v4-glint-flare)" />
          <ellipse cx="635" cy="676" rx="16" ry="4.5" transform="rotate(-8 635 676)" fill="url(#v4-glint-flare)" />
        </g>
      </g>
    </svg>
  );

}

/* ── Login View (Full 2-Column Luxury Design - Inlined Styles) ───────────── */
function LoginView({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpFlash, setHelpFlash] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api.post("/payroll-portal/login/", { email, password });
      setSession(data.token, data.user);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const flashHelp = () => {
    setHelpFlash(false);
    requestAnimationFrame(() => setHelpFlash(true));
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 sm:p-8"
      style={{
        background: `
          radial-gradient(900px 650px at 12% 18%, rgba(147, 197, 253, 0.65), transparent 70%),
          radial-gradient(1000px 750px at 88% 82%, rgba(191, 219, 254, 0.6), transparent 70%),
          radial-gradient(750px 550px at 85% 15%, rgba(224, 242, 254, 0.7), transparent 60%),
          radial-gradient(850px 600px at 20% 85%, rgba(186, 230, 253, 0.55), transparent 65%),
          linear-gradient(135deg, #dbeafe 0%, #eff6ff 45%, #e0e7ff 100%)
        `,
      }}
    >
      <div className="w-full max-w-[960px] rounded-[28px] bg-white border border-white/95 shadow-[0_35px_85px_-15px_rgba(2,40,110,0.22)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[560px]">
          {/* ── Left brand panel ── */}
          <aside
            className="relative overflow-hidden p-9 lg:p-12 flex flex-col items-center justify-between"
            style={{
              background: `
                radial-gradient(ellipse 450px 380px at 15% 90%, rgba(56, 189, 248, 0.35), transparent 70%),
                radial-gradient(ellipse 400px 350px at 85% 15%, rgba(37, 99, 235, 0.45), transparent 75%),
                linear-gradient(145deg, #013aa6 0%, #024bcc 42%, #012478 100%)
              `,
            }}
          >
            <div className="absolute inset-0 pointer-events-none opacity-95" aria-hidden="true">
              <svg viewBox="0 0 500 600" preserveAspectRatio="none" className="w-full h-full block">
                <defs>
                  <radialGradient id="cyanGlow" cx="20%" cy="85%" r="65%">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.7" />
                    <stop offset="35%" stopColor="#0284c7" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#0345b5" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="silkFlow1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
                    <stop offset="40%" stopColor="#2563eb" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#0c2e8a" stopOpacity="0.05" />
                  </linearGradient>
                  <linearGradient id="silkFlow2" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
                    <stop offset="50%" stopColor="#1d4ed8" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0b2368" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="crestGlow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#e0f2fe" stopOpacity="0.95" />
                    <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.8" />
                    <stop offset="85%" stopColor="#60a5fa" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                  </linearGradient>
                  <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Ambient cyan corner flare */}
                <rect x="0" y="0" width="500" height="600" fill="url(#cyanGlow)" />

                {/* Main sweeping silk wave */}
                <path
                  d="M -30 380 C 80 260, 240 480, 520 320 L 520 620 L -30 620 Z"
                  fill="url(#silkFlow1)"
                />

                {/* Secondary layered wave */}
                <path
                  d="M -20 460 C 130 340, 310 540, 520 400 L 520 620 L -20 620 Z"
                  fill="url(#silkFlow2)"
                />

                {/* Luminous crest highlights */}
                <path
                  d="M -30 380 C 80 260, 240 480, 520 320"
                  fill="none"
                  stroke="url(#crestGlow)"
                  strokeWidth="3"
                  filter="url(#softGlow)"
                />
                <path
                  d="M -10 415 C 100 295, 260 500, 520 350"
                  fill="none"
                  stroke="#93c5fd"
                  strokeOpacity="0.35"
                  strokeWidth="1.5"
                />
                <path
                  d="M -40 230 C 110 110, 300 330, 520 180"
                  fill="none"
                  stroke="#60a5fa"
                  strokeOpacity="0.22"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            {/* ── Center Emblem with Radiant Cyan/Blue Halo Glow ── */}
            <div className="relative z-10 my-auto flex items-center justify-center w-full max-w-[420px] px-2">
              <div className="absolute w-72 h-72 rounded-full bg-cyan-400/25 blur-3xl pointer-events-none" />
              <PortalEmblemLogo className="w-full max-w-[370px] h-auto block drop-shadow-[0_0_28px_rgba(20,184,254,0.6)] drop-shadow-[0_0_60px_rgba(5,104,232,0.38)] drop-shadow-[0_18px_38px_rgba(0,16,56,0.6)] select-none hover:scale-[1.03] hover:drop-shadow-[0_0_36px_rgba(20,184,254,0.75)] hover:drop-shadow-[0_0_75px_rgba(5,104,232,0.5)] transition-all duration-300" />
            </div>

            {/* ── Bottom Section Footer ── */}
            <div className="relative z-10 mt-auto pt-4 text-center">
              <div className="text-white font-bold text-[20px] sm:text-[21px] tracking-wide drop-shadow-[0_2px_10px_rgba(0,15,60,0.4)]">
                C K Partha Sarathy &amp; Co
              </div>
            </div>
          </aside>

          {/* ── Right sign-in form ── */}
          <div className="bg-white p-9 lg:p-12 flex flex-col justify-center">
            <h1 className="text-[30px] font-extrabold text-slate-900 m-0 mb-1.5 tracking-tight">
              Welcome <span className="text-blue-700">back!</span>
            </h1>
            <p className="text-[13.5px] text-slate-500 m-0 mb-6">Sign in to access your Payroll Portal</p>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-slate-800">Email address</span>
                <span className="relative flex items-center border-[1.5px] border-slate-300 rounded-xl bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <Mail size={18} className="text-slate-400 ml-3.5 shrink-0" />
                  <input
                    type="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="xyz@email.com"
                    autoComplete="username"
                    className="w-full border-none bg-transparent py-3 px-3.5 text-[14.5px] text-slate-900 outline-none"
                  />
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-slate-800">Password</span>
                <span className="relative flex items-center border-[1.5px] border-slate-300 rounded-xl bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <Lock size={18} className="text-slate-400 ml-3.5 shrink-0" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="•••••••••••••"
                    autoComplete="current-password"
                    className="w-full border-none bg-transparent py-3 px-3.5 text-[14.5px] text-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    className="bg-transparent border-none text-slate-400 px-3.5 cursor-pointer flex items-center justify-center hover:text-slate-800 transition-colors"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>

              <div className="flex items-center justify-between text-xs mt-0.5">
                <label className="flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span>Keep me signed in</span>
                </label>
                <button
                  type="button"
                  className="bg-transparent border-none text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer p-0"
                  onClick={flashHelp}
                >
                  Forgot password?
                </button>
              </div>

              <ErrorBanner message={error} />

              <Button
                type="submit"
                disabled={busy}
                size="lg"
                className="w-full mt-2"
              >
                <LogIn size={18} /> {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {helpFlash && (
              <div className="mt-3.5 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-start gap-2.5 animate-in fade-in zoom-in-95 duration-150">
                <Lock size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-bold text-blue-900">Need help?</div>
                  <div className="text-blue-700 leading-relaxed mt-0.5">
                    Contact your payroll team at C K Partha Sarathy &amp; Co if you need your password reset.
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mt-6 text-center">
              <Lock size={13} /> Your data is secure and confidential
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Client portal — lives inside the main app at /portal (public route).
 * Only the monthly payroll input is exposed here.
 */
/* ==========================================================================
   PART 2: MONTHLY PAYROLL INPUT WORKBENCH (CONSOLIDATED)
   ========================================================================== */

/* ── Portal UI Primitives (Self-Contained Tailwind CSS) ───────────── */


function Field({ label, hint, children, className = "" }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && <span className="block text-xs font-semibold text-slate-700">{label}</span>}
      {children}
      {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
    </div>
  );
}

const inputCls = "w-full h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors";

const TextInput = (props) => <input className={`${inputCls} ${props.className || ""}`} {...props} />;
const NumberInput = ({ prefix, className = "", ...props }) => {
  if (prefix) {
    return (
      <div className="relative flex items-center w-full">
        <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none select-none">
          {prefix}
        </span>
        <input
          className={`${inputCls} pl-6 ${className}`}
          type="number"
          step="any"
          min="0"
          {...props}
        />
      </div>
    );
  }
  return (
    <input className={`${inputCls} ${className}`} type="number" step="any" min="0" {...props} />
  );
};
const DateInput = (props) => <input className={`${inputCls} ${props.className || ""}`} type="date" {...props} />;
const TextArea = (props) => (
  <textarea
    className={`w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors ${props.className || ""}`}
    rows={3}
    {...props}
  />
);

function SelectInput({ options, placeholder = "Select…", value, onChange, className = "", ...rest }) {
  return (
    <select
      className={`${inputCls} cursor-pointer ${className}`}
      value={value ?? ""}
      onChange={onChange}
      {...rest}
    >
      <option value="" disabled>{placeholder}</option>
      {options.map((o, idx) =>
        o.options ? (
          <optgroup key={o.group || idx} label={o.group}>
            {o.options.map((sub) => (
              <option key={sub.value} value={sub.value}>{sub.label}</option>
            ))}
          </optgroup>
        ) : (
          <option key={o.value} value={o.value}>{o.label}</option>
        )
      )}
    </select>
  );
}

function Checkbox({ label, checked, onChange, className = "", ...rest }) {
  return (
    <label
      className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border cursor-pointer select-none text-xs font-semibold transition-all ${checked
          ? "bg-blue-50 border-blue-300 text-blue-800 shadow-sm"
          : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
        } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        {...rest}
      />
      <span>{label}</span>
      {checked && (
        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-200/70 text-blue-900">
          Enrolled
        </span>
      )}
    </label>
  );
}



function EmptyState({ title = "Nothing here yet", hint }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

const fmtINR = (n) => new Intl.NumberFormat("en-IN").format(Number(n || 0));

const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Changes Returned",
};

const STATUS_ICON = {
  DRAFT: Pencil,
  SUBMITTED: Clock,
  APPROVED: CheckCircle2,
  REJECTED: AlertCircle,
};

const ITEM_TYPES = PAYROLL_ITEM_LIST;
const TYPE_LABEL = PAYROLL_TYPE_LABEL;
const TYPE_UNICODE = Object.fromEntries(PAYROLL_ITEM_LIST.map((t) => [t.key, t.emoji]));
const TYPE_ACCENT = Object.fromEntries(PAYROLL_ITEM_LIST.map((t) => [t.key, t.accent]));
const EMOJI_DOCK = Object.fromEntries(PAYROLL_ITEM_LIST.map((t) => [t.key, { bg: t.bg, border: t.border }]));

// Icon + soft colour tone per item type.
const TYPE_ICON = {
  NEW_EMPLOYEE: UserPlus,
  REVISION: TrendingUp,
  EXIT: UserMinus,
  SALARY_HOLD: PauseCircle,
  REIMBURSEMENT: CreditCard,
  LOP: CalendarX,
  ARREARS: ArrowUpRight,
  TDS: Receipt,
  ADVANCE: Wallet,
  ONE_TIME_EARNING: Plus,
  ONE_TIME_DEDUCTION: Minus,
  CUSTOM_COMPONENT: Layers,
  NOTE: MessageSquareText,
};
const TYPE_TONE = {
  NEW_EMPLOYEE: "blue",
  REVISION: "coral",
  EXIT: "rose",
  SALARY_HOLD: "indigo",
  REIMBURSEMENT: "blue",
  LOP: "rose",
  ARREARS: "green",
  TDS: "coral",
  ADVANCE: "amber",
  ONE_TIME_EARNING: "purple",
  ONE_TIME_DEDUCTION: "coral",
  CUSTOM_COMPONENT: "teal",
  NOTE: "blue",
};

// Action-first wording for the "Add Another Change" tiles (the list rows keep
// the shorter TYPE_LABEL names).
const TILE_LABEL = {
  NEW_EMPLOYEE: "Add New Employee",
  REVISION: "Update Salary",
  EXIT: "Record Exit",
  SALARY_HOLD: "Hold Salary",
  REIMBURSEMENT: "Add Reimbursement",
  LOP: "Record Loss of Pay",
  ARREARS: "Add Salary Arrears",
  TDS: "Add TDS (Income Tax)",
  ADVANCE: "Add Advance / Loan",
  ONE_TIME_EARNING: "Add Extra Payment",
  ONE_TIME_DEDUCTION: "Add Deduction",
  CUSTOM_COMPONENT: "Add Custom Component",
  NOTE: "Send a Note",
};

// Short, client-friendly one-liners shown under each tile.
const TYPE_DESC = {
  NEW_EMPLOYEE: "Add someone joining this month",
  REVISION: "Change salary or CTC",
  EXIT: "Tell us about an employee leaving",
  SALARY_HOLD: "Hold salary for later release",
  REIMBURSEMENT: "Expense claims (travel, fuel, bills)",
  LOP: "Unpaid absence or leave days",
  ARREARS: "Retroactive salary or increment",
  TDS: "Monthly tax deduction (Admin only)",
  ADVANCE: "Give an advance or loan",
  ONE_TIME_EARNING: "Bonus, or extra payout",
  ONE_TIME_DEDUCTION: "One-time or other deduction",
  CUSTOM_COMPONENT: "Variable allowance, perk or deduction (e.g. Fuel, Penalty)",
  NOTE: "Leave a message for payroll team",
};

// Notes are written via the "Send a Note" tile (opens the note modal), not as
// an item — so exclude NOTE from the item-type tiles (kept in ITEM_TYPES only
// so previously added NOTE items still render with a proper label).
const ADDABLE_TYPES = ITEM_TYPES.filter((t) => t.key !== "NOTE");

// ── Categorized Action Accordions ──
const ACTION_GROUPS = [
  {
    key: "headcount",
    title: "Headcount",
    icon: Users,
    types: [
      { key: "NEW_EMPLOYEE", label: "New Employee", icon: UserPlus, emoji: "👤" },
      { key: "EXIT", label: "Exit / Resign", icon: UserMinus, emoji: "📕" },
    ],
  },
  {
    key: "salary",
    title: "Salary Changes",
    icon: Briefcase,
    types: [
      { key: "REVISION", label: "Salary Revision", icon: TrendingUp, emoji: "📈" },
      { key: "ARREARS", label: "Salary Arrears", icon: ArrowUpRight, emoji: "⏱️" },
      { key: "SALARY_HOLD", label: "Hold Salary", icon: PauseCircle, emoji: "⏸️" },
      { key: "CUSTOM_COMPONENT", label: "Custom Component", icon: Layers, emoji: "🧩" },
    ],
  },
  {
    key: "claims",
    title: "Claims & Deductions",
    icon: Wallet,
    types: [
      { key: "REIMBURSEMENT", label: "Reimbursement", icon: CreditCard, emoji: "💳" },
      { key: "LOP", label: "Loss of Pay", icon: CalendarX, emoji: "📅" },
      { key: "ONE_TIME_EARNING", label: "Extra Payout", icon: Plus, emoji: "➕" },
      { key: "ONE_TIME_DEDUCTION", label: "One-time Deduction", icon: Minus, emoji: "➖" },
      { key: "ADVANCE", label: "Advance / Loan", icon: Wallet, emoji: "💰" },
      { key: "CUSTOM_COMPONENT", label: "Custom Component", icon: Layers, emoji: "🧩" },
      { key: "TDS", label: "TDS (Income Tax)", icon: Receipt, emoji: "🧾", adminOnly: true },
    ],
  },
];

const AVATAR_PALETTES = [
  { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" }, // Blue
  { bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" }, // Emerald
  { bg: "#fdf4ff", text: "#a21caf", border: "#f0abfc" }, // Purple
  { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" }, // Orange
  { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" }, // Green
  { bg: "#eef2ff", text: "#4338ca", border: "#c7d2fe" }, // Indigo
  { bg: "#fff1f2", text: "#be123c", border: "#fecdd3" }, // Rose
];

function getAvatarStyle(name = "", code = "") {
  const str = (code + name) || "EMP";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[idx];
}

function getInitials(firstName = "", lastName = "", code = "") {
  if (firstName || lastName) {
    const f = (firstName || "").trim().charAt(0);
    const l = (lastName || "").trim().charAt(0);
    return (f + l).toUpperCase() || "EP";
  }
  if (code) {
    return code.slice(-2).toUpperCase();
  }
  return "EP";
}

function getItemAmountDisplay(item, clientComponents = []) {
  const p = item.payload || {};
  if (item.item_type === "CUSTOM_COMPONENT") {
    if (p.amount != null && p.amount !== "") {
      const comp = clientComponents.find((c) => c.code === p.component_code);
      const isDed = comp?.component_type === "DEDUCTION";
      const sign = isDed ? "-" : "+";
      const cls = isDed ? "text-rose-600 font-bold" : "text-teal-600 font-bold";
      return { text: `${sign}₹${fmtINR(p.amount)}`, className: cls };
    }
  }
  if (["ONE_TIME_EARNING", "REIMBURSEMENT", "ARREARS"].includes(item.item_type)) {
    if (p.amount != null && p.amount !== "") {
      return { text: `+₹${fmtINR(p.amount)}`, className: "text-emerald-600 font-bold" };
    }
  }
  if (["ONE_TIME_DEDUCTION", "TDS", "SALARY_HOLD"].includes(item.item_type)) {
    if (p.amount != null && p.amount !== "") {
      return { text: `-₹${fmtINR(p.amount)}`, className: "text-rose-600 font-bold" };
    }
  }
  if (item.item_type === "ADVANCE") {
    const amt = p.total_amount || p.amount;
    if (amt != null && amt !== "") {
      return { text: `-₹${fmtINR(amt)}`, className: "text-rose-600 font-bold" };
    }
  }
  if (item.item_type === "LOP") {
    if (p.days != null && p.days !== "") {
      return { text: `-${p.days} days LOP`, className: "text-rose-600 font-bold" };
    }
  }
  if (item.item_type === "NEW_EMPLOYEE" || item.item_type === "REVISION") {
    if (p.ctc_annual != null && p.ctc_annual !== "") {
      return { text: `₹${fmtINR(p.ctc_annual)} CTC`, className: "text-slate-600 font-semibold" };
    }
  }
  return { text: "—", className: "text-slate-600 font-semibold" };
}

function getEmployeeInfo(item, employees = []) {
  const p = item.payload || {};
  let emp = null;
  if (p.employee_id) {
    emp = employees.find((e) => String(e.id) === String(p.employee_id));
  }
  if (!emp && p.employee_code) {
    emp = employees.find((e) => e.employee_code === p.employee_code);
  }
  const code = emp?.employee_code || p.employee_code || (p.employee_id ? `EMP#${p.employee_id}` : "");
  const firstName = emp?.first_name || p.first_name || "";
  const lastName = emp?.last_name || p.last_name || "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || "General Adjustment";
  return {
    code: code || "EMP",
    name,
    firstName,
    lastName,
    department: emp?.department || p.department || "",
  };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
}));

const monthLabel = (m, y) =>
  new Date(Number(y), Number(m) - 1, 1).toLocaleString("en", { month: "long" }) + " " + y;

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// "Today" / "Yesterday" / "Sep 1, 2026" — the timeline reads better this way.
const fmtDay = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(dt)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return fmtDate(d);
};

// "1 change" vs "3 changes"
const fmtCount = (n) => {
  const c = Number(n || 0);
  return c === 1 ? "1 change" : `${c} changes`;
};

// A single, friendly sentence telling the client what happens next.
function nextStep(current, pendingCount, appliedCount, skippedCount = 0) {
  if (!current) return "";
  const reason = current.rejection_reason ? `: ${current.rejection_reason}` : "";
  switch (current.status) {
    case "SUBMITTED":
      return pendingCount > 0
        ? "This month is under review, and you've added more since — submit again when ready."
        : "Your changes are with your payroll team. They'll review and apply them, then the month reopens for more changes.";
    case "REJECTED":
      return `Your payroll team returned this month${reason}. Fix the flagged changes and resubmit.`;
    case "APPROVED":
      return "This month was approved. You can still add new changes and resubmit.";
    default: // DRAFT (and the reopened state after an approval)
      if (pendingCount > 0)
        return `${fmtCount(pendingCount)} not yet submitted — review the list and send it for review.`;
      if (skippedCount > 0 && appliedCount === 0)
        return "Your submitted changes were reviewed and excluded by your payroll team. You can fix them or add new changes and resubmit.";
      if (skippedCount > 0 && appliedCount > 0)
        return "Some changes were approved and applied, and some were excluded. You can fix the excluded items or add new changes.";
      if (appliedCount > 0)
        return "Your last changes were approved and applied. Add anything new, or you're all set for this month.";
      return "No changes recorded yet. Add joiners, revisions or one-time amounts from the left.";
  }
}

const ITEM_STATUS_PILL = {
  APPLIED: { tone: "green", label: "Applied", icon: CheckCircle2 },
  PENDING: { tone: "amber", label: "Pending", icon: null },
  FAILED: { tone: "red", label: "Needs Attention", icon: null },
  SKIPPED: { tone: "rose", label: "Excluded", icon: Ban },
};

const EVENT_TITLE = {
  SUBMITTED: "Changes submitted for review",
  APPROVED: "Changes approved and applied",
  REJECTED: "Changes returned",
};
const EVENT_TONE = { SUBMITTED: "amber", APPROVED: "green", REJECTED: "red" };
const EVENT_BADGE = { SUBMITTED: "SUBMITTED", APPROVED: "APPROVED", REJECTED: "RETURNED" };
const EVENT_ICON = { SUBMITTED: Clock, APPROVED: CheckCircle2, REJECTED: MinusCircle };

// "EMP102 — Priya Nair" for a payload's employee_id.
function employeeLabel(employeeId, employees = []) {
  const emp = employees.find((e) => String(e.id) === String(employeeId));
  if (!emp) return `Employee #${employeeId}`;
  const name = [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim();
  return name ? `${emp.employee_code} — ${name}` : emp.employee_code || `Employee #${employeeId}`;
}

function summary(item, employees = []) {
  const p = item.payload || {};
  const bits = [];
  if (p.employee_code) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    bits.push(name ? `${p.employee_code} — ${name}` : p.employee_code);
  } else if (p.first_name) {
    bits.push([p.first_name, p.last_name].filter(Boolean).join(" "));
  }
  // Resolve the target employee so "who the money/change is for" is always
  // visible — an earning/deduction/advance/hold/revision all reference an
  // employee_id, not a name.
  if (p.employee_id) bits.push(employeeLabel(p.employee_id, employees));
  if (p.ctc_annual) bits.push(`CTC ₹${fmtINR(p.ctc_annual)}`);
  if (p.effective_from) bits.push(`from ${p.effective_from}`);
  if (p.last_working_date) bits.push(`LWD ${p.last_working_date}`);
  if (p.total_amount) bits.push(`₹${fmtINR(p.total_amount)} over ${p.tenure_months} mo`);
  if (p.days) bits.push(`${p.days} days LOP`);
  if (p.component_code) bits.push(p.component_code);
  if (p.amount) bits.push(item.item_type === "TDS" ? `TDS ₹${fmtINR(p.amount)}` : `₹${fmtINR(p.amount)}`);
  if (p.release_month && p.release_year) {
    const m = MONTHS.find((x) => String(x.value) === String(p.release_month));
    bits.push(`release ${m ? m.label : p.release_month} ${p.release_year}`);
  }
  if (p.text) bits.push(p.text);
  if (p.description) bits.push(`(${p.description})`);
  if (p.reason) bits.push(`(${p.reason})`);
  if (p.note) bits.push(`(${p.note})`);
  if (p.label) bits.push(`(${p.label})`);
  return bits.join(" · ") || "—";
}

// Friendly labels for the expanded "all details" view of a change.
const FIELD_LABEL = {
  employee_id: "Employee",
  employee_code: "Employee Code",
  first_name: "First Name",
  last_name: "Last Name",
  ctc_annual: "Annual CTC",
  pf_opted: "PF Opted",
  uan_number: "UAN Number",
  esi_opted: "ESI Opted",
  esi_number: "ESI Number",
  hire_date: "Hire Date",
  email: "Email",
  pan_number: "PAN",
  department: "Department",
  position: "Position",
  effective_from: "Effective From",
  nps_allowance: "NPS Allowance",
  fbp: "FBP",
  vpf: "VPF",
  change_reason: "Reason",
  last_working_date: "Last Working Date",
  amount: "Amount",
  component_code: "Component",
  days: "Days",
  note: "Note",
  release_month: "Release Month",
  release_year: "Release Year",
  reason: "Reason",
  total_amount: "Total Amount",
  tenure_months: "Tenure (months)",
  label: "Label",
  description: "Description",
  text: "Note",
};
const MONEY_KEYS = new Set([
  "ctc_annual", "amount", "total_amount", "nps_allowance", "fbp", "vpf",
]);

function detailRows(item, employees = []) {
  const p = item.payload || {};
  return Object.entries(p)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => {
      let value = v;
      if (k === "employee_id") value = employeeLabel(v, employees);
      else if (typeof v === "boolean") value = v ? "Yes" : "No";
      else if (k === "release_month") {
        const m = MONTHS.find((x) => String(x.value) === String(v));
        value = m ? m.label : v;
      } else if (MONEY_KEYS.has(k)) value = `₹${fmtINR(v)}`;
      return { key: k, label: FIELD_LABEL[k] || k.replace(/_/g, " "), value: String(value) };
    });
}

const DEFAULT_PAYLOAD = {
  NEW_EMPLOYEE: {
    employee_code: "", first_name: "", last_name: "", ctc_annual: "", pf_opted: true, uan_number: "", esi_opted: false, esi_number: "",
    hire_date: "", email: "", pan_number: "", department: "", position: "",
    effective_from: "", nps_allowance: "", fbp: "", vpf: "",
  },
  REVISION: {
    employee_id: "", effective_from: "", ctc_annual: "", pf_opted: true, esi_opted: false,
    change_reason: "", nps_allowance: "", fbp: "", vpf: "",
  },
  EXIT: { employee_id: "", last_working_date: "" },
  SALARY_HOLD: { employee_id: "", amount: "", release_month: "", release_year: "", reason: "" },
  REIMBURSEMENT: { employee_id: "", amount: "", description: "" },
  LOP: { employee_id: "", days: "", reason: "" },
  ARREARS: { employee_id: "", amount: "", reason: "" },
  TDS: { employee_id: "", amount: "", note: "" },
  ADVANCE: { employee_id: "", total_amount: "", tenure_months: "", label: "" },
  ONE_TIME_EARNING: { employee_id: "", amount: "", description: "" },
  ONE_TIME_DEDUCTION: { employee_id: "", amount: "", description: "" },
  CUSTOM_COMPONENT: { employee_id: "", component_code: "", amount: "", description: "" },
};

function normalizePayload(type, p) {
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
  if ("days" in clean) clean.days = Number(clean.days);
  if ("uan_number" in clean) {
    clean.uan_number = String(clean.uan_number).replace(/\D/g, "").slice(0, 12);
  }
  return clean;
}

function ItemForm({ type, employees, clientComponents = [], onSave, saving, releaseDefault, initial }) {
  const [p, setP] = useState(() => {
    const base = { ...DEFAULT_PAYLOAD[type] };
    if (type === "SALARY_HOLD" && releaseDefault) {
      base.release_month = String(releaseDefault.month);
      base.release_year = String(releaseDefault.year);
    }
    // Editing an existing change — prefill with what was saved.
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        base[k] = typeof v === "boolean" ? v : String(v);
      }
    }
    return base;
  });
  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    onSave(type, normalizePayload(type, p));
  };

  const num = (label, key, hint, className = "", prefix = "₹") => (
    <Field label={label} hint={hint} className={className}>
      <NumberInput prefix={prefix} value={p[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <form onSubmit={submit} id="portal-item-form">
      {type === "NEW_EMPLOYEE" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
          <Field label="Employee Code *">
            <TextInput value={p.employee_code} onChange={(e) => set("employee_code", e.target.value)} placeholder="e.g. EMP-101" />
          </Field>
          <Field label="First Name *">
            <TextInput value={p.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="First" />
          </Field>
          <Field label="Last Name">
            <TextInput value={p.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Last" />
          </Field>
          <Field label="Hire Date">
            <DateInput value={p.hire_date} onChange={(e) => set("hire_date", e.target.value)} />
          </Field>
          <Field label="Effective From *">
            <DateInput value={p.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
          </Field>
          {num("Annual CTC *", "ctc_annual", "", "", "₹")}

          <Field label="Department">
            <TextInput value={p.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Engineering" />
          </Field>
          <Field label="Position">
            <TextInput value={p.position} onChange={(e) => set("position", e.target.value)} placeholder="e.g. Associate" />
          </Field>
          <Field label="Employment Type">
            <select
              className="w-full rounded-lg px-3 py-2 text-sm border border-slate-300 bg-white font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
              value={p.employment_type || "REGULAR"}
              onChange={(e) => {
                const val = e.target.value;
                set("employment_type", val);
                if (val === "INTERN") {
                  set("is_intern", true);
                  set("pf_opted", false);
                  set("esi_opted", false);
                } else {
                  set("is_intern", false);
                }
              }}
            >
              <option value="REGULAR">💼 Regular Staff (Standard Salary)</option>
              <option value="INTERN">🎓 Intern / Apprentice (Stipend — Exempt from PF/ESI)</option>
              <option value="CONSULTANT">🤝 Consultant / Retainer (Professional Fees)</option>
            </select>
          </Field>
          <div className="flex flex-col justify-end">
            <Checkbox label="PF opted (EPF)" checked={p.pf_opted} onChange={(e) => set("pf_opted", e.target.checked)} />
            <Checkbox label="ESI opted (Gross ≤ ₹21k)" checked={p.esi_opted} onChange={(e) => set("esi_opted", e.target.checked)} />
          </div>

          {p.employment_type === "INTERN" && (
            <div className="col-span-full rounded-lg p-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 flex items-start gap-2">
              <span className="text-base leading-none">💡</span>
              <div>
                <strong>Internship Mode:</strong> This new joiner receives an educational monthly stipend.
                Payslips will title as <em>STIPEND SLIP</em>, and EPF / ESI statutory deductions are exempt by default.
              </div>
            </div>
          )}
          {p.employment_type === "CONSULTANT" && (
            <div className="col-span-full rounded-lg p-2.5 text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 flex items-start gap-2">
              <span className="text-base leading-none">💡</span>
              <div>
                <strong>Consultant Mode:</strong> Professional retainer contract. Exempt from statutory EPF / ESI deductions.
              </div>
            </div>
          )}

          {p.pf_opted && (
            <Field label="UAN Number (12-digit EPF)">
              <TextInput
                value={p.uan_number || ""}
                onChange={(e) => set("uan_number", e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="100123456789"
                maxLength={12}
              />
            </Field>
          )}

          <Field label="ESI Number (IP No)">
            <TextInput value={p.esi_number} onChange={(e) => set("esi_number", e.target.value)} placeholder="10-digit ESI IP number" />
          </Field>

          <Field label="Bank Account Number">
            <TextInput
              value={p.bank_account_number || ""}
              onChange={(e) => set("bank_account_number", e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 50100234567890"
            />
          </Field>

          <Field label="Bank IFSC Code">
            <TextInput
              value={p.bank_ifsc_code || ""}
              onChange={(e) => {
                const ifsc = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
                set("bank_ifsc_code", ifsc);
                if (!p.bank_name && ifsc.length >= 4) {
                  const prefix = ifsc.slice(0, 4);
                  const bankMap = {
                    HDFC: "HDFC Bank",
                    SBIN: "State Bank of India",
                    ICIC: "ICICI Bank",
                    UTIB: "Axis Bank",
                    KKBK: "Kotak Mahindra Bank",
                    BARB: "Bank of Baroda",
                    PUNB: "Punjab National Bank",
                    IDFB: "IDFC FIRST Bank",
                    YESB: "Yes Bank",
                    INDB: "IndusInd Bank",
                    CNRB: "Canara Bank",
                    UBIN: "Union Bank of India",
                  };
                  if (bankMap[prefix]) {
                    set("bank_name", bankMap[prefix]);
                  }
                }
              }}
              placeholder="e.g. HDFC0001234"
              maxLength={11}
            />
          </Field>

          <Field label="Bank Name">
            <TextInput
              value={p.bank_name || ""}
              onChange={(e) => set("bank_name", e.target.value)}
              placeholder="e.g. HDFC Bank"
            />
          </Field>

          <Field label="PAN">
            <TextInput value={p.pan_number} onChange={(e) => set("pan_number", e.target.value)} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={p.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" />
          </Field>
          {num("NPS Allowance", "nps_allowance", "", "", "₹")}

          {num("FBP", "fbp", "", "", "₹")}
          {num("VPF", "vpf", "", "", "₹")}
        </div>
      )}

      {type === "REVISION" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
          <Field label="Employee *" className="col-span-1 sm:col-span-2 lg:col-span-3">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          <Field label="Effective From *">
            <DateInput value={p.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
          </Field>
          {num("Revised Annual CTC *", "ctc_annual", "", "", "₹")}
          <div className="flex flex-col justify-end">
            <Checkbox label="PF opted (EPF)" checked={p.pf_opted} onChange={(e) => set("pf_opted", e.target.checked)} />
            <Checkbox label="ESI opted (Gross ≤ ₹21k)" checked={p.esi_opted} onChange={(e) => set("esi_opted", e.target.checked)} />
          </div>

          <Field label="ESI Number (IP No)">
            <TextInput value={p.esi_number} onChange={(e) => set("esi_number", e.target.value)} placeholder="10-digit ESI IP number" />
          </Field>

          <Field label="Reason / note" className="col-span-1 sm:col-span-2 lg:col-span-3">
            <TextInput value={p.change_reason} onChange={(e) => set("change_reason", e.target.value)} placeholder="e.g. Annual appraisal / Promotion" />
          </Field>
          {num("NPS Allowance", "nps_allowance", "", "", "₹")}
          {num("FBP", "fbp", "", "", "₹")}
          {num("VPF", "vpf", "", "", "₹")}
        </div>
      )}

      {type === "EXIT" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          <Field label="Last Working Date *" className="sm:col-span-2">
            <DateInput value={p.last_working_date} onChange={(e) => set("last_working_date", e.target.value)} />
          </Field>
        </div>
      )}

      {type === "SALARY_HOLD" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("Amount to Hold *", "amount", "", "", "₹")}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Release Month *">
              <SelectInput options={MONTHS} value={p.release_month} onChange={(e) => set("release_month", e.target.value)} />
            </Field>
            <Field label="Release Year *">
              <NumberInput value={p.release_year} onChange={(e) => set("release_year", e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" className="sm:col-span-2">
            <TextInput value={p.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Notice period / incomplete handover" />
          </Field>
        </div>
      )}

      {type === "ADVANCE" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("Total Amount *", "total_amount", "", "", "₹")}
          <Field label="Tenure (months) *">
            <NumberInput value={p.tenure_months} onChange={(e) => set("tenure_months", e.target.value)} placeholder="e.g. 6" />
          </Field>
          <Field label="Label / Purpose" className="sm:col-span-2">
            <TextInput value={p.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Soft loan / Salary advance" />
          </Field>
        </div>
      )}

      {(type === "ONE_TIME_EARNING" || type === "ONE_TIME_DEDUCTION") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("Amount *", "amount", "", "sm:col-span-2", "₹")}
          <Field label="Description" className="sm:col-span-2">
            <TextInput value={p.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Retention bonus / Performance award / Deduction note" />
          </Field>
        </div>
      )}

      {type === "REIMBURSEMENT" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("Amount (₹) *", "amount", "", "sm:col-span-2", "₹")}
          <Field label="Description / Nature" className="sm:col-span-2">
            <TextInput value={p.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Travel / Fuel / Mobile bills" />
          </Field>
        </div>
      )}

      {type === "LOP" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          <Field label="LOP Days *" className="sm:col-span-2">
            <TextInput type="number" step="0.5" value={p.days} onChange={(e) => set("days", e.target.value)} placeholder="e.g. 1, 1.5, 2" />
          </Field>
          <Field label="Reason / Note" className="sm:col-span-2">
            <TextInput value={p.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Unapproved leave / Absenteeism" />
          </Field>
        </div>
      )}

      {type === "ARREARS" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("Arrears Amount (₹) *", "amount", "", "sm:col-span-2", "₹")}
          <Field label="Reason / Period" className="sm:col-span-2">
            <TextInput value={p.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. April increment revision arrears" />
          </Field>
        </div>
      )}

      {type === "TDS" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          {num("TDS Amount (₹) *", "amount", "", "sm:col-span-2", "₹")}
          <Field label="Tax Note / Instruction" className="sm:col-span-2">
            <TextInput value={p.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. Director tax deduction adjustment" />
          </Field>
        </div>
      )}

      {type === "CUSTOM_COMPONENT" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee *" className="sm:col-span-2">
            <SearchableEmployeeSelect employees={employees} value={p.employee_id} onChange={(id) => set("employee_id", id)} />
          </Field>
          <Field label="Custom Component *" className="sm:col-span-2">
            <SelectInput
              placeholder="— Select an allowance or deduction —"
              options={(() => {
                const valid = clientComponents.filter(
                  (c) => !c.code?.startsWith("__") && !c.statistical_component && (c.component_type === "EARNING" || c.component_type === "DEDUCTION")
                );
                const earnings = valid.filter((c) => c.component_type === "EARNING");
                const deductions = valid.filter((c) => c.component_type === "DEDUCTION");
                const formatOpt = (c) => ({
                  value: c.code,
                  label: `${c.name} (${c.code})${c.is_monthly_variable ? " · Monthly Variable" : ""}${c.default_amount ? ` · Default: ₹${Number(c.default_amount).toLocaleString("en-IN")}` : ""}`,
                });
                const groups = [];
                if (earnings.length > 0) {
                  groups.push({
                    group: "Allowances & Earnings",
                    options: earnings.map(formatOpt),
                  });
                }
                if (deductions.length > 0) {
                  groups.push({
                    group: "Deductions & Recoveries",
                    options: deductions.map(formatOpt),
                  });
                }
                return groups.length > 0 ? groups : valid.map(formatOpt);
              })()}
              value={p.component_code}
              onChange={(e) => {
                const code = e.target.value;
                const comp = clientComponents.find((c) => c.code === code);
                setP((s) => ({
                  ...s,
                  component_code: code,
                  ...(comp && comp.default_amount && (!s.amount || s.amount === "0") ? { amount: String(comp.default_amount) } : {}),
                }));
              }}
            />
          </Field>
          {num("Amount (₹) *", "amount", "", "sm:col-span-2", "₹")}
          <Field label="Description / Remarks" className="sm:col-span-2">
            <TextInput value={p.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Monthly fuel allowance / equipment recovery" />
          </Field>
        </div>
      )}
    </form>
  );
}

/* ── small presentational helpers ─────────────────────────────────── */

function SectionHead({ icon: Icon, emoji, title, right }) {
  return (
    <div className="sec-head">
      <div className="sec-head-left">
        {emoji ? (
          <span className="sec-emoji">{emoji}</span>
        ) : Icon ? (
          <span className="sec-icon"><Icon size={15} /></span>
        ) : null}
        <h3 className="sec-title">{title}</h3>
      </div>
      {right}
    </div>
  );
}

function StatTile({ tone, value, label }) {
  return (
    <div className={`stat-tile stat-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function BreakdownRow({ icon: Icon, tone, label, count }) {
  return (
    <div className="bd-row">
      <span className={`bd-icon tone-${tone}`}><Icon size={16} /></span>
      <span className="bd-label">{label}</span>
      <span className="bd-count">{fmtCount(count)}</span>
    </div>
  );
}

const EXCEL_SHEET_TABS = [
  { key: "ALL", label: "All Items" },
  { key: "NEW_EMPLOYEE", label: "New Employee" },
  { key: "REVISION", label: "Salary Revision" },
  { key: "EXIT", label: "Exit / Resignation" },
  { key: "SALARY_HOLD", label: "Salary Hold" },
  { key: "REIMBURSEMENT", label: "Reimbursements" },
  { key: "LOP", label: "Loss of Pay" },
  { key: "ARREARS", label: "Salary Arrears" },
  { key: "TDS", label: "TDS (Admin Only)", adminOnly: true },
  { key: "ADVANCE", label: "Advance / Loan" },
  { key: "ONE_TIME_EARNING", label: "Extra Payment" },
  { key: "ONE_TIME_DEDUCTION", label: "Deduction" },
  { key: "CUSTOM_COMPONENT", label: "Custom Component" },
  { key: "NOTE", label: "Note" },
];

const EXCEL_FEATURES = [
  { label: "Add New Employee", desc: "Add someone joining this month", icon: UserPlus, tone: "blue" },
  { label: "Update Salary", desc: "Change salary or CTC", icon: TrendingUp, tone: "violet" },
  { label: "Record Exit", desc: "Tell us about an employee leaving", icon: UserMinus, tone: "rose" },
  { label: "Hold Salary", desc: "Hold salary for later release", icon: PauseCircle, tone: "indigo" },
  { label: "Add Reimbursement", desc: "Expense claims (travel, fuel, bills)", icon: CreditCard, tone: "blue" },
  { label: "Record Loss of Pay", desc: "Unpaid absence or leave days", icon: CalendarX, tone: "rose" },
  { label: "Add Salary Arrears", desc: "Retroactive salary or increment", icon: ArrowUpRight, tone: "green" },
  { label: "Add TDS (Income Tax)", desc: "Tax adjustment (Client Admin only)", icon: Receipt, tone: "coral", adminOnly: true },
  { label: "Add Advance / Loan", desc: "Give an advance or loan", icon: Wallet, tone: "amber" },
  { label: "Add Extra Payment", desc: "Bonus, arrears or extra payout", icon: Plus, tone: "violet" },
  { label: "Add Deduction", desc: "One-time or other deduction", icon: Minus, tone: "rose" },
  { label: "Add Custom Component", desc: "Variable allowance, perk or deduction (e.g. Fuel, Penalty)", icon: Layers, tone: "teal" },
  { label: "Send a Note", desc: "Leave a message for payroll team", icon: MessageSquareText, tone: "blue" },
];

function ExcelUploadModal({ current, employees = [], clientComponents = [], isClientAdmin, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [step, setStep] = useState("upload");
  const [editReview, setEditReview] = useState(false);
  const [activeTab, setActiveTab] = useState("ALL");
  const [parsedItems, setParsedItems] = useState([]);
  const [parsedNotes, setParsedNotes] = useState("");
  const [uploadedFilePath, setUploadedFilePath] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const fileInputRef = useRef(null);

  const empOptions = employees.map((e) => ({
    value: String(e.id),
    label: `${e.employee_code} — ${e.full_name || [e.first_name, e.last_name].filter(Boolean).join(" ")}`,
  }));

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError("");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError("");
    }
  };

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    setError("");
    try {
      await api.download(
        `/payroll-portal/submissions/${current.id}/template/`,
        `payroll-template-${monthLabel(current.month, current.year).replace(/\s+/g, "-").toLowerCase()}.xlsx`
      );
    } catch (e) {
      setError(e.message || "Failed to download template.");
    } finally {
      setDownloading(false);
    }
  };

  const handleParse = async () => {
    if (!file) {
      setError("Please select an Excel workbook (.xlsx) first.");
      return;
    }
    setParsing(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.upload(
        `/payroll-portal/submissions/${current.id}/parse-excel/`,
        formData
      );
      setParsedItems(Array.isArray(res.items) ? res.items : []);
      setParsedNotes(res.notes || "");
      setWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setUploadedFilePath(res.file_path || null);
      setUploadedFileName(res.file_name || file.name || null);
      setStep("review");
      setEditReview(false);
      setActiveTab("ALL");
    } catch (e) {
      setError(e.message || "Failed to parse Excel file.");
    } finally {
      setParsing(false);
    }
  };

  const handleFieldChange = (itemIdx, field, val) => {
    setParsedItems((prev) => {
      const next = [...prev];
      const item = next[itemIdx];
      if (!item) return prev;
      next[itemIdx] = {
        ...item,
        payload: {
          ...item.payload,
          [field]: val,
        },
      };
      return next;
    });
  };

  const handleDeleteItem = (itemIdx) => {
    setParsedItems((prev) => prev.filter((_, idx) => idx !== itemIdx));
  };

  const handleCommit = async () => {
    setCommitting(true);
    setError("");
    try {
      const cleanItems = parsedItems.map((it) => ({
        item_type: it.item_type,
        payload: normalizePayload(it.item_type, it.payload || {}),
      }));
      await api.post(`/payroll-portal/submissions/${current.id}/commit-excel/`, {
        items: cleanItems,
        notes: parsedNotes,
        file_path: uploadedFilePath,
        file_name: uploadedFileName,
      });
      onSuccess(parsedNotes);
    } catch (e) {
      setError(e.message || "Failed to stage Excel changes.");
    } finally {
      setCommitting(false);
    }
  };

  const getTabCount = (tabKey) => {
    if (tabKey === "ALL") return parsedItems.length;
    if (tabKey === "NOTE") return parsedNotes ? 1 : 0;
    return parsedItems.filter((it) => it.item_type === tabKey).length;
  };

  const indexedItems = parsedItems.map((item, originalIndex) => ({ item, originalIndex }));
  const visibleItems =
    activeTab === "ALL"
      ? indexedItems
      : activeTab === "NOTE"
        ? []
        : indexedItems.filter(({ item }) => item.item_type === activeTab);

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2 text-base font-bold text-slate-800">
          <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
            <FileSpreadsheet size={16} />
          </span>
          {step === "upload" ? "Upload Monthly Changes Excel" : "Review & Approve Excel Changes"}
        </span>
      }
      onClose={onClose}
      overlayClassName="z-high"
      panelClassName="modal-panel-wide"
      footer={
        step === "upload" ? (
          <div className="flex items-center justify-end gap-2 w-full">
            <Button type="button" variant="secondary" onClick={onClose} disabled={parsing}>
              Cancel
            </Button>
            <Button type="button" onClick={handleParse} disabled={!file || parsing}>
              {parsing ? "Parsing Workbook…" : "Parse & Review File"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 w-full" style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              <strong>{parsedItems.length}</strong> change{parsedItems.length === 1 ? "" : "s"} ready to stage
              {parsedNotes ? " · Note included" : ""}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Button type="button" variant="secondary" onClick={onClose} disabled={committing}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCommit}
                disabled={committing || (parsedItems.length === 0 && !parsedNotes)}
              >
                {committing ? "Importing…" : `Approve & Import (${parsedItems.length})`}
              </Button>
            </div>
          </div>
        )
      }
    >
      <ErrorBanner message={error} />

      {step === "upload" && (
        <div>
          <div
            className={`rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${dragOver
                ? "border-blue-500 bg-blue-50/60 ring-4 ring-blue-100"
                : "border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/30"
              }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept=".xlsx,.xls"
              onChange={handleFileChange}
            />
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
              <Upload size={24} />
            </div>
            <div className="text-sm font-bold text-slate-800">
              {file ? file.name : "Click or drag & drop filled Excel workbook here"}
            </div>
            <div className="text-xs text-slate-500 mt-1 max-w-sm">
              Supports .xlsx files generated from the official multi-sheet monthly changes template
            </div>
            {file && (
              <span className="inline-flex items-center gap-1.5 mt-3.5 px-3 py-1 rounded-full bg-blue-100 border border-blue-200 text-blue-800 text-xs font-semibold">
                <FileSpreadsheet size={14} /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Need the official template containing all 12 pre-formatted change sheets & employee references?
            </span>
            <Button
              variant="secondary"
              className="btn-icon"
              onClick={handleDownloadTemplate}
              disabled={!current || downloading}
              title="Download multi-sheet Excel template for monthly changes"
            >
              <span className="btn-unicode">📄</span> {downloading ? "Downloading…" : "Download Template"}
            </Button>
          </div>

        </div>
      )}

      {step === "review" && (
        <div>
          <div className="review-header-bar">
            <div className="review-counts-badge">
              <FileSpreadsheet size={17} style={{ color: "#2563eb" }} />
              <span>{parsedItems.length} changes detected</span>
              {parsedNotes ? <Badge tone="blue">Note included</Badge> : null}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className={`edit-review-toggle ${editReview ? "active" : ""}`}
                onClick={() => setEditReview(!editReview)}
                title="Toggle inline editing to edit or remove rows before approving"
              >
                <span className={`toggle-indicator ${editReview ? "active" : ""}`} />
                <span>Edit Review: {editReview ? "ON" : "OFF"}</span>
              </button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { setStep("upload"); setFile(null); }}
              >
                Upload Different File
              </Button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div
              className="review-warnings-box"
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 12,
                padding: "12px 16px",
                marginBottom: 16,
              }}
            >
              <div
                className="review-warnings-title"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#b45309",
                  marginBottom: 8,
                }}
              >
                <span>⚠️</span> {warnings.length} warning{warnings.length > 1 ? "s" : ""} during Excel parsing
              </div>
              <ul
                className="review-warnings-list"
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12.5,
                  color: "#92400e",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {warnings.map((w, i) => {
                  const isObj = typeof w === "object" && w !== null;
                  const sheet = isObj ? w.sheet : "";
                  const row = isObj ? w.row : "";
                  const msg = isObj ? (w.message || JSON.stringify(w)) : String(w);
                  return (
                    <li key={i} style={{ lineHeight: 1.4 }}>
                      {sheet && <strong style={{ color: "#78350f" }}>[{sheet}] </strong>}
                      {row ? <span style={{ opacity: 0.85 }}>Row {row}: </span> : null}
                      {msg}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {editReview && (
            <div style={{ padding: "8px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12.5, color: "#1d4ed8", display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Pencil size={14} />
              <span><strong>Edit Mode Active:</strong> You can edit fields inline or remove rows below before clicking Approve & Import.</span>
            </div>
          )}

          {/* Filter tabs */}
          <div className="review-tabs-bar">
            {EXCEL_SHEET_TABS.filter((tab) => !tab.adminOnly || isClientAdmin).map((tab) => {
              const count = getTabCount(tab.key);
              if (tab.key !== "ALL" && count === 0 && !editReview) return null;
              return (
                <button
                  type="button"
                  key={tab.key}
                  className={`review-tab ${activeTab === tab.key ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span>{tab.label}</span>
                  <span className="review-tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Review Rows */}
          <div className="review-items-list">
            {visibleItems.length === 0 && (activeTab !== "NOTE" || !parsedNotes) && (
              <EmptyState
                title="No items in this category"
                hint="No rows were found in this Excel sheet. Switch to another tab or edit above."
              />
            )}

            {visibleItems.map(({ item, originalIndex }) => {
              const p = item.payload || {};
              const TypeIcon = TYPE_ICON[item.item_type] || FileText;

              return (
                <div key={item.temp_id || originalIndex} className={`review-item-card ${editReview ? "item-edit-mode" : ""}`}>
                  <div className="review-item-view">
                    <div className="review-item-left">
                      <span className={`review-item-type-badge tone-${TYPE_TONE[item.item_type] || "blue"}`}>
                        <TypeIcon size={12} style={{ display: "inline-block", marginRight: 4, verticalAlign: "-1px" }} />
                        {TYPE_LABEL[item.item_type] || item.item_type}
                      </span>
                      <div>
                        <div className="review-item-who">
                          {item.item_type === "NEW_EMPLOYEE" ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <span>{`${p.employee_code || "New"} — ${[p.first_name, p.last_name].filter(Boolean).join(" ")}`}</span>
                              {(p.employment_type === "INTERN" || p.is_intern) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  🎓 Intern
                                </span>
                              )}
                              {p.employment_type === "CONSULTANT" && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  🤝 Consultant
                                </span>
                              )}
                            </span>
                          ) : (
                            employeeLabel(p.employee_id, employees)
                          )}
                        </div>
                        <div className="review-item-sub">
                          {summary(item, employees)}
                        </div>
                      </div>
                    </div>

                    <div className="review-item-right">
                      {editReview ? (
                        <button
                          type="button"
                          className="review-del-btn"
                          title="Remove this row"
                          onClick={() => handleDeleteItem(originalIndex)}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <CheckCircle2 size={16} style={{ color: "#059669" }} />
                      )}
                    </div>
                  </div>

                  {/* Inline editable fields when editReview is ON */}
                  {editReview && (
                    <div className="review-item-edit-grid">
                      {item.item_type === "NEW_EMPLOYEE" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Emp Code *</span>
                            <input
                              className="review-input-ctrl"
                              value={p.employee_code || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_code", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">First Name *</span>
                            <input
                              className="review-input-ctrl"
                              value={p.first_name || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "first_name", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Last Name</span>
                            <input
                              className="review-input-ctrl"
                              value={p.last_name || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "last_name", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Annual CTC *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.ctc_annual || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "ctc_annual", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Hire Date</span>
                            <input
                              className="review-input-ctrl"
                              type="date"
                              value={p.hire_date || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "hire_date", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Effective From</span>
                            <input
                              className="review-input-ctrl"
                              type="date"
                              value={p.effective_from || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "effective_from", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Email</span>
                            <input
                              className="review-input-ctrl"
                              type="email"
                              value={p.email || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "email", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">PAN</span>
                            <input
                              className="review-input-ctrl"
                              value={p.pan_number || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "pan_number", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Department</span>
                            <input
                              className="review-input-ctrl"
                              value={p.department || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "department", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Position</span>
                            <input
                              className="review-input-ctrl"
                              value={p.position || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "position", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Employment Type</span>
                            <select
                              className="review-input-ctrl font-medium"
                              value={p.employment_type || (p.is_intern ? "INTERN" : "REGULAR")}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleFieldChange(originalIndex, "employment_type", val);
                                handleFieldChange(originalIndex, "is_intern", val === "INTERN");
                                if (val === "INTERN") {
                                  handleFieldChange(originalIndex, "pf_opted", false);
                                  handleFieldChange(originalIndex, "esi_opted", false);
                                }
                              }}
                            >
                              <option value="REGULAR">💼 Regular Staff</option>
                              <option value="INTERN">🎓 Intern / Apprentice</option>
                              <option value="CONSULTANT">🤝 Consultant / Retainer</option>
                            </select>
                          </div>
                          <div className="review-input-field" style={{ justifyContent: "flex-end" }}>
                            <label className="checkbox" style={{ margin: 0, paddingBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={p.pf_opted !== false}
                                onChange={(e) => handleFieldChange(originalIndex, "pf_opted", e.target.checked)}
                              />
                              <span style={{ fontSize: 12 }}>PF Opted</span>
                            </label>
                          </div>
                          {p.pf_opted !== false && (
                            <div className="review-input-field">
                              <span className="review-input-label">UAN Number (PF)</span>
                              <input
                                className="review-input-ctrl"
                                value={p.uan_number || ""}
                                onChange={(e) => handleFieldChange(originalIndex, "uan_number", e.target.value.replace(/\D/g, "").slice(0, 12))}
                                placeholder="100123456789"
                                maxLength={12}
                              />
                            </div>
                          )}
                          <div className="review-input-field">
                            <span className="review-input-label">Bank Account Number</span>
                            <input
                              className="review-input-ctrl"
                              value={p.bank_account_number || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "bank_account_number", e.target.value.replace(/\D/g, ""))}
                              placeholder="e.g. 50100234567890"
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Bank IFSC Code</span>
                            <input
                              className="review-input-ctrl font-mono"
                              value={p.bank_ifsc_code || ""}
                              onChange={(e) => {
                                const ifsc = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
                                handleFieldChange(originalIndex, "bank_ifsc_code", ifsc);
                                if (!p.bank_name && ifsc.length >= 4) {
                                  const prefix = ifsc.slice(0, 4);
                                  const bankMap = {
                                    HDFC: "HDFC Bank",
                                    SBIN: "State Bank of India",
                                    ICIC: "ICICI Bank",
                                    UTIB: "Axis Bank",
                                    KKBK: "Kotak Mahindra Bank",
                                    BARB: "Bank of Baroda",
                                    PUNB: "Punjab National Bank",
                                    IDFB: "IDFC FIRST Bank",
                                    YESB: "Yes Bank",
                                    INDB: "IndusInd Bank",
                                    CNRB: "Canara Bank",
                                    UBIN: "Union Bank of India",
                                  };
                                  if (bankMap[prefix]) {
                                    handleFieldChange(originalIndex, "bank_name", bankMap[prefix]);
                                  }
                                }
                              }}
                              placeholder="e.g. HDFC0001234"
                              maxLength={11}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Bank Name</span>
                            <input
                              className="review-input-ctrl"
                              value={p.bank_name || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "bank_name", e.target.value)}
                              placeholder="e.g. HDFC Bank"
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "REVISION" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Effective From *</span>
                            <input
                              className="review-input-ctrl"
                              type="date"
                              value={p.effective_from || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "effective_from", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Revised CTC *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.ctc_annual || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "ctc_annual", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Reason</span>
                            <input
                              className="review-input-ctrl"
                              value={p.change_reason || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "change_reason", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field" style={{ justifyContent: "flex-end" }}>
                            <label className="checkbox" style={{ margin: 0, paddingBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={p.pf_opted !== false}
                                onChange={(e) => handleFieldChange(originalIndex, "pf_opted", e.target.checked)}
                              />
                              <span style={{ fontSize: 12 }}>PF Opted</span>
                            </label>
                          </div>
                        </>
                      )}

                      {item.item_type === "EXIT" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Last Working Date *</span>
                            <input
                              className="review-input-ctrl"
                              type="date"
                              value={p.last_working_date || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "last_working_date", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "SALARY_HOLD" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Amount *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Release Month</span>
                            <select
                              className="review-input-ctrl"
                              value={p.release_month || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "release_month", e.target.value)}
                            >
                              <option value="">Month…</option>
                              {MONTHS.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Release Year</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.release_year || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "release_year", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Reason</span>
                            <input
                              className="review-input-ctrl"
                              value={p.reason || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "reason", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "ADVANCE" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Total Amount *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.total_amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "total_amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Tenure (months) *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.tenure_months || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "tenure_months", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Label / Reason</span>
                            <input
                              className="review-input-ctrl"
                              value={p.label || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "label", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "ONE_TIME_EARNING" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Amount *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Description</span>
                            <input
                              className="review-input-ctrl"
                              value={p.description || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "description", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "ONE_TIME_DEDUCTION" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Amount *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Description</span>
                            <input
                              className="review-input-ctrl"
                              value={p.description || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "description", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "REIMBURSEMENT" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Amount (₹) *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Description</span>
                            <input
                              className="review-input-ctrl"
                              value={p.description || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "description", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "CUSTOM_COMPONENT" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Component *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.component_code || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "component_code", e.target.value)}
                            >
                              <option value="">Select Component…</option>
                              {clientComponents
                                .filter((c) => !c.code?.startsWith("__") && !c.statistical_component && (c.component_type === "EARNING" || c.component_type === "DEDUCTION"))
                                .map((c) => (
                                  <option key={c.code} value={c.code}>{c.name} ({c.code}) · {c.component_type === "EARNING" ? "Earning" : "Deduction"}</option>
                                ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Amount (₹) *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Description</span>
                            <input
                              className="review-input-ctrl"
                              value={p.description || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "description", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "LOP" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">LOP Days *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              step="0.5"
                              value={p.days || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "days", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Reason</span>
                            <input
                              className="review-input-ctrl"
                              value={p.reason || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "reason", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "ARREARS" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Arrears Amount (₹) *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Reason / Period</span>
                            <input
                              className="review-input-ctrl"
                              value={p.reason || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "reason", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {item.item_type === "TDS" && (
                        <>
                          <div className="review-input-field">
                            <span className="review-input-label">Employee *</span>
                            <select
                              className="review-input-ctrl"
                              value={p.employee_id || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "employee_id", e.target.value)}
                            >
                              <option value="">Select Employee…</option>
                              {empOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">TDS Amount (₹) *</span>
                            <input
                              className="review-input-ctrl"
                              type="number"
                              value={p.amount || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "amount", e.target.value)}
                            />
                          </div>
                          <div className="review-input-field">
                            <span className="review-input-label">Tax Note / Instruction</span>
                            <input
                              className="review-input-ctrl"
                              value={p.note || ""}
                              onChange={(e) => handleFieldChange(originalIndex, "note", e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Notes Sheet Review Box */}
          {(activeTab === "ALL" || activeTab === "NOTE") && (parsedNotes || editReview) && (
            <div className="review-notes-box">
              <div className="review-notes-head">
                <MessageSquareText size={15} style={{ color: "#2563eb" }} />
                <span>Note for Payroll Team (from 'Send a Note' sheet)</span>
              </div>
              {editReview ? (
                <textarea
                  className="review-notes-textarea"
                  value={parsedNotes}
                  onChange={(e) => setParsedNotes(e.target.value)}
                  placeholder="Note for the payroll team..."
                />
              ) : (
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  {parsedNotes || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>No note entered.</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function MonthlyInput() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));

  const [employees, setEmployees] = useState([]);
  const [clientComponents, setClientComponents] = useState([]);

  const [current, setCurrent] = useState(null);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState(null);

  const [addingType, setAddingType] = useState(null);
  const [editingItem, setEditingItem] = useState(null); // item being corrected
  const [savingItem, setSavingItem] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState(null); // expanded change row
  const [excelModalOpen, setExcelModalOpen] = useState(false);

  // 2-Column Layout, Multi-Filter, View Mode & Batch Delete states
  const [accordionsOpen, setAccordionsOpen] = useState({ headcount: true, salary: true, claims: true });
  const [viewMode, setViewMode] = useState("changes"); // 'changes' | 'employee'
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);

  const currentUser = getStoredUser();
  const isClientAdmin = currentUser?.role === "client_admin";

  useEffect(() => {
    api.get("/payroll-portal/employees/").then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => { });
    api.get("/payroll-portal/components/").then((d) => {
      const comps = Array.isArray(d)
        ? d.filter((c) => !c.code?.startsWith("__") && !c.statistical_component && (c.component_type === "EARNING" || c.component_type === "DEDUCTION"))
        : [];
      setClientComponents(comps);
    }).catch(() => { });
  }, []);

  // Open the current month straight away — the client can switch months via
  // the month switcher if needed.
  useEffect(() => {
    loadMonth(month, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMonth = async (m, y) => {
    setError(""); setItems(null); setAddingType(null); setEditingItem(null); setOpenItemId(null);
    setLoading(true);
    try {
      const sub = await api.post("/payroll-portal/submissions/", { month: Number(m), year: Number(y) });
      setCurrent(sub);
      setNotes(sub.notes || "");
      const its = await api.get(`/payroll-portal/submissions/${sub.id}/items/`);
      setItems(Array.isArray(its) ? its : []);
    } catch (e) {
      setError(e.message);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  };

  const saveNotes = async () => {
    setSavingNotes(true); setError("");
    try {
      const sub = await api.post(`/payroll-portal/submissions/${current.id}/notes/`, { notes });
      setCurrent(sub);
      setNotes(sub.notes || "");
      setNotesSavedAt(new Date());
      setNoteOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const refreshItems = async (subId) => {
    const its = await api.get(`/payroll-portal/submissions/${subId}/items/`);
    setItems(Array.isArray(its) ? its : []);
  };

  // Add a new change, or save a correction to an existing one.
  const saveItem = async (type, payload) => {
    setSavingItem(true); setError("");
    try {
      if (editingItem) {
        await api.patch(
          `/payroll-portal/submissions/${current.id}/items/${editingItem.id}/`,
          { item_type: type, payload }
        );
      } else {
        await api.post(`/payroll-portal/submissions/${current.id}/items/`, { item_type: type, payload });
      }
      setAddingType(null);
      setEditingItem(null);
      await refreshItems(current.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingItem(false);
    }
  };

  const removeItem = async (item) => {
    setRemovingId(item.id); setError("");
    try {
      await api.del(`/payroll-portal/submissions/${current.id}/items/${item.id}/`);
      await refreshItems(current.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingId(null);
    }
  };

  // Client-side CSV export of the month's changes (no backend needed).
  const exportCSV = () => {
    const rows = (items || []).map((it) => ({
      type: TYPE_LABEL[it.item_type] || it.item_type,
      details: summary(it, employees),
      status: it.status,
    }));
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Type", "Details", "Status"].join(","),
      ...rows.map((r) => [r.type, r.details, r.status].map(esc).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-changes-${monthLabel(month, year).replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExcelImportSuccess = async (importedNotes) => {
    setExcelModalOpen(false);
    await refreshItems(current.id);
    if (importedNotes) {
      setNotes(importedNotes);
    }
    try {
      const sub = await api.post("/payroll-portal/submissions/", {
        month: Number(month),
        year: Number(year),
      });
      setCurrent(sub);
      if (sub.notes) setNotes(sub.notes);
    } catch (_) { }
  };

  const submitMonth = async () => {
    setSubmitting(true); setError("");
    try {
      const sub = await api.post(`/payroll-portal/submissions/${current.id}/submit/`);
      setCurrent(sub);
      setConfirmSubmit(false);
    } catch (e) {
      setError(e.message);
      setConfirmSubmit(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Payslips already generated for this month → the month is closed. Anything
  // added now could never appear on a payslip the employee already has, so the
  // portal goes read-only (the API enforces the same rule).
  const payrollLock = current?.payroll_lock || null;
  const payslipsIssued = !!payrollLock?.locked;
  const editable =
    !!current && ["DRAFT", "REJECTED", "APPROVED"].includes(current.status) && !payslipsIssued;

  // ── Client-only items & derived counts ────────────────────────────
  const events = current?.history || [];

  const isClientItem = (it) => {
    return (
      it.source === "portal" ||
      it.is_client_submission === true ||
      it.created_by != null ||
      it.created_by_id != null ||
      Boolean(it.created_by_email) ||
      it.payload?._source === "portal_excel_upload"
    );
  };

  // Strictly filter to client items only (defense-in-depth on frontend)
  const allItems = useMemo(() => {
    return (items || []).filter(isClientItem);
  }, [items]);

  const pendingOnly = allItems.filter((it) => it.status === "PENDING").length;
  const appliedCount = allItems.filter((it) => it.status === "APPLIED").length;
  const failedCount = allItems.filter((it) => it.status === "FAILED").length;
  const skippedCount = allItems.filter((it) => it.status === "SKIPPED").length;
  const pendingCount = pendingOnly + failedCount; // client unsubmitted changes
  const hasUnsent = pendingCount > 0;
  const totalAppliedCount = appliedCount;

  const approvedEvents = events.filter((e) => e.event_type === "APPROVED");
  const isRoundComplete = current?.status === "DRAFT" && totalAppliedCount > 0 && pendingCount === 0;
  const isNextRoundDraft = current?.status === "DRAFT" && totalAppliedCount > 0 && pendingCount > 0;

  // Real-time financial calculations
  const { totalAdditions, totalDeductions, netImpact } = useMemo(() => {
    let add = 0;
    let ded = 0;
    for (const it of allItems) {
      const p = it.payload || {};
      const amt = Number(p.amount || p.total_amount || 0);
      if (["ONE_TIME_EARNING", "REIMBURSEMENT", "ARREARS"].includes(it.item_type)) {
        add += amt;
      } else if (["ONE_TIME_DEDUCTION", "ADVANCE", "TDS", "SALARY_HOLD"].includes(it.item_type)) {
        ded += amt;
      } else if (it.item_type === "CUSTOM_COMPONENT") {
        const comp = clientComponents.find((c) => c.code === p.component_code);
        if (comp?.component_type === "DEDUCTION") {
          ded += amt;
        } else {
          add += amt;
        }
      }
    }
    return { totalAdditions: add, totalDeductions: ded, netImpact: add - ded };
  }, [allItems, clientComponents]);

  // Stepper step number in CAOAS lifecycle
  const currentStepNumber = useMemo(() => {
    if (payslipsIssued) return 5;
    if (totalAppliedCount > 0 && pendingCount === 0) return 4;
    if (current?.status === "SUBMITTED") return 2;
    return 1;
  }, [payslipsIssued, totalAppliedCount, pendingCount, current?.status]);

  // Accordion toggle handler
  const toggleAccordion = (sec) => {
    setAccordionsOpen((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  // Sorting: failed/skipped first, then pending, then applied
  const rank = (s) => (s === "FAILED" ? 0 : s === "SKIPPED" ? 1 : s === "PENDING" ? 2 : 3);
  const orderedItems = useMemo(() => {
    return allItems.slice().sort((a, b) => rank(a.status) - rank(b.status));
  }, [allItems]);

  // Filtered by status, type, and search query
  const filteredOrderedItems = useMemo(() => {
    return orderedItems.filter((it) => {
      if (statusFilter === "PENDING" && it.status !== "PENDING") return false;
      if (statusFilter === "APPLIED" && it.status !== "APPLIED") return false;
      if (statusFilter === "FAILED" && it.status !== "FAILED") return false;
      if (statusFilter === "SKIPPED" && it.status !== "SKIPPED") return false;

      if (typeFilter !== "ALL" && it.item_type !== typeFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const p = it.payload || {};
        const emp = getEmployeeInfo(it, employees);
        const str = `${emp.code} ${emp.name} ${emp.department} ${TYPE_LABEL[it.item_type] || ""} ${p.description || ""} ${p.note || ""} ${p.reason || ""}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      return true;
    });
  }, [orderedItems, statusFilter, typeFilter, searchQuery, employees]);

  // Grouped by employee view calculation
  const employeeGroups = useMemo(() => {
    const map = new Map();
    for (const it of filteredOrderedItems) {
      const p = it.payload || {};
      const empId = p.employee_id;
      const emp = getEmployeeInfo(it, employees);
      const key = empId ? `emp_${empId}` : p.employee_code ? `code_${p.employee_code}` : `item_${it.id}`;

      if (!map.has(key)) {
        map.set(key, {
          empKey: key,
          empId,
          empCode: emp.code,
          empName: emp.name,
          department: emp.department,
          items: [],
        });
      }
      map.get(key).items.push(it);
    }
    return Array.from(map.values());
  }, [filteredOrderedItems, employees]);

  // Deletable items for batch actions (Option 5)
  const deletableItems = useMemo(() => {
    return filteredOrderedItems.filter((it) => it.status !== "APPLIED");
  }, [filteredOrderedItems]);

  const isAllSelected = deletableItems.length > 0 && deletableItems.every((it) => selectedItemIds.has(it.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(deletableItems.map((it) => it.id)));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedItemIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to remove ${selectedItemIds.size} selected change(s)?`)) return;
    setLoading(true);
    setError("");
    try {
      for (const id of Array.from(selectedItemIds)) {
        await api.del(`/payroll-portal/submissions/${current.id}/items/${id}/`);
      }
      setSelectedItemIds(new Set());
      await refreshItems(current.id);
    } catch (err) {
      setError(err?.message || "Failed to remove selected items");
    } finally {
      setLoading(false);
    }
  };

  const visibleHistory = showHistory ? events : events.slice(0, 3);
  const StatusIcon = current ? STATUS_ICON[current.status] || Clock : Clock;
  const formType = editingItem ? editingItem.item_type : addingType;
  const heading = `${monthLabel(month, year)} Payroll Changes`;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4" style={{ paddingBottom: editable && hasUnsent ? 84 : 24 }}>
      {/* ── Page head (Native Tailwind CSS) ── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 mb-2 border-b border-slate-200/80">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{heading}</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Add or review monthly payroll changes for {monthLabel(month, year)} before submitting to CKPSCA payroll team.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
          {current && (
            payslipsIssued ? (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-slate-300 bg-slate-100 text-slate-700 shadow-sm" title={payrollLock.reason}>
                🔒 Payslips Finalized
              </span>
            ) : current.status === "SUBMITTED" ? (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 shadow-sm">
                ⏳ Under Review
              </span>
            ) : current.status === "REJECTED" ? (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-rose-300 bg-rose-50 text-rose-800 shadow-sm">
                ⚠️ Changes Returned
              </span>
            ) : isRoundComplete ? (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm">
                ✅ All Changes Applied
              </span>
            ) : isNextRoundDraft ? (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 shadow-sm">
                ✏️ Draft (Round {approvedEvents.length + 1} • {fmtCount(pendingCount)})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 shadow-sm">
                ✏️ Draft {pendingCount > 0 ? `(${fmtCount(pendingCount)})` : ""}
              </span>
            )
          )}

          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-2.5 h-10 px-3.5 rounded-xl border border-blue-200 bg-white hover:border-blue-500 hover:ring-2 hover:ring-blue-100 text-xs font-bold text-slate-800 transition-all cursor-pointer shadow-sm"
              onClick={() => setPickerOpen((o) => !o)}
            >
              <span className="text-sm">📅</span>
              <span className="text-xs font-bold text-slate-800 whitespace-nowrap">{monthLabel(month, year)}</span>
              <ChevronDown size={15} className="text-slate-400 shrink-0" />
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-50 backdrop-blur-[1px]" onClick={() => setPickerOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 w-80 p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
                  <div className="payroll-scope">
                    <MonthYearPicker
                      month={Number(month)}
                      year={Number(year)}
                      onChange={(m, y) => {
                        setMonth(String(m));
                        setYear(String(y));
                        setPickerOpen(false);
                        loadMonth(String(m), String(y));
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <Button
            variant="secondary"
            className="h-10 px-3.5 rounded-xl text-xs font-semibold"
            onClick={() => setExcelModalOpen(true)}
            disabled={!current || !editable}
            title="Upload filled multi-sheet Excel file"
          >
            <Upload size={14} className="mr-1.5" /> Upload Excel
          </Button>

          <Button
            variant="secondary"
            className="h-10 px-3.5 rounded-xl text-xs font-semibold"
            onClick={exportCSV}
            disabled={!current || allItems.length === 0}
          >
            <Download size={14} className="mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Closed months banner */}
      {payslipsIssued && (
        <div className="rounded-xl border border-slate-300 bg-slate-100/95 p-4 flex items-start gap-3 text-xs text-slate-700 shadow-sm mb-4">
          <Lock size={18} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="font-bold text-slate-900">This month is closed.</strong>{" "}
            {payrollLock.reason}{" "}
            Need a correction? Contact your payroll team — they can amend the payroll and reissue the payslips.
          </div>
        </div>
      )}

      {/* Returned months banner */}
      {current && current.status === "REJECTED" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-xs text-rose-800 shadow-sm mb-4">
          <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="font-bold text-rose-900">Your payroll team returned this month.</strong>{" "}
            {current.rejection_reason || "Fix the flagged changes below and submit again."}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      )}

      {!current && !loading && (
        <Card>
          <EmptyState
            title="Pick a month to begin"
            hint="Choose the payroll month and year, and the month opens here."
          />
        </Card>
      )}

      {current && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)] gap-5 items-start">
          {/* ══════════════════════════════════════════════════════════════
              LEFT SIDEBAR: Categorized Action Hub
              ══════════════════════════════════════════════════════════════ */}
          <div className="flex flex-col gap-3">
            {/* Accordion Categories Card */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              {ACTION_GROUPS.map((sec) => {
                const isOpen = !!accordionsOpen[sec.key];
                const Icon = sec.icon;
                const visibleTypes = sec.types.filter((t) => !t.adminOnly || isClientAdmin);
                return (
                  <div key={sec.key} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-transparent hover:bg-slate-50 transition-colors cursor-pointer text-left border-none"
                      onClick={() => toggleAccordion(sec.key)}
                      title={`Toggle ${sec.title}`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon size={15} className="text-blue-600 shrink-0" />
                        <span className="text-xs font-bold text-slate-800">{sec.title}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                          {visibleTypes.length}
                        </span>
                      </span>
                      {isOpen ? <ChevronUp size={15} className="text-slate-400 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                    </button>
                    {isOpen && (
                      <div className="px-2 pt-1 pb-2.5 flex flex-col gap-1">
                        {visibleTypes.map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            className="group w-full flex items-center justify-between p-1.5 rounded-xl bg-white border border-slate-100 hover:border-blue-200 hover:bg-blue-50/50 hover:shadow-sm hover:translate-x-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
                            disabled={!editable}
                            onClick={() => { setEditingItem(null); setAddingType(t.key); }}
                            title={`Add ${t.label}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="w-7 h-7 rounded-lg border flex items-center justify-center text-sm leading-none shrink-0 group-hover:scale-105 transition-transform"
                                style={{
                                  background: EMOJI_DOCK[t.key]?.bg || "#f1f5f9",
                                  borderColor: EMOJI_DOCK[t.key]?.border || "#e2e8f0",
                                }}
                              >
                                {t.emoji}
                              </span>
                              <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 truncate">
                                {t.label}
                              </span>
                            </div>
                            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-extrabold text-slate-400 bg-slate-100 shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-all">
                              +
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Note Utility */}
            <button
              type="button"
              className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer disabled:opacity-50 shadow-sm hover:-translate-y-0.5 ${notes && notes.trim()
                  ? "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 hover:border-emerald-300 hover:shadow-emerald-500/10"
                  : "border-slate-200 bg-white hover:bg-blue-50/60 hover:border-blue-300 hover:shadow-blue-500/10"
                }`}
              disabled={!editable}
              onClick={() => setNoteOpen(true)}
              title="Click to view or write a note for the CA payroll team"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-lg border border-blue-200 bg-blue-50 flex items-center justify-center text-sm shrink-0">
                  💬
                </span>
                <div className="flex flex-col text-left min-w-0">
                  <span className="text-xs font-bold text-slate-800 leading-tight">
                    Note for CA Team
                  </span>
                  <span className={`text-[10.5px] font-semibold ${notes && notes.trim() ? "text-emerald-700" : "text-slate-500"}`}>
                    {notes && notes.trim() ? "🟢 Note Saved" : "Leave message"}
                  </span>
                </div>
              </div>
              <Pencil size={13} className="text-slate-400 shrink-0" />
            </button>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              CENTER STAGE: Stepper, KPI Cards, Filter Bar & Ledger Table
              ══════════════════════════════════════════════════════════════ */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Horizontal Workflow Stepper Bar */}
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-4 shadow-sm flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Layers size={16} className="text-blue-600" />
                  <span>Workflow</span>
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  Round {approvedEvents.length + 1}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-1 overflow-x-auto">
                {[
                  { num: 1, title: "Draft" },
                  { num: 2, title: "Submitted" },
                  { num: 3, title: "Review" },
                  { num: 4, title: "Approved" },
                  { num: 5, title: "Payslips" },
                ].map((st, idx) => {
                  const isCurrent = st.num === currentStepNumber;
                  const isDone = st.num < currentStepNumber;

                  return (
                    <React.Fragment key={st.num}>
                      {idx > 0 && (
                        <div className={`flex-1 h-0.5 min-w-[14px] ${idx < currentStepNumber ? "bg-emerald-400" : "bg-slate-200"}`} />
                      )}
                      <div className={`flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${isCurrent ? "text-blue-700 font-bold" : isDone ? "text-emerald-700 font-semibold" : "text-slate-400"
                        }`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-bold border ${isCurrent
                            ? "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-100"
                            : isDone
                              ? "bg-emerald-500 text-white border-emerald-500"
                              : "bg-slate-100 text-slate-500 border-slate-300"
                          }`}>
                          {isDone ? <Check size={11} strokeWidth={3} /> : st.num}
                        </div>
                        <span>{st.title}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-200 transition-all cursor-pointer shrink-0 bg-white"
                onClick={() => setActivityDrawerOpen(true)}
                title="View full activity timeline"
              >
                <Clock size={13} className="text-blue-600" />
                <span>Activity</span>
                {events.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700">
                    {events.length}
                  </span>
                )}
              </button>
            </div>

            {/* 4 Status-Focused KPI Cards acting as 1-click Filter Tabs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

              <div
                className={`relative bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm cursor-pointer select-none transition-all hover:-translate-y-0.5 hover:shadow-md ${statusFilter === "ALL"
                    ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-400/50 shadow-blue-500/10"
                    : "border-slate-200 hover:border-slate-300"
                  }`}
                onClick={() => setStatusFilter("ALL")}
                role="button"
                tabIndex={0}
                title="Show all changes"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Layers size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Changes</span>
                  <span className="text-lg font-extrabold text-blue-700 leading-tight">{allItems.length}</span>
                </div>
                {statusFilter === "ALL" && (
                  <span className="absolute top-2.5 right-2.5 text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    All
                  </span>
                )}
              </div>

              <div
                className={`relative bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm cursor-pointer select-none transition-all hover:-translate-y-0.5 hover:shadow-md ${statusFilter === "PENDING"
                    ? "border-amber-500 bg-amber-50/60 ring-2 ring-amber-400/50 shadow-amber-500/10"
                    : "border-slate-200 hover:border-slate-300"
                  }`}
                onClick={() => setStatusFilter((curr) => curr === "PENDING" ? "ALL" : "PENDING")}
                role="button"
                tabIndex={0}
                title={statusFilter === "PENDING" ? "Click to clear filter" : "Filter table to Pending changes"}
              >
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <Clock size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pending</span>
                  <span className="text-lg font-extrabold text-amber-700 leading-tight">{pendingCount}</span>
                </div>
                {statusFilter === "PENDING" && (
                  <span className="absolute top-2.5 right-2.5 text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Active
                  </span>
                )}
              </div>

              <div
                className={`relative bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm cursor-pointer select-none transition-all hover:-translate-y-0.5 hover:shadow-md ${statusFilter === "APPLIED"
                    ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-400/50 shadow-emerald-500/10"
                    : "border-slate-200 hover:border-slate-300"
                  }`}
                onClick={() => setStatusFilter((curr) => curr === "APPLIED" ? "ALL" : "APPLIED")}
                role="button"
                tabIndex={0}
                title={statusFilter === "APPLIED" ? "Click to clear filter" : "Filter table to Applied changes"}
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Applied</span>
                  <span className="text-lg font-extrabold text-emerald-700 leading-tight">{appliedCount}</span>
                </div>
                {statusFilter === "APPLIED" && (
                  <span className="absolute top-2.5 right-2.5 text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Active
                  </span>
                )}
              </div>

              <div
                className={`relative bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm cursor-pointer select-none transition-all hover:-translate-y-0.5 hover:shadow-md ${statusFilter === "SKIPPED"
                    ? "border-rose-500 bg-rose-50/60 ring-2 ring-rose-400/50 shadow-rose-500/10"
                    : "border-slate-200 hover:border-slate-300"
                  }`}
                onClick={() => setStatusFilter((curr) => curr === "SKIPPED" ? "ALL" : "SKIPPED")}
                role="button"
                tabIndex={0}
                title={statusFilter === "SKIPPED" ? "Click to clear filter" : "Filter table to Excluded changes"}
              >
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
                  <Ban size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Excluded</span>
                  <span className="text-lg font-extrabold text-rose-700 leading-tight">{skippedCount}</span>
                </div>
                {statusFilter === "SKIPPED" && (
                  <span className="absolute top-2.5 right-2.5 text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                    Active
                  </span>
                )}
              </div>

            </div>

            {/* Filter & View Toolbar */}
            <div className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-2.5 flex-wrap shadow-sm">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white focus:bg-white text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  placeholder="Search employee by name, code or type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {statusFilter !== "ALL" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                  <span>
                    Filtered: <strong>{statusFilter === "PENDING" ? "Pending" : statusFilter === "APPLIED" ? "Applied" : statusFilter === "SKIPPED" ? "Excluded" : statusFilter}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("ALL")}
                    title="Clear filter (show all)"
                    className="w-4 h-4 rounded-full bg-blue-200 text-blue-800 hover:bg-blue-300 flex items-center justify-center transition-colors cursor-pointer border-none"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              <select
                className="h-9 px-2.5 pr-7 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white focus:bg-white text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer transition-all"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="ALL">All Types</option>
                {ITEM_TYPES.filter((t) => !t.adminOnly || isClientAdmin).map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>

              <select
                className="h-9 px-2.5 pr-7 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white focus:bg-white text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer transition-all"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Status ({allItems.length})</option>
                <option value="PENDING">Pending ({pendingOnly})</option>
                <option value="APPLIED">Applied ({appliedCount})</option>
                {failedCount > 0 && <option value="FAILED">Needs Attention ({failedCount})</option>}
                {skippedCount > 0 && <option value="SKIPPED">Excluded ({skippedCount})</option>}
              </select>

              {/* View Switcher Toggle */}
              <div className="inline-flex p-0.5 rounded-lg bg-slate-100 gap-0.5 border border-slate-200">
                <button
                  type="button"
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer border-none ${viewMode === "changes" ? "bg-white text-blue-700 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  onClick={() => setViewMode("changes")}
                >
                  By Changes
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer border-none ${viewMode === "employee" ? "bg-white text-blue-700 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  onClick={() => setViewMode("employee")}
                >
                  By Employee
                </button>
              </div>
            </div>

            {/* Bulk Action Strip */}
            {selectedItemIds.size > 0 && (
              <div className="flex items-center justify-between px-3.5 py-2 bg-blue-50/80 border border-blue-200 rounded-xl text-xs font-semibold text-blue-900 shadow-sm">
                <span>
                  <strong>{selectedItemIds.size}</strong> change(s) selected
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    className="link-btn text-xs text-blue-600 hover:underline font-semibold cursor-pointer bg-transparent border-none"
                    onClick={() => setSelectedItemIds(new Set())}
                  >
                    Deselect All
                  </button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={handleBulkDelete}
                    disabled={loading}
                    style={{ height: 30, fontSize: 12, padding: "0 10px", gap: 4 }}
                  >
                    <Trash2 size={13} /> Delete Selected ({selectedItemIds.size})
                  </Button>
                </div>
              </div>
            )}

            {/* Main Content: Table or Grouped Cards */}
            {filteredOrderedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-2"><FileText size={20} /></span>
                <div className="text-sm font-bold text-slate-700">
                  {statusFilter !== "ALL"
                    ? `No ${statusFilter === "PENDING" ? "pending" : statusFilter === "APPLIED" ? "applied" : statusFilter === "SKIPPED" ? "excluded" : statusFilter.toLowerCase()} changes found`
                    : "No changes found"}
                </div>
                <div className="text-xs text-slate-500 mt-1 max-w-sm">
                  {allItems.length === 0
                    ? "Use the action navigation on the left to record joiners, revisions, exits, holds, or claims."
                    : statusFilter !== "ALL"
                      ? `There are 0 changes in the "${statusFilter === "PENDING" ? "Pending" : statusFilter === "APPLIED" ? "Applied" : statusFilter === "SKIPPED" ? "Excluded" : statusFilter}" view for this month.`
                      : "No changes match your search or filter selection. Try adjusting filters."}
                </div>
                {statusFilter !== "ALL" && (
                  <Button
                    variant="secondary"
                    onClick={() => setStatusFilter("ALL")}
                    style={{ marginTop: 12, height: 32, fontSize: 12.5 }}
                  >
                    Show All {allItems.length} Changes
                  </Button>
                )}
              </div>
            ) : viewMode === "changes" ? (
              /* Flat Ledger Table */
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                      <th className="w-9 py-3 px-3 text-center" style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={isAllSelected}
                          onChange={toggleSelectAll}
                          disabled={!editable || deletableItems.length === 0}
                          title="Select all unapplied changes"
                        />
                      </th>
                      <th className="py-3 px-3.5">Employee</th>
                      <th className="py-3 px-3.5">Type</th>
                      <th className="py-3 px-3.5">Amount / Details</th>
                      <th className="py-3 px-3.5">Round</th>
                      <th className="py-3 px-3.5">Status</th>
                      <th className="py-3 px-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrderedItems.map((it) => {
                      const emp = getEmployeeInfo(it, employees);
                      const avStyle = getAvatarStyle(emp.name, emp.code);
                      const initials = getInitials(emp.firstName, emp.lastName, emp.code);
                      const amtDisp = getItemAmountDisplay(it, clientComponents);
                      const open = openItemId === it.id;
                      const canEdit = editable && it.status !== "APPLIED";
                      const isSelected = selectedItemIds.has(it.id);
                      const itemRound = it.status === "APPLIED" ? 1 : approvedEvents.length + 1;

                      return (
                        <React.Fragment key={it.id}>
                          <tr
                            className={`group cursor-pointer transition-colors ${isSelected ? "bg-blue-50/50" : "hover:bg-slate-50/80"
                              }`}
                            onClick={() => setOpenItemId(open ? null : it.id)}
                          >
                            <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                checked={isSelected}
                                onChange={() => toggleSelectItem(it.id)}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="py-3 px-3.5">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 border"
                                  style={{
                                    background: avStyle.bg,
                                    color: avStyle.text,
                                    borderColor: avStyle.border,
                                  }}
                                >
                                  {initials}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-[11px] font-bold text-blue-600 leading-tight">{emp.code}</span>
                                  <span className="text-xs font-semibold text-slate-800 truncate leading-tight">{emp.name}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3.5">
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
                                style={{
                                  background: (TYPE_ACCENT[it.item_type] || "#3b82f6") + "18",
                                  color: TYPE_ACCENT[it.item_type] || "#3b82f6",
                                  border: `1px solid ${(TYPE_ACCENT[it.item_type] || "#3b82f6")}30`,
                                }}
                              >
                                <span>{TYPE_UNICODE[it.item_type] || "📄"}</span>
                                <span>{TYPE_LABEL[it.item_type] || it.item_type}</span>
                              </span>
                            </td>
                            <td className="py-3 px-3.5">
                              <span className={`${amtDisp.className} text-xs font-semibold`}>
                                {amtDisp.text}
                              </span>
                            </td>
                            <td className="py-3 px-3.5">
                              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                R{itemRound}
                              </span>
                            </td>
                            <td className="py-3 px-3.5">
                              <span className={`item-status-pill pill-${it.status.toLowerCase()}`}>
                                {it.status === "APPLIED" ? (
                                  <>✅ Applied</>
                                ) : it.status === "PENDING" ? (
                                  <>⏳ Pending</>
                                ) : it.status === "FAILED" ? (
                                  <>⚠️ Attention</>
                                ) : it.status === "SKIPPED" ? (
                                  <>🚫 Excluded</>
                                ) : (
                                  it.status
                                )}
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="inline-flex items-center gap-1">
                                {canEdit && (
                                  <>
                                    <button
                                      type="button"
                                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all cursor-pointer bg-transparent"
                                      onClick={() => { setAddingType(null); setEditingItem(it); }}
                                      title="Edit details"
                                    >
                                      <Pencil size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="danger w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer disabled:opacity-50 bg-transparent"
                                      onClick={() => removeItem(it)}
                                      disabled={removingId === it.id}
                                      title="Delete change"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent transition-all cursor-pointer bg-transparent"
                                  onClick={() => setOpenItemId(open ? null : it.id)}
                                  title={open ? "Collapse details" : "Expand details"}
                                >
                                  <ChevronRight
                                    size={14}
                                    className={`transition-transform duration-150 ${open ? "rotate-90 text-slate-700" : ""}`}
                                  />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Detail Row */}
                          {open && (
                            <tr>
                              <td colSpan={7} className="p-0 bg-slate-50/50">
                                <div className="py-3.5 px-5 pl-14 border-b border-dashed border-slate-200">
                                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Full Specifications:
                                  </div>
                                  <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {detailRows(it, employees).map((row) => (
                                      <div className="bg-white rounded-lg p-2.5 border border-slate-200" key={row.key}>
                                        <dt className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">{row.label}</dt>
                                        <dd className="text-xs font-bold text-slate-800 mt-0.5 break-words">{row.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                  {it.error && (
                                    <div className="mt-2 text-rose-600 text-xs flex items-center gap-1.5 font-medium">
                                      <AlertCircle size={13} /> {it.error}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Grouped by Employee View */
              <div className="flex flex-col gap-3">
                {employeeGroups.map((grp) => {
                  const avStyle = getAvatarStyle(grp.empName, grp.empCode);
                  const initials = getInitials(grp.empName, "", grp.empCode);

                  return (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm" key={grp.empKey}>
                      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 border"
                            style={{
                              background: avStyle.bg,
                              color: avStyle.text,
                              borderColor: avStyle.border,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-900 mr-2">
                              {grp.empName}
                            </span>
                            <span className="text-[11px] font-bold text-blue-600">
                              {grp.empCode}
                            </span>
                            {grp.department && (
                              <span className="text-[11px] text-slate-500 ml-1.5">
                                • {grp.department}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="badge badge-slate text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700">
                          {fmtCount(grp.items.length)}
                        </span>
                      </div>

                      <table className="w-full text-left border-collapse text-xs bg-white">
                        <tbody className="divide-y divide-slate-100">
                          {grp.items.map((it) => {
                            const amtDisp = getItemAmountDisplay(it, clientComponents);
                            const canEdit = editable && it.status !== "APPLIED";
                            const itemRound = it.status === "APPLIED" ? 1 : approvedEvents.length + 1;

                            return (
                              <tr key={it.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="w-44 py-2.5 px-3.5" style={{ width: 175 }}>
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                    style={{
                                      background: (TYPE_ACCENT[it.item_type] || "#3b82f6") + "18",
                                      color: TYPE_ACCENT[it.item_type] || "#3b82f6",
                                    }}
                                  >
                                    <span>{TYPE_UNICODE[it.item_type] || "📄"}</span>
                                    <span>{TYPE_LABEL[it.item_type] || it.item_type}</span>
                                  </span>
                                </td>
                                <td className="py-2.5 px-3.5">
                                  <span className="text-xs text-slate-600">
                                    {summary(it, employees)}
                                  </span>
                                </td>
                                <td className="w-28 py-2.5 px-3.5" style={{ width: 120 }}>
                                  <span className={`${amtDisp.className} text-xs font-semibold`}>
                                    {amtDisp.text}
                                  </span>
                                </td>
                                <td className="w-14 py-2.5 px-3.5" style={{ width: 60 }}>
                                  <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                    R{itemRound}
                                  </span>
                                </td>
                                <td className="w-28 py-2.5 px-3.5" style={{ width: 110 }}>
                                  <span className={`item-status-pill pill-${it.status.toLowerCase()}`}>
                                    {it.status === "APPLIED" ? "✅ Applied" : it.status === "PENDING" ? "⏳ Pending" : it.status}
                                  </span>
                                </td>
                                <td className="w-18 py-2.5 px-3.5 text-right" style={{ width: 70 }}>
                                  {canEdit && (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="btn-ghost w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer bg-transparent border-none"
                                        onClick={() => { setAddingType(null); setEditingItem(it); }}
                                        title="Edit"
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer bg-transparent border-none"
                                        onClick={() => removeItem(it)}
                                        title="Delete"
                                      >
                                        <Trash2 size={13} className="text-rose-500" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Note Line if notes exist */}
            {notes && notes.trim() && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 mt-3">
                <span className="text-amber-500 shrink-0 mt-0.5"><Star size={14} /></span>
                <span className="flex-1 font-medium leading-relaxed">{notes.trim()}</span>
                {editable && (
                  <button type="button" className="link-btn" onClick={() => setNoteOpen(true)}>Edit Note</button>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Floating Sticky Submission Bar ── */}
      {editable && hasUnsent && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1200,
            padding: "12px 32px",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(16px) saturate(180%)",
            WebkitBackdropFilter: "blur(16px) saturate(180%)",
            borderTop: "1px solid rgba(203, 213, 225, 0.8)",
            boxShadow: "0 -8px 24px -4px rgba(15, 23, 42, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 9999,
                background: "#fef3c7",
                border: "1px solid #fde68a",
                color: "#92400e",
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              <span>⚡</span> {fmtCount(pendingCount)} Unsubmitted
            </span>
            <span style={{ fontSize: 13, color: "#475569" }}>
              Net financial impact:{" "}
              <strong style={{ color: netImpact >= 0 ? "#059669" : "#dc2626" }}>
                {netImpact >= 0 ? "+" : ""}₹{fmtINR(netImpact)}
              </strong>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11.5, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 4, marginRight: 4 }}>
              <Lock size={12} /> Editable until submitted
            </span>
            <Button
              variant="secondary"
              onClick={exportCSV}
              disabled={allItems.length === 0}
              style={{ height: 38, fontSize: 13 }}
            >
              <FileSpreadsheet size={15} /> Export CSV
            </Button>
            <Button
              onClick={() => setConfirmSubmit(true)}
              disabled={submitting}
              style={{
                height: 38,
                fontSize: 13.5,
                fontWeight: 700,
                background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
                color: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "0 18px",
                borderRadius: 8,
              }}
            >
              {submitting ? "Submitting…" : `Review & Submit (${pendingCount})`} <Send size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* ── Note modal ── */}
      {noteOpen && (
        <Modal
          maxWidth="max-w-xl"
          title="Note for Payroll Team"
          onClose={() => setNoteOpen(false)}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button type="button" variant="secondary" onClick={() => setNoteOpen(false)} disabled={savingNotes}>
                Cancel
              </Button>
              <Button onClick={saveNotes} disabled={savingNotes}>
                {savingNotes ? "Saving…" : "Save Note"}
              </Button>
            </div>
          }
        >
          <Field label="Note" hint="Shown to your payroll team when they review this month">
            <TextArea
              autoFocus
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything your payroll team should know about this month…"
            />
          </Field>
          {notesSavedAt && (
            <p className="text-xs text-slate-400 mt-2 font-medium">Last saved: {notesSavedAt.toLocaleTimeString()}</p>
          )}
        </Modal>
      )}

      {/* ── Add / edit item modal ── */}
      {formType && (() => {
        const FormIcon = TYPE_ICON[formType] || FileText;
        return (
          <Modal
            maxWidth="max-w-3xl"
            height="h-[560px] max-h-[88vh]"
            title={
              <span className="inline-flex items-center gap-2.5 text-base font-bold text-slate-800">
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                  style={{
                    background: (TYPE_ACCENT[formType] || "#3b82f6") + "18",
                    color: TYPE_ACCENT[formType] || "#3b82f6",
                  }}
                >
                  <FormIcon size={16} />
                </span>
                {`${editingItem ? "Edit" : "Add"} ${TYPE_LABEL[formType]}`}
              </span>
            }
            onClose={() => { setAddingType(null); setEditingItem(null); }}
            footer={
              <div className="flex items-center justify-end gap-2 w-full">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setAddingType(null); setEditingItem(null); }}
                  disabled={savingItem}
                >
                  Cancel
                </Button>
                <Button type="submit" form="portal-item-form" disabled={savingItem}>
                  {savingItem ? "Saving…" : editingItem ? "Save Changes" : `Add ${TYPE_LABEL[formType]}`}
                </Button>
              </div>
            }
          >
            <ItemForm
              key={editingItem ? `edit-${editingItem.id}` : `add-${formType}`}
              type={formType}
              employees={employees}
              clientComponents={clientComponents}
              saving={savingItem}
              onSave={saveItem}
              initial={editingItem ? editingItem.payload : undefined}
              releaseDefault={
                current
                  ? {
                    month: current.month === 12 ? 1 : current.month + 1,
                    year: current.month === 12 ? current.year + 1 : current.year,
                  }
                  : undefined
              }
            />
          </Modal>
        );
      })()}

      {/* ── Submit confirmation ── */}
      {confirmSubmit && (
        <Modal
          title="Submit this month for review?"
          onClose={() => setConfirmSubmit(false)}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button type="button" variant="secondary" onClick={() => setConfirmSubmit(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submitMonth} disabled={submitting}>
                {submitting ? "Submitting…" : "Yes, Submit"} <Send size={15} />
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600 leading-relaxed">
            {fmtCount(pendingCount)} for <strong>{monthLabel(month, year)}</strong> will be sent to your
            payroll team. You won't be able to edit this month until it's approved or returned.
          </p>
        </Modal>
      )}

      {/* ── Slide-Over Activity History Drawer ── */}
      {activityDrawerOpen && (
        <div className="fixed inset-0 z-[1300] bg-slate-900/40 backdrop-blur-sm flex justify-end" onClick={() => setActivityDrawerOpen(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 m-0">
                <Clock size={18} className="text-blue-600" />
                <span>Activity History</span>
              </h3>
              <button
                type="button"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer bg-transparent border-none"
                onClick={() => setActivityDrawerOpen(false)}
                title="Close drawer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {!hasUnsent && events.length === 0 ? (
                <p className="small muted" style={{ margin: "16px 0", textAlign: "center" }}>
                  No activity recorded yet for this month.
                </p>
              ) : (
                <div className="flex flex-col space-y-3.5">
                  {editable && hasUnsent && (
                    <div className="relative flex items-start gap-3 pb-3.5 border-b border-slate-100 last:border-b-0">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 border bg-slate-100 text-slate-500 border-slate-200">
                        <Pencil size={13} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900">Draft in progress</span>
                          <span className="text-[11px] font-semibold text-slate-400">Now</span>
                        </div>
                        <span className="text-[11px] text-slate-500 block mt-0.5">{fmtCount(pendingCount)} not yet submitted</span>
                      </div>
                      <Badge tone="slate">DRAFT</Badge>
                    </div>
                  )}

                  {events.map((ev) => {
                    const Icon = EVENT_ICON[ev.event_type] || Clock;
                    const tone = EVENT_TONE[ev.event_type] || "slate";
                    const TL_TONES = {
                      blue: "bg-blue-50 text-blue-600 border-blue-200",
                      green: "bg-emerald-50 text-emerald-600 border-emerald-200",
                      amber: "bg-amber-50 text-amber-600 border-amber-200",
                      red: "bg-rose-50 text-rose-600 border-rose-200",
                      slate: "bg-slate-100 text-slate-500 border-slate-200",
                    };
                    const toneCls = TL_TONES[tone] || TL_TONES.slate;
                    return (
                      <div className="relative flex items-start gap-3 pb-3.5 border-b border-slate-100 last:border-b-0" key={ev.id}>
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 border ${toneCls}`}>
                          <Icon size={13} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900">{EVENT_TITLE[ev.event_type] || ev.event_type}</span>
                            <span className="text-[11px] font-semibold text-slate-400">{fmtDay(ev.created_at)}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            {fmtCount(ev.item_count)} • {fmtDate(ev.created_at)}
                            {ev.actor ? ` • ${ev.actor}` : ""}
                          </span>
                          {ev.event_type === "REJECTED" && ev.note && (
                            <div className="mt-1.5 p-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 italic">
                              “{ev.note}”
                            </div>
                          )}
                        </div>
                        <Badge tone={tone}>{EVENT_BADGE[ev.event_type] || ev.event_type}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Excel Upload & Review Modal ── */}
      {excelModalOpen && current && (
        <ExcelUploadModal
          current={current}
          employees={employees}
          clientComponents={clientComponents}
          isClientAdmin={isClientAdmin}
          onClose={() => setExcelModalOpen(false)}
          onSuccess={handleExcelImportSuccess}
        />
      )}
    </div>
  );
}


export default function ClientPortal() {
  const [user, setUser] = useState(getStoredUser());
  const [booting, setBooting] = useState(true);

  // Revalidate the stored portal token on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.get("/payroll-portal/me/");
        if (!cancelled) {
          setSession(getToken(), me);
          setUser(me);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 anywhere drops the client back to login.
  useEffect(() => {
    const onUnauth = () => setUser(null);
    window.addEventListener("portal:unauthorized", onUnauth);
    return () => window.removeEventListener("portal:unauthorized", onUnauth);
  }, []);

  const logout = async () => {
    try {
      await api.post("/payroll-portal/logout/");
    } catch {
      /* ignore */
    }
    clearSession();
    setUser(null);
  };

  const clientName = user?.client_name || "Company";

  return (
    <div id="client-portal" className="min-h-screen bg-[#f4f6fb] text-[#0f172a] font-sans antialiased">
      {booting ? (
        <div className="min-h-screen flex items-center justify-center">
          <Spinner />
        </div>
      ) : !user ? (
        <LoginView onLogin={setUser} />
      ) : (
        <>
          <header
            className="sticky top-0 z-[100] px-7 flex items-center justify-between"
            style={{
              height: 60,
              background: "linear-gradient(90deg, #091e42 0%, #0d3880 50%, #154c9e 100%)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center drop-shadow-[0_0_12px_rgba(56,189,248,0.7)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
                <PayrollBrandLogo />
              </div>
              <div>
                <div className="text-white font-bold text-base tracking-tight leading-snug">Payroll Portal</div>
                <div className="text-[#94a3b8] text-[11.5px] leading-none mt-0.5">C K Partha Sarathy &amp; Co</div>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2.5">
              {user?.client_logo ? (
                <img src={user.client_logo} alt={clientName} className="max-h-7 max-w-[130px] object-contain" />
              ) : (
                <span className="text-white text-[13.5px] font-bold tracking-tight">{clientName}</span>
              )}
              <span className="text-white/30 text-xs mx-0.5">|</span>
              <span className="text-white text-[20px] font-bold tracking-wider">{clientName.toUpperCase()}</span>
            </div>

            <div className="flex items-center gap-3.5">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-slate-200 hover:text-rose-200 hover:bg-rose-950/40 hover:border-rose-800/40 transition-all cursor-pointer"
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                }}
                onClick={logout}
                title="Sign out of portal"
              >
                <LogOut size={16} /> Logout
              </button>
            </div>
          </header>
          <main className="max-w-[1360px] mx-auto px-7 pt-6 pb-20">
            <MonthlyInput />
          </main>
        </>
      )}
    </div>
  );
}
