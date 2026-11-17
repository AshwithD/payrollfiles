import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { PuffLoader } from "react-spinners";
import {
  Building2, Layers, Clock3, CheckCircle2, AlertTriangle, Loader2,
  ArrowUpRight, LayoutGrid, List, ShieldCheck, Inbox, Bell,
  Mail, Phone, FileText, Pencil, Search, Upload, UserPlus, Users,
  Info, IndianRupee, CreditCard, Receipt, Hash, Landmark,
  MapPin, ClipboardList, Palette, Image as ImageIcon, CalendarClock,
  Filter, Eye, Clock, Send, AlertCircle, Download,
  RefreshCcw, Trash2, XCircle, ArrowLeft, X, UserCheck, UserX,
  Plus, FileUp, FileSpreadsheet, TrendingUp, Wallet,
  Calendar, User, Briefcase, CircleDot, Lock, History, RefreshCw, Sliders,
  Info as InfoIcon, Check, Calculator, Sparkles, ArrowRight, ChevronDown,
} from "lucide-react";
import {
  Badge, Breadcrumb, Button, Card, ClientLogo,
  EmptyState, ErrorState, GlassDropdown, Skeleton, Pagination,
  useConfirm, Input, Modal, PageHero, PayrollDialog,
  Textarea, WorkspaceHeader, LedgerAdjustmentModal, LEDGER_TYPE_CONFIG,
  formatBalanceValue, useSmartBack, formatDateTime, formatDate, formatTenure, formatCurrency, MONTHS,
  unwrapList, SearchableEmployeeSelect,
  api, apiPath,
} from "../PayrollRoutes";

import { PayrollJobBatchReview } from "./PayrollJobBatchReview";

import {
  P, PL, BRD, BG, MUT, INK, GR, GL, RED, REDL, AMB, AMBL, PUR, PURL, WH, NEU, NEUT,
  STATUS_COLORS, DEFAULT_STATUS_COLOR, Pill, Breadcrumb as JobBreadcrumb,
} from "../../IncomeTaxPage/JobUiCommon";
import {
  WsCard,
  WsBtn,
  wsInput,
  Notice,
  Loader,
  WS_FONT,
} from "../../IncomeTaxPage/JobWorkspaceCommon";

export { unwrapList, SearchableEmployeeSelect };

/* ── Canonical CAOAS Workspace UI Components (JobWorkspaceCommon & JobUiCommon) ── */

function StatTile({ label, value, emoji, extra, sub, tone }) {
  const v = value === null || value === undefined || value === "" ? "—" : value;
  const valueColor = tone === "amber" ? AMB : tone === "purple" ? PUR : tone === "green" ? GR : tone === "red" ? RED : P;

  return (
    <div
      style={{
        background: WH,
        border: `1px solid ${BRD}`,
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 82,
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: MUT,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              display: "flex",
              alignItems: "center",
              gap: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {emoji && <span>{emoji}</span>}
            <span>{label}</span>
          </div>
          {extra}
        </div>
        <div
          title={typeof v === "string" ? v : undefined}
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: valueColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {v}
        </div>
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 10.5 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function PayrollWorkspaceShell({
  breadcrumb,
  title,
  statusLabel,
  statusTone,
  statusLoading,
  statusNode,
  chips = [],
  rightChip,
  actions,
  meta = [],
  tabs = [],
  activeTab,
  onTabChange,
  isTabLocked,
  notice,
  loading,
  loadingLabel,
  sticky = false,
  stickyTop = 0,
  children,
  style,
}) {
  const tone = statusTone || DEFAULT_STATUS_COLOR;
  const metaItems = [...meta.filter(Boolean)];

  return (
    <div style={{ fontFamily: WS_FONT, ...style }}>
      {breadcrumb && breadcrumb.length > 0 && <JobBreadcrumb steps={breadcrumb} />}

      <div style={{ position: sticky ? "sticky" : "static", top: sticky ? stickyTop : undefined, zIndex: sticky ? 200 : undefined, background: BG }}>
        {/* Header */}
        <div
          style={{
            background: WH,
            border: `1px solid ${BRD}`,
            borderRadius: "12px 12px 0 0",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: 0 }}>{title || "—"}</h2>
              {statusNode !== undefined ? statusNode : (
                statusLabel ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 10px",
                      borderRadius: 99,
                      background: tone.bg,
                      color: tone.color,
                      opacity: statusLoading ? 0.5 : 1,
                      transition: "opacity .2s",
                    }}
                  >
                    {statusLabel}
                  </span>
                ) : null
              )}
              {chips.filter(Boolean).map((c, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: PL,
                    color: P,
                    fontWeight: 600,
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
            <div
              style={{
                fontSize: 12,
                color: MUT,
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {metaItems.map((m, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                  {m}
                  {i < metaItems.length - 1 && (
                    <span style={{ margin: "0 6px", color: BRD }}>·</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {actions}
            {rightChip && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: P,
                  background: PL,
                  border: `1px solid ${BRD}`,
                  padding: "3px 10px",
                  borderRadius: 6,
                }}
              >
                {rightChip}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        {tabs && tabs.length > 0 && (
          <div
            role="tablist"
            style={{
              display: "flex",
              borderBottom: `1px solid ${BRD}`,
              background: WH,
              overflowX: "auto",
              boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
            }}
          >
            {tabs.map((t) => {
              const active = activeTab === t.key;
              const locked = !!isTabLocked?.(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="jws-tab"
                  onClick={() => onTabChange(t.key)}
                  style={{
                    padding: "11px 18px",
                    background: "none",
                    border: "none",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: active ? P : locked ? "#AAB0C0" : MUT,
                    fontWeight: active ? 700 : 500,
                    borderBottom: active ? `2px solid ${P}` : "2px solid transparent",
                    opacity: locked ? 0.7 : 1,
                  }}
                >
                  {locked ? (
                    <span aria-label="locked">🔒</span>
                  ) : t.icon ? (
                    <span aria-hidden="true">{t.icon}</span>
                  ) : null}
                  <span>{t.label}</span>
                  {t.badge !== undefined && t.badge !== null && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 10,
                        background: active ? PL : NEU,
                        color: active ? P : NEUT,
                        borderRadius: 99,
                        padding: "1px 6px",
                        fontWeight: 700,
                      }}
                    >
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {notice && <div style={{ marginTop: 12 }}>{notice}</div>}

      <div style={{ padding: "16px 0" }}>
        {loading ? <Loader label={loadingLabel || "Loading..."} /> : children}
      </div>
    </div>
  );
}

/* ── Workspace Data Fetching & Mutation Hooks ───────────────────────────── */

function useQueryLike(fetcher, deps) {
  const [state, setState] = useState({ data: undefined, isLoading: true, isError: false, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, isError: false, error: null }));
    Promise.resolve(fetcherRef.current())
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, isError: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: undefined, isLoading: false, isError: true, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => run(), [run]);

  const setData = useCallback((updater) => {
    setState((s) => ({
      ...s,
      data: typeof updater === "function" ? updater(s.data) : updater,
      isLoading: false,
      isError: false,
      error: null,
    }));
  }, []);

  return { ...state, refetch: run, setData };
}

function unwrap(res) {
  return res.data;
}

export function useBatches(filters = {}) {
  const key = JSON.stringify(filters || {});
  return useQueryLike(
    () =>
      api.get(apiPath("batches/"), { params: filters }).then(unwrap).then((data) => {
        if (!filters.client) return data;
        const list = Array.isArray(data) ? data : data?.results;
        if (!Array.isArray(list)) return data;
        const filtered = list.filter((b) => String(b.client) === String(filters.client));
        return Array.isArray(data) ? filtered : { ...data, results: filtered };
      }),
    [key]
  );
}

export function useEmployeeRecords(employeeId) {
  return useQueryLike(
    () =>
      employeeId
        ? api.get(apiPath("records/"), { params: { employee: employeeId } }).then(unwrap)
        : Promise.resolve(null),
    [employeeId]
  );
}

export function useSalaryStructureHistory(employeeId) {
  return useQueryLike(
    () =>
      employeeId
        ? api.get(apiPath("salary-structures/"), { params: { employee: employeeId } }).then(unwrap)
        : Promise.resolve(null),
    [employeeId]
  );
}

export function useClientSalaryComponents(clientId) {
  return useQueryLike(
    () =>
      clientId
        ? api.get(apiPath("components/"), { params: { client_id: clientId } }).then(unwrap)
        : Promise.resolve([]),
    [clientId]
  );
}

const ADJUSTMENT_ENDPOINTS = {
  comp_off: "comp-off-adjustments/",
  leave: "leave-adjustments/",
  salary_advance: "salary-advance-adjustments/",
  on_hold: "on-hold-adjustments/",
};

export function usePendingAdjustments(employeeId) {
  return useQueryLike(
    () => {
      if (!employeeId) return Promise.resolve(null);
      return Promise.all(
        Object.entries(ADJUSTMENT_ENDPOINTS).map(([key, endpoint]) =>
          api
            .get(apiPath(endpoint), { params: { employee: employeeId } })
            .then(unwrap)
            .then((data) => {
              const list = Array.isArray(data) ? data : data?.results || [];
              const pending = list.filter((row) => row.applied_in_record == null);
              return [key, pending];
            })
        )
      ).then((entries) => Object.fromEntries(entries));
    },
    [employeeId]
  );
}

export function useAdjustmentHistory(employeeId) {
  return useQueryLike(
    () => {
      if (!employeeId) return Promise.resolve(null);
      const adjustments = Promise.all(
        Object.entries(ADJUSTMENT_ENDPOINTS).map(([key, endpoint]) =>
          api
            .get(apiPath(endpoint), { params: { employee: employeeId } })
            .then(unwrap)
            .then((data) => {
              const list = Array.isArray(data) ? data : data?.results || [];
              const sorted = [...list].sort(
                (a, b) => new Date(b.created_at) - new Date(a.created_at)
              );
              return [key, sorted];
            })
        )
      ).then((entries) => Object.fromEntries(entries));

      const plans = api
        .get(apiPath("salary-advances/"), { params: { employee: employeeId } })
        .then(unwrap)
        .then((data) => (Array.isArray(data) ? data : data?.results || []));

      return Promise.all([adjustments, plans]).then(([byType, salaryAdvancePlans]) => ({
        ...byType,
        salary_advance_plans: salaryAdvancePlans,
      }));
    },
    [employeeId]
  );
}

export function useEmailLogs(filters = {}) {
  const key = JSON.stringify(filters || {});
  return useQueryLike(
    () => api.get(apiPath("email-logs/"), { params: filters }).then(unwrap),
    [key]
  );
}

export function useClients() {
  return useQueryLike(() => api.get(apiPath("clients/")).then(unwrap), []);
}

export function useClient(id) {
  const { data: clients, ...rest } = useClients();
  const list = Array.isArray(clients) ? clients : clients?.results || [];
  return { ...rest, data: id ? list.find((c) => String(c.id) === String(id)) : null };
}

export function useOverviewStats() {
  return useQueryLike(() => api.get(apiPath("batches/stats/")).then(unwrap), []);
}

function useMutationLike(fn) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const mutateAsync = useCallback(async (variables) => {
    setIsPending(true);
    setError(null);
    try {
      return await fnRef.current(variables);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const mutate = useCallback(
    (variables, { onSuccess, onError } = {}) => {
      mutateAsync(variables).then(onSuccess).catch((err) => onError?.(err));
    },
    [mutateAsync]
  );

  return { mutate, mutateAsync, isPending, error };
}

export function useAppMutations() {
  const discardBatch = useMutationLike((batchId) =>
    api.post(apiPath(`batches/${batchId}/discard/`)).then(unwrap)
  );
  const sendEmails = useMutationLike((batchId) =>
    api.post(apiPath(`batches/${batchId}/send-emails/`)).then(unwrap)
  );
  const updateRecord = useMutationLike(({ id, ...fields }) =>
    api.patch(apiPath(`records/${id}/`), fields).then(unwrap)
  );
  const resendEmail = useMutationLike((recordId) =>
    api.post(apiPath(`records/${recordId}/resend/`)).then(unwrap)
  );
  const saveClient = useMutationLike(({ id, formData }) =>
    (id ? api.patch(apiPath(`clients/${id}/`), formData) : api.post(apiPath("clients/"), formData)).then(unwrap)
  );
  const saveEmployee = useMutationLike(({ id, data }) =>
    (id ? api.patch(apiPath(`employees/${id}/`), data) : api.post(apiPath("employees/"), data)).then(unwrap)
  );
  const importEmployees = useMutationLike((formData) =>
    api.post(apiPath("employees/import/"), formData).then(unwrap)
  );

  return {
    mutateDiscardBatch: discardBatch,
    mutateSendEmails: sendEmails,
    mutateUpdateRecord: updateRecord,
    mutateResendEmail: resendEmail,
    mutateSaveClient: saveClient,
    mutateSaveEmployee: saveEmployee,
    mutateImportEmployees: importEmployees,
    mutateUpdateSalaryStructure: useMutationLike(({ id, data }) =>
      api.post(apiPath("salary-structures/"), { employee: id, ...data }).then(unwrap)
    ),
  };
}

export const resolveStatusTone = (status) => {
  switch (String(status || "").toUpperCase()) {
    case "DONE":
    case "CLOSED":
    case "COMPLETED":
      return "green";
    case "APPROVED":
      return "green";
    case "UNDER REVIEW":
    case "REVIEWED":
      return "blue";
    case "IN PROGRESS":
    case "SENDING":
      return "blue";
    case "CLIENT DOCS PENDING":
    case "UPLOADED":
      return "amber";
    case "REWORK":
    case "FAILED":
    case "OVER DUE":
      return "red";
    case "TO DO":
    default:
      return "slate";
  }
};

export const resolveStatusIcon = (status) => {
  switch (String(status || "").toUpperCase()) {
    case "DONE":
    case "CLOSED":
    case "COMPLETED":
    case "APPROVED":
      return CheckCircle2;
    case "UNDER REVIEW":
    case "REVIEWED":
      return Eye;
    case "IN PROGRESS":
    case "SENDING":
      return Send;
    case "CLIENT DOCS PENDING":
    case "UPLOADED":
      return Clock;
    case "REWORK":
    case "FAILED":
    case "OVER DUE":
      return AlertCircle;
    default:
      return Clock;
  }
};

/* ── one card per client — landing surface for overview. ──────────────── */
function ClientCard({ client, batches, onOpen }) {
  const clientBatches = batches.filter((b) => String(b.client) === String(client.id));
  const pending = clientBatches.filter((b) => !["DONE", "CLOSED", "COMPLETED", "FAILED", "CANCELLED"].includes(String(b.job_status || b.status || "").toUpperCase())).length;
  const sortedClientBatches = [...clientBatches].sort((a, b) => {
    const aVal = (Number(a.year || 0) * 100) + Number(a.month || 0);
    const bVal = (Number(b.year || 0) * 100) + Number(b.month || 0);
    return bVal - aVal;
  });
  const latest = sortedClientBatches[0];
  const latestStatus = latest ? (latest.job_status || latest.status) : null;

  return (
    <Card
      className="p-4 flex flex-col gap-3 transition-all hover:shadow-md hover:-translate-y-0.5 bg-white"
      style={{ cursor: "pointer", border: `1px solid ${BRD}`, borderRadius: 12, fontFamily: WS_FONT }}
      onClick={() => onOpen(client)}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-xs"
          style={{ background: "var(--surface-3)", border: "1px solid var(--border-3)" }}
        >
          {client.logo ? (
            <img src={client.logo} alt="" className="h-full w-full object-contain p-1" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100/60 text-xl font-bold text-blue-800">
              🏛️
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold truncate text-slate-800">
              {client.name}
            </h3>
            {client.master_is_active === false ? (
              <Badge tone="red">🔴 Inactive</Badge>
            ) : client.is_active === false ? (
              <Badge tone="red">⏸️ Inactive</Badge>
            ) : null}
          </div>
          <p className="text-xs truncate text-slate-500 mt-0.5">
            {client.email ? `📧 ${client.email}` : "No email on file"}
          </p>
        </div>
        {pending > 0 && <Badge tone="amber">⏳ {pending} pending</Badge>}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span>📜</span>
          <strong>{clientBatches.length}</strong> batch{clientBatches.length === 1 ? "" : "es"}
        </span>
        {latest ? (
          <span className="truncate flex items-center gap-1.5">
            <span className="text-slate-400">Latest:</span>
            <span className="font-semibold">{String(latest.month).padStart(2, "0")}/{latest.year}</span>
            <Badge tone={resolveStatusTone(latestStatus)}>{latestStatus}</Badge>
          </span>
        ) : (
          <span className="text-slate-400 text-[11px]">No batches yet</span>
        )}
      </div>
    </Card>
  );
}

/* ── compact horizontal row for list view. ─────────────────────────── */
function ClientListRow({ client, batches, onOpen, isLast }) {
  const clientBatches = batches.filter((b) => String(b.client) === String(client.id));
  const pending = clientBatches.filter((b) => !["DONE", "CLOSED", "COMPLETED", "FAILED", "CANCELLED"].includes(String(b.job_status || b.status || "").toUpperCase())).length;
  const sortedClientBatches = [...clientBatches].sort((a, b) => {
    const aVal = (Number(a.year || 0) * 100) + Number(a.month || 0);
    const bVal = (Number(b.year || 0) * 100) + Number(b.month || 0);
    return bVal - aVal;
  });
  const latest = sortedClientBatches[0];
  const latestStatus = latest ? (latest.job_status || latest.status) : null;

  return (
    <div
      className="px-2 py-3 flex items-center gap-4 transition-colors hover:bg-slate-50/70"
      style={{
        cursor: "pointer",
        borderBottom: isLast ? "none" : `1px solid ${BRD}`,
        fontFamily: WS_FONT,
      }}
      onClick={() => onOpen(client)}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-2xs"
        style={{ background: "var(--surface-3)" }}
      >
        {client.logo ? (
          <img src={client.logo} alt="" className="h-full w-full object-contain p-1" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100/60 text-base font-bold text-blue-800">
            🏛️
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-1 min-w-0">
        <h3 className="text-sm font-bold truncate text-slate-800">
          {client.name}
        </h3>
        {client.master_is_active === false ? (
          <Badge tone="red">🔴 Inactive</Badge>
        ) : client.is_active === false ? (
          <Badge tone="red">⏸️ Inactive</Badge>
        ) : client.activation_source === "CONTRACT" || client.has_payroll_service ? (
          <Badge tone="green" title="Enrolled via active Client Management contract">⚡ Contract</Badge>
        ) : (
          <Badge tone="blue" title="Enrolled via firm administrator override">⚡ Firm</Badge>
        )}
      </div>

      <p className="hidden sm:block text-xs w-48 shrink-0 truncate text-slate-500">
        {client.email ? `📧 ${client.email}` : "—"}
      </p>

      <div className="hidden sm:block text-xs w-24 shrink-0 text-slate-600">
        <span>📜 <strong>{clientBatches.length}</strong> batches</span>
      </div>

      {latest && (
        <div className="hidden md:flex items-center gap-2 text-xs shrink-0 text-slate-600">
          <span>📅 {String(latest.month).padStart(2, "0")}/{latest.year}</span>
          <Badge tone={resolveStatusTone(latestStatus)}>{latestStatus}</Badge>
        </div>
      )}

      {pending > 0 && <Badge tone="amber">⏳ {pending} pending</Badge>}

      <span className="text-slate-400 text-sm font-bold shrink-0">➔</span>
    </div>
  );
}

/* ── Detailed client card for the full Client Directory / FirmDetails view ── */
function ManagedClientCard({ client, batches = [], onToggleStatus, togglePending, onOpenClient }) {
  const clientBatches = batches.filter((b) => String(b.client) === String(client.id));
  return (
    <Card className="p-4 rounded-xl border border-slate-200/80 shadow-xs hover:shadow-sm transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div
          className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-xl shrink-0 cursor-pointer shadow-2xs bg-white"
          style={{ border: "1px solid var(--border-3)" }}
          onClick={() => onOpenClient?.(client)}
        >
          {client.logo ? (
            <img src={client.logo} alt="client logo" className="h-full w-full object-contain p-1.5" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100/60 text-2xl font-bold text-blue-800">
              🏛️
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3
              className="text-base font-bold truncate cursor-pointer hover:text-blue-700 transition-colors"
              style={{ color: "var(--text-strong)" }}
              onClick={() => onOpenClient?.(client)}
            >
              {client.name}
            </h3>
            {client.master_is_active === false ? (
              <Badge tone="red">🔴 Deactivated in Master</Badge>
            ) : client.is_active === false ? (
              <Badge tone="red">⏸️ Payroll Inactive</Badge>
            ) : client.activation_source === "CONTRACT" || client.has_payroll_service ? (
              <Badge tone="green" title="Enrolled via active Client Management service contract">⚡ Contract Active</Badge>
            ) : (
              <Badge tone="blue" title="Enrolled via firm administrator override">⚡ Firm Active</Badge>
            )}
            {clientBatches.length > 0 && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                📜 {clientBatches.length} batch{clientBatches.length === 1 ? "" : "es"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1.5 text-xs text-slate-600">
            {client.address && (
              <div className="flex items-center gap-1.5 min-w-0" title={client.address}>
                <span>📍</span> <span className="truncate">{client.address}</span>
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-1.5 min-w-0" title={client.email}>
                <span>📧</span> <span className="truncate">{client.email}</span>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-1.5 min-w-0" title={client.phone}>
                <span>📞</span> <span className="truncate">{client.phone}</span>
              </div>
            )}
            {client.gstin && (
              <div className="flex items-center gap-1.5 min-w-0" title={`GSTIN: ${client.gstin}`}>
                <span>📑</span> <span className="truncate">GST: {client.gstin}</span>
              </div>
            )}
            {client.pan && (
              <div className="flex items-center gap-1.5 min-w-0" title={`PAN: ${client.pan}`}>
                <span>🧾</span> <span className="truncate">PAN: {client.pan}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <Button
            size="sm"
            variant="secondary"
            disabled={togglePending}
            onClick={() => onToggleStatus(client)}
            style={
              client.is_active === false
                ? { color: "var(--green-text)", border: "1px solid var(--green-border)", background: "var(--green-bg-subtle)" }
                : { color: "var(--red-text)", border: "1px solid var(--red-border)", background: "var(--red-bg-subtle)" }
            }
          >
            {client.is_active === false ? "⚡ Activate" : "⏸️ Deactivate"}
          </Button>
          <Button size="sm" onClick={() => onOpenClient?.(client)}>
            🏢 Open ➔
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── Integrated Client Directory (formerly FirmDetails.jsx) ─────────────── */
export function FirmDetailsView({ onBack, batches = [] }) {
  const navigate = useNavigate();
  const { data: clientsData, isLoading, isError, refetch } = useClients();
  const { mutateSaveClient } = useAppMutations();
  const list = Array.isArray(clientsData) ? clientsData : clientsData?.results || [];
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get("status") === "active" ? "active"
    : searchParams.get("status") === "inactive" ? "inactive" : "all";
  const setStatus = (next) => {
    const p = new URLSearchParams(searchParams);
    if (next === "all") p.delete("status"); else p.set("status", next);
    setSearchParams(p, { replace: true });
  };

  const isActivePayrollClient = (c) =>
    c.is_effectively_active !== undefined
      ? c.is_effectively_active === true
      : c.is_active === true;

  const statusFiltered = useMemo(() => {
    if (status === "active") return list.filter(isActivePayrollClient);
    if (status === "inactive") return list.filter((c) => !isActivePayrollClient(c));
    return list;
  }, [list, status]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return statusFiltered;
    return statusFiltered.filter((c) =>
      ["name", "email", "payroll_email", "phone", "pan", "tan", "gstin"]
        .some((k) => String(c[k] || "").toLowerCase().includes(q))
    );
  }, [statusFiltered, query]);

  const toggleClientStatus = async (client) => {
    const nextActive = client.is_active === false ? true : false;
    try {
      await mutateSaveClient.mutateAsync({ id: client.id, formData: { is_active: nextActive } });
      refetch();
    } catch (err) {
      console.error("Failed to update client status:", err);
    }
  };

  if (isLoading) return null;
  if (isError) return <div><ErrorState message="Failed to load clients." onRetry={refetch} /></div>;

  return (
    <div className="space-y-5">
      <div className="w-fit self-start">
        <Breadcrumb
          items={[
            { label: "🏦 Payroll", onClick: () => navigate("/payroll") },
            { label: "Client Master", onClick: onBack },
            { label: "All Clients & Settings" },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-3" style={{ borderBottom: "1px solid var(--border-2)" }}>
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800">
            <span>🏛️</span> All Clients & Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            The CA firm&apos;s master payroll clients — manage payroll profiles, toggle payroll service active status, and view statutory credentials.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onBack}>
          ← Back to Workspace Overview
        </Button>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 rounded-xl p-1 bg-slate-100 border border-slate-200">
            {[
              { key: "all", label: "🏢 All Clients", count: list.length },
              { key: "active", label: "🟢 Active Payroll", count: list.filter(isActivePayrollClient).length },
              { key: "inactive", label: "⚪ Inactive", count: list.filter((c) => !isActivePayrollClient(c)).length },
            ].map((opt) => {
              const isSelected = status === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatus(opt.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5 ${isSelected
                    ? "bg-[#001F5B] text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                    }`}
                >
                  <span>{opt.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10.5px] font-bold ${isSelected ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                    }`}>
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-80">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone, PAN, GSTIN…"
              style={{ paddingLeft: 32 }}
            />
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <Card className="p-5">
          <EmptyState emoji="🏢" message="No clients yet. Add one in the Client module — it will appear here, ready to switch payroll on." />
        </Card>
      ) : visible.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            emoji="🔍"
            message={query
              ? `No ${status === "all" ? "" : `${status} `}client matches “${query}”.`
              : `No ${status} clients.`}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((client) => (
            <ManagedClientCard
              key={client.id}
              client={client}
              batches={batches}
              onToggleStatus={toggleClientStatus}
              togglePending={mutateSaveClient.isPending}
              onOpenClient={(c) => navigate(`/payroll/clients/${c.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


/* ==========================================================================
   PART: CLIENT BRANDING & DESIGN PREVIEWER (ReportLab Designs 1–8)
   ========================================================================== */

const DESIGN_COUNT = 8;
const DESIGNS = Array.from({ length: DESIGN_COUNT }, (_, i) => i + 1);

const PDFJS_VERSION = "4.0.379";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let pdfjsLoad = null;
function loadPdfjs() {
  if (!pdfjsLoad) {
    pdfjsLoad = import(/* webpackIgnore: true */ `${PDFJS_BASE}/pdf.min.mjs`).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsLoad;
}

export function ChooseDesignModal({ client, onClose, onSaved }) {
  const { mutateSaveClient } = useAppMutations();

  const [selected, setSelected] = useState(client?.pdf_design || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);
  const requestSeq = useRef(0);

  const renderPage = async (pdfDoc) => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const page = await pdfDoc.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(
      container.clientWidth / unscaled.width,
      container.clientHeight / unscaled.height
    );
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });

    const outputScale = Math.max(window.devicePixelRatio || 1, 3);
    canvas.width = viewport.width * outputScale;
    canvas.height = viewport.height * outputScale;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    if (renderTaskRef.current) renderTaskRef.current.cancel();
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (err) {
      if (err?.name !== "RenderingCancelledException") throw err;
    }
  };

  const loadPreview = async (design) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const [pdfjsLib, response] = await Promise.all([
        loadPdfjs(),
        api.get(apiPath(`clients/${client.id}/pdf-preview/?design=${design}`), {
          responseType: "arraybuffer",
        }),
      ]);
      if (seq !== requestSeq.current) return;

      const pdfDoc = await pdfjsLib.getDocument({ data: response.data }).promise;
      if (seq !== requestSeq.current) { pdfDoc.destroy(); return; }

      if (pdfDocRef.current) pdfDocRef.current.destroy();
      pdfDocRef.current = pdfDoc;

      await renderPage(pdfDoc);
      if (seq !== requestSeq.current) return;
    } catch {
      if (seq !== requestSeq.current) return;
      setError("Couldn't load this design's preview. Try another design.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview(selected);
    return () => {
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      if (pdfDocRef.current) pdfDocRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      if (pdfDocRef.current) renderPage(pdfDocRef.current);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const pick = (design) => {
    if (design === selected) return;
    setSelected(design);
    loadPreview(design);
  };

  const save = () => {
    mutateSaveClient.mutate(
      { id: client.id, formData: { pdf_design: selected, is_active: client.is_active !== false } },
      { onSuccess: () => { onSaved?.(selected); onClose?.(); } }
    );
  };

  return (
    <Modal title="🎨 Choose Payslip PDF Letterhead Design" onClose={onClose} size="l">
      <div className="flex gap-4" style={{ height: "70vh", minHeight: 0 }}>
        <div className="w-52 shrink-0 space-y-1.5 overflow-y-auto pr-1" style={{ minHeight: 0 }}>
          {DESIGNS.map((design) => {
            const isSelected = design === selected;
            return (
              <button
                key={design}
                type="button"
                onClick={() => pick(design)}
                className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all shadow-2xs"
                style={{
                  background: isSelected ? "var(--blue-bg)" : "var(--surface-2)",
                  border: `1px solid ${isSelected ? "var(--blue-border)" : "var(--border-3)"}`,
                  color: isSelected ? "var(--blue-text-strong)" : "var(--text-primary)",
                }}
              >
                <span>📑</span>
                Design {design}
                {isSelected && <span className="ml-auto text-blue-600 font-bold">✓</span>}
              </button>
            );
          })}
        </div>

        <div
          ref={containerRef}
          className="flex-1 rounded-xl flex items-center justify-center relative"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)", overflow: "hidden", minWidth: 0, minHeight: 0 }}
        >
          <canvas
            ref={canvasRef}
            style={{ display: loading || error ? "none" : "block", boxShadow: "var(--shadow-xl)" }}
          />
          {loading && (
            <div className="flex flex-col items-center gap-2 absolute" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-xs">Rendering preview…</span>
            </div>
          )}
          {!loading && error && (
            <div className="text-sm px-4 text-center absolute" style={{ color: "var(--red-text-strong)" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-4">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Currently saved: Design {client?.pdf_design || 1}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutateSaveClient.isPending}
            className="btn-glass inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <Button
            onClick={save}
            disabled={mutateSaveClient.isPending || loading || !!error}
          >
            {mutateSaveClient.isPending ? "Saving…" : "Save Design"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


/* ==========================================================================
   PART: CLIENT WORKSPACE, EMPLOYEE MASTER & ROSTERS
   (Consolidated from ClientWorkspace.jsx)
   ========================================================================== */

const CLIENT_WORKSPACE_TABS = [
  { key: "details", label: "Client Details", emoji: "🏢" },
  { key: "policy", label: "Salary Policy & Rules", emoji: "⚖️" },
  { key: "employees", label: "Employees & Roster", emoji: "👥" },
  { key: "batches", label: "Batch History", emoji: "📜" },
  { key: "emails", label: "Email Logs", emoji: "✉️" },
];

/* ==========================================================================
   PART: CLIENT SALARY POLICY & CONFIGURABLE COMPONENTS
   ========================================================================== */

function PolicyToggleSwitch({ checked, onChange, disabled = false, label, description, id }) {
  return (
    <label
      htmlFor={id}
      className={`inline-flex items-start gap-3.5 cursor-pointer select-none group transition-transform ${disabled ? "opacity-50 cursor-not-allowed" : "active:scale-[0.98]"
        }`}
      title={label ? `Click to toggle ${label}` : undefined}
    >
      {/* Rigid 58x32 stadium container matching uploaded reference design */}
      <div className="relative inline-flex items-center shrink-0 w-[58px] h-[32px] mt-0.5 select-none">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        {/* Layer 1: Neumorphic stadium outer casing (Soft Light Grey) */}
        <div
          className="w-[58px] h-[32px] rounded-full bg-[#dce1e7] flex items-center justify-center shrink-0 relative transition-all duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(255,255,255,0.9)] group-hover:brightness-[1.02]"
        >
          {/* Layer 2: Sunken inner channel/groove (Narrower & shorter than casing; Mint Green when ON, Slate Grey when OFF) */}
          <div
            className={`w-[44px] h-[16px] rounded-full transition-colors duration-200 relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.22)] ${checked ? "bg-[#54cc78]" : "bg-[#b8c0c8]"
              }`}
          />
          {/* Layer 3: Pure-white floating 3D circular knob with realistic drop shadow */}
          <div
            className={`w-[22px] h-[22px] bg-white rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.28),0_1px_2px_rgba(0,0,0,0.15)] absolute top-[5px] transition-all duration-200 ease-out ${checked ? "left-[30px]" : "left-[6px]"
              }`}
          />
        </div>
      </div>
      {(label || description) && (
        <div className="text-left select-none">
          {label && <span className="text-xs font-semibold text-slate-800 block leading-tight">{label}</span>}
          {description && <span className="text-[10.5px] text-slate-500 block leading-snug mt-0.5">{description}</span>}
        </div>
      )}
    </label>
  );
}

function StatutoryInfoTooltip({ text }) {
  if (!text) return null;
  return (
    <span
      className="inline-flex items-center text-slate-400 hover:text-blue-600 transition-colors cursor-help ml-1 text-[11px]"
      title={text}
    >
      ℹ️
    </span>
  );
}

function SalaryPolicyDialog({
  isOpen,
  title,
  message,
  variant = "primary",
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
  children,
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !loading && onCancel) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => {
        if (!loading && onCancel) onCancel();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 flex items-start gap-3.5">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
              isDanger
                ? "bg-rose-50 border-rose-200 text-rose-600"
                : "bg-blue-50 border-blue-200 text-blue-600"
            }`}
          >
            {isDanger ? <AlertTriangle size={20} /> : <RefreshCw size={20} />}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-base font-bold text-slate-900 tracking-tight leading-snug">
              {title}
            </h3>
            {message && (
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {message}
              </p>
            )}
          </div>
          {!loading && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors cursor-pointer"
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Custom Body (e.g. Effective Date Picker) */}
        {children && (
          <div className="px-5 pb-4">
            {children}
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg text-white shadow-xs inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-60 ${
              isDanger
                ? "bg-rose-600 hover:bg-rose-700 active:bg-rose-800"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
            }`}
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientSalaryPolicyTab({ client, onUpdated }) {
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [policySavedMsg, setPolicySavedMsg] = useState("");
  const [compactMode, setCompactMode] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const [showReapplyModal, setShowReapplyModal] = useState(false);
  const [reapplyEffectiveDate, setReapplyEffectiveDate] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}-01`;
  });
  const [compToDelete, setCompToDelete] = useState(null);
  const [deletingComp, setDeletingComp] = useState(false);
  const toggleRowExpanded = (rowKey) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
  };

  const rowGutter = compactMode ? "border-b-4 border-slate-100/90" : "border-b-8 border-slate-100/90";
  const cellPad = compactMode ? "py-2 px-3.5 align-middle" : "py-3.5 px-3.5 align-middle";

  // Keyboard Shortcuts 1-6 for Sections + S for Simulator
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      if (e.key === "1") setActiveSection("earnings");
      else if (e.key === "2") setActiveSection("statutory");
      else if (e.key === "3") setActiveSection("attendance");
      else if (e.key === "4") setActiveSection("payout");
      else if (e.key === "5") setActiveSection("payslip");
      else if (e.key === "6") setActiveSection("components");
      else if (e.key?.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setShowSimulatorModal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [components, setComponents] = useState([]);
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addingComponent, setAddingComponent] = useState(false);
  const [compSearch, setCompSearch] = useState("");
  const [policySearch, setPolicySearch] = useState("");
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [activeSection, setActiveSection] = useState("earnings");
  const [collapsedSections, setCollapsedSections] = useState({
    earnings: false,
    statutory: false,
    attendance: false,
    payout: false,
    payslip: false,
  });

  const toggleSection = (sectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  // Policy Form State
  const [basicType, setBasicType] = useState(client?.basic_calculation_type || "PERCENT_GROSS");
  const [basicPct, setBasicPct] = useState(client?.basic_percentage ?? 50);
  const [basicFlat, setBasicFlat] = useState(client?.basic_flat_amount ?? 0);

  const [hraType, setHraType] = useState(client?.hra_calculation_type || "PERCENT_BASIC");
  const [hraPct, setHraPct] = useState(client?.hra_percentage ?? 50);
  const [hraFlat, setHraFlat] = useState(client?.hra_flat_amount ?? 0);

  const [pfRule, setPfRule] = useState(client?.pf_calculation_rule || "CAPPED_1800");
  const [pfWageCeiling, setPfWageCeiling] = useState(
    client?.pf_wage_ceiling ?? (client?.pf_calculation_rule === "CAPPED_3000" ? 25000 : 15000)
  );
  const [pfCustomPct, setPfCustomPct] = useState(client?.pf_custom_pct ?? 12);
  const [pfCustomBase, setPfCustomBase] = useState(client?.pf_custom_base || "BASIC");
  const [pfCustomCapped, setPfCustomCapped] = useState(client?.pf_custom_capped !== false);
  const [employerPfInCtc, setEmployerPfInCtc] = useState(client?.employer_pf_in_ctc !== false);

  // ESI Policy State
  const [esiEnabled, setEsiEnabled] = useState(client?.esi_enabled ?? false);
  const [esiCalculationRule, setEsiCalculationRule] = useState(client?.esi_calculation_rule || "STATUTORY_21K");
  const [esiWageCeiling, setEsiWageCeiling] = useState(
    client?.esi_wage_ceiling ?? (client?.esi_calculation_rule === "STATUTORY_25K" ? 25000 : 21000)
  );
  const [esiEmployeePct, setEsiEmployeePct] = useState(client?.esi_employee_pct ?? 0.75);
  const [esiEmployerPct, setEsiEmployerPct] = useState(client?.esi_employer_pct ?? 3.25);
  const [esiCustomBase, setEsiCustomBase] = useState(client?.esi_custom_base || "GROSS");
  const [esiPeriodContinuity, setEsiPeriodContinuity] = useState(client?.esi_period_continuity !== false);
  const [esiEstablishmentCode, setEsiEstablishmentCode] = useState(client?.esi_establishment_code || "");
  const [employerEsiInCtc, setEmployerEsiInCtc] = useState(client?.employer_esi_in_ctc !== false);
  const [showEmployerEsi, setShowEmployerEsi] = useState(client?.show_employer_esi_in_payslip !== false);
  const [showUanInPayslip, setShowUanInPayslip] = useState(client?.show_uan_in_payslip !== false);

  // LWF, Statutory Bonus & Mid-Month Proration Policy State
  const [lwfState, setLwfState] = useState(client?.lwf_state || "EXEMPT_ZERO");
  const [lwfEmployeeAmount, setLwfEmployeeAmount] = useState(client?.lwf_employee_amount ?? 20);
  const [lwfEmployerAmount, setLwfEmployerAmount] = useState(client?.lwf_employer_amount ?? 40);
  const [statutoryBonusPct, setStatutoryBonusPct] = useState(client?.statutory_bonus_pct ?? 0);
  const [midMonthProrationRule, setMidMonthProrationRule] = useState(client?.mid_month_proration_rule || "ACTUAL_CALENDAR_DAYS");
  const [autoProrateMidMonth, setAutoProrateMidMonth] = useState(client?.auto_prorate_mid_month !== false);

  // Mode of Payment & Pay Cycle State
  const [defaultPaymentMode, setDefaultPaymentMode] = useState(client?.default_payment_mode || "WIRE_TRANSFER");
  const [showPaymentMode, setShowPaymentMode] = useState(client?.show_payment_mode_in_payslip !== false);
  const [showEmployerContrib, setShowEmployerContrib] = useState(client?.show_employer_contribution_in_payslip !== false);
  const [cycleStartDay, setCycleStartDay] = useState(client?.cycle_start_day || 1);
  const [cycleEndDay, setCycleEndDay] = useState(client?.cycle_end_day || 0);
  const [lopPolicy, setLopPolicy] = useState(client?.lop_policy || "ACCRUE_LEAVE_DEBT");
  const [ptState, setPtState] = useState(client?.pt_state || "KARNATAKA");
  const [ptAmount, setPtAmount] = useState(client?.pt_amount ?? 0);
  const [ptCustomPct, setPtCustomPct] = useState(client?.pt_custom_pct ?? 1.0);
  const [ptCustomBase, setPtCustomBase] = useState(client?.pt_custom_base || "GROSS");
  const [ptCustomCap, setPtCustomCap] = useState(client?.pt_custom_cap ?? 200);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(client?.annual_leave_days ?? 22);
  const [probationMonths, setProbationMonths] = useState(client?.probation_months ?? 6);
  const [trackLeaveLedger, setTrackLeaveLedger] = useState(client?.track_leave_ledger !== false);
  const [trackCompOff, setTrackCompOff] = useState(client?.track_comp_off !== false);
  const [carveOutFbp, setCarveOutFbp] = useState(client?.carve_out_fbp_in_ctc ?? false);
  const [carveOutCustom, setCarveOutCustom] = useState(client?.carve_out_custom_in_ctc ?? false);
  const [esiRoundingMode, setEsiRoundingMode] = useState(client?.esi_rounding_mode || "CEIL_RUPEE");
  const [netPayRoundingMode, setNetPayRoundingMode] = useState(client?.net_pay_rounding_mode || "EXACT_PAISA");
  const [gratuityInCtc, setGratuityInCtc] = useState(client?.gratuity_in_ctc ?? false);
  const [gratuityPct, setGratuityPct] = useState(client?.gratuity_pct ?? 4.81);
  const [leaveEncashmentBase, setLeaveEncashmentBase] = useState(client?.leave_encashment_base || "BASIC");
  const [leaveEncashmentDivisor, setLeaveEncashmentDivisor] = useState(String(client?.leave_encashment_divisor || "30"));
  const [ltaType, setLtaType] = useState(client?.lta_calculation_type || "OFF");
  const [ltaPct, setLtaPct] = useState(client?.lta_percentage ?? 0);
  const [ltaFlat, setLtaFlat] = useState(client?.lta_flat_amount ?? 0);

  useEffect(() => {
    if (client) {
      setTrackLeaveLedger(client.track_leave_ledger !== false);
      setTrackCompOff(client.track_comp_off !== false);
      setEsiEnabled(client.esi_enabled ?? false);
      if (client.esi_calculation_rule) setEsiCalculationRule(client.esi_calculation_rule);
      if (client.esi_wage_ceiling !== undefined && client.esi_wage_ceiling !== null) {
        setEsiWageCeiling(client.esi_wage_ceiling);
      } else {
        setEsiWageCeiling(client.esi_calculation_rule === "STATUTORY_25K" ? 25000 : 21000);
      }
      if (client.esi_employee_pct !== undefined && client.esi_employee_pct !== null) setEsiEmployeePct(client.esi_employee_pct);
      if (client.esi_employer_pct !== undefined && client.esi_employer_pct !== null) setEsiEmployerPct(client.esi_employer_pct);
      if (client.esi_custom_base) setEsiCustomBase(client.esi_custom_base);
      setEsiPeriodContinuity(client.esi_period_continuity !== false);
      setEsiEstablishmentCode(client.esi_establishment_code || "");
      setEmployerEsiInCtc(client.employer_esi_in_ctc !== false);
      setShowEmployerEsi(client.show_employer_esi_in_payslip !== false);
      setShowUanInPayslip(client.show_uan_in_payslip !== false);
      if (client.lwf_state) setLwfState(client.lwf_state);
      if (client.lwf_employee_amount !== undefined && client.lwf_employee_amount !== null) setLwfEmployeeAmount(client.lwf_employee_amount);
      if (client.lwf_employer_amount !== undefined && client.lwf_employer_amount !== null) setLwfEmployerAmount(client.lwf_employer_amount);
      if (client.statutory_bonus_pct !== undefined && client.statutory_bonus_pct !== null) setStatutoryBonusPct(client.statutory_bonus_pct);
      if (client.mid_month_proration_rule) setMidMonthProrationRule(client.mid_month_proration_rule);
      setAutoProrateMidMonth(client.auto_prorate_mid_month !== false);
      setCarveOutFbp(client.carve_out_fbp_in_ctc ?? false);
      setCarveOutCustom(client.carve_out_custom_in_ctc ?? false);
      setEsiRoundingMode(client.esi_rounding_mode || "CEIL_RUPEE");
      setNetPayRoundingMode(client.net_pay_rounding_mode || "EXACT_PAISA");
      setGratuityInCtc(client.gratuity_in_ctc ?? false);
      if (client.gratuity_pct !== undefined && client.gratuity_pct !== null) setGratuityPct(client.gratuity_pct);
      if (client.leave_encashment_base) setLeaveEncashmentBase(client.leave_encashment_base);
      if (client.leave_encashment_divisor) setLeaveEncashmentDivisor(String(client.leave_encashment_divisor));
      if (client.lta_calculation_type) setLtaType(client.lta_calculation_type);
      if (client.lta_percentage !== undefined && client.lta_percentage !== null) setLtaPct(client.lta_percentage);
      if (client.lta_flat_amount !== undefined && client.lta_flat_amount !== null) setLtaFlat(client.lta_flat_amount);
      if (client.pf_calculation_rule) setPfRule(client.pf_calculation_rule);
      if (client.pf_wage_ceiling !== undefined && client.pf_wage_ceiling !== null) {
        setPfWageCeiling(client.pf_wage_ceiling);
      } else {
        setPfWageCeiling(client.pf_calculation_rule === "CAPPED_3000" ? 25000 : 15000);
      }
      if (client.pf_custom_pct !== undefined && client.pf_custom_pct !== null) setPfCustomPct(client.pf_custom_pct);
      if (client.pf_custom_base) setPfCustomBase(client.pf_custom_base);
      if (client.pf_custom_capped !== undefined) setPfCustomCapped(client.pf_custom_capped !== false);
      if (client.pt_custom_pct !== undefined && client.pt_custom_pct !== null) setPtCustomPct(client.pt_custom_pct);
      if (client.pt_custom_base) setPtCustomBase(client.pt_custom_base);
      if (client.pt_custom_cap !== undefined && client.pt_custom_cap !== null) setPtCustomCap(client.pt_custom_cap);
    }
  }, [client]);

  // New Component Form State
  const [newComp, setNewComp] = useState({
    name: "",
    code: "",
    abbr: "",
    component_type: "EARNING",
    calculation_type: "FLAT",
    default_value: 0,
    depends_on_payment_days: true,
    is_taxable: true,
    is_part_of_pf_wages: false,
    is_monthly_variable: false,
    carve_out_from_ctc: false,
    payout_frequency: "MONTHLY",
    payout_month: 3,
    prorate_for_mid_year_joiners: false,
  });

  const fetchComponents = useCallback(async () => {
    if (!client?.id) return;
    setLoadingComponents(true);
    try {
      const res = await api.get(apiPath("components/"), { params: { client_id: client.id } });
      const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setComponents(list);
    } catch (err) {
      console.error("Failed to fetch salary components:", err);
    } finally {
      setLoadingComponents(false);
    }
  }, [client?.id]);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  // Simulator Sample Monthly CTC
  const [sampleCtc, setSampleCtc] = useState(60000);

  // Active Preset Detection
  const activePreset = useMemo(() => {
    if (
      basicType === "PERCENT_GROSS" &&
      Number(basicPct) === 50 &&
      Number(basicFlat) === 0 &&
      hraType === "PERCENT_BASIC" &&
      Number(hraPct) === 50 &&
      Number(hraFlat) === 0 &&
      pfRule === "CAPPED_1800" &&
      employerPfInCtc === true &&
      trackLeaveLedger === true &&
      trackCompOff === true
    ) {
      return "CORPORATE";
    }
    if (
      basicType === "PERCENT_GROSS" &&
      Number(basicPct) === 40 &&
      Number(basicFlat) === 0 &&
      hraType === "PERCENT_BASIC" &&
      Number(hraPct) === 50 &&
      Number(hraFlat) === 0 &&
      pfRule === "UNCAPPED_12_PERCENT" &&
      employerPfInCtc === false &&
      trackLeaveLedger === true &&
      trackCompOff === false
    ) {
      return "STARTUP";
    }
    if (
      basicType === "PERCENT_GROSS" &&
      Number(basicPct) === 100 &&
      Number(basicFlat) === 0 &&
      hraType === "PERCENT_BASIC" &&
      Number(hraPct) === 0 &&
      Number(hraFlat) === 0 &&
      pfRule === "NOT_OPTED" &&
      employerPfInCtc === false &&
      trackLeaveLedger === false &&
      trackCompOff === false
    ) {
      return "CONSULTANT";
    }
    return "CUSTOM";
  }, [basicType, basicPct, basicFlat, hraType, hraPct, hraFlat, pfRule, employerPfInCtc, trackLeaveLedger, trackCompOff]);

  // Dirty State Detection per Section (Option 2)
  const isEarningsDirty = useMemo(() => {
    return (
      basicType !== (client?.basic_calculation_type || "PERCENT_GROSS") ||
      Number(basicPct) !== Number(client?.basic_percentage ?? 50) ||
      Number(basicFlat) !== Number(client?.basic_flat_amount ?? 0) ||
      hraType !== (client?.hra_calculation_type || "PERCENT_BASIC") ||
      Number(hraPct) !== Number(client?.hra_percentage ?? 50) ||
      Number(hraFlat) !== Number(client?.hra_flat_amount ?? 0) ||
      ltaType !== (client?.lta_calculation_type || "OFF") ||
      Number(ltaPct) !== Number(client?.lta_percentage ?? 0) ||
      Number(ltaFlat) !== Number(client?.lta_flat_amount ?? 0) ||
      carveOutFbp !== (client?.carve_out_fbp_in_ctc ?? false) ||
      carveOutCustom !== (client?.carve_out_custom_in_ctc ?? false) ||
      gratuityInCtc !== (client?.gratuity_in_ctc ?? false) ||
      Number(gratuityPct) !== Number(client?.gratuity_pct ?? 4.81)
    );
  }, [client, basicType, basicPct, basicFlat, hraType, hraPct, hraFlat, ltaType, ltaPct, ltaFlat, carveOutFbp, carveOutCustom, gratuityInCtc, gratuityPct]);

  const isStatutoryDirty = useMemo(() => {
    const savedCeiling = Number(client?.pf_wage_ceiling ?? (client?.pf_calculation_rule === "CAPPED_3000" ? 25000 : 15000));
    const savedEsiCeiling = Number(client?.esi_wage_ceiling ?? (client?.esi_calculation_rule === "STATUTORY_25K" ? 25000 : 21000));
    return (
      pfRule !== (client?.pf_calculation_rule || "CAPPED_1800") ||
      Number(pfWageCeiling) !== savedCeiling ||
      Number(pfCustomPct) !== Number(client?.pf_custom_pct ?? 12) ||
      pfCustomBase !== (client?.pf_custom_base || "BASIC") ||
      pfCustomCapped !== (client?.pf_custom_capped !== false) ||
      employerPfInCtc !== (client?.employer_pf_in_ctc !== false) ||
      ptState !== (client?.pt_state || "KARNATAKA") ||
      Number(ptAmount) !== Number(client?.pt_amount ?? 0) ||
      Number(ptCustomPct) !== Number(client?.pt_custom_pct ?? 1.0) ||
      ptCustomBase !== (client?.pt_custom_base || "GROSS") ||
      Number(ptCustomCap) !== Number(client?.pt_custom_cap ?? 200) ||
      esiEnabled !== (client?.esi_enabled ?? false) ||
      esiCalculationRule !== (client?.esi_calculation_rule || "STATUTORY_21K") ||
      Number(esiWageCeiling) !== savedEsiCeiling ||
      Number(esiEmployeePct) !== Number(client?.esi_employee_pct ?? 0.75) ||
      Number(esiEmployerPct) !== Number(client?.esi_employer_pct ?? 3.25) ||
      esiCustomBase !== (client?.esi_custom_base || "GROSS") ||
      esiPeriodContinuity !== (client?.esi_period_continuity !== false) ||
      esiRoundingMode !== (client?.esi_rounding_mode || "CEIL_RUPEE") ||
      esiEstablishmentCode !== (client?.esi_establishment_code || "") ||
      employerEsiInCtc !== (client?.employer_esi_in_ctc !== false) ||
      lwfState !== (client?.lwf_state || "EXEMPT_ZERO") ||
      Number(lwfEmployeeAmount) !== Number(client?.lwf_employee_amount ?? 20) ||
      Number(lwfEmployerAmount) !== Number(client?.lwf_employer_amount ?? 40) ||
      Number(statutoryBonusPct) !== Number(client?.statutory_bonus_pct ?? 0)
    );
  }, [client, pfRule, pfWageCeiling, pfCustomPct, pfCustomBase, pfCustomCapped, employerPfInCtc, ptState, ptAmount, ptCustomPct, ptCustomBase, ptCustomCap, esiEnabled, esiCalculationRule, esiWageCeiling, esiEmployeePct, esiEmployerPct, esiCustomBase, esiPeriodContinuity, esiRoundingMode, esiEstablishmentCode, employerEsiInCtc, lwfState, lwfEmployeeAmount, lwfEmployerAmount, statutoryBonusPct]);

  const isAttendanceDirty = useMemo(() => {
    return (
      Number(cycleStartDay) !== Number(client?.cycle_start_day || 1) ||
      Number(cycleEndDay) !== Number(client?.cycle_end_day || 0) ||
      Number(annualLeaveDays) !== Number(client?.annual_leave_days ?? 22) ||
      Number(probationMonths) !== Number(client?.probation_months ?? 6) ||
      trackLeaveLedger !== (client?.track_leave_ledger !== false) ||
      trackCompOff !== (client?.track_comp_off !== false) ||
      midMonthProrationRule !== (client?.mid_month_proration_rule || "ACTUAL_CALENDAR_DAYS") ||
      autoProrateMidMonth !== (client?.auto_prorate_mid_month !== false) ||
      leaveEncashmentBase !== (client?.leave_encashment_base || "BASIC") ||
      String(leaveEncashmentDivisor) !== String(client?.leave_encashment_divisor || "30")
    );
  }, [client, cycleStartDay, cycleEndDay, annualLeaveDays, probationMonths, trackLeaveLedger, trackCompOff, midMonthProrationRule, autoProrateMidMonth, leaveEncashmentBase, leaveEncashmentDivisor]);

  const isPayoutDirty = useMemo(() => {
    return (
      defaultPaymentMode !== (client?.default_payment_mode || "WIRE_TRANSFER") ||
      lopPolicy !== (client?.lop_policy || "ACCRUE_LEAVE_DEBT") ||
      netPayRoundingMode !== (client?.net_pay_rounding_mode || "EXACT_PAISA")
    );
  }, [client, defaultPaymentMode, lopPolicy, netPayRoundingMode]);

  const isPayslipDirty = useMemo(() => {
    return (
      showUanInPayslip !== (client?.show_uan_in_payslip !== false) ||
      showEmployerContrib !== (client?.show_employer_contribution_in_payslip !== false) ||
      showEmployerEsi !== (client?.show_employer_esi_in_payslip !== false) ||
      showPaymentMode !== (client?.show_payment_mode_in_payslip !== false)
    );
  }, [client, showUanInPayslip, showEmployerContrib, showEmployerEsi, showPaymentMode]);

  const isDirty = useMemo(() => {
    return isEarningsDirty || isStatutoryDirty || isAttendanceDirty || isPayoutDirty || isPayslipDirty;
  }, [isEarningsDirty, isStatutoryDirty, isAttendanceDirty, isPayoutDirty, isPayslipDirty]);

  const POLICY_SECTIONS = useMemo(() => [
    { key: "earnings", label: "Earnings Architecture", emoji: "💰", subtitle: "Basic+DA, HRA structuring & auto-balancing special allowance formulas", isDirty: isEarningsDirty },
    { key: "statutory", label: "Statutory Compliance", emoji: "🛡️", subtitle: "Provident Fund (EPF), Professional Tax (PT) & State Insurance (ESI)", isDirty: isStatutoryDirty },
    { key: "attendance", label: "Attendance & Pay Cycle", emoji: "🗓️", subtitle: "Monthly attendance cut-off window, leave entitlement & probation freeze", isDirty: isAttendanceDirty },
    { key: "payout", label: "Disbursement & LOP", emoji: "💳", subtitle: "Default payout channel & Loss of Pay (LOP) debt policy", isDirty: isPayoutDirty },
    { key: "payslip", label: "Payslip Display & Rules", emoji: "📄", subtitle: "Statutory credentials, employer contributions & banking disclosures", isDirty: isPayslipDirty },
    { key: "components", label: "Custom Components", emoji: "🧩", subtitle: "Client-specific bespoke earnings and deduction catalog", count: components.length },
  ], [isEarningsDirty, isStatutoryDirty, isAttendanceDirty, isPayoutDirty, isPayslipDirty, components.length]);



  // Live Simulator Calculation (100% parity with backend build_from_ctc)
  const simCalc = useMemo(() => {
    const ctc = Math.max(0, Number(sampleCtc) || 0);
    const basicRatio = basicType === "PERCENT_GROSS" ? (Number(basicPct) || 50) / 100 : 0.5;
    const basicFlatVal = Number(basicFlat) || 0;
    const hraRatio = hraType === "PERCENT_BASIC" ? (Number(hraPct) || 50) / 100 : 0.5;
    const hraFlatVal = Number(hraFlat) || 0;

    const actualPfOpted = pfRule !== "NOT_OPTED";
    const pfCapped = pfRule === "CAPPED_1800" || pfRule === "CAPPED_3000";
    const pfUncapped = pfRule === "UNCAPPED_12_PERCENT";
    const pfCustom = pfRule === "CUSTOM_PERCENT";
    const pfCustomRate = (Number(pfCustomPct) || 12) / 100;
    const defaultCeiling = pfRule === "CAPPED_3000" ? 25000 : 15000;
    const effectiveCeiling = Number(pfWageCeiling) > 0 ? Number(pfWageCeiling) : defaultCeiling;
    const cappedPfAmount = Math.round(effectiveCeiling * (pfCustom ? pfCustomRate : 0.12));

    // 1. Check tentative ESI applicability
    const defaultEsiCeil = esiCalculationRule === "STATUTORY_25K" ? 25000 : 21000;
    const effectiveEsiCeiling = Number(esiWageCeiling) > 0 ? Number(esiWageCeiling) : defaultEsiCeil;
    const effEsiEmpRate = (Number(esiEmployeePct) >= 0 ? Number(esiEmployeePct) : 0.75) / 100;
    const effEsiEmprRate = (Number(esiEmployerPct) >= 0 ? Number(esiEmployerPct) : 3.25) / 100;
    const esiBaseRatio = (esiCalculationRule === "CUSTOM_RULE" && esiCustomBase === "BASIC") ? basicRatio : 1;

    let actualEsiOpted = esiEnabled && (esiCalculationRule === "UNCAPPED" || ctc <= effectiveEsiCeiling * 1.15);
    const esiRate = (actualEsiOpted && employerEsiInCtc) ? (effEsiEmprRate * esiBaseRatio) : 0;

    // Upfront Custom Allowance Carve-out (frequency-aware, matching backend _get_monthly_carveout)
    const getMonthlyCarveoutVal = (val, freq) => {
      const f = String(freq || "MONTHLY").trim().toUpperCase();
      const num = Number(val) || 0;
      if (f === "ANNUAL" || f === "ON_SEPARATION" || f === "SEPARATION") return num / 12;
      if (f === "QUARTERLY") return num / 3;
      return num;
    };

    const customCarveout = components
      .filter((c) => c.component_type === "EARNING" && !c.is_monthly_variable && c.formula !== "VARIABLE" && (c.calculation_type || "FLAT") === "FLAT")
      .filter((c) => carveOutCustom || c.carve_out_from_ctc)
      .reduce((sum, c) => sum + getMonthlyCarveoutVal(c.default_value, c.payout_frequency), 0);
    const grossPool = Math.max(0, ctc - customCarveout);

    // Gratuity Carve-Out setup (Payment of Gratuity Act: default 4.81% of Basic)
    const gratuityRateOnBasic = gratuityInCtc ? (Math.max(0, Number(gratuityPct) || 0) / 100) : 0;
    const gratuityFactorOnGross = basicType === "CUSTOM_FIXED" ? 0 : (gratuityRateOnBasic * basicRatio);

    const roundEsiVal = (val) => {
      if (esiRoundingMode === "CEIL_RUPEE") return Math.ceil(val - 1e-9);
      if (esiRoundingMode === "NEAREST_RUPEE") return Math.round(val);
      return Math.round(val * 100) / 100;
    };

    // 2. Upfront Gross Derivation (mirroring backend build_from_ctc)
    let monthlyGross = grossPool;
    let employerPf = 0;
    let epf = 0;
    let employerEsi = 0;
    let employeeEsi = 0;
    let gratuityReserve = 0;

    if (actualPfOpted && employerPfInCtc && pfCapped && ((grossPool - cappedPfAmount) * basicRatio) >= effectiveCeiling && (grossPool - cappedPfAmount) > effectiveEsiCeiling && esiCalculationRule !== "UNCAPPED") {
      // Standard corporate bracket: Flat capped PF reserve on statutory ceiling
      employerPf = cappedPfAmount;
      epf = cappedPfAmount;
      actualEsiOpted = false;
      const afterPfPool = Math.max(0, grossPool - cappedPfAmount);
      if (gratuityInCtc && gratuityRateOnBasic > 0) {
        if (basicType === "CUSTOM_FIXED" && basicFlatVal > 0) {
          gratuityReserve = Math.round(basicFlatVal * gratuityRateOnBasic);
          monthlyGross = Math.max(0, afterPfPool - gratuityReserve);
        } else {
          monthlyGross = Math.round(afterPfPool / (1 + gratuityFactorOnGross));
          const tBasic = Math.round(monthlyGross * basicRatio);
          gratuityReserve = Math.round(tBasic * gratuityRateOnBasic);
          monthlyGross = Math.max(0, afterPfPool - gratuityReserve);
        }
      } else {
        monthlyGross = afterPfPool;
      }
    } else {
      // Entry / mid-level salaries or uncapped: derive algebraically
      const effectivePfRate = pfCustom ? pfCustomRate * (pfCustomBase === "GROSS" ? 1 : basicRatio) : (0.12 * basicRatio);
      const pfRate = (actualPfOpted && employerPfInCtc) ? effectivePfRate : 0;
      const denom = 1 + pfRate + esiRate + gratuityFactorOnGross;
      const tentativeGross = denom > 0 ? grossPool / denom : grossPool;

      if (esiEnabled) {
        actualEsiOpted = esiCalculationRule === "UNCAPPED" ? true : (tentativeGross <= effectiveEsiCeiling);
      }
      const finalEsiRate = (actualEsiOpted && employerEsiInCtc) ? (effEsiEmprRate * esiBaseRatio) : 0;
      const finalDenom = 1 + pfRate + finalEsiRate + gratuityFactorOnGross;
      const finalTentativeGross = finalDenom > 0 ? grossPool / finalDenom : grossPool;

      const tBasic = basicType === "CUSTOM_FIXED" && basicFlatVal > 0
        ? Math.min(basicFlatVal, finalTentativeGross)
        : finalTentativeGross * basicRatio;

      let reserve = 0;
      if (actualPfOpted) {
        if (pfCustom) {
          const baseVal = pfCustomBase === "GROSS" ? finalTentativeGross : tBasic;
          if (pfCustomCapped) {
            reserve = baseVal >= effectiveCeiling ? Math.round(effectiveCeiling * pfCustomRate) : Math.round(baseVal * pfCustomRate);
          } else {
            reserve = Math.round(baseVal * pfCustomRate);
          }
        } else if (pfUncapped) {
          reserve = Math.round(tBasic * 0.12);
        } else {
          reserve = tBasic >= effectiveCeiling ? cappedPfAmount : Math.round(tBasic * 0.12);
        }
      }
      employerPf = reserve;
      epf = reserve;

      const tEsiBase = (esiCalculationRule === "CUSTOM_RULE" && esiCustomBase === "BASIC") ? tBasic : finalTentativeGross;
      const esiReserve = (actualEsiOpted && employerEsiInCtc) ? roundEsiVal(tEsiBase * effEsiEmprRate) : 0;
      gratuityReserve = (gratuityInCtc && gratuityRateOnBasic > 0) ? Math.round(tBasic * gratuityRateOnBasic) : 0;
      monthlyGross = Math.max(0, grossPool - (employerPfInCtc ? reserve : 0) - (employerEsiInCtc ? esiReserve : 0) - gratuityReserve);
    }

    // 3. Derive Basic+DA from true Monthly Gross
    let basic = 0;
    if (basicType === "CUSTOM_FIXED" && basicFlatVal > 0) {
      basic = Math.min(basicFlatVal, monthlyGross);
    } else {
      basic = Math.round(monthlyGross * basicRatio);
    }

    // Re-verify exact PF, ESI & Gratuity on actual Basic & Monthly Gross
    if (!actualPfOpted) {
      employerPf = 0;
      epf = 0;
    } else if (pfCustom) {
      const baseVal = pfCustomBase === "GROSS" ? monthlyGross : basic;
      if (pfCustomCapped) {
        employerPf = baseVal >= effectiveCeiling ? Math.round(effectiveCeiling * pfCustomRate) : Math.round(baseVal * pfCustomRate);
      } else {
        employerPf = Math.round(baseVal * pfCustomRate);
      }
      epf = employerPf;
    } else if (pfUncapped) {
      employerPf = Math.round(basic * 0.12);
      epf = employerPf;
    } else {
      employerPf = basic >= effectiveCeiling ? cappedPfAmount : Math.round(basic * 0.12);
      epf = employerPf;
    }

    gratuityReserve = (gratuityInCtc && gratuityRateOnBasic > 0) ? Math.round(basic * gratuityRateOnBasic) : 0;

    actualEsiOpted = esiEnabled && (esiCalculationRule === "UNCAPPED" || monthlyGross <= effectiveEsiCeiling);
    const finalEsiBase = (esiCalculationRule === "CUSTOM_RULE" && esiCustomBase === "BASIC") ? basic : monthlyGross;
    employerEsi = actualEsiOpted ? roundEsiVal(finalEsiBase * effEsiEmprRate) : 0;
    employeeEsi = actualEsiOpted ? roundEsiVal(finalEsiBase * effEsiEmpRate) : 0;

    // 4. Fixed Custom Earnings & Carve-outs (100% parity with backend build_from_ctc)
    // Distinguish between:
    // a) insideGrossCustomEarnings: components NOT carved out (deducted from special_allowance to fit within monthlyGross)
    // b) carvedCustomEarningsMonthly: components CARVED OUT of CTC that are disbursed MONTHLY (paid on top of monthlyGross)
    // c) carvedAnnualRetainedMonthly: components CARVED OUT of CTC that are deferred/annual (e.g. Annual Bonus) - reserved in CTC, not in monthly cash paychecks
    let insideGrossCustomEarnings = 0;
    let carvedCustomEarningsMonthly = 0;
    let carvedAnnualRetainedMonthly = 0;
    let carvedAnnualRetainedAnnual = 0;

    components
      .filter((c) => c.component_type === "EARNING" && !c.is_monthly_variable && c.formula !== "VARIABLE")
      .forEach((c) => {
        const val = Number(c.default_value) || 0;
        const isCarved = Boolean(carveOutCustom || c.carve_out_from_ctc);
        const freq = String(c.payout_frequency || "MONTHLY").trim().toUpperCase();
        const monthlyCarveout = getMonthlyCarveoutVal(val, freq);

        if (isCarved) {
          if (freq === "MONTHLY") {
            carvedCustomEarningsMonthly += monthlyCarveout;
          } else {
            carvedAnnualRetainedMonthly += monthlyCarveout;
            carvedAnnualRetainedAnnual += val;
          }
        } else {
          // Inside Gross: deducted from special_allowance
          if (c.calculation_type === "PERCENT_GROSS") {
            insideGrossCustomEarnings += Math.round(monthlyGross * (val / 100));
          } else if (c.calculation_type === "PERCENT_BASIC") {
            insideGrossCustomEarnings += Math.round(basic * (val / 100));
          } else {
            insideGrossCustomEarnings += monthlyCarveout;
          }
        }
      });

    // 5. Derive LTA if configured
    let simLta = 0;
    if (ltaType === "PERCENT_BASIC" && Number(ltaPct) > 0) {
      simLta = Math.round(basic * (Number(ltaPct) / 100));
    } else if (ltaType === "CUSTOM_FIXED" && Number(ltaFlat) > 0) {
      simLta = Number(ltaFlat);
    }

    // 6. Derive HRA
    const availableForHra = Math.max(0, monthlyGross - basic - simLta - insideGrossCustomEarnings);
    let hra = 0;
    if (hraType === "CUSTOM_FIXED" && hraFlatVal > 0) {
      hra = Math.min(hraFlatVal, availableForHra);
    } else {
      hra = Math.min(Math.round(basic * hraRatio), availableForHra);
    }

    // 7. Special Allowance (balancing remainder)
    const specialAllowance = Math.max(0, monthlyGross - basic - hra - simLta - insideGrossCustomEarnings);

    // Regular monthly earned gross consists of monthlyGross + any monthly cash allowances carved out upfront
    const earnedGross = monthlyGross + carvedCustomEarningsMonthly;

    // Professional Tax (PT) Deduction (State-Specific Live Slabs)
    let ptDeduction = 0;
    if (ptState === "KARNATAKA") {
      ptDeduction = earnedGross >= 25000 ? 200 : 0;
    } else if (ptState === "TELANGANA_AP") {
      if (earnedGross > 20000) ptDeduction = 200;
      else if (earnedGross > 15000) ptDeduction = 150;
      else ptDeduction = 0;
    } else if (ptState === "MAHARASHTRA") {
      if (earnedGross > 10000) ptDeduction = 200;
      else if (earnedGross > 7500) ptDeduction = 175;
      else ptDeduction = 0;
    } else if (ptState === "GUJARAT") {
      ptDeduction = earnedGross > 12000 ? 200 : 0;
    } else if (ptState === "EXEMPT_ZERO") {
      ptDeduction = 0;
    } else if (ptState === "CUSTOM_FIXED") {
      ptDeduction = Number(ptAmount) || 0;
    } else if (ptState === "CUSTOM_PERCENT") {
      const pct = (Number(ptCustomPct) || 0) / 100;
      const baseVal = ptCustomBase === "BASIC" ? basic : earnedGross;
      const raw = Math.round(baseVal * pct);
      const cap = Number(ptCustomCap) || 0;
      ptDeduction = cap > 0 ? Math.min(raw, cap) : raw;
    }

    const rawNetInHand = Math.max(0, earnedGross - epf - employeeEsi - ptDeduction);
    const netInHand = netPayRoundingMode === "NEAREST_RUPEE" ? Math.round(rawNetInHand) : Math.round(rawNetInHand * 100) / 100;
    const takeHomeRatio = ctc > 0 ? ((netInHand / ctc) * 100).toFixed(1) : 0;

    const pfDeductedFromCtc = employerPfInCtc ? employerPf : 0;
    const esiDeductedFromCtc = (actualEsiOpted && employerEsiInCtc) ? employerEsi : 0;

    const encashBaseAmt = leaveEncashmentBase === "GROSS" ? earnedGross : basic;
    const encashDiv = Number(leaveEncashmentDivisor) === 26 ? 26 : 30;
    const leaveEncashmentDailyRate = encashDiv > 0 ? Math.round((encashBaseAmt / encashDiv) * 100) / 100 : 0;

    const totalCustomEarnings = insideGrossCustomEarnings + carvedCustomEarningsMonthly;

    return {
      ctc,
      basic,
      earnedBasic: basic,
      hra,
      lta: simLta,
      employerPf,
      epf,
      employeeEsi,
      employerEsi,
      gratuityReserve,
      leaveEncashmentDailyRate,
      customEarnings: totalCustomEarnings,
      insideGrossCustomEarnings,
      carvedCustomEarningsMonthly,
      carvedAnnualRetainedMonthly,
      carvedAnnualRetainedAnnual,
      ptDeduction,
      customCarveout,
      specialAllowance,
      earnedGross,
      netInHand,
      takeHomeRatio,
      carveOutFbp,
      carveOutCustom,
      effectiveCeiling,
      cappedPfAmount,
      effectiveEsiCeiling,
      basicShare: ctc > 0 ? ((basic / ctc) * 100).toFixed(1) : 0,
      hraShare: ctc > 0 ? ((hra / ctc) * 100).toFixed(1) : 0,
      specialShare: ctc > 0 ? ((specialAllowance / ctc) * 100).toFixed(1) : 0,
      customInsideShare: ctc > 0 ? ((insideGrossCustomEarnings / ctc) * 100).toFixed(1) : 0,
      customCarvedShare: ctc > 0 ? ((carvedCustomEarningsMonthly / ctc) * 100).toFixed(1) : 0,
      annualRetainedShare: ctc > 0 ? ((carvedAnnualRetainedMonthly / ctc) * 100).toFixed(1) : 0,
      pfShare: ctc > 0 ? ((pfDeductedFromCtc / ctc) * 100).toFixed(1) : 0,
      esiShare: ctc > 0 ? ((esiDeductedFromCtc / ctc) * 100).toFixed(1) : 0,
      gratuityShare: ctc > 0 ? ((gratuityReserve / ctc) * 100).toFixed(1) : 0,
      customShare: ctc > 0 ? (((insideGrossCustomEarnings + carvedCustomEarningsMonthly) / ctc) * 100).toFixed(1) : 0,
    };
  }, [
    sampleCtc, basicType, basicPct, basicFlat, hraType, hraPct, hraFlat, ltaType, ltaPct, ltaFlat,
    pfRule, pfWageCeiling, pfCustomPct, pfCustomBase, pfCustomCapped, employerPfInCtc,
    esiEnabled, esiCalculationRule, esiWageCeiling, esiEmployeePct, esiEmployerPct, esiCustomBase, esiRoundingMode, employerEsiInCtc,
    gratuityInCtc, gratuityPct, leaveEncashmentBase, leaveEncashmentDivisor, netPayRoundingMode,
    components, carveOutFbp, carveOutCustom,
    ptState, ptAmount, ptCustomPct, ptCustomBase, ptCustomCap,
  ]);

  // Option 1: Live Professional Tax Slabs calculation for sample gross (synchronized with simCalc)
  const simulatedPt = useMemo(() => {
    return simCalc?.ptDeduction ?? 0;
  }, [simCalc?.ptDeduction]);

  // Option 3: Filtered components for search
  const filteredComponents = useMemo(() => {
    const q = (compSearch || policySearch || "").trim().toLowerCase();
    if (!q) return components;
    return components.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.code || "").toLowerCase().includes(q) ||
        (c.abbr || "").toLowerCase().includes(q)
    );
  }, [components, compSearch, policySearch]);

  // Apply One-Click Presets
  const applyPreset = (preset) => {
    if (preset === "CORPORATE") {
      setBasicType("PERCENT_GROSS");
      setBasicPct(50);
      setBasicFlat(0);
      setHraType("PERCENT_BASIC");
      setHraPct(50);
      setHraFlat(0);
      setPfRule("CAPPED_1800");
      setPfWageCeiling(15000);
      setEmployerPfInCtc(true);
      setLtaType("PERCENT_BASIC");
      setLtaPct(8.33);
      setLtaFlat(0);
      setTrackLeaveLedger(true);
      setTrackCompOff(true);
    } else if (preset === "STARTUP") {
      setBasicType("PERCENT_GROSS");
      setBasicPct(40);
      setBasicFlat(0);
      setHraType("PERCENT_BASIC");
      setHraPct(50);
      setHraFlat(0);
      setLtaType("OFF");
      setLtaPct(0);
      setLtaFlat(0);
      setPfRule("UNCAPPED_12_PERCENT");
      setEmployerPfInCtc(false);
      setTrackLeaveLedger(true);
      setTrackCompOff(false);
    } else if (preset === "CONSULTANT") {
      setBasicType("PERCENT_GROSS");
      setBasicPct(100);
      setBasicFlat(0);
      setHraType("PERCENT_BASIC");
      setHraPct(0);
      setHraFlat(0);
      setLtaType("OFF");
      setLtaPct(0);
      setLtaFlat(0);
      setPfRule("NOT_OPTED");
      setEmployerPfInCtc(false);
      setTrackLeaveLedger(false);
      setTrackCompOff(false);
    }
  };

  const savePolicy = async () => {
    setSavingPolicy(true);
    setPolicySavedMsg("");
    try {
      const payload = {
        basic_calculation_type: basicType,
        basic_percentage: Number(basicPct),
        basic_flat_amount: Number(basicFlat),
        hra_calculation_type: hraType,
        hra_percentage: Number(hraPct),
        hra_flat_amount: Number(hraFlat),
        pf_calculation_rule: pfRule,
        pf_wage_ceiling: Number(pfWageCeiling) > 0 ? Number(pfWageCeiling) : (pfRule === "CAPPED_3000" ? 25000 : 15000),
        pf_custom_pct: Number(pfCustomPct),
        pf_custom_base: pfCustomBase,
        pf_custom_capped: pfCustomCapped,
        employer_pf_in_ctc: employerPfInCtc,
        default_payment_mode: defaultPaymentMode,
        show_payment_mode_in_payslip: showPaymentMode,
        show_employer_contribution_in_payslip: showEmployerContrib,
        cycle_start_day: Number(cycleStartDay),
        cycle_end_day: Number(cycleEndDay),
        lop_policy: lopPolicy,
        pt_state: ptState,
        pt_amount: Number(ptAmount || 0),
        pt_custom_pct: Number(ptCustomPct || 0),
        pt_custom_base: ptCustomBase,
        pt_custom_cap: Number(ptCustomCap || 0),
        annual_leave_days: Number(annualLeaveDays || 22),
        probation_months: Number(probationMonths ?? 6),
        track_leave_ledger: trackLeaveLedger,
        track_comp_off: trackCompOff,
        esi_enabled: esiEnabled,
        esi_calculation_rule: esiCalculationRule,
        esi_wage_ceiling: Number(esiWageCeiling) > 0 ? Number(esiWageCeiling) : (esiCalculationRule === "STATUTORY_25K" ? 25000 : 21000),
        esi_employee_pct: Number(esiEmployeePct ?? 0.75),
        esi_employer_pct: Number(esiEmployerPct ?? 3.25),
        esi_custom_base: esiCustomBase,
        esi_period_continuity: esiPeriodContinuity,
        esi_establishment_code: esiEstablishmentCode,
        employer_esi_in_ctc: employerEsiInCtc,
        show_employer_esi_in_payslip: showEmployerEsi,
        show_uan_in_payslip: showUanInPayslip,
        lwf_state: lwfState,
        lwf_employee_amount: Number(lwfEmployeeAmount ?? 20),
        lwf_employer_amount: Number(lwfEmployerAmount ?? 40),
        statutory_bonus_pct: Number(statutoryBonusPct ?? 0),
        mid_month_proration_rule: midMonthProrationRule,
        auto_prorate_mid_month: autoProrateMidMonth,
        carve_out_fbp_in_ctc: carveOutFbp,
        carve_out_custom_in_ctc: carveOutCustom,
        esi_rounding_mode: esiRoundingMode,
        net_pay_rounding_mode: netPayRoundingMode,
        gratuity_in_ctc: gratuityInCtc,
        gratuity_pct: Number(gratuityPct ?? 4.81),
        leave_encashment_base: leaveEncashmentBase,
        leave_encashment_divisor: Number(leaveEncashmentDivisor || 30),
        lta_calculation_type: ltaType,
        lta_percentage: Number(ltaPct ?? 0),
        lta_flat_amount: Number(ltaFlat ?? 0),
        is_active: client.is_active !== false,
      };
      await api.patch(apiPath(`clients/${client.id}/`), payload);
      setPolicySavedMsg("Salary policy saved successfully!");
      if (onUpdated) onUpdated();
      setTimeout(() => setPolicySavedMsg(""), 3500);
    } catch (err) {
      console.error("Failed to save salary policy:", err);
      alert("Failed to save salary policy. Please check values.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const openReapplyModal = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    setReapplyEffectiveDate(`${yyyy}-${mm}-01`);
    setShowReapplyModal(true);
  };

  const handleConfirmReapply = async () => {
    if (!reapplyEffectiveDate) {
      alert("Please select a valid effective from date.");
      return;
    }
    setReapplying(true);
    setPolicySavedMsg("");
    try {
      const res = await api.post(
        apiPath(`clients/${client.id}/reapply-salary-policy/`),
        { effective_from: reapplyEffectiveDate }
      );
      setPolicySavedMsg(`✓ ${res.data?.message || 'Policy re-applied successfully!'}`);
      setShowReapplyModal(false);
      if (onUpdated) onUpdated();
      setTimeout(() => setPolicySavedMsg(""), 5000);
    } catch (err) {
      console.error("Failed to reapply policy:", err);
      alert(err?.response?.data?.detail || err?.response?.data?.message || "Failed to re-apply salary policy.");
    } finally {
      setReapplying(false);
    }
  };

  const handleCreateComponent = async (e) => {
    e.preventDefault();
    if (!newComp.name || !newComp.code || !newComp.abbr) {
      alert("Name, Code, and Abbreviation are required.");
      return;
    }
    setAddingComponent(true);
    try {
      const rawVal = String(newComp.default_value ?? "").replace(/[^0-9.]/g, "");
      const payload = {
        ...newComp,
        client: client.id,
        code: newComp.code.toUpperCase().trim(),
        abbr: newComp.abbr.toUpperCase().trim(),
        default_value: Number(rawVal || 0),
      };
      await api.post(apiPath("components/"), payload);
      setIsAddModalOpen(false);
      setNewComp({
        name: "",
        code: "",
        abbr: "",
        component_type: "EARNING",
        calculation_type: "FLAT",
        default_value: 0,
        depends_on_payment_days: true,
        is_taxable: true,
        is_part_of_pf_wages: false,
        is_monthly_variable: false,
        carve_out_from_ctc: false,
        payout_frequency: "MONTHLY",
        payout_month: 3,
        prorate_for_mid_year_joiners: false,
      });
      fetchComponents();
    } catch (err) {
      console.error("Failed to create component:", err);
      alert("Failed to create component. Ensure code is unique for this client.");
    } finally {
      setAddingComponent(false);
    }
  };

  const handleOpenDeleteComp = (comp) => {
    setCompToDelete(comp);
  };

  const handleConfirmDeleteComp = async () => {
    if (!compToDelete?.id) return;
    setDeletingComp(true);
    try {
      await api.delete(apiPath(`components/${compToDelete.id}/`));
      setCompToDelete(null);
      fetchComponents();
    } catch (err) {
      console.error("Failed to delete component:", err);
      alert("Failed to delete component.");
    } finally {
      setDeletingComp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Section 1: Salary Structuring Policy & Presets ──────────── */}
      <Card className="p-5 sm:p-6 space-y-6 bg-white shadow-xs border border-slate-200/80 rounded-xl">
        {/* Header & 1-Click Presets */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/80 text-blue-900 flex items-center justify-center shrink-0 text-xl shadow-2xs">
                ⚖️
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  Salary Structuring Policy & Presets
                  <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full uppercase tracking-wider ${activePreset === "CUSTOM"
                    ? "bg-slate-100 text-slate-700 border border-slate-200"
                    : "bg-blue-100 text-blue-800 border border-blue-200"
                    }`}>
                    {activePreset === "CORPORATE" && "🏢 Corporate Preset"}
                    {activePreset === "STARTUP" && "🚀 Startup Preset"}
                    {activePreset === "CONSULTANT" && "💼 Consultant Preset"}
                    {activePreset === "CUSTOM" && "⚙️ Custom Rules"}
                  </span>
                </h3>
              </div>
            </div>
          </div>

          {/* Quick Preset Selector Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide mr-1">1-Click Presets:</span>
            <button
              type="button"
              onClick={() => applyPreset("CORPORATE")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer ${activePreset === "CORPORATE"
                ? "bg-[#001F5B] text-white border-[#001F5B] shadow-xs"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
            >
              🏢 Standard Corporate
            </button>
            <button
              type="button"
              onClick={() => applyPreset("STARTUP")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer ${activePreset === "STARTUP"
                ? "bg-emerald-700 text-white border-emerald-700 shadow-xs"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
            >
              🚀 Tech Startup
            </button>
            <button
              type="button"
              onClick={() => applyPreset("CONSULTANT")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer ${activePreset === "CONSULTANT"
                ? "bg-purple-700 text-white border-purple-700 shadow-xs"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
            >
              💼 Contractor / 0 PF
            </button>
          </div>
        </div>

        {/* ── Split-Panel Master-Detail Layout ── */}
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* Left Sidebar: Policy Sections Navigation (Compact 220px) */}
          <div className="w-full lg:w-[220px] shrink-0 space-y-3">
            <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200 shadow-2xs space-y-2">
              <div className="px-2 py-0.5">
                <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Policy Sections</h4>
              </div>

              <div className="space-y-1">
                {POLICY_SECTIONS.map((sec) => {
                  const isSelected = activeSection === sec.key;
                  return (
                    <button
                      key={sec.key}
                      type="button"
                      onClick={() => {
                        setActiveSection(sec.key);
                        if (sec.key !== "all" && sec.key !== "components" && collapsedSections[sec.key]) {
                          setCollapsedSections((prev) => ({ ...prev, [sec.key]: false }));
                        }
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-between gap-1.5 cursor-pointer ${isSelected
                        ? "bg-blue-600 text-white font-bold shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70 hover:text-slate-900"
                        }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-sm shrink-0">{sec.emoji}</span>
                        <span className="truncate">{sec.label}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {sec.isDirty && (
                          <span
                            className={`w-2 h-2 rounded-full ${isSelected ? "bg-amber-300" : "bg-amber-500"} animate-pulse`}
                            title="Unsaved changes in this section"
                          />
                        )}
                        {sec.count !== undefined && (
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isSelected ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-700"
                              }`}
                          >
                            {sec.count}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Option 4: Continuous View Mode Button */}
              <div className="pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveSection(activeSection === "all" ? "earnings" : "all")}
                  className={`w-full py-1.5 px-2 text-center text-[11px] font-semibold rounded-lg border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${activeSection === "all"
                    ? "bg-blue-50 text-blue-800 border-blue-300 font-bold"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                >
                  <span>📋</span>
                  <span className="truncate">{activeSection === "all" ? "Exit Continuous" : "Continuous View"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Content Panel: Active Section Controls & Table */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Header bar of Right Content Panel */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">
                  {POLICY_SECTIONS.find((s) => s.key === activeSection)?.emoji || "📋"}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    {activeSection === "all"
                      ? "All Policy Sections (Continuous View)"
                      : activeSection === "components"
                        ? "Custom Salary Components Catalog"
                        : POLICY_SECTIONS.find((s) => s.key === activeSection)?.label || "Policy Configuration"}
                    {activeSection === "components" && (
                      <Badge tone="slate">{components.length} components</Badge>
                    )}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Option 3: Compact Mode Spacing Toggle */}
                <button
                  type="button"
                  onClick={() => setCompactMode(!compactMode)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer shadow-2xs ${compactMode
                    ? "bg-blue-50 text-blue-800 border-blue-300 font-bold"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  title="Toggle compact row spacing"
                >
                  {compactMode ? "📐 Compact" : "📐 Comfortable"}
                </button>

                {/* Search Box (Option 1 Global Search) */}
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Filter rules (e.g. Basic, HRA, PF, PT, ESI, Leave)..."
                    value={policySearch}
                    onChange={(e) => setPolicySearch(e.target.value)}
                    className="w-44 sm:w-60 pl-7 pr-7 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {policySearch && (
                    <button
                      type="button"
                      onClick={() => setPolicySearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {activeSection === "components" ? (
                  <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                    ➕ Add Component
                  </Button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const allCollapsed = Object.values(collapsedSections).every(Boolean);
                      setCollapsedSections({
                        earnings: !allCollapsed,
                        statutory: !allCollapsed,
                        attendance: !allCollapsed,
                        payout: !allCollapsed,
                        payslip: !allCollapsed,
                      });
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
                  >
                    {Object.values(collapsedSections).every(Boolean) ? "Expand All" : "Collapse All"}
                  </button>
                )}
              </div>
            </div>

            {/* Option 1: Global Search Filter Active Banner */}
            {policySearch && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs text-amber-800 flex items-center justify-between">
                <span>
                  🔍 Filtering across all sections for: <strong>"{policySearch}"</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPolicySearch("")}
                  className="text-amber-900 underline font-semibold text-[11px] hover:text-amber-950"
                >
                  Clear search
                </button>
              </div>
            )}

            {/* Unified Policy Specification Table */}
            {(activeSection !== "components" || activeSection === "all" || policySearch) && (
              <div className="overflow-hidden rounded-xl border border-slate-200/90 shadow-2xs bg-white min-h-[540px]">
                <table className="w-full text-left text-xs border-collapse table-fixed">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">
                      <th className="py-2.5 px-3.5 w-[280px]">Policy Parameter</th>
                      <th className="py-2.5 px-3.5 w-auto">Configuration Controls</th>
                      <th className="py-2.5 px-3.5 w-[240px] text-right">Active Status / Impact</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {/* ──────────────── SECTION 1: 💰 EARNINGS ARCHITECTURE ──────────────── */}
                    {(activeSection === "earnings" || activeSection === "all" || (policySearch && ["basic", "da", "hra", "earnings", "gross"].some((k) => policySearch.toLowerCase().includes(k)))) && (
                      <>
                        {/* Section Divider Banner (only shown in continuous view or search) */}
                        {(activeSection === "all" || policySearch) && (
                          <tr
                            id="section-earnings"
                            onClick={() => toggleSection("earnings")}
                            className="bg-slate-100/90 hover:bg-slate-200/70 cursor-pointer transition-colors border-y border-slate-200 font-bold"
                          >
                            <td colSpan={3} className="py-2 px-3.5 text-slate-800 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span>💰</span>
                                  <span className="uppercase tracking-wider">1. Earnings Architecture</span>
                                </span>
                                <span className="text-slate-400 text-xs">{collapsedSections.earnings && !policySearch ? "▼" : "▲"}</span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {(activeSection !== "all" || !collapsedSections.earnings || policySearch) && (
                          <>
                            {/* Row 1.1: Basic + DA */}
                            {(!policySearch || ["basic", "da", "gross"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.basic ? "border-b border-blue-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Basic + DA Calculation</span>
                                      <StatutoryInfoTooltip text="Statutory baseline for EPF, Gratuity & overtime calculation. Code on Wages mandates ≥ 50% of Gross." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1.5`}>
                                    <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-semibold border border-slate-200 max-w-sm">
                                      <button
                                        type="button"
                                        onClick={() => { setBasicType("PERCENT_GROSS"); setBasicPct(50); setBasicFlat(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${basicType === "PERCENT_GROSS" && Number(basicPct) === 50
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        50%
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setBasicType("PERCENT_GROSS"); setBasicPct(40); setBasicFlat(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${basicType === "PERCENT_GROSS" && Number(basicPct) === 40
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        40%
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setBasicType("PERCENT_GROSS");
                                          if (Number(basicPct) === 50 || Number(basicPct) === 40) setBasicPct(45);
                                        }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${basicType === "PERCENT_GROSS" && Number(basicPct) !== 50 && Number(basicPct) !== 40
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Custom %
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setBasicType("CUSTOM_FIXED")}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${basicType === "CUSTOM_FIXED"
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Custom ₹
                                      </button>
                                    </div>
                                    {basicType === "PERCENT_GROSS" ? (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="1"
                                          max="100"
                                          step="any"
                                          value={basicPct}
                                          onChange={(e) => setBasicPct(e.target.value)}
                                          className="w-18 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">% of Gross Salary</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500 font-bold">₹</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          value={basicFlat}
                                          onChange={(e) => setBasicFlat(e.target.value)}
                                          className="w-28 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                          placeholder="35000"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">Fixed Monthly</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                          {basicType === "PERCENT_GROSS" ? `${Number(basicPct).toFixed(2)}% Gross` : `₹${Number(basicFlat).toLocaleString()} Flat`}
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          {formatCurrency(simCalc.basic)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("basic")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View statutory rules & formula notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.basic ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.basic && (
                                  <tr className={`bg-blue-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-blue-700 font-bold shrink-0">⚖️ Statutory Law:</span>
                                        <span>EPF Act Section 6 mandates Basic + DA as the computation wage ceiling base (capped at ₹15,000/mo). Code on Wages 2019 requires Basic to constitute at least 50% of total contracted gross pay to prevent excessive allowance suppression.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 1.2: House Rent Allowance (HRA) */}
                            {(!policySearch || ["hra", "rent", "metro"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.hra ? "border-b border-purple-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">House Rent Allowance (HRA)</span>
                                      <StatutoryInfoTooltip text="Income Tax Act Sec 10(13A) tax-exempt component structured against Basic (50% Metro / 40% Non-Metro)." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1.5`}>
                                    <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-semibold border border-slate-200 max-w-sm">
                                      <button
                                        type="button"
                                        onClick={() => { setHraType("PERCENT_BASIC"); setHraPct(50); setHraFlat(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${hraType === "PERCENT_BASIC" && Number(hraPct) === 50
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        50%
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setHraType("PERCENT_BASIC"); setHraPct(40); setHraFlat(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${hraType === "PERCENT_BASIC" && Number(hraPct) === 40
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        40%
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setHraType("PERCENT_BASIC");
                                          if (Number(hraPct) === 50 || Number(hraPct) === 40) setHraPct(30);
                                        }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${hraType === "PERCENT_BASIC" && Number(hraPct) !== 50 && Number(hraPct) !== 40
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Custom %
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setHraType("CUSTOM_FIXED")}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${hraType === "CUSTOM_FIXED"
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Custom ₹
                                      </button>
                                    </div>
                                    {hraType === "PERCENT_BASIC" ? (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          step="any"
                                          value={hraPct}
                                          onChange={(e) => setHraPct(e.target.value)}
                                          className="w-18 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">% of Basic Salary</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500 font-bold">₹</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          value={hraFlat}
                                          onChange={(e) => setHraFlat(e.target.value)}
                                          className="w-28 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                          placeholder="15000"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">Fixed Monthly</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                                          {hraType === "PERCENT_BASIC" ? `${Number(hraPct).toFixed(2)}% Basic` : `₹${Number(hraFlat).toLocaleString()} Flat`}
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          {formatCurrency(simCalc.hra)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("hra")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View statutory rules & formula notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.hra ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.hra && (
                                  <tr className={`bg-purple-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-purple-700 font-bold shrink-0">⚖️ IT Rule 2A:</span>
                                        <span>Exempt from tax under Sec 10(13A) to the least of: (1) Actual HRA received, (2) 50% of Basic salary for metro cities or 40% for non-metros, or (3) Rent paid minus 10% of Basic salary.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 1.3: Leave Travel Allowance (LTA / LTC Policy) */}
                            {(!policySearch || ["lta", "leave travel", "travel", "ltc", "exemption"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.lta ? "border-b border-sky-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-sky-50 text-sky-600 border border-sky-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Leave Travel Allowance (LTA)</span>
                                      <StatutoryInfoTooltip text="Statutory vacation travel component under Section 10(5). CAs benchmark LTA at 8.33% of Basic (1 month's basic per year) for Old Tax Regime tax savings." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1.5`}>
                                    <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-semibold border border-slate-200 max-w-sm">
                                      <button
                                        type="button"
                                        onClick={() => { setLtaType("OFF"); setLtaPct(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${ltaType === "OFF"
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Off (0%)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setLtaType("PERCENT_BASIC"); setLtaPct(8.33); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${ltaType === "PERCENT_BASIC" && Number(ltaPct) === 8.33
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        8.33% (1 Mo)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setLtaType("PERCENT_BASIC"); setLtaPct(10); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${ltaType === "PERCENT_BASIC" && Number(ltaPct) === 10
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        10% Basic
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setLtaType("CUSTOM_FIXED")}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${ltaType === "CUSTOM_FIXED"
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        Custom ₹
                                      </button>
                                    </div>
                                    {ltaType === "PERCENT_BASIC" ? (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="0"
                                          max="50"
                                          step="0.01"
                                          value={ltaPct}
                                          onChange={(e) => setLtaPct(e.target.value)}
                                          className="w-20 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">% of Basic Salary</span>
                                      </div>
                                    ) : ltaType === "CUSTOM_FIXED" ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500 font-bold">₹</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          value={ltaFlat}
                                          onChange={(e) => setLtaFlat(e.target.value)}
                                          className="w-28 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                                          placeholder="2500"
                                        />
                                        <span className="text-xs text-slate-600 font-medium">Fixed Monthly</span>
                                      </div>
                                    ) : (
                                      <div className="text-[10.5px] text-slate-400 font-medium">
                                        No auto-LTA configured. LTA can be set manually per employee or left as ₹0.
                                      </div>
                                    )}
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${ltaType === "OFF"
                                          ? "bg-slate-200 text-slate-700"
                                          : "bg-sky-100 text-sky-800 border border-sky-200"
                                          }`}>
                                          {ltaType === "OFF" ? "LTA Off (₹0)" : ltaType === "PERCENT_BASIC" ? `${Number(ltaPct).toFixed(2)}% Basic` : `₹${Number(ltaFlat).toLocaleString()} Flat`}
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          {formatCurrency(simCalc.lta || 0)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("lta")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View CA & statutory rules"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.lta ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.lta && (
                                  <tr className={`bg-sky-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-sky-700 font-bold shrink-0">🏛️ IT Sec 10(5) & CA Standard:</span>
                                        <span>Exempt for domestic travel fares (max 2 journeys in a 4-year block) upon proof submission under the <strong>Old Tax Regime</strong>. Under the <strong>New Tax Regime (Sec 115BAC)</strong>, LTA is 100% taxable as regular income. CAs standardly structure LTA at <strong>8.33% of Basic</strong> (1 month's Basic annually).</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 1.4: Special Allowance (Auto-Balancing Remainder) */}
                            {(!policySearch || ["special", "allowance", "balance", "gross"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.special ? "border-b border-amber-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Special Allowance (Balancing)</span>
                                      <StatutoryInfoTooltip text="Dynamically absorbs remaining CTC pool so Gross strictly equals contracted CTC with zero variance." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-1.5 text-xs font-mono bg-slate-50 px-2.5 py-1 rounded border border-slate-200 text-slate-700 max-w-sm">
                                      <span>Gross</span>
                                      <span className="text-slate-400">−</span>
                                      <span>Basic</span>
                                      <span className="text-slate-400">−</span>
                                      <span>HRA</span>
                                      <span className="text-slate-400">−</span>
                                      <span>Statutory</span>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                          Dynamic Remainder
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          {formatCurrency(simCalc.specialAllowance)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("special")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View balance formula details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.special ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.special && (
                                  <tr className={`bg-amber-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-amber-800 font-bold shrink-0">ℹ️ Zero Variance Rule:</span>
                                        <span>Special Allowance is computed algebraically at salary creation time to guarantee that the sum of Basic + HRA + Custom Allowances + Special Allowance exactly matches Monthly Gross with zero paisa variance.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 1.4: Flexible Benefit Plan (FBP) Carve-Out Toggle */}
                            {(!policySearch || ["fbp", "flexible", "benefit", "ctc", "carve"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.fbpCarve ? "border-b border-indigo-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Carve out FBP from CTC</span>
                                      <StatutoryInfoTooltip text="Controls whether FBP is extracted from CTC upfront before Monthly Gross & Basic are derived." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <PolicyToggleSwitch
                                      id="toggle-carve-out-fbp"
                                      checked={carveOutFbp}
                                      onChange={setCarveOutFbp}
                                      label="Carve out Flexible Benefit Plan (FBP) from CTC"
                                      description="Deducts FBP upfront from CTC before deriving Gross & Basic (Non-Cash Perk Model)"
                                    />
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${carveOutFbp ? "bg-indigo-100 text-indigo-800 border border-indigo-200" : "bg-slate-100 text-slate-600 border border-slate-200"
                                        }`}>
                                        {carveOutFbp ? "FBP Carved Out" : "FBP in Gross"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("fbpCarve")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View FBP tax & structuring notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.fbpCarve ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.fbpCarve && (
                                  <tr className={`bg-indigo-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-indigo-800 font-bold shrink-0">📜 IT Sec 10 &amp; Rule 3:</span>
                                        <span>When OFF (Standard), FBP sits inside Monthly Gross and offsets Special Allowance on the payslip. When ON, FBP is extracted directly from the CTC pool upfront before Monthly Gross and Basic are derived (used for corporate prepaid benefit cards or off-payroll vouchers).</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}



                            {/* Row 1.6: Statutory Gratuity Carve-Out from CTC */}
                            {(!policySearch || ["gratuity", "ctc", "carve", "4.81", "retiral", "basic"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.gratuityCarve ? "border-b border-rose-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Carve out Gratuity from CTC</span>
                                      <StatutoryInfoTooltip text="Payment of Gratuity Act, 1972: 15/26 × 1/12 ≈ 4.81% of Basic + DA. Reserves employer gratuity provision upfront from CTC before deriving Monthly Gross." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2`}>
                                    <PolicyToggleSwitch
                                      id="toggle-gratuity-in-ctc"
                                      checked={gratuityInCtc}
                                      onChange={setGratuityInCtc}
                                      label={`Carve out Employer Gratuity (${Number(gratuityPct || 4.81).toFixed(2)}% of Basic) from CTC`}
                                      description="Deducts monthly gratuity provision upfront from CTC before calculating Monthly Gross & Special Allowance"
                                    />
                                    {gratuityInCtc && (
                                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-rose-50/60 border border-rose-200 max-w-sm">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10.5px] font-bold text-slate-700">Gratuity Rate:</span>
                                          <input
                                            type="number"
                                            min="0"
                                            max="20"
                                            step="0.01"
                                            value={gratuityPct}
                                            onChange={(e) => setGratuityPct(e.target.value)}
                                            className="w-18 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 font-mono"
                                          />
                                          <span className="text-[10px] text-slate-600">% of Basic</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setGratuityPct(4.81)}
                                          className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${Number(gratuityPct) === 4.81
                                            ? "bg-rose-600 text-white border-rose-600"
                                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
                                            }`}
                                        >
                                          Statutory 4.81%
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${gratuityInCtc
                                          ? "bg-rose-100 text-rose-800 border border-rose-200"
                                          : "bg-slate-100 text-slate-600 border border-slate-200"
                                          }`}>
                                          {gratuityInCtc ? `Gratuity ${Number(gratuityPct || 4.81).toFixed(2)}%` : "Outside CTC"}
                                        </span>
                                        {gratuityInCtc && (
                                          <span className="block text-xs font-bold text-rose-700 font-mono mt-0.5">
                                            {formatCurrency(simCalc.gratuityReserve)}/mo
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("gratuityCarve")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View Gratuity Act calculation details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.gratuityCarve ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.gratuityCarve && (
                                  <tr className={`bg-rose-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-rose-800 font-bold shrink-0">⚖️ Payment of Gratuity Act, 1972:</span>
                                        <span>Statutory gratuity accrues at 15 days of Basic + DA for every completed year of service based on a 26-working-day month: (15 ÷ 26) ÷ 12 = 4.8077% ≈ 4.81% of Basic. When carved out of CTC, it is reserved upfront alongside Employer PF/ESI before Monthly Gross is distributed.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* ──────────────── SECTION 2: 🛡️ STATUTORY COMPLIANCE ──────────────── */}
                    {(activeSection === "statutory" || activeSection === "all" || (policySearch && ["pf", "epf", "pt", "tax", "esi", "statutory"].some((k) => policySearch.toLowerCase().includes(k)))) && (
                      <>
                        {(activeSection === "all" || policySearch) && (
                          <tr
                            id="section-statutory"
                            onClick={() => toggleSection("statutory")}
                            className="bg-slate-50/90 hover:bg-slate-100/90 cursor-pointer transition-colors border-y border-slate-200 font-bold"
                          >
                            <td colSpan={3} className="py-2 px-3.5 text-slate-800 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span>🛡️</span>
                                  <span className="uppercase tracking-wider">2. Statutory Compliance</span>
                                </span>
                                <span className="text-slate-400 text-xs">{collapsedSections.statutory && !policySearch ? "▼" : "▲"}</span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {(activeSection !== "all" || !collapsedSections.statutory || policySearch) && (
                          <>
                            {/* Row 2.1: EPF Calculation Rule */}
                            {(!policySearch || ["pf", "epf", "provident"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.pf ? "border-b border-emerald-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Provident Fund (EPF)</span>
                                      <StatutoryInfoTooltip text="Statutory EPF under Employees' Provident Funds Act 1952. Standard 12% contribution with ₹1,800 wage cap, or configurable custom percentage and base." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2`}>
                                    <select
                                      value={pfRule}
                                      onChange={(e) => {
                                        const nextRule = e.target.value;
                                        setPfRule(nextRule);
                                        if (nextRule === "CAPPED_3000" && Number(pfWageCeiling) === 15000) {
                                          setPfWageCeiling(25000);
                                        } else if (nextRule === "CAPPED_1800" && Number(pfWageCeiling) === 25000) {
                                          setPfWageCeiling(15000);
                                        }
                                      }}
                                      className="w-full max-w-sm px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-semibold focus:ring-2 focus:ring-blue-500/20"
                                    >
                                      <option value="CAPPED_1800">Statutory Capped — ₹15k Ceiling (12% up to ₹1,800/mo)</option>
                                      <option value="CAPPED_3000">Statutory Capped — New ₹25k Ceiling (12% up to ₹3,000/mo)</option>
                                      <option value="UNCAPPED_12_PERCENT">Uncapped (12% of full Basic)</option>
                                      <option value="CUSTOM_PERCENT">Custom Percentage, Base & Ceiling</option>
                                      <option value="NOT_OPTED">Not Opted (0 PF Contribution)</option>
                                    </select>

                                    {(pfRule === "CAPPED_1800" || pfRule === "CAPPED_3000") && (
                                      <div className="p-2.5 bg-slate-50/90 rounded-lg border border-slate-200/90 space-y-2 max-w-sm">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[11px] font-bold text-slate-700">Statutory PF Wage Ceiling:</span>
                                          <div className="flex items-center gap-1">
                                            {[
                                              { label: "₹15k (₹1,800)", val: 15000, rule: "CAPPED_1800" },
                                              { label: "₹25k (₹3,000)", val: 25000, rule: "CAPPED_3000" },
                                            ].map((preset) => (
                                              <button
                                                key={preset.val}
                                                type="button"
                                                onClick={() => {
                                                  setPfWageCeiling(preset.val);
                                                  setPfRule(preset.rule);
                                                }}
                                                className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-all cursor-pointer ${Number(pfWageCeiling) === preset.val
                                                  ? "bg-blue-600 text-white border-blue-600"
                                                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                                  }`}
                                              >
                                                {preset.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-bold text-slate-500">₹</span>
                                            <input
                                              type="number"
                                              min="1000"
                                              step="any"
                                              value={pfWageCeiling}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setPfWageCeiling(v);
                                                if (Number(v) === 25000) setPfRule("CAPPED_3000");
                                                else if (Number(v) === 15000) setPfRule("CAPPED_1800");
                                              }}
                                              className="w-24 px-2 py-0.5 text-xs font-mono font-bold border border-slate-300 rounded bg-white text-slate-800"
                                              placeholder="25000"
                                            />
                                            <span className="text-[10.5px] text-slate-500 font-medium">/ mo Basic cap</span>
                                          </div>
                                          <span className="text-[10.5px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-mono">
                                            Max PF: ₹{Math.round((Number(pfWageCeiling) || 15000) * 0.12).toLocaleString()}/mo
                                          </span>
                                        </div>
                                      </div>
                                    )}

                                    {pfRule === "CUSTOM_PERCENT" && (
                                      <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-200/80 space-y-2 max-w-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[11px] font-bold text-slate-700">Employee Contribution %:</span>
                                          <div className="flex items-center gap-1">
                                            {[8, 10, 12].map((pct) => (
                                              <button
                                                key={pct}
                                                type="button"
                                                onClick={() => setPfCustomPct(pct)}
                                                className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-all cursor-pointer ${Number(pfCustomPct) === pct
                                                  ? "bg-blue-600 text-white border-blue-600"
                                                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                                  }`}
                                              >
                                                {pct}%
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="number"
                                              min="0"
                                              max="100"
                                              step="any"
                                              value={pfCustomPct}
                                              onChange={(e) => setPfCustomPct(e.target.value)}
                                              className="w-16 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                            />
                                            <span className="text-xs text-slate-600 font-bold">%</span>
                                          </div>
                                          <span className="text-[11px] text-slate-500 font-medium">on</span>
                                          <select
                                            value={pfCustomBase}
                                            onChange={(e) => setPfCustomBase(e.target.value)}
                                            className="flex-1 px-2 py-0.5 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-800"
                                          >
                                            <option value="BASIC">% of Basic + DA</option>
                                            <option value="GROSS">% of Gross Salary</option>
                                          </select>
                                        </div>
                                        <label className="flex items-center gap-2 pt-0.5 cursor-pointer select-none">
                                          <input
                                            type="checkbox"
                                            checked={pfCustomCapped}
                                            onChange={(e) => setPfCustomCapped(e.target.checked)}
                                            className="rounded text-blue-600 focus:ring-0"
                                          />
                                          <span className="text-[10.5px] text-slate-700 font-medium">
                                            Cap at statutory wage ceiling (₹{Number(pfWageCeiling || 15000).toLocaleString()}/mo)
                                          </span>
                                        </label>
                                        {pfCustomCapped && (
                                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-blue-200/60">
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[10.5px] font-bold text-slate-600">Ceiling ₹:</span>
                                              <input
                                                type="number"
                                                min="1000"
                                                step="any"
                                                value={pfWageCeiling}
                                                onChange={(e) => setPfWageCeiling(e.target.value)}
                                                className="w-20 px-2 py-0.5 text-xs font-mono font-bold border border-slate-300 rounded bg-white text-slate-800"
                                              />
                                              <div className="flex items-center gap-1">
                                                {[15000, 25000].map((val) => (
                                                  <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => setPfWageCeiling(val)}
                                                    className={`px-1.5 py-0.5 text-[9.5px] font-bold rounded border cursor-pointer ${Number(pfWageCeiling) === val
                                                      ? "bg-blue-600 text-white border-blue-600"
                                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                                      }`}
                                                  >
                                                    ₹{val / 1000}k
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                            <span className="text-[10px] font-bold text-blue-900 font-mono">
                                              Max: ₹{Math.round((Number(pfWageCeiling) || 15000) * ((Number(pfCustomPct) || 12) / 100)).toLocaleString()}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    <div className="pt-0.5">
                                      <PolicyToggleSwitch
                                        id="toggle-employer-pf-ctc"
                                        checked={employerPfInCtc}
                                        onChange={setEmployerPfInCtc}
                                        label="Carve out Employer PF from CTC pool"
                                        description="Offsets Special Allowance so contracted CTC is strictly preserved"
                                      />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                          {pfRule === "CAPPED_1800" || pfRule === "CAPPED_3000"
                                            ? `Capped ₹${simCalc.cappedPfAmount.toLocaleString()} (₹${(simCalc.effectiveCeiling / 1000).toFixed(0)}k)`
                                            : pfRule === "UNCAPPED_12_PERCENT"
                                              ? "12% Uncapped"
                                              : pfRule === "CUSTOM_PERCENT"
                                                ? `${pfCustomPct}% ${pfCustomBase}${pfCustomCapped ? ` (≤₹${(simCalc.effectiveCeiling / 1000).toFixed(0)}k)` : ""}`
                                                : "0 PF"}
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          ₹{simCalc.epf.toLocaleString()} / ₹{simCalc.employerPf.toLocaleString()}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("pf")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View EPF statutory rules"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.pf ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.pf && (
                                  <tr className={`bg-emerald-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-emerald-800 font-bold shrink-0">📜 EPF Act 1952:</span>
                                        <span>Employee share deducted from monthly salary. Employer share is reserved from CTC at structuring time and is purely informational on the payslip.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 2.2: Professional Tax (PT) */}
                            {(!policySearch || ["pt", "tax", "state", "karnataka"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.pt ? "border-b border-blue-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Professional Tax (PT)</span>
                                      <StatutoryInfoTooltip text="State statutory schedule & tax thresholds applied on monthly gross, or custom percentage calculation rule." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1.5`}>
                                    <select
                                      value={ptState}
                                      onChange={(e) => setPtState(e.target.value)}
                                      className="w-full max-w-sm px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-semibold focus:ring-2 focus:ring-blue-500/20"
                                    >
                                      <option value="KARNATAKA">Karnataka (2025 Act — ₹25k Threshold, ₹200 / ₹300 Feb)</option>
                                      <option value="TELANGANA_AP">Telangana / AP (₹15k / ₹20k Slabs)</option>
                                      <option value="MAHARASHTRA">Maharashtra (Tiered Slabs, ₹25k Women Exemption)</option>
                                      <option value="GUJARAT">Gujarat (₹12k Threshold, ₹200)</option>
                                      <option value="EXEMPT_ZERO">Delhi / UP / Rajasthan / Haryana (₹0 Exempt)</option>
                                      <option value="CUSTOM_FIXED">Custom Fixed Monthly Amount (₹ Flat)</option>
                                      <option value="CUSTOM_PERCENT">Custom Percentage of Salary (% Base)</option>
                                    </select>

                                    {ptState === "CUSTOM_FIXED" && (
                                      <div className="flex items-center gap-1.5 pt-0.5">
                                        <span className="text-xs text-slate-500 font-bold">₹</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          value={ptAmount}
                                          onChange={(e) => setPtAmount(e.target.value)}
                                          className="w-20 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                          placeholder="200"
                                        />
                                        <span className="text-[11px] text-slate-500">Fixed Monthly PT</span>
                                      </div>
                                    )}

                                    {ptState === "CUSTOM_PERCENT" && (
                                      <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-200/80 space-y-2 max-w-sm">
                                        <div className="flex items-center gap-2">
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="number"
                                              min="0"
                                              max="20"
                                              step="any"
                                              value={ptCustomPct}
                                              onChange={(e) => setPtCustomPct(e.target.value)}
                                              className="w-16 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                              placeholder="1.0"
                                            />
                                            <span className="text-xs text-slate-600 font-bold">%</span>
                                          </div>
                                          <span className="text-[11px] text-slate-500 font-medium">of</span>
                                          <select
                                            value={ptCustomBase}
                                            onChange={(e) => setPtCustomBase(e.target.value)}
                                            className="flex-1 px-2 py-0.5 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-800"
                                          >
                                            <option value="GROSS">Monthly Gross Salary</option>
                                            <option value="BASIC">Basic + DA</option>
                                            <option value="EARNED">Earned Net Gross</option>
                                          </select>
                                        </div>
                                        <div className="flex items-center gap-2 pt-0.5">
                                          <span className="text-[11px] text-slate-600 font-medium">Monthly Cap:</span>
                                          <span className="text-xs text-slate-500 font-bold">₹</span>
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={ptCustomCap}
                                            onChange={(e) => setPtCustomCap(e.target.value)}
                                            className="w-20 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                            placeholder="200"
                                          />
                                          <span className="text-[10px] text-slate-400 font-mono">(0 = no cap)</span>
                                        </div>
                                      </div>
                                    )}

                                    <div className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200 max-w-sm">
                                      💡 Sample Gross ₹{simCalc?.earnedGross.toLocaleString()} ➔ Deduction: <strong>₹{simulatedPt}/mo</strong>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${ptState === "EXEMPT_ZERO"
                                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                          : "bg-blue-100 text-blue-800 border border-blue-200"
                                          }`}>
                                          {ptState === "CUSTOM_PERCENT" ? `${ptCustomPct}% ${ptCustomBase}` : ptState === "EXEMPT_ZERO" ? "₹0 Exempt" : ptState}
                                        </span>
                                        <span className="block text-sm font-bold text-slate-900 font-mono mt-0.5">
                                          ₹{simulatedPt}/mo
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("pt")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View PT state schedule notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.pt ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.pt && (
                                  <tr className={`bg-blue-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-blue-800 font-bold shrink-0">🏛️ State PT Schedule:</span>
                                        <span>Karnataka: ₹0 if Monthly Gross &lt; ₹25,000; ₹200/mo (Apr–Jan, Mar) and ₹300 in February to reach statutory ₹2,500 annual limit.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 2.3: Employees' State Insurance (ESI) */}
                            {(!policySearch || ["esi", "insurance", "ceiling"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.esi ? "border-b border-emerald-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Employees&apos; State Insurance (ESI)</span>
                                      <StatutoryInfoTooltip text="Statutory social security and health insurance scheme under ESI Act 1948 with configurable wage ceiling, rates, and 6-month contribution continuity." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2`}>
                                    <div className="pt-0.5">
                                      <PolicyToggleSwitch
                                        id="toggle-esi-scheme"
                                        checked={esiEnabled}
                                        onChange={setEsiEnabled}
                                        label={esiEnabled ? "ESI Scheme Active" : "ESI Scheme Disabled"}
                                        description={`Statutory healthcare insurance for employees with gross ≤ ₹${Number(esiWageCeiling || 21000).toLocaleString("en-IN")}/mo`}
                                      />
                                    </div>
                                    {esiEnabled && (
                                      <div className="space-y-2.5 p-2.5 bg-blue-50/50 rounded-lg border border-blue-200/60 mt-1 max-w-md">
                                        <div>
                                          <span className="text-[10.5px] font-bold text-slate-700 block mb-1">ESI Calculation Rule</span>
                                          <select
                                            value={esiCalculationRule}
                                            onChange={(e) => {
                                              const nextRule = e.target.value;
                                              setEsiCalculationRule(nextRule);
                                              if (nextRule === "STATUTORY_21K") {
                                                setEsiWageCeiling(21000);
                                                setEsiEmployeePct(0.75);
                                                setEsiEmployerPct(3.25);
                                                setEsiCustomBase("GROSS");
                                              } else if (nextRule === "STATUTORY_25K") {
                                                setEsiWageCeiling(25000);
                                                setEsiEmployeePct(0.75);
                                                setEsiEmployerPct(3.25);
                                                setEsiCustomBase("GROSS");
                                              }
                                            }}
                                            className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-md bg-white text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                          >
                                            <option value="STATUTORY_21K">Statutory (0.75% Empl / 3.25% Emplr · ₹21,000 Ceiling)</option>
                                            <option value="STATUTORY_25K">Revised Ceiling (0.75% Empl / 3.25% Emplr · ₹25,000 Ceiling)</option>
                                            <option value="UNCAPPED">Uncapped ESI (All Employees Regardless of Gross)</option>
                                            <option value="CUSTOM_RULE">Custom ESI Rule (% Rate, Base & Custom Ceiling)</option>
                                          </select>
                                        </div>

                                        {esiCalculationRule !== "UNCAPPED" && (
                                          <div className="p-2 rounded bg-white border border-slate-200 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="text-[10.5px] font-bold text-slate-700">Statutory ESI Wage Ceiling:</span>
                                              <div className="flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEsiWageCeiling(21000);
                                                    if (esiCalculationRule === "STATUTORY_25K") setEsiCalculationRule("STATUTORY_21K");
                                                  }}
                                                  className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${Number(esiWageCeiling) === 21000 ? "bg-blue-600 text-white border-blue-600" : "bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100"}`}
                                                >
                                                  ₹21k
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEsiWageCeiling(25000);
                                                    if (esiCalculationRule === "STATUTORY_21K") setEsiCalculationRule("STATUTORY_25K");
                                                  }}
                                                  className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${Number(esiWageCeiling) === 25000 ? "bg-blue-600 text-white border-blue-600" : "bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100"}`}
                                                >
                                                  ₹25k
                                                </button>
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-1">
                                                <span className="text-[11px] font-bold text-slate-500">₹</span>
                                                <input
                                                  type="number"
                                                  min={1000}
                                                  step="any"
                                                  value={esiWageCeiling}
                                                  onChange={(e) => setEsiWageCeiling(e.target.value)}
                                                  className="w-24 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 font-mono"
                                                />
                                                <span className="text-[10px] text-slate-500">/mo</span>
                                              </div>
                                              <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                                Max Empl: ₹{Math.ceil((Number(esiWageCeiling || 21000) * (esiCalculationRule === "CUSTOM_RULE" ? (Number(esiEmployeePct || 0.75) / 100) : 0.0075))).toLocaleString("en-IN")}/mo
                                              </span>
                                            </div>
                                          </div>
                                        )}

                                        {esiCalculationRule === "CUSTOM_RULE" && (
                                          <div className="p-2 rounded bg-white border border-blue-200 space-y-1.5">
                                            <div className="grid grid-cols-3 gap-2">
                                              <div>
                                                <span className="text-[10px] font-semibold text-slate-600 block">Empl Rate (%)</span>
                                                <input
                                                  type="number"
                                                  min={0}
                                                  max={20}
                                                  step="any"
                                                  value={esiEmployeePct}
                                                  onChange={(e) => setEsiEmployeePct(e.target.value)}
                                                  className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                                />
                                              </div>
                                              <div>
                                                <span className="text-[10px] font-semibold text-slate-600 block">Emplr Rate (%)</span>
                                                <input
                                                  type="number"
                                                  min={0}
                                                  max={20}
                                                  step="any"
                                                  value={esiEmployerPct}
                                                  onChange={(e) => setEsiEmployerPct(e.target.value)}
                                                  className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                                />
                                              </div>
                                              <div>
                                                <span className="text-[10px] font-semibold text-slate-600 block">Wage Base</span>
                                                <select
                                                  value={esiCustomBase}
                                                  onChange={(e) => setEsiCustomBase(e.target.value)}
                                                  className="w-full px-1.5 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                                >
                                                  <option value="GROSS">Gross</option>
                                                  <option value="BASIC">Basic</option>
                                                </select>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        <PolicyToggleSwitch
                                          id="toggle-esi-continuity"
                                          checked={esiPeriodContinuity}
                                          onChange={setEsiPeriodContinuity}
                                          label="Enforce 6-Month Contribution Continuity (Apr–Sep / Oct–Mar)"
                                          description="Keep deducting ESI until period end if employee crosses ceiling mid-period (Sec 2(9) ESI Act)"
                                        />

                                        <div>
                                          <span className="text-[10.5px] font-bold text-slate-700 block mb-1">ESI Deduction Rounding Rule (ESIC Reg. 29)</span>
                                          <select
                                            value={esiRoundingMode}
                                            onChange={(e) => setEsiRoundingMode(e.target.value)}
                                            className="w-full px-2 py-1 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-800"
                                          >
                                            <option value="CEIL_RUPEE">ESIC Next Higher Rupee — Ceiling (₹142.05 ➔ ₹143)</option>
                                            <option value="NEAREST_RUPEE">Nearest Whole Rupee (₹142.05 ➔ ₹142)</option>
                                            <option value="EXACT_PAISA">Exact Paisa — 2 Decimals (₹142.05)</option>
                                          </select>
                                        </div>

                                        <div>
                                          <span className="text-[10.5px] font-bold text-slate-700 block mb-1">ESI Establishment Code</span>
                                          <input
                                            type="text"
                                            value={esiEstablishmentCode}
                                            onChange={(e) => setEsiEstablishmentCode(e.target.value)}
                                            placeholder="17-Digit Establishment Code"
                                            maxLength={25}
                                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-800 font-mono"
                                          />
                                        </div>
                                        <PolicyToggleSwitch
                                          id="toggle-employer-esi-ctc"
                                          checked={employerEsiInCtc}
                                          onChange={setEmployerEsiInCtc}
                                          label={`Carve out Employer ESI (${esiCalculationRule === "CUSTOM_RULE" ? esiEmployerPct : 3.25}%) from CTC pool`}
                                          description="Deducts employer ESI from CTC before calculating gross"
                                        />
                                      </div>
                                    )}
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${esiEnabled ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-200 text-slate-700"
                                          }`}>
                                          {esiEnabled
                                            ? esiCalculationRule === "UNCAPPED"
                                              ? "Active (Uncapped)"
                                              : `Active (≤ ₹${Math.round(Number(esiWageCeiling || 21000) / 1000)}k)`
                                            : "Disabled"}
                                        </span>
                                        {esiEnabled && (
                                          <span className="block text-[11px] text-slate-600 font-mono mt-0.5">
                                            {esiCalculationRule === "CUSTOM_RULE" ? `${esiEmployeePct}% / ${esiEmployerPct}%` : "0.75% Empl / 3.25% Emplr"}
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("esi")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View ESI statutory notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.esi ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.esi && (
                                  <tr className={`bg-emerald-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-emerald-800 font-bold shrink-0">🏥 ESI Act 1948:</span>
                                        <span>Mandatory when gross wages ≤ ₹{Number(esiWageCeiling || 21000).toLocaleString("en-IN")}/month. Under Section 2(9), if an employee starts a 6-month contribution window (Apr–Sep or Oct–Mar) below the ceiling and receives a mid-period hike above the ceiling, ESI continues until the end of that 6-month window.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 2.4: Labour Welfare Fund (LWF) */}
                            {(!policySearch || ["lwf", "welfare", "labour welfare", "statutory"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.lwf ? "border-b border-indigo-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Labour Welfare Fund (LWF)</span>
                                      <StatutoryInfoTooltip text="Configure state-specific Labour Welfare Fund (LWF) statutory deductions and employer contributions." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2.5`}>
                                    <div className="space-y-2 max-w-md">
                                      <div>
                                        <span className="text-[10.5px] font-bold text-slate-700 block mb-1">State Labour Welfare Fund (LWF) Schedule</span>
                                        <select
                                          value={lwfState}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            setLwfState(next);
                                            if (next === "KARNATAKA_DEC") {
                                              setLwfEmployeeAmount(20);
                                              setLwfEmployerAmount(40);
                                            } else if (next === "MAHARASHTRA_JUN_DEC") {
                                              setLwfEmployeeAmount(25);
                                              setLwfEmployerAmount(75);
                                            }
                                          }}
                                          className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-md bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                                        >
                                          <option value="EXEMPT_ZERO">Exempt / Disabled (₹0)</option>
                                          <option value="KARNATAKA_DEC">Karnataka LWF (₹20 Empl / ₹40 Emplr — December Only)</option>
                                          <option value="MAHARASHTRA_JUN_DEC">Maharashtra LWF (₹25 Empl / ₹75 Emplr — June & December)</option>
                                          <option value="CUSTOM_DECEMBER">Custom Annual LWF (Deducted in December)</option>
                                          <option value="CUSTOM_MONTHLY">Custom Monthly LWF (Every Month)</option>
                                        </select>
                                      </div>

                                      {lwfState !== "EXEMPT_ZERO" && (
                                        <div className="grid grid-cols-2 gap-2 p-2 rounded bg-indigo-50/50 border border-indigo-200/70">
                                          <div>
                                            <span className="text-[10px] font-semibold text-slate-600 block">Employee LWF (₹)</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="any"
                                              value={lwfEmployeeAmount}
                                              onChange={(e) => setLwfEmployeeAmount(e.target.value)}
                                              className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 font-mono"
                                            />
                                          </div>
                                          <div>
                                            <span className="text-[10px] font-semibold text-slate-600 block">Employer LWF (₹)</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step="any"
                                              value={lwfEmployerAmount}
                                              onChange={(e) => setLwfEmployerAmount(e.target.value)}
                                              className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 font-mono"
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${lwfState !== "EXEMPT_ZERO"
                                          ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                          : "bg-slate-200 text-slate-700"
                                          }`}>
                                          {lwfState === "EXEMPT_ZERO" ? "LWF Exempt" : `LWF ₹${lwfEmployeeAmount}`}
                                        </span>
                                        <span className="block text-[11px] text-slate-600 font-mono mt-0.5">
                                          {lwfState === "EXEMPT_ZERO" ? "₹0 / mo" : lwfState === "KARNATAKA_DEC" ? "Dec Only" : lwfState === "MAHARASHTRA_JUN_DEC" ? "Jun & Dec" : "Scheduled"}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("lwf")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View LWF statutory notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.lwf ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.lwf && (
                                  <tr className={`bg-indigo-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-indigo-800 font-bold shrink-0">🏛️ State LWF Rules:</span>
                                        <span>Labour Welfare Fund is a statutory state contribution. Karnataka LWF deducts ₹20 (Employee) and ₹40 (Employer) in December only. Maharashtra LWF deducts ₹25 (Employee) and ₹75 (Employer) bi-annually in June and December.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 2.5: Statutory Bonus (% of Basic) */}
                            {(!policySearch || ["bonus", "statutory bonus", "payment of bonus", "statutory"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.bonus ? "border-b border-emerald-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Statutory Bonus (% of Basic)</span>
                                      <StatutoryInfoTooltip text="Configure statutory bonus under Payment of Bonus Act, 1965 (mandates 8.33% to 20% of Basic + DA)." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2.5`}>
                                    <div className="space-y-2 max-w-md">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10.5px] font-bold text-slate-700">Bonus Percentage (% of Earned Basic)</span>
                                        <div className="flex items-center gap-1">
                                          {[
                                            { label: "Off (0%)", val: 0 },
                                            { label: "Min 8.33%", val: 8.33 },
                                            { label: "Max 20%", val: 20 },
                                          ].map((preset) => (
                                            <button
                                              key={preset.label}
                                              type="button"
                                              onClick={() => setStatutoryBonusPct(preset.val)}
                                              className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${Number(statutoryBonusPct) === preset.val ? "bg-emerald-600 text-white border-emerald-600 shadow-xs" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"}`}
                                            >
                                              {preset.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between gap-2 p-2 rounded bg-emerald-50/50 border border-emerald-200/70">
                                        <div className="flex items-center gap-1.5">
                                          <input
                                            type="number"
                                            min={0}
                                            max={30}
                                            step={0.01}
                                            value={statutoryBonusPct}
                                            onChange={(e) => setStatutoryBonusPct(e.target.value)}
                                            className="w-20 px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                                          />
                                          <span className="text-[11px] text-slate-600 font-semibold">% of Earned Basic</span>
                                        </div>
                                        <span className="text-[11px] text-emerald-800 font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200/80 shadow-xs">
                                          {Number(statutoryBonusPct) > 0
                                            ? `≈ ₹${Math.round((simCalc?.earnedBasic || 0) * (Number(statutoryBonusPct) / 100)).toLocaleString("en-IN")}/mo`
                                            : "No auto-bonus"}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${Number(statutoryBonusPct) > 0
                                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          : "bg-slate-200 text-slate-700"
                                          }`}>
                                          {Number(statutoryBonusPct) > 0 ? `Bonus: ${statutoryBonusPct}%` : "Bonus: Off (0%)"}
                                        </span>
                                        <span className="block text-[11px] text-slate-600 font-mono mt-0.5">
                                          {Number(statutoryBonusPct) > 0 ? "Monthly Earning" : "Exempt / Off"}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("bonus")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View Statutory Bonus notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.bonus ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.bonus && (
                                  <tr className={`bg-emerald-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-emerald-800 font-bold shrink-0">🎁 Payment of Bonus Act, 1965:</span>
                                        <span>Mandates a minimum statutory bonus of 8.33% (equivalent to 1 month basic wages spread over 12 months) up to 20% maximum. When configured, this earning is automatically computed on Earned Basic each month, included in Gross Earnings and Net Take-Home Pay, and displayed under Earnings on payslips (exempt from PF wages).</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* ──────────────── SECTION 3: 🗓️ ATTENDANCE & LEAVE POLICIES ──────────────── */}
                    {(activeSection === "attendance" || activeSection === "all" || (policySearch && ["attendance", "cut-off", "cycle", "leave", "probation", "comp-off", "ledger", "proration", "divisor"].some((k) => policySearch.toLowerCase().includes(k)))) && (
                      <>
                        {(activeSection === "all" || policySearch) && (
                          <tr
                            id="section-attendance"
                            onClick={() => toggleSection("attendance")}
                            className="bg-slate-50/90 hover:bg-slate-100/90 cursor-pointer transition-colors border-y border-slate-200 font-bold"
                          >
                            <td colSpan={3} className="py-2 px-3.5 text-slate-800 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span>🗓️</span>
                                  <span className="uppercase tracking-wider">3. Attendance & Pay Cycle</span>
                                </span>
                                <span className="text-slate-400 text-xs">{collapsedSections.attendance && !policySearch ? "▼" : "▲"}</span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {(activeSection !== "all" || !collapsedSections.attendance || policySearch) && (
                          <>
                            {/* Row 3.1: Attendance Cut-Off Range */}
                            {(!policySearch || ["cut-off", "cycle", "attendance", "calendar"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.cutoff ? "border-b border-blue-100" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Attendance Cut-Off Window</span>
                                      <StatutoryInfoTooltip text="Monthly payroll billing cut-off window. E.g., 21st to 20th means attendance from 21st of previous month to 20th of current month." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1.5`}>
                                    <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-semibold border border-slate-200 max-w-sm">
                                      <button
                                        type="button"
                                        onClick={() => { setCycleStartDay(1); setCycleEndDay(0); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${cycleStartDay === 1 && cycleEndDay === 0
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        1st–EOM
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setCycleStartDay(21); setCycleEndDay(20); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${cycleStartDay === 21 && cycleEndDay === 20
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        21st–20th
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setCycleStartDay(26); setCycleEndDay(25); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${cycleStartDay === 26 && cycleEndDay === 25
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        26th–25th
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setCycleStartDay(16); setCycleEndDay(15); }}
                                        className={`py-1 px-1 rounded transition-all text-center cursor-pointer ${cycleStartDay === 16 && cycleEndDay === 15
                                          ? "bg-blue-600 text-white font-bold shadow-xs"
                                          : "text-slate-600 hover:text-slate-900"
                                          }`}
                                      >
                                        16th–15th
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2 pt-0.5">
                                      <span className="text-[11px] text-slate-500 font-medium">Start:</span>
                                      <input
                                        type="number"
                                        min="1"
                                        max="31"
                                        value={cycleStartDay}
                                        onChange={(e) => setCycleStartDay(e.target.value)}
                                        className="w-14 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                      />
                                      <span className="text-[11px] text-slate-500 font-medium">End:</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="31"
                                        value={cycleEndDay}
                                        onChange={(e) => setCycleEndDay(e.target.value)}
                                        className="w-14 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                      />
                                      <span className="text-[10px] text-slate-400 font-mono">(0 = EOM)</span>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200 font-mono">
                                        {cycleStartDay === 1 && cycleEndDay === 0 ? "1st – EOM" : `${cycleStartDay}th – ${cycleEndDay}th`}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("cutoff")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View cycle details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.cutoff ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.cutoff && (
                                  <tr className={`bg-blue-50/50 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-blue-800 font-bold shrink-0">🗓️ Billing Cycle:</span>
                                        <span>Determines the biometric attendance window used when parsing monthly Excel attendance files. If 21st–20th is chosen, August payroll evaluates attendance between July 21st and August 20th.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 3.2: Annual Paid Leaves & Probation */}
                            {(!policySearch || ["leave", "probation", "accrual"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.leaves ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Leaves & Probation Rules</span>
                                      <StatutoryInfoTooltip text="Annual paid leave entitlement (default 22 days/year = 1.83 days/month). New joiners in probation have leave/comp-off freeze." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2`}>
                                    <div className="grid grid-cols-2 gap-3 max-w-md">
                                      <div className="space-y-1">
                                        <span className="text-[11px] text-slate-600 block font-medium">Annual Paid Leaves:</span>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="number"
                                            min="0"
                                            max="60"
                                            step="0.5"
                                            disabled={!trackLeaveLedger}
                                            value={annualLeaveDays}
                                            onChange={(e) => setAnnualLeaveDays(e.target.value)}
                                            className={`w-28 px-3 py-1.5 text-sm font-bold border rounded-lg ${trackLeaveLedger
                                              ? "border-slate-300 bg-white text-slate-800 shadow-2xs"
                                              : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                                              }`}
                                          />
                                          <span className="text-xs text-slate-500 font-semibold">days/yr</span>
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[11px] text-slate-600 block font-medium">Probation Duration:</span>
                                          <div className="flex items-center gap-1">
                                            {[0, 3, 6].map((m) => (
                                              <button
                                                key={m}
                                                type="button"
                                                onClick={() => setProbationMonths(m)}
                                                className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-all ${Number(probationMonths) === m
                                                  ? "bg-blue-600 text-white border-blue-600"
                                                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                                  }`}
                                              >
                                                {m === 0 ? "0m" : `${m}m`}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <input
                                            type="number"
                                            min="0"
                                            max="36"
                                            step="1"
                                            value={probationMonths}
                                            onChange={(e) => setProbationMonths(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10)))}
                                            className="w-24 px-2.5 py-1 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-800"
                                            placeholder="6"
                                          />
                                          <span className="text-[11px] text-slate-500 font-medium">months</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Leave Encashment Formula & Live Daily Rate Badge (Option 1) */}
                                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 max-w-md space-y-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10.5px] font-bold text-slate-700">Leave Encashment Formula:</span>
                                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                                          1-Day Rate: ₹{simCalc.leaveEncashmentDailyRate.toLocaleString("en-IN")}/day
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <span className="text-[10px] text-slate-500 block font-semibold">Salary Base</span>
                                          <select
                                            value={leaveEncashmentBase}
                                            onChange={(e) => setLeaveEncashmentBase(e.target.value)}
                                            className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                          >
                                            <option value="BASIC">Basic + DA (Statutory)</option>
                                            <option value="GROSS">Monthly Gross Salary</option>
                                          </select>
                                        </div>
                                        <div>
                                          <span className="text-[10px] text-slate-500 block font-semibold">Day Divisor</span>
                                          <select
                                            value={leaveEncashmentDivisor}
                                            onChange={(e) => setLeaveEncashmentDivisor(e.target.value)}
                                            className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800"
                                          >
                                            <option value="30">÷ 30 Days (Standard)</option>
                                            <option value="26">÷ 26 Days (Factories Act)</option>
                                          </select>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                                          {trackLeaveLedger ? `= ${(Number(annualLeaveDays || 0) / 12).toFixed(2)} d/mo` : "Accrual Off"}
                                        </span>
                                        <span className="block text-[11px] text-slate-500 mt-0.5">
                                          {Number(probationMonths) === 0 ? "Immediate eligibility" : `${probationMonths}m freeze`}
                                        </span>
                                        <span className="block text-[10px] text-emerald-700 font-mono font-bold mt-0.5">
                                          Encash: {leaveEncashmentBase === "GROSS" ? "Gross" : "Basic"} ÷ {leaveEncashmentDivisor}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("leaves")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View leave accrual details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.leaves ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.leaves && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">🌴 Leave Policy:</span>
                                        <span>Employees accrue paid leave monthly. During the probation period (e.g. 6 months), paid leave & comp-off cannot cover LOP; attendance shortfalls during probation directly reduce salary.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 3.3: Balance Ledgers (Leave Ledger & Comp-Off) */}
                            {(!policySearch || ["ledger", "comp-off", "balance", "bank"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.ledgers ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Balance Ledgers & Debt</span>
                                      <StatutoryInfoTooltip text="Track monthly leave balances, negative leave debt, and comp-off banks." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2`}>
                                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 max-w-sm">
                                      <PolicyToggleSwitch
                                        id="toggle-leave-ledger"
                                        checked={trackLeaveLedger}
                                        onChange={setTrackLeaveLedger}
                                        label="Track Paid Leave Ledger (🌴)"
                                        description="Accumulate monthly leave credits & calculate negative leave debt"
                                      />
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 max-w-sm">
                                      <PolicyToggleSwitch
                                        id="toggle-comp-off"
                                        checked={trackCompOff}
                                        onChange={setTrackCompOff}
                                        label="Track Compensatory Off Bank (🏖️)"
                                        description="Allow holiday/weekend work credit banking and encashment"
                                      />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right space-y-1">
                                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${trackLeaveLedger ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                                          }`}>
                                          {trackLeaveLedger ? "Ledger ON" : "Ledger OFF"}
                                        </span>
                                        <span className={`block text-[10px] font-bold ${trackCompOff ? "text-blue-700" : "text-slate-400"
                                          }`}>
                                          {trackCompOff ? "Comp-Off ON" : "Comp-Off OFF"}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("ledgers")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View ledger settlement details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.ledgers ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.ledgers && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">⚖️ Auto-Settlement:</span>
                                        <span>When comp-off has a positive closing balance and leave ledger has negative debt, spare comp-off automatically offsets leave debt in every calculation cycle without manual intervention.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 3.4: Mid-Month Proration & Pay Divisor Rule */}
                            {(!policySearch || ["proration", "divisor", "mid-month", "joiner", "calendar", "working"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.proration ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Mid-Month Proration & Pay Divisor</span>
                                      <StatutoryInfoTooltip text="Configure how daily salary rates and mid-month joiner/exit/revision prorations are calculated across the pay period." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-2.5`}>
                                    <div className="space-y-2 max-w-md">
                                      <div>
                                        <span className="text-[10.5px] font-bold text-slate-700 block mb-1">Monthly Pay Divisor Basis</span>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          {[
                                            { id: "ACTUAL_CALENDAR_DAYS", label: "Actual Calendar Days", sub: "28 / 29 / 30 / 31 days" },
                                            { id: "STANDARD_30_DAYS", label: "Flat 30-Day Standard", sub: "Always ÷ 30 every month" },
                                            { id: "WORKING_DAYS_26", label: "26 Working Days", sub: "Factories Act (÷ 26)" },
                                            { id: "DISABLED", label: "No Proration (Full)", sub: "100% monthly pay" },
                                          ].map((opt) => (
                                            <button
                                              key={opt.id}
                                              type="button"
                                              onClick={() => setMidMonthProrationRule(opt.id)}
                                              className={`text-left px-2.5 py-1.5 rounded-md border transition-all cursor-pointer ${midMonthProrationRule === opt.id
                                                ? "bg-blue-50 border-blue-500 text-blue-900 shadow-xs"
                                                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                                                }`}
                                            >
                                              <span className="block text-[11px] font-bold">{opt.label}</span>
                                              <span className="block text-[9.5px] text-slate-500">{opt.sub}</span>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                                        <PolicyToggleSwitch
                                          id="toggle-auto-prorate-mid-month"
                                          checked={autoProrateMidMonth}
                                          onChange={setAutoProrateMidMonth}
                                          label="Auto-Prorate Mid-Month Joiners, Exits & Salary Revisions"
                                          description="Automatically clamp active tenure days for DOJ/DOL and blend mid-month salary revisions by effective date"
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="text-right space-y-1">
                                        <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                          {midMonthProrationRule === "STANDARD_30_DAYS"
                                            ? "30-Day Basis"
                                            : midMonthProrationRule === "WORKING_DAYS_26"
                                              ? "26-Day Basis"
                                              : midMonthProrationRule === "DISABLED"
                                                ? "No Proration"
                                                : "Calendar Days"}
                                        </span>
                                        <span className={`block text-[10px] font-bold ${autoProrateMidMonth ? "text-emerald-700" : "text-slate-400"}`}>
                                          {autoProrateMidMonth ? "Auto-Tenure ON" : "Auto-Tenure OFF"}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("proration")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View proration divisor details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.proration ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.proration && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">📐 Proration Math:</span>
                                        <span>Controls the denominator used when computing earned salary from payable days and when clamping attendance for employees who join or exit mid-month.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* ──────────────── SECTION 4: 💳 DISBURSEMENT & LOSS OF PAY (LOP) ──────────────── */}
                    {(activeSection === "payout" || activeSection === "all" || (policySearch && ["payout", "lop", "payment", "mode", "loss", "disbursement"].some((k) => policySearch.toLowerCase().includes(k)))) && (
                      <>
                        {(activeSection === "all" || policySearch) && (
                          <tr
                            id="section-payout"
                            onClick={() => toggleSection("payout")}
                            className="bg-slate-50/90 hover:bg-slate-100/90 cursor-pointer transition-colors border-y border-slate-200 font-bold"
                          >
                            <td colSpan={3} className="py-2 px-3.5 text-slate-800 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span>💳</span>
                                  <span className="uppercase tracking-wider">4. Disbursement & Loss of Pay (LOP)</span>
                                </span>
                                <span className="text-slate-400 text-xs">{collapsedSections.payout && !policySearch ? "▼" : "▲"}</span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {(activeSection !== "all" || !collapsedSections.payout || policySearch) && (
                          <>
                            {/* Row 4.1: Default Payment Mode */}
                            {(!policySearch || ["payment", "wire", "bank", "cheque", "mode"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.payoutMode ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Default Payment Mode</span>
                                      <StatutoryInfoTooltip text="Default payout channel shown on monthly payslip header and bank payment advisory files." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <select
                                      value={defaultPaymentMode}
                                      onChange={(e) => setDefaultPaymentMode(e.target.value)}
                                      className="w-full max-w-sm px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-semibold focus:ring-2 focus:ring-blue-500/20"
                                    >
                                      <option value="WIRE_TRANSFER">Wire Transfer</option>
                                      <option value="BANK_TRANSFER">Bank Transfer / NEFT / RTGS</option>
                                      <option value="CHEQUE">Cheque</option>
                                      <option value="CASH">Cash</option>
                                    </select>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                                        {defaultPaymentMode.replace('_', ' ')}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("payoutMode")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View payment channel details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.payoutMode ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.payoutMode && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">💳 Payout Mode:</span>
                                        <span>Printed on the top header of individual payslip PDFs and feeds into automated bank export sheets during batch disbursement.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 4.2: Loss of Pay (LOP) Policy */}
                            {(!policySearch || ["lop", "loss", "pay", "reduction", "debt"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.lop ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Loss of Pay (LOP) Rule</span>
                                      <StatutoryInfoTooltip text="Governs how attendance shortfalls and unapproved leaves are processed during monthly payroll." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1`}>
                                    <select
                                      value={lopPolicy}
                                      onChange={(e) => setLopPolicy(e.target.value)}
                                      className="w-full max-w-sm px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-semibold focus:ring-2 focus:ring-blue-500/20"
                                    >
                                      <option value="ACCRUE_LEAVE_DEBT">Negative Leave Debt (CKPS Firm Model)</option>
                                      <option value="REDUCE_SALARY">Direct Salary Reduction (Commercial Client Model)</option>
                                    </select>
                                    <span className="text-[10px] text-slate-500 block">
                                      {lopPolicy === "REDUCE_SALARY"
                                        ? "Uncovered LOP directly reduces payable days and earned monthly salary."
                                        : "Full salary is disbursed; shortfalls accumulate as negative ledger debt."}
                                    </span>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${lopPolicy === "REDUCE_SALARY"
                                        ? "bg-rose-100 text-rose-800 border border-rose-200"
                                        : "bg-blue-100 text-blue-800 border border-blue-200"
                                        }`}>
                                        {lopPolicy === "REDUCE_SALARY" ? "Deduct Salary" : "Negative Debt"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("lop")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View LOP rule details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.lop ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.lop && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">⚖️ LOP Mechanics:</span>
                                        <span>Under CKPS Debt Accrual, employees receive full pay even during leave shortfalls; the debt is tracked and recovered from future comp-off or leave credits. Commercial clients deduct unapproved absences directly from that month's salary.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 4.3: Net Salary Rounding Rule */}
                            {(!policySearch || ["round", "net", "paisa", "rupee", "payout", "disbursement"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.netRounding ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Net Salary Rounding Rule</span>
                                      <StatutoryInfoTooltip text="Controls whether final monthly Net In-Hand Salary on payslips and bank NEFT files is rounded to the nearest whole rupee (₹1) or kept at exact paisa (0.01)." />
                                    </div>
                                  </td>
                                  <td className={`${cellPad} space-y-1`}>
                                    <select
                                      value={netPayRoundingMode}
                                      onChange={(e) => setNetPayRoundingMode(e.target.value)}
                                      className="w-full max-w-sm px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-semibold focus:ring-2 focus:ring-blue-500/20"
                                    >
                                      <option value="EXACT_PAISA">Exact Paisa — 2 Decimal Places (0.01)</option>
                                      <option value="NEAREST_RUPEE">Nearest Whole Rupee — Half-Up (₹1)</option>
                                    </select>
                                    <span className="text-[10px] text-slate-500 block">
                                      {netPayRoundingMode === "NEAREST_RUPEE"
                                        ? "Rounds final net take-home pay to whole rupees (eliminates fractional paisa in bank NEFT uploads)."
                                        : "Retains exact two-decimal paisa precision on payslips and ledger records."}
                                    </span>
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${netPayRoundingMode === "NEAREST_RUPEE"
                                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                        : "bg-slate-100 text-slate-800 border border-slate-200"
                                        }`}>
                                        {netPayRoundingMode === "NEAREST_RUPEE" ? "Whole ₹1" : "Exact 0.01"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("netRounding")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View net pay rounding details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.netRounding ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.netRounding && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2.5 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">🏦 Bank NEFT Compatibility:</span>
                                        <span>Corporate banking portals often prefer whole-rupee disbursement amounts when mid-month proration or ESI percentages produce fractional paisa.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* ──────────────── SECTION 5: 📄 PAYSLIP DISPLAY & PRESENTATION RULES ──────────────── */}
                    {(activeSection === "payslip" || activeSection === "all" || (policySearch && ["payslip", "display", "uan", "esi", "employer", "payment", "bank", "disclosure", "presentation"].some((k) => policySearch.toLowerCase().includes(k)))) && (
                      <>
                        {(activeSection === "all" || policySearch) && (
                          <tr
                            id="section-payslip"
                            onClick={() => toggleSection("payslip")}
                            className="bg-slate-50/90 hover:bg-slate-100/90 cursor-pointer transition-colors border-y border-slate-200 font-bold"
                          >
                            <td colSpan={3} className="py-2.5 px-3.5 text-slate-800 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span>📄</span>
                                  <span className="uppercase tracking-wider">5. Payslip Display & Presentation Rules</span>
                                </span>
                                <span className="text-slate-400 text-xs">{collapsedSections.payslip && !policySearch ? "▼" : "▲"}</span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {(activeSection !== "all" || !collapsedSections.payslip || policySearch) && (
                          <>
                            {/* Row 5.1: Employee UAN Visibility */}
                            {(!policySearch || ["uan", "pf", "payslip"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.uan ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Universal Account Number (UAN)</span>
                                      <StatutoryInfoTooltip text="Statutory 12-digit EPF credential printed in employee details header on payslips." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <PolicyToggleSwitch
                                      id="toggle-uan-payslip"
                                      checked={showUanInPayslip}
                                      onChange={setShowUanInPayslip}
                                      label="Show Employee UAN on Payslips"
                                      description="Displays a dedicated UAN field in the payslip employee details section"
                                    />
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${showUanInPayslip ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
                                        }`}>
                                        {showUanInPayslip ? "UAN Visible" : "UAN Hidden"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("uan")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View UAN display notes"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.uan ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.uan && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">📜 EPFO Compliance:</span>
                                        <span>Employees with active PF registrations require their 12-digit UAN on PDF payslips to satisfy EPFO audit standards and employee claim verifications.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 5.2: Employer PF Disclosure Note */}
                            {(!policySearch || ["employer", "pf", "contribution", "payslip"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.pfNote ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Employer PF Contribution Note</span>
                                      <StatutoryInfoTooltip text="Informational footnote disclosing employer provident fund reserve." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <PolicyToggleSwitch
                                      id="toggle-employer-pf-payslip"
                                      checked={showEmployerContrib}
                                      onChange={setShowEmployerContrib}
                                      label="Show Employer PF Note on Payslips"
                                      description={`Discloses ${pfRule === "UNCAPPED_12_PERCENT" ? "12% uncapped" : pfRule === "CUSTOM_PERCENT" ? `${pfCustomPct}% custom` : `₹${simCalc.cappedPfAmount.toLocaleString("en-IN")}/mo (on ₹${simCalc.effectiveCeiling.toLocaleString("en-IN")} ceiling)`} employer PF reserved during CTC structuring`}
                                    />
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${showEmployerContrib ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
                                        }`}>
                                        {showEmployerContrib ? "Note Printed" : "Note Hidden"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("pfNote")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View employer PF note details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.pfNote ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.pfNote && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">ℹ️ Transparency Footnote:</span>
                                        <span>Clarifies to the employee that ₹{simCalc.cappedPfAmount.toLocaleString("en-IN")}/mo (or {pfRule === "CUSTOM_PERCENT" ? `${pfCustomPct}%` : "12%"}) is deposited into their EPFO account on their behalf as company cost, rather than deducted from net earnings.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 5.3: Employer ESI Disclosure Note */}
                            {(!policySearch || ["employer", "esi", "insurance", "payslip"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.esiNote ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Employer ESI Contribution Note</span>
                                      <StatutoryInfoTooltip text={`Discloses ${esiCalculationRule === "CUSTOM_RULE" ? esiEmployerPct : 3.25}% employer medical insurance share on covered payslips.`} />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <PolicyToggleSwitch
                                      id="toggle-employer-esi-payslip"
                                      checked={showEmployerEsi}
                                      onChange={setShowEmployerEsi}
                                      label="Show Employer ESI Note on Payslips"
                                      description={`Discloses employer ${esiCalculationRule === "CUSTOM_RULE" ? esiEmployerPct : 3.25}% ESI contribution (ceiling ≤ ₹${simCalc.effectiveEsiCeiling.toLocaleString("en-IN")}/mo) when employee is covered`}
                                    />
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${showEmployerEsi ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
                                        }`}>
                                        {showEmployerEsi ? "Note Printed" : "Note Hidden"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("esiNote")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View employer ESI note details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.esiNote ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.esiNote && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">🏥 ESI Disclosure:</span>
                                        <span>Prints a summary of the employer's {esiCalculationRule === "CUSTOM_RULE" ? esiEmployerPct : 3.25}% social health insurance premium payment at the bottom of the payslip (independently of the Employer PF note toggle).</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}

                            {/* Row 5.4: Mode of Payment & Masked Bank Details */}
                            {(!policySearch || ["payment", "bank", "account", "payslip", "mode"].some((k) => policySearch.toLowerCase().includes(k))) && (
                              <>
                                <tr className={`hover:bg-slate-50/60 transition-colors ${expandedRows.bankMask ? "border-b border-slate-200" : rowGutter}`}>
                                  <td className={cellPad}>
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-[10px] shrink-0 font-bold">›</span>
                                      <span className="font-bold text-slate-900 text-xs">Disbursement Mode & Masked Bank</span>
                                      <StatutoryInfoTooltip text="Payment channel header and masked employee bank account number." />
                                    </div>
                                  </td>
                                  <td className={cellPad}>
                                    <PolicyToggleSwitch
                                      id="toggle-payment-mode-payslip"
                                      checked={showPaymentMode}
                                      onChange={setShowPaymentMode}
                                      label="Show Mode of Payment & Masked Bank"
                                      description="Prints 'Bank Transfer (A/C: ••••4589)' or chosen payment mode on payslip header"
                                    />
                                  </td>
                                  <td className={`${cellPad} text-right`}>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${showPaymentMode ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
                                        }`}>
                                        {showPaymentMode ? "Bank Info ON" : "Bank Info OFF"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleRowExpanded("bankMask")}
                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                        title="View bank mask details"
                                      >
                                        <span className={`text-[10px] transform transition-transform ${expandedRows.bankMask ? "rotate-180" : ""}`}>▼</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {expandedRows.bankMask && (
                                  <tr className={`bg-slate-50/70 ${rowGutter}`}>
                                    <td colSpan={3} className="px-5 py-2 text-[11px] text-slate-600">
                                      <div className="flex items-start gap-2">
                                        <span className="text-slate-800 font-bold shrink-0">🔒 Banking Privacy:</span>
                                        <span>Security masking protects employee privacy by displaying only the last 4 digits of their account number alongside the payment mode.</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}


                          </>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Section 6: Configurable Custom Components Catalog ── */}
            {(activeSection === "components" || activeSection === "all" || (policySearch && ["custom", "component", "allowance", "fuel", "deduction"].some((k) => policySearch.toLowerCase().includes(k)))) && (
              <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                {activeSection === "all" && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <span>🧩</span>
                      <span>6. Custom Salary Components Catalog</span>
                      <Badge tone="slate">{components.length}</Badge>
                    </h4>
                    <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                      ➕ Add Component
                    </Button>
                  </div>
                )}
                {loadingComponents ? (
                  <div className="py-8 text-center text-xs text-slate-500">Loading custom components…</div>
                ) : components.length === 0 ? (
                  <EmptyState
                    emoji="🧩"
                    message="No custom allowances or deductions defined for this client yet."
                    description="Use '+ Add Component' above to add Fuel Allowance, Internet Subsidy, or custom recovery items."
                  />
                ) : filteredComponents.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No components found matching &quot;{policySearch || compSearch}&quot;.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200/90 shadow-2xs bg-white">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">
                        <tr>
                          <th className="py-2 px-3">Component</th>
                          <th className="py-2 px-3">Code / Abbr</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Calculation</th>
                          <th className="py-2 px-3">Nature / Frequency</th>
                          <th className="py-2 px-3">Default Amount</th>
                          <th className="py-2 px-3">Prorate on LOP</th>
                          <th className="py-2 px-3">Taxable</th>
                          <th className="py-2 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {filteredComponents.map((comp) => (
                          <tr key={comp.id} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/40 transition-colors">
                            <td className="px-3 py-1.5 font-bold text-slate-900 text-xs">{comp.name}</td>
                            <td className="px-3 py-1.5 text-[11px] text-slate-600 font-mono">
                              <span className="font-bold text-slate-800">{comp.code}</span> <span className="text-slate-400 font-normal">({comp.abbr})</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${comp.component_type === "EARNING"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}>
                                {comp.component_type === "EARNING" ? "➕ Earning" : "➖ Deduction"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-xs">
                              {comp.calculation_type === "PERCENT_BASIC" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  📐 % of Basic
                                </span>
                              ) : comp.calculation_type === "PERCENT_GROSS" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                  📊 % of Gross
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                  💵 Flat Monthly ₹
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-xs">
                              {comp.is_monthly_variable ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  📊 Changes Monthly
                                </span>
                              ) : comp.payout_frequency === "ANNUAL" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs" title={`Disbursed in Month ${comp.payout_month || 3}`}>
                                  🎁 Annual ({MONTHS[(comp.payout_month || 3) - 1]?.slice(0, 3) || `M${comp.payout_month || 3}`})
                                </span>
                              ) : comp.payout_frequency === "QUARTERLY" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-300">
                                  📅 Quarterly
                                </span>
                              ) : comp.payout_frequency === "ON_SEPARATION" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-800 border border-rose-300">
                                  🚪 On Separation
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  🔒 Monthly Fixed
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-xs tabular-nums">
                              {comp.calculation_type === "PERCENT_BASIC" ? (
                                <div className="font-bold text-blue-800 flex items-center gap-1">
                                  <span className="font-mono text-xs">{Number(comp.default_value || 0)}%</span>
                                  <span className="text-[10px] text-slate-400 font-normal">of Basic</span>
                                </div>
                              ) : comp.calculation_type === "PERCENT_GROSS" ? (
                                <div className="font-bold text-purple-800 flex items-center gap-1">
                                  <span className="font-mono text-xs">{Number(comp.default_value || 0)}%</span>
                                  <span className="text-[10px] text-slate-400 font-normal">of Gross</span>
                                </div>
                              ) : (
                                <span className="font-bold text-slate-900 font-mono text-xs">
                                  ₹{Number(comp.default_value || 0).toLocaleString()}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[11px]">
                              {comp.depends_on_payment_days ? (
                                <span className="text-emerald-700 font-bold">✓ Yes</span>
                              ) : (
                                <span className="text-slate-400">Fixed</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[11px] font-medium">
                              {comp.is_taxable ? "Yes" : <span className="text-slate-400">Exempt</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleOpenDeleteComp(comp)}
                                className="text-[11px] text-rose-600 hover:text-rose-800 font-bold px-2 py-0.5 rounded hover:bg-rose-50 transition-colors cursor-pointer border border-rose-200 inline-flex items-center gap-1"
                              >
                                <span>🗑️</span>
                                <span>Remove</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}


          </div>
        </div>

        {/* ════ Interactive Live CTC Breakdown Simulator Modal ════ */}
        {showSimulatorModal && (
          <Modal
            title="📊 Live Salary Structure & Take-Home Simulator"
            onClose={() => setShowSimulatorModal(false)}
            size="l"
          >
            <div className="p-4 sm:p-5 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 rounded-xl border border-blue-200/90 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-blue-200/60">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📊</span>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      Live Breakdown Simulator
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded-full border border-amber-300">
                        ⚡ Real-Time
                      </span>
                    </h4>
                    <p className="text-[10px] text-slate-500">Instant take-home calculation preview</p>
                  </div>
                </div>

                {/* Illuminated Take-Home Ratio Tag */}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs shrink-0">
                  <span>✨</span>
                  <span>{simCalc.takeHomeRatio}%</span>
                  <span className="text-[10px] text-emerald-700 font-normal">({formatCurrency(simCalc.netInHand)})</span>
                </span>
              </div>

              {/* Quick Sample CTC Pills */}
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold text-slate-500">Sample:</span>
                <div className="flex flex-wrap items-center gap-1">
                  {[30000, 50000, 75000, 100000, 150000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setSampleCtc(amt)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-all font-mono font-bold cursor-pointer ${sampleCtc === amt
                        ? "bg-[#001F5B] text-white shadow-2xs"
                        : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                        }`}
                    >
                      ₹{(amt / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </div>

              {/* Slider & Custom CTC Input */}
              <div className="space-y-2 bg-white/90 p-3 rounded-lg border border-blue-200/70 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-700 font-bold">Monthly CTC:</span>
                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      <span className="absolute left-2 top-1 text-xs text-slate-400 font-bold">₹</span>
                      <input
                        type="number"
                        min="15000"
                        max="500000"
                        step="2500"
                        value={sampleCtc}
                        onChange={(e) => setSampleCtc(Number(e.target.value))}
                        className="w-24 pl-5 pr-1.5 py-0.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded text-slate-900"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">(= ₹{((sampleCtc * 12) / 100000).toFixed(1)} LPA)</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="15000"
                  max="300000"
                  step="5000"
                  value={sampleCtc}
                  onChange={(e) => setSampleCtc(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-blue-700"
                />
              </div>

              {/* Stacked Waterfall Distribution Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-semibold text-slate-600">
                  <span>Component Distribution</span>
                  <span className="font-mono text-slate-500">100% of CTC</span>
                </div>
                <div className="w-full h-3.5 rounded-full overflow-hidden flex bg-slate-200 border border-slate-300 shadow-inner">
                  {Number(simCalc.basicShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.basicShare}%` }}
                      className="bg-blue-600 hover:opacity-90 transition-all"
                      title={`Basic: ₹${simCalc.basic.toLocaleString()} (${simCalc.basicShare}%)`}
                    />
                  )}
                  {Number(simCalc.hraShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.hraShare}%` }}
                      className="bg-purple-600 hover:opacity-90 transition-all"
                      title={`HRA: ₹${simCalc.hra.toLocaleString()} (${simCalc.hraShare}%)`}
                    />
                  )}
                  {Number(simCalc.customInsideShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.customInsideShare}%` }}
                      className="bg-teal-500 hover:opacity-90 transition-all"
                      title={`Custom Allowances (Inside Gross): ₹${simCalc.insideGrossCustomEarnings.toLocaleString()} (${simCalc.customInsideShare}%)`}
                    />
                  )}
                  {Number(simCalc.specialShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.specialShare}%` }}
                      className="bg-amber-500 hover:opacity-90 transition-all"
                      title={`Special Allowance (Remainder): ₹${simCalc.specialAllowance.toLocaleString()} (${simCalc.specialShare}%)`}
                    />
                  )}
                  {Number(simCalc.customCarvedShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.customCarvedShare}%` }}
                      className="bg-cyan-600 hover:opacity-90 transition-all"
                      title={`Carved Monthly Allowances: ₹${simCalc.carvedCustomEarningsMonthly.toLocaleString()} (${simCalc.customCarvedShare}%)`}
                    />
                  )}
                  {Number(simCalc.annualRetainedShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.annualRetainedShare}%` }}
                      className="bg-indigo-500 hover:opacity-90 transition-all"
                      title={`Annual / Deferred Bonus Reserve: ₹${Math.round(simCalc.carvedAnnualRetainedMonthly).toLocaleString()}/mo (${simCalc.annualRetainedShare}%)`}
                    />
                  )}
                  {Number(simCalc.pfShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.pfShare}%` }}
                      className="bg-slate-500 hover:opacity-90 transition-all"
                      title={`Employer PF: ₹${simCalc.employerPf.toLocaleString()} (${simCalc.pfShare}%)`}
                    />
                  )}
                  {employerEsiInCtc && Number(simCalc.esiShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.esiShare}%` }}
                      className="bg-emerald-600 hover:opacity-90 transition-all"
                      title={`Employer ESI: ₹${simCalc.employerEsi.toLocaleString()} (${simCalc.esiShare}%)`}
                    />
                  )}
                  {gratuityInCtc && Number(simCalc.gratuityShare) > 0 && (
                    <div
                      style={{ width: `${simCalc.gratuityShare}%` }}
                      className="bg-rose-500 hover:opacity-90 transition-all"
                      title={`Employer Gratuity Reserve: ₹${simCalc.gratuityReserve.toLocaleString()} (${simCalc.gratuityShare}%)`}
                    />
                  )}
                </div>

                {/* Mini Legend */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700 pt-0.5">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                    <span>Basic ({simCalc.basicShare}%)</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-600 inline-block" />
                    <span>HRA ({simCalc.hraShare}%)</span>
                  </span>
                  {Number(simCalc.customInsideShare) > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />
                      <span>In-Gross ({simCalc.customInsideShare}%)</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    <span>Special Allow ({simCalc.specialShare}%)</span>
                  </span>
                  {Number(simCalc.customCarvedShare) > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-cyan-600 inline-block" />
                      <span>Carved Mo ({simCalc.customCarvedShare}%)</span>
                    </span>
                  )}
                  {Number(simCalc.annualRetainedShare) > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                      <span>Annual Bonus ({simCalc.annualRetainedShare}%)</span>
                    </span>
                  )}
                  {employerPfInCtc && Number(simCalc.employerPf) > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
                      <span>Emplr PF ({simCalc.pfShare}%)</span>
                    </span>
                  )}
                  {gratuityInCtc && Number(simCalc.gratuityReserve) > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                      <span>Gratuity ({simCalc.gratuityShare}%)</span>
                    </span>
                  )}
                </div>

                {/* Option 1: Live Policy Rule Carve-Out Indicators */}
                <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-blue-200/50">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Structuring Mode:</span>
                  <span className={`px-2 py-0.5 text-[10.5px] font-bold rounded-md border ${carveOutFbp ? "bg-indigo-50 text-indigo-800 border-indigo-200" : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}>
                    FBP: {carveOutFbp ? "✂️ Carved Out Upfront" : "📥 Inside Gross"}
                  </span>
                  <span className={`px-2 py-0.5 text-[10.5px] font-bold rounded-md border ${simCalc.customCarveout > 0 ? "bg-teal-50 text-teal-800 border-teal-200" : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}>
                    Custom Allowances: {simCalc.customCarveout > 0 ? `✂️ Carved Out Upfront (₹${Math.round(simCalc.customCarveout).toLocaleString()}/mo)` : "📥 Inside Gross"}
                  </span>
                  {gratuityInCtc && (
                    <span className="px-2 py-0.5 text-[10.5px] font-bold rounded-md border bg-rose-50 text-rose-800 border-rose-200">
                      Gratuity ({Number(gratuityPct || 4.81).toFixed(2)}%): ✂️ ₹{simCalc.gratuityReserve.toLocaleString()}/mo
                    </span>
                  )}
                </div>
              </div>

              {/* Compact Breakdown Cards */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[9px] text-slate-500 block uppercase font-bold">Basic + DA</span>
                  <span className="text-xs font-bold text-blue-900 font-mono">₹{simCalc.basic.toLocaleString()}</span>
                  <span className="text-[9px] text-slate-400 block">{simCalc.basicShare}% of CTC</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[9px] text-slate-500 block uppercase font-bold">HRA</span>
                  <span className="text-xs font-bold text-purple-900 font-mono">₹{simCalc.hra.toLocaleString()}</span>
                  <span className="text-[9px] text-slate-400 block">{simCalc.hraShare}% of CTC</span>
                </div>
                <div className="bg-amber-50/70 p-2.5 rounded-lg border border-amber-300">
                  <span className="text-[9px] text-amber-900 block uppercase font-bold">Special Allowance</span>
                  <span className="text-xs font-bold text-amber-900 font-mono">₹{simCalc.specialAllowance.toLocaleString()}</span>
                  <span className="text-[9px] text-amber-700 block">Balancing Remainder</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[9px] text-slate-500 block uppercase font-bold">EPF & Statutory Deductions</span>
                  <span className="text-xs font-bold text-slate-800 font-mono">
                    EPF: ₹{simCalc.epf.toLocaleString()} {simCalc.ptDeduction > 0 && `| PT: ₹${simCalc.ptDeduction}`}
                  </span>
                  <span className="text-[9px] text-slate-400 block">
                    {pfRule === "NOT_OPTED" ? "0 PF" : "Statutory EPF"} {simCalc.ptDeduction > 0 ? `+ ${ptState || "State"} PT` : ""}
                  </span>
                </div>
                {simCalc.carvedAnnualRetainedMonthly > 0 && (
                  <div className="bg-indigo-50/80 p-2.5 rounded-lg border border-indigo-200 col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[9px] text-indigo-900 block uppercase font-bold flex items-center gap-1">
                          <span>🎁</span> Annual / Deferred Bonus Reserve
                        </span>
                        <span className="text-xs font-bold text-indigo-950 font-mono">
                          ₹{Math.round(simCalc.carvedAnnualRetainedMonthly).toLocaleString()}/mo{" "}
                          <span className="text-[10px] text-indigo-700 font-normal">
                            (₹{Math.round(simCalc.carvedAnnualRetainedAnnual).toLocaleString()}/yr)
                          </span>
                        </span>
                      </div>
                      <span className="text-[9.5px] text-indigo-700 font-semibold bg-indigo-100/80 px-2 py-0.5 rounded border border-indigo-200">
                        Deferred Annual Payout
                      </span>
                    </div>
                  </div>
                )}
                {gratuityInCtc && (
                  <div className="bg-rose-50/70 p-2.5 rounded-lg border border-rose-200 col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[9px] text-rose-900 block uppercase font-bold">Gratuity Reserve ({Number(gratuityPct || 4.81).toFixed(2)}% of Basic)</span>
                        <span className="text-xs font-bold text-rose-800 font-mono">₹{simCalc.gratuityReserve.toLocaleString()}/mo</span>
                      </div>
                      <span className="text-[9.5px] text-rose-700 font-semibold bg-rose-100/80 px-2 py-0.5 rounded">
                        Carved Out of CTC
                      </span>
                    </div>
                  </div>
                )}
                <div className="bg-emerald-50/80 p-2.5 rounded-lg border border-emerald-300 col-span-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] text-emerald-900 block uppercase font-bold">Est. Monthly Take-Home ({netPayRoundingMode === "NEAREST_RUPEE" ? "Whole ₹1" : "Exact 0.01"})</span>
                      <span className="text-sm font-bold text-emerald-800 font-mono">₹{simCalc.netInHand.toLocaleString()}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100/80 px-2 py-0.5 rounded block">
                        {simCalc.takeHomeRatio}% of CTC
                      </span>
                      <span className="text-[9px] text-slate-500 mt-0.5 block">
                        Gross ₹{simCalc.earnedGross.toLocaleString()} {simCalc.ptDeduction > 0 ? `- ₹${simCalc.ptDeduction} PT` : ""} - ₹{simCalc.epf.toLocaleString()} EPF
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowSimulatorModal(false)}
                  className="text-xs cursor-pointer"
                >
                  Close Simulator
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Sticky Action Footer Bar */}
        <div className="sticky bottom-0 z-20 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 p-4 bg-white/95 backdrop-blur-md border-t border-slate-200/90 rounded-b-xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs animate-pulse">
                <span>⚠️</span> Unsaved policy changes detected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                <span className="text-emerald-600 font-bold">✓</span> All structuring rules are in sync with database
              </span>
            )}
            {policySavedMsg && (
              <span className="text-xs font-bold text-emerald-700 animate-fade-in bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                {policySavedMsg}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Breakdown Simulator Trigger Card (Relocated to Footer) */}
            <button
              type="button"
              onClick={() => setShowSimulatorModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 hover:border-emerald-400 shadow-2xs hover:shadow-xs transition-all cursor-pointer text-xs font-semibold group"
              title="Open interactive real-time salary structure & take-home simulator (Shortcut: S)"
            >
              <span className="text-sm group-hover:scale-110 transition-transform">📊</span>
              <span>Live Breakdown Simulator</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-950 border border-emerald-300/80">
                {simCalc.takeHomeRatio}% In-Hand
              </span>
            </button>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={openReapplyModal}
              disabled={reapplying || isDirty || savingPolicy}
              title={isDirty ? "Save policy changes first before re-applying" : "Re-apply this policy to active employees with contracted CTC"}
              className="text-xs cursor-pointer"
            >
              {reapplying ? "Re-applying Policy…" : "🔄 Re-apply Policy to Active Employees"}
            </Button>

            <Button
              size="sm"
              onClick={savePolicy}
              disabled={savingPolicy || reapplying}
              className={`shadow-xs px-4 py-2 font-bold cursor-pointer transition-all ${isDirty ? "bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-500/30 shadow-md" : ""
                }`}
            >
              {savingPolicy ? "Saving Policy…" : "💾 Save Policy Changes"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Dialog: Re-apply Salary Policy with Effective Date Picker ── */}
      <SalaryPolicyDialog
        isOpen={showReapplyModal}
        title="Re-apply Salary Policy to Active Employees"
        variant="primary"
        confirmText={reapplying ? "Re-applying Policy…" : "Re-apply Policy"}
        cancelText="Cancel"
        loading={reapplying}
        onConfirm={handleConfirmReapply}
        onCancel={() => {
          if (!reapplying) setShowReapplyModal(false);
        }}
      >
        <div className="space-y-3 pt-1">
          <p className="text-xs text-slate-600 leading-relaxed">
            This will recalculate and generate updated salary structure versions for all active employees of{" "}
            <strong className="text-slate-800">{client?.name || "this client"}</strong> using current policy rules.
            Existing customized components and statutory opt-ins (PF/ESI/UAN) are preserved.
          </p>

          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 space-y-2">
            <label className="block text-xs font-bold text-blue-950">
              📅 Effective From Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={reapplyEffectiveDate}
              onChange={(e) => setReapplyEffectiveDate(e.target.value)}
              disabled={reapplying}
              className="w-full px-3 py-2 text-sm bg-white border border-blue-300 rounded-md shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-slate-800"
            />
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Quick Select:</span>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, "0");
                  setReapplyEffectiveDate(`${y}-${m}-01`);
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 cursor-pointer text-[11px] transition-colors"
              >
                1st of This Month
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                  const y = nextMonth.getFullYear();
                  const m = String(nextMonth.getMonth() + 1).padStart(2, "0");
                  setReapplyEffectiveDate(`${y}-${m}-01`);
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 cursor-pointer text-[11px] transition-colors"
              >
                1st of Next Month
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, "0");
                  const d = String(now.getDate()).padStart(2, "0");
                  setReapplyEffectiveDate(`${y}-${m}-${d}`);
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 cursor-pointer text-[11px] transition-colors"
              >
                Today
              </button>
            </div>
          </div>

          {isDirty && (
            <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5 flex items-start gap-2">
              <span className="text-sm shrink-0">⚠️</span>
              <span>
                You have unsaved policy edits above. Please close this dialog and click <strong>Save Policy Changes</strong> first so your updates take effect during recalculation.
              </span>
            </div>
          )}
        </div>
      </SalaryPolicyDialog>

      {/* ── Dialog: Delete Salary Component Confirmation ── */}
      <SalaryPolicyDialog
        isOpen={Boolean(compToDelete)}
        title="Delete Salary Component"
        message={`Are you sure you want to remove "${compToDelete?.name || ''}" (${compToDelete?.code || ''}) from this client's policy catalog?`}
        variant="danger"
        confirmText={deletingComp ? "Deleting…" : "Delete Component"}
        cancelText="Cancel"
        loading={deletingComp}
        onConfirm={handleConfirmDeleteComp}
        onCancel={() => {
          if (!deletingComp) setCompToDelete(null);
        }}
      />

      {/* ── Modal: Add Component ────────────────────────────────────── */}
      {isAddModalOpen && (
        <Modal title="➕ Add Custom Salary Component" onClose={() => setIsAddModalOpen(false)} size="xl">
          <form onSubmit={handleCreateComponent} className="space-y-4 p-1">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-slate-700 block mb-1">Component Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fuel Allowance"
                  value={newComp.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const code = name.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
                    const abbr = code.slice(0, 6);
                    setNewComp((c) => ({ ...c, name, code, abbr }));
                  }}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Unique Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FUEL_ALLOW"
                  value={newComp.code}
                  onChange={(e) => setNewComp((c) => ({ ...c, code: e.target.value.toUpperCase() }))}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Formula Abbreviation *</label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  placeholder="e.g. FUEL"
                  value={newComp.abbr}
                  onChange={(e) => setNewComp((c) => ({ ...c, abbr: e.target.value.toUpperCase() }))}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="sm:col-span-1">
                <label className="text-xs font-bold text-slate-700 block mb-1">Component Type</label>
                <select
                  value={newComp.component_type}
                  onChange={(e) => setNewComp((c) => ({ ...c, component_type: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium"
                >
                  <option value="EARNING">Earning (Addition)</option>
                  <option value="DEDUCTION">Deduction (Recovery)</option>
                </select>
              </div>

              <div className="sm:col-span-1">
                <label className="text-xs font-bold text-slate-700 block mb-1">Calculation Rule *</label>
                <select
                  value={newComp.calculation_type}
                  onChange={(e) => setNewComp((c) => ({ ...c, calculation_type: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium"
                >
                  <option value="FLAT">Flat Monthly Amount (₹)</option>
                  <option value="PERCENT_BASIC">% of Basic Salary</option>
                  <option value="PERCENT_GROSS">% of Gross CTC Pool</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {newComp.calculation_type === "PERCENT_BASIC"
                    ? "Percentage of Basic Salary (%) *"
                    : newComp.calculation_type === "PERCENT_GROSS"
                      ? "Percentage of Gross CTC Pool (%) *"
                      : "Default Monthly Amount (₹) *"}
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-xs text-slate-400 font-bold">
                    {newComp.calculation_type === "FLAT" ? "₹" : "%"}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={newComp.calculation_type === "FLAT" ? undefined : 100}
                    step="any"
                    placeholder={
                      newComp.calculation_type === "PERCENT_BASIC"
                        ? "e.g. 10.0"
                        : newComp.calculation_type === "PERCENT_GROSS"
                          ? "e.g. 5.0"
                          : "e.g. 5000"
                    }
                    value={newComp.default_value}
                    onPaste={(e) => {
                      const text = e.clipboardData?.getData("text") || "";
                      const cleaned = text.replace(/[^0-9.]/g, "");
                      if (cleaned && cleaned !== text) {
                        e.preventDefault();
                        setNewComp((c) => ({ ...c, default_value: cleaned }));
                      }
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cleanVal = typeof val === "string" ? val.replace(/[^0-9.]/g, "") : val;
                      setNewComp((c) => ({ ...c, default_value: cleanVal }));
                    }}
                    className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold"
                  />
                </div>
              </div>

              {/* Slim Live Formula & Evaluated Amount Banner */}
              <div className="col-span-1 sm:col-span-4 px-3.5 py-2 rounded-lg border border-blue-200/90 bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-slate-50 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-blue-900 flex items-center gap-1.5">
                    <span>⚡ Live Formula:</span>
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-blue-100 text-blue-800 border border-blue-300">
                      {newComp.calculation_type === "PERCENT_BASIC"
                        ? "% OF BASIC"
                        : newComp.calculation_type === "PERCENT_GROSS"
                          ? "% OF GROSS"
                          : "FLAT MONTHLY"}
                    </span>
                  </span>
                  <span className="font-mono text-slate-700 text-xs">
                    {newComp.calculation_type === "PERCENT_BASIC" ? (
                      <span className="text-blue-900 font-semibold">
                        {Number(newComp.default_value || 0)}% × ₹{(simCalc?.basic || 25000).toLocaleString()} (Basic)
                      </span>
                    ) : newComp.calculation_type === "PERCENT_GROSS" ? (
                      <span className="text-purple-900 font-semibold">
                        {Number(newComp.default_value || 0)}% × ₹{(simCalc?.ctc || 50000).toLocaleString()} (Gross Pool)
                      </span>
                    ) : (
                      <span className="text-slate-800 font-semibold">Flat recurring credit across CTC tiers</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                    Evaluated (₹{(simCalc?.ctc || 50000).toLocaleString()} CTC Benchmark):
                  </span>
                  <span className="text-xs font-bold font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    ₹{(() => {
                      const rate = Number(newComp.default_value || 0);
                      if (newComp.calculation_type === "PERCENT_BASIC") {
                        const b = simCalc?.basic || 25000;
                        return Math.round(b * (rate / 100)).toLocaleString();
                      }
                      if (newComp.calculation_type === "PERCENT_GROSS") {
                        const g = simCalc?.ctc || 50000;
                        return Math.round(g * (rate / 100)).toLocaleString();
                      }
                      return rate.toLocaleString();
                    })()}/mo
                  </span>
                </div>
              </div>

              {/* Monthly Behavior & Disbursement Schedule */}
              <div className="col-span-1 sm:col-span-4 p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2.5">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1.5">
                    Monthly Input Type *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewComp((c) => ({ ...c, is_monthly_variable: false }))}
                      className={`p-2 rounded-lg border text-left cursor-pointer transition-all ${!newComp.is_monthly_variable
                        ? "bg-blue-50 border-blue-400 text-blue-900 shadow-xs ring-1 ring-blue-300"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>🔒 Fixed Baseline (Contracted)</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        Contracted in salary structure with scheduled payout
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewComp((c) => ({ ...c, is_monthly_variable: true, payout_frequency: "MONTHLY" }))}
                      className={`p-2 rounded-lg border text-left cursor-pointer transition-all ${newComp.is_monthly_variable
                        ? "bg-amber-50 border-amber-400 text-amber-900 shadow-xs ring-1 ring-amber-300"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>📊 Changes Every Month (Variable)</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        Varies monthly via Excel or workbench input
                      </div>
                    </button>
                  </div>
                </div>

                {/* If Fixed Baseline, show Disbursement Frequency Schedule */}
                {!newComp.is_monthly_variable && (
                  <div className="pt-2 border-t border-slate-200">
                    <label className="text-xs font-bold text-slate-800 block mb-1.5">
                      📅 Disbursement Schedule / Frequency
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {[
                        { id: "MONTHLY", label: "🔄 Monthly", desc: "Every month" },
                        { id: "ANNUAL", label: "🎁 Annual Lump-Sum", desc: "Once a year" },
                        { id: "QUARTERLY", label: "📅 Quarterly", desc: "Every 3 mos" },
                        { id: "ON_SEPARATION", label: "🚪 On Separation", desc: "Exit / F&F only" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setNewComp((c) => ({ ...c, payout_frequency: item.id }))}
                          className={`p-1.5 rounded-lg border text-left cursor-pointer transition-all ${(newComp.payout_frequency || "MONTHLY") === item.id
                            ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-bold ring-1 ring-indigo-300 shadow-2xs"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}
                        >
                          <div className="text-[11.5px] font-semibold">{item.label}</div>
                          <div className="text-[9.5px] text-slate-500">{item.desc}</div>
                        </button>
                      ))}
                    </div>

                    {/* Annual Payout Configuration */}
                    {newComp.payout_frequency === "ANNUAL" && (
                      <div className="mt-2.5 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                            <span>🎯 Target Payout Month:</span>
                            <select
                              value={newComp.payout_month || 3}
                              onChange={(e) => setNewComp((c) => ({ ...c, payout_month: Number(e.target.value) }))}
                              className="text-xs rounded-md border border-emerald-300 bg-white px-2 py-1 font-semibold text-slate-800 shadow-2xs focus:ring-1 focus:ring-emerald-500"
                            >
                              {MONTHS.map((mName, idx) => (
                                <option key={idx + 1} value={idx + 1}>
                                  {mName} (Month {idx + 1}{idx === 2 ? " - FY End" : idx === 9 ? " - Diwali/Festival" : ""})
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(newComp.prorate_for_mid_year_joiners)}
                              onChange={(e) => setNewComp((c) => ({ ...c, prorate_for_mid_year_joiners: e.target.checked }))}
                              className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="font-semibold text-emerald-950 text-[11px]">Prorate for mid-year joiners</span>
                          </label>
                        </div>
                        <div className="text-[10.5px] text-emerald-800 leading-tight">
                          💡 <strong>How it works:</strong> If carved out from CTC, ₹{Math.round((Number(newComp.default_value || 0) / 12)).toLocaleString()}/mo is reserved from the monthly CTC pool so regular monthly pay is constant across all 12 months. In Month {newComp.payout_month || 3} ({MONTHS[(newComp.payout_month || 3) - 1]}), the full ₹{Number(newComp.default_value || 0).toLocaleString()} lump sum is disbursed in cash!
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Statutory & Attendance Rules in 2x2 Grid with Tooltip Hints */}
            <div className="pt-2.5 border-t border-slate-200">
              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
                ⚙️ Statutory &amp; Attendance Rules
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer p-2 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50/80 transition-colors">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newComp.depends_on_payment_days}
                      onChange={(e) => setNewComp((c) => ({ ...c, depends_on_payment_days: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-slate-800">Prorate on Absence (LOP)</span>
                  </div>
                  <span className="text-slate-400 hover:text-slate-600 cursor-help text-[11px]" title="Reduces pay proportionally when attendance days fall short (uncheck for fixed bills/Wi-Fi)">ℹ️</span>
                </label>

                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer p-2 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50/80 transition-colors">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newComp.is_taxable}
                      onChange={(e) => setNewComp((c) => ({ ...c, is_taxable: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-slate-800">Subject to Income Tax TDS</span>
                  </div>
                  <span className="text-slate-400 hover:text-slate-600 cursor-help text-[11px]" title="Includes this allowance in monthly taxable gross under Section 192">ℹ️</span>
                </label>

                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer p-2 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50/80 transition-colors">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newComp.is_part_of_pf_wages}
                      onChange={(e) => setNewComp((c) => ({ ...c, is_part_of_pf_wages: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-slate-800">Include in 12% EPF Wage Pool</span>
                  </div>
                  <span className="text-slate-400 hover:text-slate-600 cursor-help text-[11px]" title="Adds to Basic pay when calculating statutory PF up to the ₹15,000 ceiling">ℹ️</span>
                </label>

                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer p-2 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50/80 transition-colors">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(newComp.carve_out_from_ctc ?? newComp.do_not_include_in_total)}
                      onChange={(e) => setNewComp((c) => ({ ...c, carve_out_from_ctc: e.target.checked, do_not_include_in_total: false }))}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className="font-semibold text-slate-800">Carve out from CTC Upfront</span>
                  </div>
                  <span className="text-slate-400 hover:text-slate-600 cursor-help text-[11px]" title="Subtracts this component from the monthly CTC pool upfront before calculating Basic, HRA, and Special Allowance.">ℹ️</span>
                </label>

                {Boolean(newComp.carve_out_from_ctc) && (
                  <div className="sm:col-span-2 p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-[11px] text-teal-900 leading-relaxed animate-in fade-in duration-100">
                    <div className="font-bold flex items-center gap-1.5 mb-0.5">
                      <span>✂️ Upfront CTC Carve-Out Math:</span>
                    </div>
                    {newComp.payout_frequency === "ANNUAL" ? (
                      <div>
                        An annual lump sum of <strong>₹{Number(newComp.default_value || 0).toLocaleString()}</strong> will be reserved at <strong>₹{Math.round(Number(newComp.default_value || 0) / 12).toLocaleString()}/mo</strong> from the monthly pool, then disbursed in full during Month {newComp.payout_month || 3}.
                      </div>
                    ) : newComp.payout_frequency === "QUARTERLY" ? (
                      <div>
                        A quarterly payout of <strong>₹{Number(newComp.default_value || 0).toLocaleString()}</strong> will be reserved at <strong>₹{Math.round(Number(newComp.default_value || 0) / 3).toLocaleString()}/mo</strong> from the monthly pool, then disbursed in Months 3, 6, 9 &amp; 12.
                      </div>
                    ) : (
                      <div>
                        <strong>₹{Number(newComp.default_value || 0).toLocaleString()}/mo</strong> will be deducted from the monthly pool before deriving Basic &amp; HRA (= <strong>₹{(Number(newComp.default_value || 0) * 12).toLocaleString()}/year</strong> deducted from Annual CTC), then paid every month in payslips with zero CTC variance!
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button type="button" variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addingComponent}>
                {addingComponent ? "Saving…" : "➕ Add Component"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function TabRow({ active, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pt-1 border-b border-slate-200">
      {CLIENT_WORKSPACE_TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold transition-all rounded-t-lg -mb-px ${isActive
              ? "bg-blue-50/70 text-blue-900 border-b-2 border-blue-700 shadow-2xs"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-b-2 border-transparent"
              }`}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function InfoBox({ label, value, emoji, tone = "slate" }) {
  const toneMap = {
    slate: "bg-slate-50/90 border-slate-200/90 text-slate-800",
    blue: "bg-blue-50/70 border-blue-200/90 text-blue-900",
    green: "bg-emerald-50/70 border-emerald-200/90 text-emerald-900",
    red: "bg-rose-50/70 border-rose-200/90 text-rose-900",
    amber: "bg-amber-50/70 border-amber-200/90 text-amber-900",
  };
  return (
    <div className={`rounded-xl p-3.5 border shadow-2xs transition-all hover:shadow-xs ${toneMap[tone] || toneMap.slate}`}>
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
        <span>{label}</span>
        {emoji && <span className="text-sm">{emoji}</span>}
      </div>
      <p className="text-xl font-bold mt-1.5 tabular-nums text-slate-800">{value}</p>
    </div>
  );
}

function InfoField({ label, value, required, emoji }) {
  return (
    <div className="min-w-0 p-2.5 rounded-lg bg-slate-50/60 border border-slate-200/70">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
        {emoji && <span>{emoji}</span>}
        <span>{label}</span>
        {required && <span className="text-rose-500">*</span>}
      </p>
      <p className="text-sm font-semibold mt-1 truncate text-slate-800">{value || "—"}</p>
    </div>
  );
}

function ClientDetailsTab({ client, batches, emailsSent, emailsFailed }) {
  const latestBatch = batches[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
        <StatTile label="Total Batches" value={batches.length} />
        <StatTile label="Latest Period" value={latestBatch ? `${String(latestBatch.month).padStart(2, "0")}/${latestBatch.year}` : "—"} />
        <StatTile label="Emails Delivered" value={emailsSent} />
        <StatTile label="Failed Deliveries" value={emailsFailed} />
      </div>

      <div
        className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs sm:text-sm font-medium bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-slate-50 border border-blue-200/80 text-blue-900 shadow-2xs"
      >
        <span className="text-base shrink-0">ℹ️</span>
        <span>
          <strong>Scoped Partition:</strong> All master records below — personnel rosters, salary blueprints, payroll batches, and email archives — are strictly partitioned to <strong className="text-blue-950">{client?.name}</strong>.
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-sm">
        <h2 className="text-xs font-extrabold text-slate-500 tracking-wider uppercase mb-5 flex items-center gap-2">
          <span>📋</span> CLIENT MASTER CREDENTIALS & STATUTORY DATA
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-y-5 gap-x-8">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">LEGAL ENTITY NAME *</div>
            <div className="text-[13.5px] font-bold text-slate-900 mt-1">
              {client.name ? client.name.toUpperCase() : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">PRIMARY CONTACT EMAIL</div>
            <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
              {client.email || "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">OFFICIAL PHONE NUMBER</div>
            <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
              {client.phone || "—"}
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
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">DEDICATED PAYROLL EMAIL</div>
            <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
              {client.payroll_email || client.email || "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">PAYSLIP PDF DESIGN</div>
            <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
              {client.pdf_design ? `Design ${client.pdf_design}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">HIGH-RES PAYSLIP LOGO</div>
            <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
              {client.logo ? "Uploaded ✓" : "Not uploaded"}
            </div>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">REGISTERED OFFICE ADDRESS</div>
            <div className="text-[13px] text-slate-700 mt-1 leading-relaxed">
              {client.address || "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   PART 2: EMPLOYEE MODALS & HELPERS (Consolidated from EmployeeWorkspace)
   ========================================================================== */

/* ── file drop zone (mirrors UploadPayrollModal) ─────────────────────── */
function EmployeeFileDropZone({ file, onChange }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.name.endsWith(".xlsx")) onChange(f);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="relative flex flex-col items-center justify-center gap-2 rounded-xl cursor-pointer transition-all"
      style={{
        minHeight: 96,
        background: dragging ? "var(--blue-bg)" : file ? "var(--green-bg-subtle)" : "var(--surface-2)",
        border: `2px dashed ${dragging ? "var(--blue-border)" : file ? "var(--green-border)" : "var(--border-4)"}`,
      }}
    >
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />

      {file ? (
        <>
          <FileSpreadsheet size={22} style={{ color: "var(--green-text-strong)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--green-text-strong)" }}>{file.name}</span>
          <span className="text-xs" style={{ color: "var(--green-text-strong)" }}>
            {(file.size / 1024).toFixed(1)} KB
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-full"
            style={{ background: "var(--red-bg)", color: "var(--red-text-strong)" }}
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <FileUp size={22} style={{ color: "var(--text-subtle)" }} />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Drop .xlsx here or <span style={{ color: "var(--blue-text)" }}>browse</span>
          </span>
        </>
      )}
    </div>
  );
}

/* ── validation error table (mirrors UploadPayrollModal) ─────────────── */
function EmployeeValidationErrors({ data }) {
  return (
    <div className="rounded-xl p-4"
      style={{ background: "var(--red-bg-subtle)", border: "1px solid var(--red-bg-strong)" }}>
      <p className="text-sm font-semibold" style={{ color: "var(--red-text-strong)" }}>
        Import rejected — {data?.total_errors} row{data?.total_errors !== 1 ? "s" : ""} with errors
      </p>
      <p className="text-xs mt-1 mb-4" style={{ color: "var(--red-text-strong)" }}>
        Fix all errors in Excel and re-upload. No employees were created or updated.
      </p>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Row", "Employee Code", "Error"].map((h) => (
              <th key={h} className="text-left pb-2 font-medium px-2"
                style={{ color: "var(--red-text-strong)", borderBottom: "1px solid var(--red-bg-strong)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data?.errors?.map((row) => (
            <tr key={`${row.row}-${row.employee_code}`}
              style={{ borderBottom: "1px solid var(--red-bg-subtle)" }}>
              <td className="px-2 py-2" style={{ color: "var(--red-text-strong)" }}>{row.row}</td>
              <td className="px-2 py-2" style={{ color: "var(--red-text-strong)" }}>{row.employee_code || "—"}</td>
              <td className="px-2 py-2" style={{ color: "var(--red-text-strong)" }}>{row.errors.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── bulk employee-master import modal ──────────────────────────────── */
export function ImportEmployeesModal({ clientId, client, onClose, onImported }) {
  const { mutateImportEmployees } = useAppMutations();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const clientParam = clientId ? `?client_id=${clientId}` : "";
      const response = await api.get(apiPath(`template/employee-template/${clientParam}`), {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const cleanName = (client?.name || "Client").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      link.download = `Employee_Master_Template_${cleanName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Template download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("client_id", clientId);
    fd.append("file", file);
    mutateImportEmployees.mutate(fd, {
      onSuccess: (data) => {
        setResult(data);
        onImported?.();
      },
    });
  };

  const error = mutateImportEmployees.error?.response;

  return (
    <Modal title="📥 Import Employee Master Roster" onClose={onClose} size="l">
      <form onSubmit={submit} className="space-y-4">
        {/* Top Header Toolbar with Client Context & Download Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm shadow-2xs">
              🏢
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900">{client?.name || "Client Directory"}</div>
              <div className="text-[11px] text-slate-500">Bulk onboard staff & auto-derive salary structures from CTC</div>
            </div>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            title="Download formatted Excel template customized with client components"
          >
            <Download size={13} strokeWidth={2.5} />
            <span>{downloading ? "Preparing…" : "Download Excel Template"}</span>
          </button>
        </div>

        {/* Modern Drag & Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              setFile(e.dataTransfer.files[0]);
            }
          }}
          className={`border-2 border-dashed rounded-xl p-5 transition-all duration-150 flex flex-col items-center justify-center text-center gap-2.5 ${dragOver
            ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20"
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
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                setFile(e.target.files[0]);
              }
            }}
          />

          {!file ? (
            <div
              className="flex flex-col items-center gap-2 cursor-pointer py-3"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                <Upload size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">
                  Drop Filled Excel Roster here, or <span className="text-emerald-700 underline font-extrabold">Browse Files</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 max-w-sm">
                  Upload Excel spreadsheet (.xlsx) with employee master directory & compensation details.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2 w-full">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                <FileSpreadsheet size={22} />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 flex items-center justify-center gap-2">
                  <span>{file.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Ready to validate and import into master roster.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={mutateImportEmployees.isPending}
                className="mt-1 px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Change File
              </button>
            </div>
          )}
        </div>

        {/* Info Banner */}
        <div className="rounded-xl px-4 py-2.5 text-xs leading-relaxed flex items-start gap-2.5 bg-blue-50 border border-blue-200 text-blue-900 shadow-2xs">
          <span className="text-sm shrink-0">ℹ️</span>
          <span>
            Rows are matched by <strong>Employee Code</strong> within this client — existing records update in-place, new codes are created. Salary structures (Basic, HRA, EPF, Monthly Gross) auto-derive from <strong>Annual CTC</strong>.
          </span>
        </div>

        {/* Categorized Template Field Reference Cards */}
        <div className="rounded-xl p-3.5 text-xs bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <span>📋</span> Supported Template Columns Reference
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              * denotes mandatory fields
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <div className="font-bold text-slate-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span>Core Identity & Role</span>
              </div>
              <div className="text-slate-600 space-y-0.5">
                <p>• <strong>Employee Code *</strong>, <strong>First Name *</strong>, Last Name</p>
                <p>• Email, PAN Number, Department, Position</p>
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <div className="font-bold text-slate-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Compensation & Dates</span>
              </div>
              <div className="text-slate-600 space-y-0.5">
                <p>• <strong>Annual CTC *</strong> (in ₹, e.g. 600000)</p>
                <p>• Effective From (YYYY-MM-DD), Hire Date (YYYY-MM-DD)</p>
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <div className="font-bold text-slate-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                <span>Statutory & Retirals</span>
              </div>
              <div className="text-slate-600 space-y-0.5">
                <p>• PF Opted (Yes/No), ESI Opted (Yes/No), ESI Number</p>
                <p>• NPS Allowance, FBP (Flexible Benefit), VPF</p>
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <div className="font-bold text-slate-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Client Custom Components</span>
              </div>
              <div className="text-slate-600 space-y-0.5">
                <p>• Fixed flat allowances/deductions configured for {client?.name || "this client"} are included in the downloaded template.</p>
              </div>
            </div>
          </div>
        </div>

        {error?.status === 400 && (
          <div className="rounded-xl px-4 py-3 text-sm bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error.data?.detail}</span>
          </div>
        )}

        {error?.status === 422 && <EmployeeValidationErrors data={error.data} />}

        {result && (
          <div className="rounded-xl px-4 py-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            <span>✓ {result.created} created, {result.updated} updated successfully.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={mutateImportEmployees.isPending}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || mutateImportEmployees.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs sm:text-sm font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <Sparkles size={14} />
            <span>{mutateImportEmployees.isPending ? "Importing Roster…" : "Upload & Process Roster"}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── single employee add/edit modal ─────────────────────────────────── */
const EMPLOYEE_FIELDS = [
  ["employee_code", "🆔 Employee Code", "text"],
  ["first_name", "👤 First Name", "text"],
  ["last_name", "👤 Last Name", "text"],
  ["email", "📧 Work Email", "email"],
  ["pan_number", "🧾 PAN Card Number", "text"],
  ["uan_number", "💼 UAN Number (12-digit EPF)", "text"],
  ["esi_number", "🛡️ ESI Number (10-digit IP)", "text"],
  ["department", "🏛️ Department", "text"],
  ["position", "💼 Position / Role", "text"],
  ["bank_account_number", "🏦 Bank Account Number", "text"],
  ["bank_ifsc_code", "🏛️ Bank IFSC Code", "text"],
  ["bank_name", "🏢 Bank Name", "text"],
  ["hire_date", "📅 Hire Date", "date"],
  ["ctc", "💰 Annual CTC (₹)", "number"],
];

function EmployeeFormTabBar({ activeTab, onChange, isEditMode }) {
  const tabs = [
    { key: "info", label: "👤 Employee Info" },
    { key: "salary", label: "💰 Salary Structure" },
  ];

  return (
    <div className="flex gap-3 mb-4 pb-2 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          disabled={isEditMode && tab.key === "salary"}
          className={`text-xs sm:text-sm font-semibold pb-1.5 px-2.5 transition-all rounded-t-md -mb-px disabled:opacity-50 disabled:cursor-not-allowed ${activeTab === tab.key
            ? "text-blue-700 border-b-2 border-blue-600 bg-blue-50/50"
            : "text-slate-500 hover:text-slate-800 border-b-2 border-transparent"
            }`}
          title={isEditMode && tab.key === "salary" ? "Salary structure is managed separately for existing employees" : ""}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function currentMonthLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

const PF_WAGE_CEILING = 15000;
const PF_FLAT_RESERVE = 1800;

function getPfReserve(basicDa, pfOpted, policy = {}, monthlyGross = 0) {
  if (!pfOpted) return 0;
  const pfRule = policy?.pf_calculation_rule || "CAPPED_1800";
  if (pfRule === "NOT_OPTED") return 0;
  const defaultCeiling = pfRule === "CAPPED_3000" ? 25000 : PF_WAGE_CEILING;
  const effectiveCeiling = Number(policy?.pf_wage_ceiling) > 0 ? Number(policy.pf_wage_ceiling) : defaultCeiling;
  if (pfRule === "UNCAPPED_12_PERCENT") {
    return Math.round(0.12 * basicDa * 100) / 100;
  }
  if (pfRule === "CUSTOM_PERCENT") {
    const rate = (Number(policy?.pf_custom_pct ?? 12) || 0) / 100;
    const baseMode = (policy?.pf_custom_base || "BASIC").toUpperCase();
    const isCapped = policy?.pf_custom_capped !== false;
    let baseVal = baseMode === "GROSS" && monthlyGross > 0 ? monthlyGross : basicDa;
    if (isCapped) baseVal = Math.min(baseVal, effectiveCeiling);
    return Math.round(baseVal * rate * 100) / 100;
  }
  const flatCap = Math.round(effectiveCeiling * 0.12 * 100) / 100;
  return basicDa >= effectiveCeiling ? flatCap : Math.round(0.12 * basicDa * 100) / 100;
}

function computeFromCTC(
  ctcAnnual,
  currentLTA = 0,
  npsAllowance = 0,
  fbp = 0,
  pfOpted = true,
  policy = {},
  customComponents = {},
  esiOpted = null,
  reapplyPolicy = false
) {
  const monthlyPool = Number(ctcAnnual || 0) / 12;
  const lta = Number(currentLTA || 0);
  const nps = Number(npsAllowance || 0);
  const fbpVal = Number(fbp || 0);

  const basicCalcType = policy.basic_calculation_type || "PERCENT_GROSS";
  const basicPct = Number(policy.basic_percentage ?? 50) / 100;
  const basicFlat = Number(policy.basic_flat_amount || 0);

  const hraCalcType = policy.hra_calculation_type || "PERCENT_BASIC";
  const hraPct = Number(policy.hra_percentage ?? 50) / 100;
  const hraFlat = Number(policy.hra_flat_amount || 0);

  const pfRule = policy.pf_calculation_rule || (pfOpted ? "CAPPED_1800" : "NOT_OPTED");
  const employerPfInCTC = policy.employer_pf_in_ctc !== false;
  const actualPfOpted = Boolean(pfOpted && pfRule !== "NOT_OPTED");
  const defaultCeiling = pfRule === "CAPPED_3000" ? 25000 : PF_WAGE_CEILING;
  const effectiveCeiling = Number(policy.pf_wage_ceiling) > 0 ? Number(policy.pf_wage_ceiling) : defaultCeiling;
  const pfCustomRate = (Number(policy.pf_custom_pct ?? 12) || 12) / 100;
  const pfCustomBase = (policy.pf_custom_base || "BASIC").toUpperCase();
  const pfCustomCapped = policy.pf_custom_capped !== false;
  const cappedPfFlat = Math.round(effectiveCeiling * (pfRule === "CUSTOM_PERCENT" ? pfCustomRate : 0.12) * 100) / 100;

  // Upfront Carve-Out Logic for FBP and Non-Cash Custom Components
  const carveOutFbp = policy.carve_out_fbp_in_ctc === true;
  const carveOutCustom = policy.carve_out_custom_in_ctc === true;
  const fbpCarveout = carveOutFbp ? fbpVal : 0;

  let customCarveout = 0;
  if (customComponents && typeof customComponents === "object") {
    Object.values(customComponents).forEach((comp) => {
      if ((comp?.type === "EARNING" || comp?.component_type === "EARNING") && !comp.is_monthly_variable && (comp.formula || "").toUpperCase() !== "VARIABLE") {
        if ((comp.calculation_type || comp.calc_type || "FLAT") === "FLAT") {
          const isCarved = carveOutCustom || comp.carve_out_from_ctc;
          if (isCarved) {
            const rawAmt = Number(comp.amount ?? comp.default_value ?? 0);
            const freq = String(comp.payout_frequency || "MONTHLY").trim().toUpperCase();
            if (freq === "ANNUAL" || freq === "ON_SEPARATION" || freq === "SEPARATION") {
              customCarveout += rawAmt / 12;
            } else if (freq === "QUARTERLY") {
              customCarveout += rawAmt / 3;
            } else {
              customCarveout += rawAmt;
            }
          }
        }
      }
    });
  }

  const grossPool = Math.max(0, monthlyPool - fbpCarveout - customCarveout);

  // Employer ESI setup
  const esiEnabled = policy.esi_enabled === true;
  const employerEsiInCTC = policy.employer_esi_in_ctc !== false;
  const esiRule = policy.esi_calculation_rule || "STATUTORY_21K";
  const defaultEsiCeiling = esiRule === "STATUTORY_25K" ? 25000 : 21000;
  const effectiveEsiCeiling = Number(policy.esi_wage_ceiling) > 0 ? Number(policy.esi_wage_ceiling) : defaultEsiCeiling;
  const esiEmployerRate = esiRule === "CUSTOM_RULE"
    ? (Number(policy.esi_employer_pct ?? 3.25) || 0) / 100
    : 0.0325;
  const esiBaseChoice = esiRule === "CUSTOM_RULE" ? (policy.esi_custom_base || "GROSS").toUpperCase() : "GROSS";

  let actualEsiOpted = false;
  if (esiOpted !== null && esiOpted !== undefined) {
    actualEsiOpted = Boolean(esiOpted);
  } else if (esiEnabled) {
    actualEsiOpted = esiRule === "UNCAPPED" ? true : grossPool <= effectiveEsiCeiling * 1.15;
  }

  // Gratuity Carve-Out setup
  const gratuityInCTC = policy.gratuity_in_ctc === true;
  const gratuityRateOnBasic = gratuityInCTC ? (Math.max(0, Number(policy.gratuity_pct ?? 4.81) || 0) / 100) : 0;
  const gratuityFactorOnGross = basicCalcType === "CUSTOM_FIXED" ? 0 : (gratuityRateOnBasic * basicPct);

  // Upfront Derivation: Deduct Employer Contributions from CTC to get Monthly Gross
  let monthlyGross = grossPool;
  let pfReserve = 0;
  let esiReserve = 0;
  let gratuityReserve = 0;

  if (
    actualPfOpted &&
    employerPfInCTC &&
    (pfRule === "CAPPED_1800" || pfRule === "CAPPED_3000") &&
    ((grossPool - cappedPfFlat) * basicPct) >= effectiveCeiling
  ) {
    pfReserve = cappedPfFlat;
    const tentativeAfterPf = grossPool - pfReserve;
    if (esiOpted === null || esiOpted === undefined) {
      actualEsiOpted = esiEnabled && (esiRule === "UNCAPPED" || tentativeAfterPf <= effectiveEsiCeiling);
    }
    const effectiveEsiFactor = esiBaseChoice === "BASIC" ? esiEmployerRate * basicPct : esiEmployerRate;
    const esiRate = (actualEsiOpted && employerEsiInCTC) ? effectiveEsiFactor : 0;
    const denom = 1 + esiRate + gratuityFactorOnGross;
    const tentativeGross = denom > 0 ? tentativeAfterPf / denom : tentativeAfterPf;
    const tBasic = (basicCalcType === "CUSTOM_FIXED" && basicFlat > 0) ? Math.min(basicFlat, tentativeGross) : tentativeGross * basicPct;
    const esiBaseVal = esiBaseChoice === "BASIC" ? tBasic : tentativeGross;
    esiReserve = (actualEsiOpted && employerEsiInCTC) ? Math.round(esiBaseVal * esiEmployerRate * 100) / 100 : 0;
    gratuityReserve = (gratuityInCTC && gratuityRateOnBasic > 0) ? Math.round(tBasic * gratuityRateOnBasic * 100) / 100 : 0;
    monthlyGross = Math.round((grossPool - pfReserve - esiReserve - gratuityReserve) * 100) / 100;
  } else {
    const effectivePfRate = pfRule === "CUSTOM_PERCENT"
      ? pfCustomRate * (pfCustomBase === "GROSS" ? 1 : basicPct)
      : 0.12 * basicPct;
    const pfRate = (actualPfOpted && employerPfInCTC) ? effectivePfRate : 0;
    const effectiveEsiFactor = esiBaseChoice === "BASIC" ? esiEmployerRate * basicPct : esiEmployerRate;
    let esiRate = (actualEsiOpted && employerEsiInCTC) ? effectiveEsiFactor : 0;
    let denom = 1 + pfRate + esiRate + gratuityFactorOnGross;
    let tentativeGross = grossPool / denom;

    if ((esiOpted === null || esiOpted === undefined) && esiEnabled) {
      actualEsiOpted = esiRule === "UNCAPPED" || tentativeGross <= effectiveEsiCeiling;
      esiRate = (actualEsiOpted && employerEsiInCTC) ? effectiveEsiFactor : 0;
      denom = 1 + pfRate + esiRate + gratuityFactorOnGross;
      tentativeGross = grossPool / denom;
    }

    const tBasic = (basicCalcType === "CUSTOM_FIXED" && basicFlat > 0) ? Math.min(basicFlat, tentativeGross) : tentativeGross * basicPct;
    if (!actualPfOpted) {
      pfReserve = 0;
    } else if (pfRule === "CUSTOM_PERCENT") {
      const baseVal = pfCustomBase === "GROSS" ? tentativeGross : tBasic;
      const cappedBase = pfCustomCapped ? Math.min(baseVal, effectiveCeiling) : baseVal;
      pfReserve = Math.round(cappedBase * pfCustomRate * 100) / 100;
    } else if (pfRule === "UNCAPPED_12_PERCENT") {
      pfReserve = Math.round(0.12 * tBasic * 100) / 100;
    } else {
      pfReserve = tBasic >= effectiveCeiling ? cappedPfFlat : Math.round(0.12 * tBasic * 100) / 100;
    }

    const tEsiBase = esiBaseChoice === "BASIC" ? tBasic : tentativeGross;
    esiReserve = (actualEsiOpted && employerEsiInCTC) ? Math.round(tEsiBase * esiEmployerRate * 100) / 100 : 0;
    gratuityReserve = (gratuityInCTC && gratuityRateOnBasic > 0) ? Math.round(tBasic * gratuityRateOnBasic * 100) / 100 : 0;
    monthlyGross = Math.round((grossPool - (employerPfInCTC ? pfReserve : 0) - (employerEsiInCTC ? esiReserve : 0) - gratuityReserve) * 100) / 100;
  }

  // 1. Basic calculation from true Monthly Gross (NO 25k floor!)
  let basic = 0;
  if (basicCalcType === "CUSTOM_FIXED" && basicFlat > 0) {
    basic = Math.min(basicFlat, monthlyGross);
  } else {
    basic = Math.round(monthlyGross * basicPct * 100) / 100;
  }

  // Finalize PF and ESI reserves on exact basic & gross
  if (!actualPfOpted) {
    pfReserve = 0;
  } else if (pfRule === "CUSTOM_PERCENT") {
    const baseVal = pfCustomBase === "GROSS" ? monthlyGross : basic;
    const cappedBase = pfCustomCapped ? Math.min(baseVal, effectiveCeiling) : baseVal;
    pfReserve = Math.round(cappedBase * pfCustomRate * 100) / 100;
  } else if (pfRule === "UNCAPPED_12_PERCENT") {
    pfReserve = Math.round(0.12 * basic * 100) / 100;
  } else {
    pfReserve = basic >= effectiveCeiling ? cappedPfFlat : Math.round(0.12 * basic * 100) / 100;
  }
  const finalEsiBase = esiBaseChoice === "BASIC" ? basic : monthlyGross;
  esiReserve = actualEsiOpted ? Math.round(finalEsiBase * esiEmployerRate * 100) / 100 : 0;

  // Derive LTA if not manually provided and client policy has LTA enabled
  const ltaPolicyType = policy?.lta_calculation_type || "OFF";
  const ltaPolicyPct = Number(policy?.lta_percentage || 0);
  const ltaPolicyFlat = Number(policy?.lta_flat_amount || 0);

  let effectiveLta = lta;
  if (reapplyPolicy || effectiveLta <= 0) {
    if (ltaPolicyType === "PERCENT_BASIC" && ltaPolicyPct > 0) {
      effectiveLta = Math.round((basic * (ltaPolicyPct / 100)) * 100) / 100;
    } else if (ltaPolicyType === "CUSTOM_FIXED" && ltaPolicyFlat > 0) {
      effectiveLta = ltaPolicyFlat;
    } else if (ltaPolicyType === "OFF") {
      effectiveLta = 0;
    }
  }

  // 2. HRA calculation (only deduct FBP from Gross if NOT carved out upfront)
  let hra = 0;
  const effectiveAllowanceDeductions = effectiveLta + nps + (carveOutFbp ? 0 : fbpVal);
  const availableForHra = Math.max(0, monthlyGross - basic - effectiveAllowanceDeductions);
  if (hraCalcType === "CUSTOM_FIXED" && hraFlat > 0) {
    hra = Math.max(0, Math.min(hraFlat, availableForHra));
  } else {
    hra = Math.max(0, Math.min(Math.round(hraPct * basic * 100) / 100, availableForHra));
  }

  // 3. Custom components sum (strictly uncarved FIXED components only; variable components vary per monthly batch)
  let sumCustomEarnings = 0;
  if (customComponents && typeof customComponents === "object") {
    Object.values(customComponents).forEach((comp) => {
      if (comp?.type === "EARNING" || comp?.component_type === "EARNING") {
        if (comp.is_monthly_variable || (comp.formula || "").toUpperCase() === "VARIABLE") return;
        const isCarved = carveOutCustom || comp.carve_out_from_ctc;
        if (isCarved) return; // Carved out upfront from CTC pool; not subtracted from Special Allowance again
        let amt = Number(comp.amount || 0);
        if (!amt && (comp.rate || comp.percentage || comp.default_value)) {
          const r = Number(comp.rate ?? comp.percentage ?? comp.default_value ?? 0);
          if (comp.calculation_type === "PERCENT_GROSS") {
            amt = monthlyGross * (r / 100);
          } else if (comp.calculation_type === "PERCENT_BASIC") {
            amt = basic * (r / 100);
          } else {
            amt = r;
          }
        }
        sumCustomEarnings += amt;
      }
    });
  }

  // 4. Special allowance remainder
  const nonSpecialEarnings = basic + hra + effectiveAllowanceDeductions + sumCustomEarnings;
  let specialAllowance = Math.max(0, Math.round((monthlyGross - nonSpecialEarnings) * 100) / 100);

  // 5. Overall shortfall / deficit check
  const totalAllocated = basic + hra + specialAllowance + effectiveAllowanceDeductions + sumCustomEarnings + (employerPfInCTC && actualPfOpted ? pfReserve : 0) + (employerEsiInCTC && actualEsiOpted ? esiReserve : 0) + fbpCarveout + customCarveout;
  const shortfall = Math.max(0, Math.round((totalAllocated - monthlyPool) * 100) / 100);

  // 6. Available buffer for discretionary allowances (LTA, NPS, FBP)
  const baseCommitted = basic + hra + sumCustomEarnings + (employerPfInCTC && actualPfOpted ? pfReserve : 0) + (employerEsiInCTC && actualEsiOpted ? esiReserve : 0) + customCarveout;
  const availableAllowanceBuffer = Math.max(0, Math.round((monthlyPool - baseCommitted) * 100) / 100);

  return {
    original_basic_da: Math.round(basic * 100) / 100,
    original_hra: Math.round(hra * 100) / 100,
    original_special_allowance: Math.round(specialAllowance * 100) / 100,
    original_lta: Math.round(effectiveLta * 100) / 100,
    nps_allowance: Math.round(nps * 100) / 100,
    fbp: Math.round(fbpVal * 100) / 100,
    monthly_gross: Math.round(monthlyGross * 100) / 100,
    employer_pf: Math.round(pfReserve * 100) / 100,
    employer_esi: Math.round(esiReserve * 100) / 100,
    esi_opted: actualEsiOpted,
    carve_out_fbp_in_ctc: carveOutFbp,
    carve_out_custom_in_ctc: carveOutCustom,
    fbp_carveout: fbpCarveout,
    custom_carveout: customCarveout,
    min_wage_warning: (monthlyGross >= 16500 && basic < 16500) || (monthlyPool >= 16500 && basic < 15000),
    shortfall,
    availableAllowanceBuffer,
  };
}

const SALARY_STRUCTURE_FIELDS = [
  ["ctc_annual", "CTC Annual"],
  ["monthly_gross", "Monthly Gross"],
  ["original_basic_da", "Basic + DA"],
  ["original_hra", "HRA"],
  ["original_special_allowance", "Special Allowance"],
  ["original_lta", "Leave Travel Allowance"],
  ["nps_allowance", "NPS Allowance (Employer)"],
  ["fbp", "FBP"],
  ["vpf", "VPF"],
];

const SALARY_STRUCTURE_EARNINGS_FIELDS = [
  ["monthly_gross", "Monthly Gross", "CTC ÷ 12"],
  ["original_basic_da", "Basic + DA", "Statutory / Policy base"],
  ["original_hra", "HRA", "Policy percentage of Basic"],
  ["original_special_allowance", "Special Allowance", "Balancing residual figure"],
  ["original_lta", "Leave Travel Allowance", "Carved from Special Allowance"],
  ["nps_allowance", "NPS Allowance (Employer)", "Carved from SA (Sec 80CCD(2))"],
  ["fbp", "FBP (Flexible Benefit)", "Carved from Special Allowance"],
];

function FieldRow({ label, children }) {
  return (
    <div className="flex items-start gap-3">
      <label className="text-xs font-medium w-36 shrink-0 pt-2.5" style={{ color: "var(--text-strong)" }}>
        {label}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function FieldError({ msg }) {
  return (
    <p className="text-xs mt-1" style={{ color: "var(--red-text-strong)" }}>{msg}</p>
  );
}

export function EmployeeFormModal({ employee, clients = [], defaultClientId, clientName, onClose, onSaved }) {
  const { mutateSaveEmployee, mutateUpdateSalaryStructure } = useAppMutations();
  const isEditMode = !!employee;
  const [activeTab, setActiveTab] = useState("info");

  // Fallback client directory lookup for self-healing resolution
  const { data: allClientsData } = useClients();
  const allClients = useMemo(() => {
    if (clients && clients.length > 0 && clients.some((c) => c && c.name)) return clients;
    return Array.isArray(allClientsData) ? allClientsData : allClientsData?.results || [];
  }, [clients, allClientsData]);

  const [form, setForm] = useState({
    employee_code: employee?.employee_code || "",
    first_name: employee?.first_name || "",
    last_name: employee?.last_name || "",
    email: employee?.email || "",
    pan_number: employee?.pan_number || "",
    uan_number: employee?.uan_number || "",
    esi_number: employee?.esi_number || "",
    department: employee?.department || "",
    position: employee?.position || "",
    employment_type: employee?.employment_type || (employee?.is_intern ? "INTERN" : "REGULAR"),
    hire_date: employee?.hire_date || "",
    ctc: employee?.ctc ?? "",
    status: employee?.status || "active",
    client: employee?.client || defaultClientId || (clients.length === 1 ? clients[0].id : ""),
    payment_mode: employee?.payment_mode || "",
    bank_name: employee?.bank_name || "",
    bank_account_number: employee?.bank_account_number || "",
    bank_ifsc_code: employee?.bank_ifsc_code || "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (employee) {
      setForm({
        employee_code: employee.employee_code || "",
        first_name: employee.first_name || "",
        last_name: employee.last_name || "",
        email: employee.email || "",
        pan_number: employee.pan_number || "",
        uan_number: employee.uan_number || "",
        esi_number: employee.esi_number || "",
        department: employee.department || "",
        position: employee.position || "",
        employment_type: employee.employment_type || (employee.is_intern ? "INTERN" : "REGULAR"),
        hire_date: employee.hire_date || "",
        ctc: employee.ctc ?? "",
        status: employee.status || "active",
        client: employee.client || defaultClientId || (clients.length === 1 ? clients[0].id : ""),
        payment_mode: employee.payment_mode || "",
        bank_name: employee.bank_name || "",
        bank_account_number: employee.bank_account_number || "",
        bank_ifsc_code: employee.bank_ifsc_code || "",
      });
    }
  }, [employee, defaultClientId, clients]);

  const selectedClient = useMemo(() => {
    return allClients.find((c) => String(c.id) === String(form.client)) || null;
  }, [allClients, form.client]);

  const resolvedClientName = clientName
    || employee?.client_name
    || selectedClient?.name
    || (form.client ? `Client #${form.client}` : "—");

  const saveEmployee = async () => {
    if (!form.employee_code.trim() || !form.first_name.trim()) {
      setError("Employee Code and First Name are required.");
      return;
    }
    if (!form.client) {
      setError("Select a client.");
      return;
    }
    setError("");
    try {
      const payload = { ...form, ctc: form.ctc === "" ? null : form.ctc, hire_date: form.hire_date || null };
      await mutateSaveEmployee.mutateAsync({ id: employee?.id, data: payload });
      onSaved();
    } catch (err) {
      const d = err?.response?.data;
      let message = "Failed to save employee.";
      if (typeof d === "string") {
        message = d;
      } else if (d?.detail) {
        message = d.detail;
      } else if (d?.employee_code) {
        const codeMsg = Array.isArray(d.employee_code) ? d.employee_code.join(", ") : d.employee_code;
        message = `Employee Code: ${codeMsg}`;
      } else if (d && typeof d === "object") {
        message = Object.entries(d)
          .map(([f, msgs]) => `${f}: ${Array.isArray(msgs) ? msgs.join(", ") : msgs}`)
          .join(" · ");
      }
      setError(message);
    }
  };

  return (
    <Modal
      title={employee ? "✏️ Edit Employee Profile" : "👤 Add New Employee"}
      onClose={onClose}
      width="min(760px, 95vw)"
      height="min(680px, calc(100vh - 2rem))"
    >
      {!isEditMode && (
        <EmployeeFormTabBar activeTab={activeTab} onChange={setActiveTab} isEditMode={isEditMode} />
      )}

      {activeTab === "info" && (
        <div className="flex-1 min-h-0 flex flex-col justify-between">
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">🏢 Client Company</label>
              {employee ? (
                <div
                  className="w-full rounded-lg px-3 py-2 text-sm font-semibold bg-slate-50 border border-slate-200 text-slate-700"
                >
                  {resolvedClientName}
                </div>
              ) : (
                <select
                  value={form.client}
                  onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none font-medium bg-white border border-slate-300 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Select a client company…</option>
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {EMPLOYEE_FIELDS.map(([key, label, type]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">{label}</label>
                  <input
                    key={`${key}-${employee?.id || 'new'}`}
                    type={type}
                    value={form[key] || ""}
                    placeholder={
                      key === "uan_number"
                        ? "12-digit UAN (e.g. 100123456789)"
                        : key === "esi_number"
                          ? "10-digit IP (e.g. 1234567890)"
                          : key === "bank_account_number"
                  ? "Account No (e.g. 50100234567890)"
                  : key === "bank_ifsc_code"
                  ? "11-char IFSC (e.g. HDFC0001234)"
                  : key === "bank_name"
                  ? "Bank name (e.g. HDFC Bank)"
                  : ""
                    }
                  maxLength={key === "uan_number" ? 12 : key === "bank_ifsc_code" ? 11 : undefined}
                  onChange={(e) => {
                    let val = e.target.value;
                      if (key === "uan_number" || key === "bank_account_number") {
                        val = val.replace(/\D/g, "");
                        if (key === "uan_number") val = val.slice(0, 12);
                      } else if (key === "bank_ifsc_code") {
                        val = val.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 11);
                        setForm((f) => {
                          const updates = { [key]: val };
                          if (!f.bank_name && val.length >= 4) {
                            const bankMap = {
                              HDFC: "HDFC Bank", SBIN: "State Bank of India", ICIC: "ICICI Bank",
                              UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", BARB: "Bank of Baroda",
                              PUNB: "Punjab National Bank", IDFB: "IDFC FIRST Bank", YESB: "Yes Bank",
                              INDB: "IndusInd Bank", CNRB: "Canara Bank", UBIN: "Union Bank of India",
                            };
                            if (bankMap[val.slice(0, 4)]) updates.bank_name = bankMap[val.slice(0, 4)];
                          }
                          return { ...f, ...updates };
                        });
                        return;
                      }
                      setForm((f) => ({ ...f, [key]: val }));
                    }
                  }
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none bg-white border border-slate-300 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              ))}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">👔 Employment Type</label>
                <select
                  value={form.employment_type || "REGULAR"}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setForm((f) => ({ ...f, employment_type: newType }));
                  }}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none font-medium bg-white border border-slate-300 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="REGULAR">💼 Regular Staff (Standard Salary & CTC)</option>
                  <option value="INTERN">🎓 Intern / Apprentice (Stipendiary — Exempt from PF/ESI)</option>
                  <option value="CONSULTANT">🤝 Consultant / Retainer (Professional Fees)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">🟢 Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none font-medium bg-white border border-slate-300 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="active">🟢 Active</option>
                  <option value="inactive">⚪ Inactive</option>
                </select>
              </div>
            </div>

            {form.employment_type === "INTERN" && (
              <div className="rounded-lg p-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 flex items-start gap-2">
                <span className="text-base leading-none">💡</span>
                <div>
                  <strong>Internship Mode:</strong> Staff member is classified as an intern receiving a monthly stipend.
                  Payslips automatically title as <em>STIPEND SLIP</em>, and EPF / ESI statutory deductions are exempt by default.
                </div>
              </div>
            )}
            {form.employment_type === "CONSULTANT" && (
              <div className="rounded-lg p-2.5 text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 flex items-start gap-2">
                <span className="text-base leading-none">💡</span>
                <div>
                  <strong>Consultant Mode:</strong> Professional retainer contract. Exempt from statutory EPF / ESI deductions.
                </div>
              </div>
            )}

            {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 mt-2 shrink-0">
            <Button variant="secondary" onClick={onClose} disabled={mutateSaveEmployee.isPending || mutateUpdateSalaryStructure.isPending}>Cancel</Button>
            {!isEditMode && (
              <Button variant="secondary" onClick={() => setActiveTab("salary")} disabled={mutateSaveEmployee.isPending}>
                Next: 💰 Salary Structure →
              </Button>
            )}
            <Button onClick={saveEmployee} disabled={mutateSaveEmployee.isPending || mutateUpdateSalaryStructure.isPending}>
              {mutateSaveEmployee.isPending ? "Saving…" : isEditMode ? "💾 Save Changes" : "Save & Continue"}
            </Button>
          </div>
        </div>
      )}

      {activeTab === "salary" && !isEditMode && (
        <div className="flex-1 min-h-0 flex flex-col pt-1">
          <SalaryStructureForm
            employee={{ client: form.client, employment_type: form.employment_type, is_intern: form.employment_type === "INTERN" }}
            client={selectedClient}
            isNewEmployee={true}
            initialEmploymentType={form.employment_type}
            onBack={() => setActiveTab("info")}
            onCancel={onClose}
            onCustomSubmit={async (salaryPayload) => {
              const payload = { ...form, ctc: form.ctc === "" ? null : form.ctc, hire_date: form.hire_date || null };
              const savedEmployee = await mutateSaveEmployee.mutateAsync({ id: employee?.id, data: payload });
              if (Number(salaryPayload.ctc_annual) > 0) {
                await mutateUpdateSalaryStructure.mutateAsync({
                  id: savedEmployee.id,
                  data: {
                    ...salaryPayload,
                    employment_type: form.employment_type,
                    is_intern: form.employment_type === "INTERN",
                  }
                });
              }
              onSaved();
            }}
          />
        </div>
      )}
    </Modal>
  );
}

/* ── Salary Structure Modal & Form (Consolidated from modals/) ────────────── */
export function SalaryStructureForm({
  employee,
  client,
  onSaved,
  onCancel,
  isNewEmployee = false,
  onBack,
  onCustomSubmit,
  submitButtonText,
  initialEmploymentType,
}) {
  const current = employee?.salary_structure;
  const isInternInitial = initialEmploymentType === "INTERN" || employee?.employment_type === "INTERN" || employee?.is_intern || current?.is_intern;
  const initialType = initialEmploymentType || employee?.employment_type || (isInternInitial ? "INTERN" : "REGULAR");
  const { mutateUpdateSalaryStructure } = useAppMutations();
  const [savingCustom, setSavingCustom] = useState(false);
  const [customError, setCustomError] = useState("");
  const clientPolicy = client || (typeof employee?.client === "object" ? employee.client : null) || {};

  const { register, watch, control, handleSubmit, setValue, formState: { errors } } = useForm({
    defaultValues: {
      effective_from: currentMonthLocal(),
      change_reason: "",
      ctc_annual: current?.ctc_annual ?? 0,
      fbp: current?.fbp ?? 0,
      monthly_gross: current?.monthly_gross ?? 0,
      original_basic_da: current?.original_basic_da ?? 0,
      original_hra: current?.original_hra ?? 0,
      original_lta: current?.original_lta ?? 0,
      original_special_allowance: current?.original_special_allowance ?? 0,
      nps_allowance: current?.nps_allowance ?? 0,
      vpf: current?.vpf ?? 0,
      pf_opted: current?.pf_opted ?? (isInternInitial ? false : true),
      esi_opted: current?.esi_opted ?? false,
      employment_type: initialType,
    },
  });

  const values = watch();
  const monthlyGross = Number(values.monthly_gross || 0);

  const clientId = client?.id || (typeof employee?.client === "object" ? employee.client?.id : employee?.client);
  const { data: rawClientComps } = useClientSalaryComponents(clientId);
  const clientComponents = useMemo(() => {
    return Array.isArray(rawClientComps) ? rawClientComps : rawClientComps?.results || [];
  }, [rawClientComps]);
  const variableCustomComponents = useMemo(() => {
    return clientComponents.filter((c) => c.is_monthly_variable || (c.formula || "").toUpperCase() === "VARIABLE");
  }, [clientComponents]);

  // Filter and merge current custom components with client catalog defaults
  const fixedCustomComponents = useMemo(() => {
    const merged = {};
    // 1. Seed from client catalog active fixed components
    clientComponents.forEach((c) => {
      if (c && c.code && !c.code.startsWith("__") && !c.is_monthly_variable && (c.formula || "").toUpperCase() !== "VARIABLE") {
        const rateVal = Number(c.default_value || 0);
        merged[c.code] = {
          name: c.name,
          code: c.code,
          abbr: c.abbr,
          type: c.component_type,
          component_type: c.component_type,
          calculation_type: c.calculation_type,
          rate: rateVal,
          amount: rateVal,
          is_monthly_variable: false,
          formula: "FIXED",
          source: "CATALOG_DEFAULT",
          carve_out_from_ctc: c.carve_out_from_ctc,
          payout_frequency: c.payout_frequency,
        };
      }
    });

    // 2. Overlay existing structure components if present
    if (current?.custom_components && typeof current.custom_components === "object") {
      Object.entries(current.custom_components).forEach(([k, v]) => {
        if (!v || typeof v !== "object") return;
        if (!v.is_monthly_variable && (v.formula || "").toUpperCase() !== "VARIABLE") {
          // If clientComponents is loaded, do not resurrect components that were deleted from client catalog
          if (!clientComponents || clientComponents.length === 0 || clientComponents.some((c) => String(c.code).toUpperCase() === String(k).toUpperCase())) {
            merged[k] = {
              ...(merged[k] || {}),
              ...v,
            };
          }
        }
      });
    }
    return merged;
  }, [clientComponents, current?.custom_components]);

  const carveOutCustom = clientPolicy?.carve_out_custom_in_ctc === true;
  const carveOutFbp = clientPolicy?.carve_out_fbp_in_ctc === true;
  const employerPfInCtc = clientPolicy?.employer_pf_in_ctc !== false;
  const employerEsiInCtc = clientPolicy?.employer_esi_in_ctc !== false;
  const gratuityInCtc = clientPolicy?.gratuity_in_ctc === true;
  const gratuityRateOnBasic = gratuityInCtc ? (Number(clientPolicy?.gratuity_pct ?? 4.81) / 100) : 0;

  const { carvedCustomEarningsSum, insideGrossCustomEarningsSum } = useMemo(() => {
    let carved = 0;
    let inside = 0;
    Object.values(fixedCustomComponents)
      .filter((c) => c.type === "EARNING" || c.component_type === "EARNING")
      .forEach((c) => {
        const val = Number(c.amount ?? c.default_value ?? 0);
        const b = Number(values.original_basic_da || 0);
        const g = Number(values.monthly_gross || 0);
        let evaluatedAmt = val;
        if (c.calculation_type === "PERCENT_BASIC") evaluatedAmt = Math.round(b * (val / 100));
        else if (c.calculation_type === "PERCENT_GROSS") evaluatedAmt = Math.round(g * (val / 100));

        const freq = String(c.payout_frequency || "MONTHLY").trim().toUpperCase();
        let monthlyAmt = evaluatedAmt;
        if (freq === "ANNUAL" || freq === "ON_SEPARATION" || freq === "SEPARATION") monthlyAmt = evaluatedAmt / 12;
        else if (freq === "QUARTERLY") monthlyAmt = evaluatedAmt / 3;

        const isCarved = carveOutCustom || c.carve_out_from_ctc;
        if (isCarved) {
          carved += monthlyAmt;
        } else {
          inside += monthlyAmt;
        }
      });
    return { carvedCustomEarningsSum: carved, insideGrossCustomEarningsSum: inside };
  }, [fixedCustomComponents, values.original_basic_da, values.monthly_gross, carveOutCustom]);

  const fixedCustomEarningsSum = carvedCustomEarningsSum + insideGrossCustomEarningsSum;

  const grossComponentSum = ["original_basic_da", "original_hra", "original_lta", "original_special_allowance", "nps_allowance"]
    .reduce((sum, key) => sum + Number(values[key] || 0), 0) + (carveOutFbp ? 0 : Number(values.fbp || 0)) + insideGrossCustomEarningsSum;
  const componentSum = grossComponentSum;

  const allAllocatedMonthly = ["original_basic_da", "original_hra", "original_lta", "original_special_allowance", "nps_allowance", "fbp"]
    .reduce((sum, key) => sum + Number(values[key] || 0), 0) + fixedCustomEarningsSum;

  const bAmt = Number(values.original_basic_da || 0);
  const pfReserve = getPfReserve(bAmt, values.pf_opted, clientPolicy, monthlyGross);
  const pfInCtc = (employerPfInCtc && values.pf_opted) ? pfReserve : 0;

  // ESI reserve
  const esiEmployeePct = Number(clientPolicy?.esi_employee_pct ?? 0.75) / 100;
  const esiEmployerPct = Number(clientPolicy?.esi_employer_pct ?? 3.25) / 100;
  const esiWageCeiling = Number(clientPolicy?.esi_wage_ceiling ?? 21000);
  const esiRule = clientPolicy?.esi_calculation_rule || "STATUTORY_21K";
  const esiBaseMode = (clientPolicy?.esi_custom_base || "GROSS").toUpperCase();
  const effectiveEsiCeiling = esiRule === "STATUTORY_25K" ? 25000 : esiWageCeiling;
  const isEsiOpted = values.esi_opted ?? (monthlyGross <= effectiveEsiCeiling && Boolean(clientPolicy?.esi_enabled));
  const esiBase = esiBaseMode === "BASIC" ? bAmt : monthlyGross;
  const esiApplicable = isEsiOpted && (esiRule === "UNCAPPED" || monthlyGross <= effectiveEsiCeiling);
  const esiReserve = esiApplicable ? Math.round(esiBase * esiEmployerPct * 100) / 100 : 0;
  const esiInCtc = (employerEsiInCtc && isEsiOpted) ? esiReserve : 0;

  // Gratuity reserve
  const gratuityReserve = (gratuityInCtc && gratuityRateOnBasic > 0) ? Math.round(bAmt * gratuityRateOnBasic * 100) / 100 : 0;

  const monthlyCtcPool = Math.round((Number(values.ctc_annual || 0) / 12) * 100) / 100;
  const totalCtcAllocated = Math.round((allAllocatedMonthly + pfInCtc + esiInCtc + gratuityReserve) * 100) / 100;
  // Standard regular components should equal monthlyGross; and total allocated components + reserves in CTC should equal monthlyCtcPool (with ±₹1 rounding tolerance)
  const grossMismatch = Math.abs(monthlyGross - grossComponentSum) > 1.0;
  const ctcMismatch = monthlyCtcPool > 0 && Math.abs(monthlyCtcPool - totalCtcAllocated) > 1.0;
  const mismatch = grossMismatch || ctcMismatch;

  const handleResetToPolicy = () => {
    if (!values.ctc_annual || Number(values.ctc_annual) <= 0) return;
    const result = computeFromCTC(
      values.ctc_annual,
      0,
      values.nps_allowance,
      values.fbp,
      values.pf_opted,
      clientPolicy,
      fixedCustomComponents,
      values.esi_opted,
      true
    );
    setValue("original_basic_da", result.original_basic_da, { shouldDirty: true });
    setValue("original_hra", result.original_hra, { shouldDirty: true });
    setValue("original_lta", result.original_lta, { shouldDirty: true });
    setValue("original_special_allowance", result.original_special_allowance, { shouldDirty: true });
    setValue("monthly_gross", result.monthly_gross, { shouldDirty: true });
  };

  useEffect(() => {
    if (!values.ctc_annual || Number(values.ctc_annual) <= 0) return;
    const ltaPolicyType = clientPolicy?.lta_calculation_type || "OFF";
    const shouldDeriveLta = (Number(values.original_lta || 0) <= 0 && ltaPolicyType !== "OFF");
    const result = computeFromCTC(
      values.ctc_annual,
      values.original_lta,
      values.nps_allowance,
      values.fbp,
      values.pf_opted,
      clientPolicy,
      fixedCustomComponents,
      values.esi_opted,
      shouldDeriveLta
    );
    setValue("original_basic_da", result.original_basic_da, { shouldDirty: true });
    setValue("original_hra", result.original_hra, { shouldDirty: true });
    if (shouldDeriveLta) {
      setValue("original_lta", result.original_lta, { shouldDirty: true });
    }
    setValue("original_special_allowance", result.original_special_allowance, { shouldDirty: true });
    setValue("monthly_gross", result.monthly_gross, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.ctc_annual, values.original_lta, values.nps_allowance, values.fbp, values.pf_opted, values.esi_opted, clientPolicy, fixedCustomComponents]);

  const diffs = useMemo(() => {
    if (!current) return [];
    return SALARY_STRUCTURE_FIELDS
      .map(([key, label]) => ({ key, label, old: Number(current[key] || 0), next: Number(values[key] || 0) }))
      .filter((item) => item.old !== item.next);
  }, [current, values]);

  const submit = async (data) => {
    const payload = { ...data };
    if (payload.effective_from?.length === 7) payload.effective_from += "-01";
    SALARY_STRUCTURE_FIELDS.forEach(([key]) => { payload[key] = Number(payload[key] || 0); });
    payload.pf_opted = Boolean(data.pf_opted);
    payload.esi_opted = Boolean(data.esi_opted);
    payload.employer_pf_in_ctc = employerPfInCtc;
    payload.employer_esi_in_ctc = employerEsiInCtc;
    payload.custom_components = fixedCustomComponents;
    payload.employment_type = data.employment_type || initialType;
    payload.is_intern = payload.employment_type === "INTERN";

    if (onCustomSubmit) {
      setSavingCustom(true);
      setCustomError("");
      try {
        await onCustomSubmit(payload);
      } catch (err) {
        const d = err?.response?.data;
        let msg = "Failed to save.";
        if (typeof d === "string") msg = d;
        else if (d?.detail) msg = d.detail;
        else if (d && typeof d === "object") {
          msg = Object.entries(d).map(([f, m]) => `${f}: ${Array.isArray(m) ? m.join(", ") : m}`).join(" · ");
        } else if (err?.message) {
          msg = err.message;
        }
        setCustomError(msg);
      } finally {
        setSavingCustom(false);
      }
      return;
    }

    mutateUpdateSalaryStructure.mutate({ id: employee.id, data: payload }, { onSuccess: onSaved });
  };

  const apiError = mutateUpdateSalaryStructure.error;
  const apiErrorMessage = (() => {
    if (!apiError) return null;
    const d = apiError?.response?.data;
    if (!d) return apiError.message || "An unexpected error occurred.";
    if (typeof d === "string") return d;
    if (d.detail) return d.detail;
    return Object.entries(d)
      .map(([f, msgs]) => `${f}: ${Array.isArray(msgs) ? msgs.join(", ") : msgs}`)
      .join(" · ");
  })();

  const isPending = mutateUpdateSalaryStructure.isPending || savingCustom;

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        {isNewEmployee && (
          <div className="rounded-lg px-3 py-2 text-xs leading-relaxed flex items-start gap-2"
            style={{ background: "var(--blue-bg-subtle)", border: "1px solid var(--blue-bg-strong)", color: "var(--blue-text-strong)" }}>
            <InfoIcon size={13} className="shrink-0 mt-0.5" />
            <span>Set up salary structure for this employee. All fields are optional — you can add or adjust this later.</span>
          </div>
        )}
        {isInternInitial && (
          <div className="rounded-lg px-3 py-2 text-xs leading-relaxed flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900">
            <span className="text-sm">🎓</span>
            <div>
              <strong>Stipendiary Internship:</strong> This staff member is onboarded as an intern.
              EPF and ESI are set to exempt by default. The monthly allocation represents their educational stipend.
            </div>
          </div>
        )}
        {/* Employment Type Row */}
        <div className="grid gap-4 items-start md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>
              👔 Employment Type
            </label>
            <select
              value={values.employment_type || "REGULAR"}
              onChange={(e) => {
                const val = e.target.value;
                setValue("employment_type", val, { shouldDirty: true });
                if (val === "INTERN") {
                  setValue("pf_opted", false, { shouldDirty: true });
                  setValue("esi_opted", false, { shouldDirty: true });
                }
              }}
              className="w-full rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer outline-none"
              style={{ background: "var(--surface-1, #fff)", border: "1px solid var(--border-2)", color: "var(--text-strong)" }}
            >
              <option value="REGULAR">💼 Regular Staff (Standard Salary & CTC)</option>
              <option value="INTERN">🎓 Intern / Apprentice (Stipend — Exempt from PF/ESI)</option>
              <option value="CONSULTANT">🤝 Consultant / Retainer (Professional Fees)</option>
            </select>
          </div>
          {values.employment_type === "INTERN" && (
            <div className="rounded-xl px-3 py-2 text-xs leading-relaxed flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 self-end">
              <span className="text-sm">💡</span>
              <span><strong>Internship Mode:</strong> Educational stipend. EPF & ESI exempt. Slips titled <em>STIPEND SLIP</em>.</span>
            </div>
          )}
          {values.employment_type === "CONSULTANT" && (
            <div className="rounded-xl px-3 py-2 text-xs leading-relaxed flex items-start gap-2 bg-indigo-50 border border-indigo-200 text-indigo-900 self-end">
              <span className="text-sm">💡</span>
              <span><strong>Consultant Mode:</strong> Professional retainer contract. Exempt from PF/ESI.</span>
            </div>
          )}
        </div>

        {/* Effective From + CTC Annual + PF/ESI toggles row */}
        <div className="grid gap-4 items-start md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>
              Effective From
            </label>
            <Controller
              name="effective_from"
              control={control}
              rules={{ required: "Effective date is required" }}
              render={({ field }) => {
                const parts = field.value ? field.value.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1, 1];
                const y = parts[0] || new Date().getFullYear();
                const m = parts[1] || (new Date().getMonth() + 1);
                const d = parts[2] || 1;
                const maxDays = new Date(y, m, 0).getDate();
                const clampedDay = Math.min(Math.max(1, d), maxDays);
                const isoVal = `${y}-${String(m).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
                return (
                  <div className="space-y-1.5">
                    <input
                      type="date"
                      value={isoVal}
                      title="Pick exact effective date (e.g. 1st for full month or mid-month for proration)"
                      onChange={(e) => {
                        if (e.target.value) field.onChange(e.target.value);
                      }}
                      className="w-full rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer"
                      style={{ background: "var(--surface-1, #fff)", border: "1px solid var(--border-2)", color: "var(--text-strong)" }}
                    />
                    {clampedDay > 1 && (
                      <div
                        className="rounded-lg px-2.5 py-1 text-[11px] font-medium flex items-center justify-between gap-2"
                        style={{ background: "var(--amber-bg-subtle)", color: "var(--amber-text-strong)", border: "1px solid var(--amber-bg-strong)" }}
                      >
                        <span>⚡ Mid-Month Revision (Day {clampedDay}/{maxDays}) — Blended Proration</span>
                        <button
                          type="button"
                          onClick={() => field.onChange(`${y}-${String(m).padStart(2, "0")}-01`)}
                          className="underline font-semibold cursor-pointer"
                        >
                          Reset to 1st
                        </button>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {errors.effective_from && <FieldError msg={errors.effective_from.message} />}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>
              CTC Annual
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              {...register("ctc_annual", {
                required: "CTC Annual is required",
                min: { value: 0, message: "Must be 0 or more" },
              })}
            />
            {errors.ctc_annual && <FieldError msg={errors.ctc_annual.message} />}
          </div>

          <div className="space-y-1.5 pt-6">
            <label className="flex items-center gap-2 text-xs font-medium whitespace-nowrap rounded-xl px-3 py-2.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)", color: "var(--text-strong)" }}>
              <input type="checkbox" {...register("pf_opted")} className="h-4 w-4" />
              PF Applicable
            </label>
            <label className="flex items-center gap-2 text-xs font-medium whitespace-nowrap rounded-xl px-3 py-2.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)", color: "var(--text-strong)" }}>
              <input type="checkbox" {...register("esi_opted")} className="h-4 w-4" />
              ESI Applicable (Gross ≤ ₹21k)
            </label>
          </div>
        </div>

        {current && !isNewEmployee && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>
              Change Reason
            </label>
            <Textarea
              rows={2}
              className="min-h-0"
              {...register("change_reason", { required: (!isNewEmployee && current) ? "Change reason is required" : false })}
              placeholder="Annual increment, promotion, correction…"
            />
            {errors.change_reason && <FieldError msg={errors.change_reason.message} />}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 -mt-2">
          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
            Basic + DA, HRA, LTA, and Special Allowance auto-fill from CTC per company policy. Values remain fully editable afterward.
          </p>
          <button
            type="button"
            onClick={handleResetToPolicy}
            className="text-[11px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-0.5 rounded cursor-pointer transition-colors flex items-center gap-1 shrink-0"
            title="Recalculate Basic, HRA, LTA and Special Allowance based on current company Salary Policy"
          >
            <span>⚡</span> Reset to Policy
          </button>
        </div>

        {/* Diff panel */}
        {current && diffs.length > 0 && (
          <div className="rounded-lg p-3 text-[11px] leading-relaxed"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}>
            <p className="font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-subtle)" }}>
              Diff vs Current
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-0.5">
              {diffs.map((item) => {
                const up = item.next > item.old;
                return (
                  <p key={item.key} style={{ color: up ? "var(--green-text-strong)" : "var(--red-text-strong)" }}>
                    {item.label}: {up ? "▲" : "▼"} {formatCurrency(Math.abs(item.next - item.old))}
                  </p>
                );
              })}
            </div>
          </div>
        )}

        {/* CTC Earnings Components */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>
              CTC Earnings Components
            </p>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface-3)", color: "var(--text-subtle)" }}>
              Carved from CTC Pool
            </span>
          </div>
          <div className="grid gap-x-3 gap-y-2.5 md:grid-cols-3">
            {SALARY_STRUCTURE_EARNINGS_FIELDS.map(([key, label, hint]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--text-strong)" }}>{label}</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  {...register(key, { min: { value: 0, message: "Must be 0 or more" } })}
                />
                {hint && <p className="text-[10px] leading-snug" style={{ color: "var(--text-subtle)" }}>{hint}</p>}

                {key === "nps_allowance" && Number(values.nps_allowance || 0) > (Number(values.original_basic_da || 0) * 0.10) && (
                  <p className="text-[10px] leading-snug" style={{ color: "var(--amber-text-strong)" }}>
                    ⚠️ Exceeds 10% of Basic ({formatCurrency(Number(values.original_basic_da || 0) * 0.10)}) tax limit
                  </p>
                )}
                {errors[key] && <FieldError msg={errors[key].message} />}
              </div>
            ))}
          </div>

          {/* Custom Salary Components Breakdown if configured */}
          {(() => {
            const fixedEntries = Object.entries(fixedCustomComponents || {});
            if (fixedEntries.length === 0) return null;
            return (
              <div className="mt-3 rounded-xl p-3.5 space-y-2 border border-blue-200/80 bg-blue-50/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                    <span>🧩</span> Active Fixed Custom Salary Components
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                    🔒 Fixed Contract Baseline
                  </span>
                </div>
                <div className="divide-y divide-blue-100 bg-white rounded-lg p-2.5 border border-blue-200/60">
                  {fixedEntries.map(([code, comp]) => {
                    const isEarning = comp.type === "EARNING" || comp.component_type === "EARNING";
                    const isPctBasic = comp.calculation_type === "PERCENT_BASIC";
                    const isPctGross = comp.calculation_type === "PERCENT_GROSS";
                    const rateVal = comp.rate ?? comp.percentage ?? comp.amount;
                    return (
                      <div key={code} className="py-1.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className={isEarning ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                            {isEarning ? "➕" : "➖"} {comp.name || code}
                          </span>
                          {(isPctBasic || isPctGross) && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono font-bold">
                              {rateVal}% of {isPctBasic ? "Basic" : "Gross"}
                            </span>
                          )}
                        </div>
                        <span className="font-bold tabular-nums text-slate-800">
                          {formatCurrency(comp.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500">
                  💡 Fixed contractual components are carved from CTC and factored into Special Allowance.
                </p>
              </div>
            );
          })()}

          {/* Option 2: Helpful Variable Notice Pill */}
          {variableCustomComponents.length > 0 && (
            <div className="mt-3 rounded-xl p-3 text-xs bg-amber-50/80 border border-amber-200/90 text-amber-900 flex items-start gap-2 shadow-2xs">
              <span className="text-base shrink-0">📊</span>
              <div>
                <span className="font-bold">Monthly Variable Components ({variableCustomComponents.length}): </span>
                <span className="font-semibold">{variableCustomComponents.map((c) => c.name).join(", ")}</span>
                <p className="text-[11px] text-amber-800/90 mt-0.5">
                  These vary monthly (e.g. claims, vouchers) and are submitted during monthly payroll via dedicated Excel tabs or batch review inputs. They do not carve out from or reduce fixed CTC.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Voluntary Employee Deductions */}
        <div className="rounded-xl p-3.5 space-y-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-strong)" }}>
              Voluntary Employee Deductions (Take-Home Pay)
            </span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface-3)", color: "var(--text-subtle)" }}>
              Deducted from Net Pay · Sec 80C
            </span>
          </div>
          <div className="max-w-md">
            <FieldRow label="VPF (Voluntary PF)">
              <Input
                type="number"
                min="0"
                step="0.01"
                className="max-w-[220px]"
                {...register("vpf", { min: { value: 0, message: "Must be 0 or more" } })}
              />
              {errors.vpf && <FieldError msg={errors.vpf.message} />}
            </FieldRow>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-subtle)" }}>
            ℹ️ VPF is voluntarily deducted from the employee&apos;s take-home pay into their PF account. It does not alter CTC, Monthly Gross, or Special Allowance.
          </p>
        </div>

        <div className="text-xs space-y-2 pt-1" style={{ color: "var(--text-muted)" }}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Monthly Gross: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(monthlyGross)}</span>
            </span>
            {carvedCustomEarningsSum > 0 && (
              <span>
                {"  ·  "}+ Carved Custom: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(carvedCustomEarningsSum)}</span>
              </span>
            )}
            {carveOutFbp && Number(values.fbp || 0) > 0 && (
              <span>
                {"  ·  "}+ Carved FBP: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(Number(values.fbp || 0))}</span>
              </span>
            )}
            {values.pf_opted && pfReserve > 0 && employerPfInCtc && (
              <span>
                {"  ·  "}+ Employer PF: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(pfReserve)}</span>
              </span>
            )}
            {employerEsiInCtc && esiInCtc > 0 && (
              <span>
                {"  ·  "}+ Employer ESI: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(esiInCtc)}</span>
              </span>
            )}
            {gratuityInCtc && gratuityReserve > 0 && (
              <span>
                {"  ·  "}+ Gratuity: <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(gratuityReserve)}</span>
              </span>
            )}
            <span>
              {"  =  "}<span className="font-semibold tabular-nums" style={{ color: mismatch ? "var(--amber-text-strong)" : "var(--text-primary)" }}>
                CTC {formatCurrency(totalCtcAllocated)}
              </span>
            </span>
            {values.pf_opted && pfReserve > 0 && !employerPfInCtc && (
              <span className="text-[10.5px] px-1.5 py-0.5 rounded font-medium bg-purple-50 text-purple-700 border border-purple-200">
                Employer PF: {formatCurrency(pfReserve)} (Outside CTC)
              </span>
            )}
            {!mismatch && monthlyGross > 0 && (
              <span className="font-bold text-emerald-600 inline-flex items-center gap-0.5">
                ✓ Balanced
              </span>
            )}
          </p>
          {Number(values.original_special_allowance || 0) === 0 && mismatch && totalCtcAllocated > (monthlyCtcPool || monthlyGross) ? (
            <div className="rounded-xl p-3 text-xs leading-relaxed space-y-1"
              style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "var(--red-text-strong)" }}>
              <p className="font-semibold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>CTC Pool Overflow / Shortfall: {formatCurrency(totalCtcAllocated - (monthlyCtcPool || monthlyGross))}</span>
              </p>
              <p>
                The sum of salary allowances exceeds the monthly CTC pool. Special Allowance is at <strong>₹0.00</strong> and cannot absorb any more allowances.
                Please reduce LTA, NPS Allowance, or FBP by <strong>{formatCurrency(totalCtcAllocated - (monthlyCtcPool || monthlyGross))}</strong> (or increase Annual CTC) to balance the salary structure.
              </p>
            </div>
          ) : mismatch ? (
            <p style={{ color: "var(--amber-text-strong)" }}>
              {grossMismatch
                ? `Monthly Gross (${formatCurrency(monthlyGross)}) doesn't match component sum (${formatCurrency(componentSum)}).`
                : `Total CTC allocated (${formatCurrency(totalCtcAllocated)}) doesn't match monthly CTC pool (${formatCurrency(monthlyCtcPool)}).`}
              {" "}You can still save if this is an intentional manual override.
            </p>
          ) : null}
        </div>

        {(apiErrorMessage || customError) && (
          <div className="rounded-lg px-3 py-1.5 text-xs leading-relaxed"
            style={{ background: "var(--red-bg-subtle)", border: "1px solid var(--red-bg-strong)", color: "var(--red-text-strong)" }}>
            {apiErrorMessage || customError}
          </div>
        )}
      </div>

      <div className={`flex items-center ${onBack ? "justify-between" : "justify-end"} gap-2 pt-3 mt-1 shrink-0`} style={{ borderTop: "1px solid var(--border-1)" }}>
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack} disabled={isPending}>
            ← Back to Info
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : submitButtonText || (isNewEmployee ? "Save Employee & Structure" : "Save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SalaryStructureModal({ employee, client, onClose }) {
  return (
    <Modal
      title={`Update Salary Structure — ${employee?.full_name || employee?.name || ""}`}
      onClose={onClose}
      width="820px"
      height="min(680px, calc(100vh - 2rem))"
    >
      <SalaryStructureForm employee={employee} client={client} onSaved={onClose} onCancel={onClose} />
    </Modal>
  );
}

/* ==========================================================================
   PART 3: INDIVIDUAL EMPLOYEE PERSONNEL DETAIL (Consolidated from EmployeeWorkspace)
   ========================================================================== */

const STRUCTURE_ROWS = [
  ["ctc_annual", "CTC (Annual)"],
  ["monthly_gross", "Monthly Gross"],
  ["original_basic_da", "Basic + DA"],
  ["original_hra", "HRA"],
  ["original_special_allowance", "Special Allowance"],
  ["original_lta", "Leave Travel Allowance"],
  ["nps_allowance", "NPS Allowance (Employer)"],
  ["fbp", "FBP"],
  ["vpf", "VPF"],
];

const payslipRecordStatusTone = {
  DRAFT: "slate",
  APPROVED: "blue",
  EMAIL_SENT: "green",
  EMAIL_FAILED: "red",
};

const EMPLOYEE_TABS = [
  { key: "details", label: "Personnel Profile", emoji: "👤" },
  { key: "payslips", label: "Payslips & Archive", emoji: "🧾" },
  { key: "adjustments", label: "Ledgers & Adjustments", emoji: "⚖️" },
];

function EmployeeTabRow({ active, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pt-1 border-b border-slate-200">
      {EMPLOYEE_TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold transition-all rounded-t-lg -mb-px ${isActive
              ? "bg-blue-50/70 text-blue-900 border-b-2 border-blue-700 shadow-2xs"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-b-2 border-transparent"
              }`}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmployeeInfoField({ label, value, emoji }) {
  return (
    <div className="p-2.5 rounded-lg bg-slate-50/60 border border-slate-200/70">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
        {emoji && <span>{emoji}</span>}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold mt-1 truncate text-slate-800">
        {value || "—"}
      </div>
    </div>
  );
}

function EmployeeDetailsTab({ emp, clientName, client, totalPayslips, emailSent, totalPaid, latestRecord, structure, history, historyLoading, pendingAdjustments, onAdjust, currentGross }) {
  const clientId = client?.id || emp?.client;
  const { data: rawClientComps } = useClientSalaryComponents(clientId);
  const clientComponents = useMemo(() => {
    return Array.isArray(rawClientComps) ? rawClientComps : rawClientComps?.results || [];
  }, [rawClientComps]);

  const compOffBalance = latestRecord?.comp_off_closing_balance ?? 0;
  const leaveBalance = latestRecord?.leave_closing_balance ?? 0;
  const advanceBalance = latestRecord?.salary_advance_closing_balance ?? 0;
  const onHoldBalance = latestRecord?.on_hold_closing_balance ?? 0;

  const trackCompOff = client?.track_comp_off !== false;
  const trackLeaveLedger = client?.track_leave_ledger !== false;

  const pendingSummary = (rows) => {
    if (!rows || rows.length === 0) return null;
    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const sign = total > 0 ? "+" : "";
    return `${rows.length} pending (${sign}${Number(total).toFixed(2)})`;
  };

  return (
    <div className="space-y-4">
      {/* ── Unified Metric & Ledger Stat Tiles (Single Harmonized Row) ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatTile label="Total Paid (Net)" value={formatCurrency(totalPaid)} />
        <StatTile
          label="Current Gross"
          value={
            currentGross && Number(currentGross) > 0
              ? formatCurrency(currentGross)
              : latestRecord?.monthly_gross
                ? formatCurrency(latestRecord.monthly_gross)
                : "—"
          }
        />

        {[
          {
            key: "comp_off",
            label: "Comp Off",
            emoji: "🏖️",
            balance: compOffBalance,
            enabled: trackCompOff,
          },
          {
            key: "leave",
            label: "Paid Leave",
            emoji: "🌴",
            balance: leaveBalance,
            enabled: trackLeaveLedger,
          },
          {
            key: "salary_advance",
            label: "Salary Advance",
            emoji: "💸",
            balance: advanceBalance,
            enabled: true,
          },
          {
            key: "on_hold",
            label: "Salary on Hold",
            emoji: "🔒",
            balance: onHoldBalance,
            enabled: true,
          },
        ]
          .filter((chip) => chip.enabled)
          .map((chip) => {
            const pending = pendingSummary(pendingAdjustments?.[chip.key]);
            const display = formatBalanceValue(chip.key, chip.balance);
            const hasPending = Boolean(pending);
            const isNonZero = Number(chip.balance || 0) !== 0;

            return (
              <StatTile
                key={chip.key}
                label={chip.label}
                emoji={chip.emoji}
                value={display}
                tone={
                  chip.key === "salary_advance" && isNonZero
                    ? "amber"
                    : chip.key === "on_hold" && isNonZero
                      ? "purple"
                      : chip.balance > 0
                        ? "green"
                        : chip.balance < 0
                          ? "red"
                          : undefined
                }
                extra={
                  <button
                    type="button"
                    onClick={() => onAdjust(chip.key)}
                    style={{
                      background: "none",
                      border: `1px solid ${BRD}`,
                      borderRadius: 6,
                      padding: "2px 7px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: P,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      transition: "all .15s",
                      lineHeight: "14px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = PL;
                      e.currentTarget.style.borderColor = P;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "none";
                      e.currentTarget.style.borderColor = BRD;
                    }}
                  >
                    ⚡ Adjust
                  </button>
                }
                sub={
                  hasPending ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        background: AMBL,
                        color: AMB,
                        border: `1px solid ${BRD}`,
                      }}
                    >
                      ⏳ {pending}
                    </span>
                  ) : (
                    <span style={{ color: MUT, fontSize: 10.5 }}>
                      Ledger reconciled
                    </span>
                  )
                }
              />
            );
          })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-sm">
          <h2 className="text-xs font-extrabold text-slate-500 tracking-wider uppercase mb-5 flex items-center gap-2">
            <span>👤</span> PERSONNEL PROFILE
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-6">
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">EMPLOYEE CODE</div>
              <div className="text-[13.5px] font-bold text-slate-900 mt-1 font-mono">
                {emp.employee_code || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CLIENT COMPANY</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {clientName || (emp.client ? `Client #${emp.client}` : "—")}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">DESIGNATION / ROLE</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.position || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">DEPARTMENT</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.department || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">WORK EMAIL</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.email || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">PAN CARD NUMBER</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                {emp.pan_number || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">UAN NUMBER (PF)</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                {emp.uan_number || "—"}
              </div>
            </div>
            {emp.esi_number && (
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">ESI IP NUMBER</div>
                <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                  {emp.esi_number}
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">HIRE DATE</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.hire_date ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>{formatDate(emp.hire_date)}</span>
                    {formatTenure(emp.hire_date) && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200"
                        title={`Tenure: ${formatTenure(emp.hire_date)}`}
                      >
                        ⏳ {formatTenure(emp.hire_date)}
                      </span>
                    )}
                  </div>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">EMPLOYMENT STATUS</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.status === "active" ? "🟢 Active" : "⚪ Inactive"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">BANK ACCOUNT NUMBER</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                {emp.bank_account_number || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">BANK IFSC CODE</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1 font-mono">
                {emp.bank_ifsc_code || "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">BANK NAME</div>
              <div className="text-[13.5px] font-semibold text-slate-900 mt-1">
                {emp.bank_name || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-extrabold text-slate-500 tracking-wider uppercase flex items-center gap-2">
              <span>💰</span> ACTIVE SALARY STRUCTURE
            </h2>
            {structure?.effective_from && (
              <Badge tone="green">Effective {structure.effective_from}</Badge>
            )}
          </div>
          {structure ? (
            <div className="divide-y divide-slate-100">
              {STRUCTURE_ROWS.map(([key, label]) => (
                <div key={key} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">{label}</span>
                  <span className="font-bold tabular-nums text-slate-800">
                    {formatCurrency(structure[key])}
                  </span>
                </div>
              ))}

              {/* Dynamic Custom Salary Components Breakdown (strictly FIXED contract components only) */}
              {(() => {
                // Merge structure components with client catalog components to guarantee display
                const mergedCustom = {};
                if (clientComponents && Array.isArray(clientComponents)) {
                  clientComponents.forEach((c) => {
                    if (c && c.code && !c.code.startsWith("__") && !c.is_monthly_variable && (c.formula || "").toUpperCase() !== "VARIABLE") {
                      const rateVal = Number(c.default_value || 0);
                      const b = Number(structure.original_basic_da || 0);
                      const g = Number(structure.monthly_gross || 0);
                      const evaluatedAmt = c.calculation_type === "PERCENT_BASIC"
                        ? Math.round(b * (rateVal / 100))
                        : c.calculation_type === "PERCENT_GROSS"
                          ? Math.round(g * (rateVal / 100))
                          : rateVal;
                      mergedCustom[c.code] = {
                        name: c.name,
                        code: c.code,
                        type: c.component_type,
                        calculation_type: c.calculation_type,
                        rate: rateVal,
                        amount: evaluatedAmt,
                        source: "CATALOG_DEFAULT",
                      };
                    }
                  });
                }
                if (structure.custom_components && typeof structure.custom_components === "object") {
                  Object.entries(structure.custom_components).forEach(([k, v]) => {
                    if (!v || typeof v !== "object") return;
                    if (!v.is_monthly_variable && (v.formula || "").toUpperCase() !== "VARIABLE") {
                      if (!clientComponents || clientComponents.length === 0 || clientComponents.some((c) => String(c.code).toUpperCase() === String(k).toUpperCase())) {
                        mergedCustom[k] = {
                          ...(mergedCustom[k] || {}),
                          ...v,
                          source: v.source || (mergedCustom[k] ? "CUSTOM_OVERRIDE" : "CUSTOM"),
                        };
                      }
                    }
                  });
                }

                const fixedEntries = Object.entries(mergedCustom);
                if (fixedEntries.length === 0) return null;
                return (
                  <div className="pt-2.5 mt-2 border-t border-slate-200">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span>🧩</span> Fixed Custom Components
                      </span>
                      <span className="text-[9.5px] font-normal text-slate-400 lowercase">
                        {fixedEntries.length} fixed in contract
                      </span>
                    </div>
                    {fixedEntries.map(([code, comp]) => {
                      const isEarning = comp.type === "EARNING" || comp.component_type === "EARNING";
                      const isPctBasic = comp.calculation_type === "PERCENT_BASIC";
                      const isPctGross = comp.calculation_type === "PERCENT_GROSS";
                      const rateVal = comp.rate ?? comp.percentage ?? comp.amount;
                      const isDefault = comp.source === "CATALOG_DEFAULT";
                      return (
                        <div key={code} className="py-1.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={isEarning ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
                              {isEarning ? "➕" : "➖"} {comp.name || code}
                            </span>
                            {(isPctBasic || isPctGross) && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200">
                                {rateVal}% of {isPctBasic ? "Basic" : "Gross"}
                              </span>
                            )}
                            <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-medium ${isDefault ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>
                              {isDefault ? "Default" : "Custom"}
                            </span>
                          </div>
                          <span className="font-bold tabular-nums text-slate-800">
                            {formatCurrency(comp.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <span>⚠️</span>
              <span>No active salary structure configured for this employee.</span>
            </div>
          )}
        </div>
      </div>

      {history?.length > 1 && (
        <Card className="p-4 space-y-3 rounded-xl border border-slate-200/80 shadow-xs bg-white">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>📜</span> HISTORICAL SALARY REVISIONS
          </h4>
          <div className="divide-y divide-slate-100">
            {history.map((rev) => (
              <div key={rev.id} className="py-2 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-800">
                    Effective {rev.effective_from}
                  </span>
                  {rev.change_reason && (
                    <span className="ml-2 text-slate-500">({rev.change_reason})</span>
                  )}
                </div>
                <div className="font-bold tabular-nums text-slate-800">
                  Monthly Gross: {formatCurrency(rev.monthly_gross)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function PayslipsTab({ records, recordsLoading, onDownload }) {
  if (recordsLoading) return null;
  if (!records || records.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState emoji="🧾" message="No payslips generated for this employee yet." />
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "var(--table-header-bg)", borderBottom: "1px solid var(--border-3)" }}>
            {["Period", "Earned", "Deductions", "Net Pay", "Status", "Actions"].map((h) => (
              <th key={h} className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: "var(--border-2)" }}>
          {records.map((r) => {
            const monthNum = Number(r.batch_month || r.month || 1);
            const monthName = MONTHS[monthNum - 1] || monthNum;
            const year = r.batch_year || r.year || "";
            return (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-strong)" }}>
                  {monthName} {year}
                </td>
                <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-strong)" }}>
                  {formatCurrency(r.earned_salary)}
                </td>
                <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--red-text)" }}>
                  {formatCurrency(r.total_deductions)}
                </td>
                <td className="px-4 py-2.5 font-bold tabular-nums" style={{ color: "var(--green-text-strong)" }}>
                  {formatCurrency(r.net_salary)}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={payslipRecordStatusTone[r.status] || "slate"}>{r.status}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Button size="sm" variant="secondary" onClick={() => onDownload(r)} title="Download PDF">
                    <Download size={12} /> PDF
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function AdjustmentTypeSection({ typeKey, entries, isMoney, plans, onAdjust }) {
  const conf = LEDGER_TYPE_CONFIG[typeKey] || { label: typeKey };
  const rows = entries || [];
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between pb-1" style={{ borderBottom: "1px solid var(--border-2)" }}>
        <span className="text-xs font-bold" style={{ color: "var(--text-strong)" }}>{conf.label}</span>
        <button type="button" onClick={() => onAdjust(typeKey)} className="text-xs font-semibold text-blue-600 hover:underline">
          + Adjust
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-3 text-center">No adjustment history.</p>
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
          {rows.map((row) => (
            <div key={row.id} className="p-2 rounded-lg text-xs flex justify-between items-center" style={{ background: "var(--surface-2)" }}>
              <div className="min-w-0 pr-2">
                <p className="font-semibold truncate" style={{ color: "var(--text-strong)" }}>{row.reason || "Manual Adjustment"}</p>
                <p className="text-[11px] text-slate-400">{formatDateTime(row.created_at)}</p>
              </div>
              <div className="font-bold tabular-nums shrink-0" style={{ color: row.amount >= 0 ? "var(--green-text)" : "var(--red-text)" }}>
                {row.amount >= 0 ? "+" : ""}{isMoney ? formatCurrency(row.amount) : `${row.amount} days`}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AdjustmentHistoryTab({ data, isLoading, onAdjust }) {
  if (isLoading) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-4 items-start">
      <AdjustmentTypeSection typeKey="comp_off" entries={data?.comp_off} isMoney={false} onAdjust={onAdjust} />
      <AdjustmentTypeSection typeKey="leave" entries={data?.leave} isMoney={false} onAdjust={onAdjust} />
      <AdjustmentTypeSection typeKey="salary_advance" entries={data?.salary_advance} isMoney plans={data?.salary_advance_plans} onAdjust={onAdjust} />
      <AdjustmentTypeSection typeKey="on_hold" entries={data?.on_hold} isMoney onAdjust={onAdjust} />
    </div>
  );
}

export function EmployeeDetailView({ employeeId, client = null, embedded = false, onBack }) {
  const navigate = useNavigate();
  const goBack = useSmartBack("/payroll/workspace");
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get("emp_tab") || (!embedded ? searchParams.get("tab") : null) || "details");

  const setTab = (tab) => {
    setActiveTab(tab);
    if (embedded) {
      const next = new URLSearchParams(searchParams);
      next.set("emp_tab", tab);
      setSearchParams(next, { replace: true });
    } else {
      setSearchParams({ tab });
    }
  };

  const clientsQuery = useClients();
  const clients = Array.isArray(clientsQuery.data) ? clientsQuery.data : clientsQuery.data?.results || [];

  const [empState, setEmpState] = useState({ data: null, isLoading: true, isError: false });
  const empClient = useMemo(() => {
    return clients.find((c) => String(c.id) === String(empState.data?.client)) || null;
  }, [clients, empState.data?.client]);
  const effectiveClient = client || empClient;
  const [showEditEmployee, setShowEditEmployee] = useState(false);
  const [showEditSalary, setShowEditSalary] = useState(false);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(null);

  const fetchEmployee = () => {
    setEmpState((s) => ({ ...s, isLoading: true, isError: false }));
    return api
      .get(apiPath(`salary-structures/employees/${employeeId}/`))
      .then((res) => setEmpState({ data: res.data, isLoading: false, isError: false }))
      .catch(() => setEmpState({ data: null, isLoading: false, isError: true }));
  };

  useEffect(() => {
    fetchEmployee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const { data: emp, isLoading: empLoading, isError: empError } = empState;

  const historyQuery = useSalaryStructureHistory(employeeId);
  const history = unwrapList(historyQuery.data);

  const recordsQuery = useEmployeeRecords(employeeId);
  const records = unwrapList(recordsQuery.data);

  // Chronologically sort records by (batch_year, batch_month) descending so latestRecord is genuinely the most recent
  // Placed unconditionally before early returns to satisfy React Hook rules
  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const aVal = (Number(a.batch_year || a.year || 0) * 100) + Number(a.batch_month || a.month || 0);
      const bVal = (Number(b.batch_year || b.year || 0) * 100) + Number(b.batch_month || b.month || 0);
      return bVal - aVal;
    });
  }, [records]);

  const pendingAdjustmentsQuery = usePendingAdjustments(employeeId);
  const adjustmentHistoryQuery = useAdjustmentHistory(employeeId);

  const downloadPDF = async (record) => {
    try {
      const response = await api.get(apiPath(`records/${record.id}/download-pdf/`), { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      const monthNum = Number(record.batch_month || record.month || 1);
      const monthName = MONTHS[monthNum - 1] || `Month${monthNum}`;
      const year = record.batch_year || record.year || "";
      const code = emp?.employee_code || "Staff";
      link.download = `Payslip_${code}_${monthName}_${year}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      let errMsg = "Failed to download payslip PDF.";
      if (err?.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          errMsg = json.error || json.detail || json.message || errMsg;
        } catch (_) { }
      } else if (err?.response?.data?.detail) {
        errMsg = err.response.data.detail;
      }
      alert(errMsg);
    }
  };

  if (empLoading) return null;

  if (empError || !emp) {
    return (
      <div className={`${embedded ? "" : "payroll-scope "}p-4`}>
        <ErrorState message="Failed to load employee details." onRetry={fetchEmployee} />
      </div>
    );
  }

  const clientName = effectiveClient?.name || emp?.client_name || clients.find((c) => String(c.id) === String(emp.client))?.name;
  const structure = emp.salary_structure;

  const totalPayslips = sortedRecords.length;
  const emailSent = sortedRecords.filter((r) => r.status === "EMAIL_SENT" || r.email_sent === true).length;
  const approvedRecords = sortedRecords.filter((r) => r.status !== "DRAFT");
  const totalPaid = (approvedRecords.length > 0 ? approvedRecords : sortedRecords)
    .reduce((sum, r) => sum + Number(r.net_salary || 0), 0);
  const latestRecord = sortedRecords[0];
  const currentGross = structure?.monthly_gross ?? (latestRecord?.monthly_gross ?? (emp.ctc ? Number(emp.ctc) / 12 : 0));

  return (
    <PayrollWorkspaceShell
      breadcrumb={
        embedded
          ? undefined
          : [
            { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
            { label: "Monthly Payroll", onClick: () => navigate("/payroll") },
            { label: "Client Master", onClick: () => navigate("/payroll/workspace") },
            ...(emp.client
              ? [{ label: clientName ? clientName.toUpperCase() : "CLIENT", onClick: () => navigate(`/payroll/clients/${emp.client}?tab=employees`) }]
              : []),
            { label: `${emp.employee_code ? emp.employee_code + " - " : ""}${emp.full_name}`.trim().toUpperCase() },
          ]
      }
      title={emp.full_name ? emp.full_name.toUpperCase() : "EMPLOYEE"}
      statusNode={
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 10px",
            borderRadius: 99,
            background: emp.status === "active" ? GL : REDL,
            color: emp.status === "active" ? GR : RED,
          }}
        >
          {emp.status === "active" ? "🟢 ACTIVE" : "⚪ INACTIVE"}
        </span>
      }
      chips={[
        emp.employee_code ? `ID: ${emp.employee_code}` : null,
        emp.position || "Staff",
      ].filter(Boolean)}
      meta={[
        clientName ? `🏢 ${clientName}` : null,
        `🧾 ${totalPayslips} payslip${totalPayslips === 1 ? "" : "s"} on file`,
        latestRecord?.batch_month && latestRecord?.batch_year
          ? `Latest: ${MONTHS[Number(latestRecord.batch_month) - 1] || latestRecord.batch_month} ${latestRecord.batch_year}`
          : null,
      ].filter(Boolean)}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <WsBtn size="sm" variant="ghost" onClick={() => setShowEditEmployee(true)}>
            ✏️ Edit Profile
          </WsBtn>
          <WsBtn size="sm" variant="primary" onClick={() => setShowEditSalary(true)}>
            💰 Configure Structure
          </WsBtn>
          <WsBtn size="sm" variant="ghost" onClick={onBack || goBack}>
            ← Back to Roster
          </WsBtn>
        </div>
      }
      tabs={[
        { key: "details", label: "Personnel Profile", icon: "👤" },
        { key: "payslips", label: "Payslips & Archive", icon: "🧾", badge: totalPayslips || undefined },
        { key: "adjustments", label: "Ledgers & Adjustments", icon: "⚖️" },
      ]}
      activeTab={activeTab}
      onTabChange={(tab) => {
        setTab(tab);
        window.scrollTo({ top: 0, behavior: "instant" });
      }}
      style={{
        minHeight: "100%",
        padding: embedded ? "0" : "16px 20px 24px 20px",
        background: embedded ? "transparent" : BG,
      }}
    >

      {activeTab === "details" && (
        <EmployeeDetailsTab
          emp={emp}
          clientName={clientName}
          client={effectiveClient}
          totalPayslips={totalPayslips}
          emailSent={emailSent}
          totalPaid={totalPaid}
          latestRecord={latestRecord}
          currentGross={currentGross}
          structure={structure}
          history={history}
          historyLoading={historyQuery.isLoading}
          pendingAdjustments={pendingAdjustmentsQuery.data}
          onAdjust={(type) => setLedgerModalOpen(type)}
        />
      )}

      {activeTab === "payslips" && (
        <PayslipsTab
          records={sortedRecords}
          recordsLoading={recordsQuery.isLoading}
          onDownload={downloadPDF}
        />
      )}

      {activeTab === "adjustments" && (
        <AdjustmentHistoryTab
          data={adjustmentHistoryQuery.data}
          isLoading={adjustmentHistoryQuery.isLoading}
          onAdjust={(type) => setLedgerModalOpen(type)}
        />
      )}

      {showEditEmployee && (
        <EmployeeFormModal
          employee={emp}
          clients={clients}
          clientName={clientName}
          onClose={() => setShowEditEmployee(false)}
          onSaved={() => {
            setShowEditEmployee(false);
            fetchEmployee();
          }}
        />
      )}

      {showEditSalary && (
        <SalaryStructureModal
          employee={emp}
          client={empClient}
          onClose={() => {
            setShowEditSalary(false);
            fetchEmployee();
            historyQuery.refetch();
          }}
        />
      )}

      {ledgerModalOpen && (
        <LedgerAdjustmentModal
          employee={emp}
          type={ledgerModalOpen}
          closingBalance={
            {
              comp_off: latestRecord?.comp_off_closing_balance,
              leave: latestRecord?.leave_closing_balance,
              salary_advance: latestRecord?.salary_advance_closing_balance,
              on_hold: latestRecord?.on_hold_closing_balance,
            }[ledgerModalOpen] ?? 0
          }
          pendingTotal={(pendingAdjustmentsQuery.data?.[ledgerModalOpen] || []).reduce(
            (sum, r) => sum + Number(r.amount || 0),
            0
          )}
          onClose={() => {
            setLedgerModalOpen(null);
            recordsQuery.refetch();
            pendingAdjustmentsQuery.refetch();
            adjustmentHistoryQuery.refetch();
          }}
        />
      )}
    </PayrollWorkspaceShell>
  );
}

export function EmployeeWorkspace({ employeeId: propEmployeeId } = {}) {
  const { id: paramId } = useParams();
  const employeeId = propEmployeeId || paramId;

  if (employeeId) {
    return <EmployeeDetailView employeeId={employeeId} embedded={false} />;
  }

  return <Navigate to="/payroll/workspace" replace />;
}

/* ── Client Employees Roster Table ────────────────────────────────────── */
function useEmployeesWithStructure(search, clientId) {
  const [state, setState] = useState({ data: [], isLoading: true, isError: false });

  const load = () => {
    setState((s) => ({ ...s, isLoading: true, isError: false }));
    const params = {};
    if (search) params.search = search;
    if (clientId) params.client = clientId;
    api
      .get(apiPath("salary-structures/employees/"), { params })
      .then((res) => setState({ data: res.data, isLoading: false, isError: false }))
      .catch(() => setState({ data: [], isLoading: false, isError: true }));
  };

  useEffect(load, [search, clientId]);
  return { ...state, refetch: load };
}

export function ClientEmployeesTab({ clientId, client, onOpenEmployee, refreshKey }) {
  const { mutateSaveEmployee: mutateToggleStatus } = useAppMutations();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEmployeeId = searchParams.get("employee");

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [structureFilter, setStructureFilter] = useState("");
  const { data: employees, isLoading, isError, refetch } = useEmployeesWithStructure(search, clientId);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const [editingStructure, setEditingStructure] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const toggleEmployeeStatus = async (emp) => {
    const nextStatus = emp.status === "active" ? "inactive" : "active";
    try {
      await mutateToggleStatus.mutateAsync({ id: emp.id, data: { status: nextStatus } });
      refetch();
    } catch (err) {
      console.error("Failed to update employee status:", err);
    }
  };

  const handleBackToEmployees = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("employee");
    next.delete("emp_tab");
    setSearchParams(next);
  };

  if (selectedEmployeeId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer bg-transparent border-none"
            onClick={handleBackToEmployees}
          >
            <ArrowLeft size={14} /> Back to Employees
          </button>
          <span className="text-xs font-semibold text-slate-500">
            Employee Personnel File
          </span>
        </div>
        <EmployeeDetailView
          employeeId={selectedEmployeeId}
          client={client}
          embedded={true}
          onBack={handleBackToEmployees}
        />
      </div>
    );
  }

  const filtered = employees.filter((emp) => {
    if (structureFilter === "with") return !emp.salary_structure;
    if (structureFilter === "without") return !emp.salary_structure;
    return true;
  });

  const withStructure = employees.filter((e) => e.salary_structure).length;
  const withoutStructure = employees.length - withStructure;

  return (
    <>
      <Card className="overflow-hidden rounded-xl border border-slate-200/80 shadow-xs bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 bg-slate-50/80 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>👥</span> EMPLOYEE PERSONNEL ROSTER
            </h3>
            <Badge tone="slate">{filtered.length} records</Badge>
            <div className="flex items-center gap-3 text-xs ml-2 font-medium text-slate-600">
              <span>👥 <strong>{employees.length}</strong> total staff</span>
              <span>•</span>
              <span className="text-emerald-700">✓ <strong>{withStructure}</strong> structured</span>
              <span>•</span>
              <span className="text-amber-700">⚠️ <strong>{withoutStructure}</strong> pending</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <GlassDropdown
              value={structureFilter}
              onChange={setStructureFilter}
              options={[
                { value: "with", label: "✓ Has Structure" },
                { value: "without", label: "⚠️ No Structure" },
              ]}
              placeholder="Structure Status"
              width="w-44"
            />
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
              <input
                placeholder="Search name, code, role…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="rounded-lg pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-300 text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {isError ? (
          <ErrorState message="Failed to load employees." onRetry={refetch} />
        ) : isLoading ? null : filtered.length === 0 ? (
          <EmptyState emoji="👥" message="No employees match the current search or filter criteria." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200">
                {["👤 Employee Profile", "💼 Position", "💰 Annual CTC", "📈 Monthly Gross", "📑 Structure Status", "⚡ Actions"].map((h) => (
                  <th
                    key={h}
                    className={`${h === "⚡ Actions" ? "text-center" : "text-left"
                      } px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((emp) => (
                <tr key={emp.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="font-bold text-left hover:text-blue-700 transition-colors text-slate-900 cursor-pointer"
                        onClick={() => onOpenEmployee(emp.id)}
                      >
                        {emp.full_name}
                      </button>
                      {emp.status !== "active" ? (
                        <Badge tone="red">⚪ Inactive</Badge>
                      ) : (
                        <Badge tone="green">🟢 Active</Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      🆔 {emp.employee_code || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{emp.position || "—"}</span>
                      {(emp.employment_type === "INTERN" || emp.is_intern) ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          🎓 Intern
                        </span>
                      ) : emp.employment_type === "CONSULTANT" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          🤝 Consultant
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-800 font-bold tabular-nums">
                    {formatCurrency(emp.ctc)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-800 font-bold tabular-nums">
                    {emp.salary_structure ? formatCurrency(emp.salary_structure.monthly_gross) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {emp.salary_structure ? (
                      <Badge tone="green">✓ Effective {emp.salary_structure.effective_from}</Badge>
                    ) : (
                      <Badge tone="amber">⚠️ Not Set</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => onOpenEmployee(emp.id)}>
                        👁️ View
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingEmployee(emp)}>
                        ✏️ Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingStructure(emp)}>
                        {emp.salary_structure ? "💼 Structure" : "➕ Structure"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutateToggleStatus.isPending}
                        onClick={() => toggleEmployeeStatus(emp)}
                        style={
                          emp.status === "active"
                            ? { color: "var(--red-text)", border: "1px solid var(--red-border)", background: "var(--red-bg-subtle)" }
                            : { color: "var(--green-text)", border: "1px solid var(--green-border)", background: "var(--green-bg-subtle)" }
                        }
                      >
                        {emp.status === "active" ? "⏸️ Deactivate" : "⚡ Activate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editingStructure && (
        <SalaryStructureModal
          employee={editingStructure}
          client={client}
          onClose={() => {
            setEditingStructure(null);
            refetch();
          }}
        />
      )}

      {editingEmployee && (
        <EmployeeFormModal
          employee={editingEmployee}
          clients={client ? [client] : [{ id: clientId }]}
          clientName={client?.name}
          onClose={() => setEditingEmployee(null)}
          onSaved={() => {
            setEditingEmployee(null);
            refetch();
          }}
        />
      )}
    </>
  );
}

/* ==========================================================================
   PART 3: CLIENT BATCH HISTORY TAB (Consolidated from BatchList.jsx)
   ========================================================================== */

const BATCH_PAGE_SIZE = 10;

export const BATCH_STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "Done", label: "Done", dot: "var(--green-solid-dark)" },
  { value: "Approved", label: "Approved", dot: "var(--green-solid)" },
  { value: "Under Review", label: "Under Review", dot: "var(--blue-solid)" },
  { value: "In Progress", label: "In Progress", dot: "var(--blue-solid)" },
  { value: "To Do", label: "To Do", dot: "var(--text-muted)" },
  { value: "Failed", label: "Failed", dot: "var(--red-solid)" },
];

export function ClientBatchesTab({ clientId }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const batchesQuery = useBatches({ client: clientId });
  const batches = unwrapList(batchesQuery.data);
  const { mutateSendEmails, mutateDiscardBatch } = useAppMutations();

  const handleOpenBatchReview = async (batch) => {
    if (batch.job_id) {
      setSelectedJobId(batch.job_id);
      return;
    }
    try {
      const res = await api.get("/payroll/jobs/", {
        params: { client: batch.client || clientId, month: batch.month, year: batch.year },
      });
      const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
      if (list.length > 0 && list[0].id) {
        setSelectedJobId(list[0].id);
      } else {
        navigate(`/payroll/batches/${batch.id}`);
      }
    } catch {
      navigate(`/payroll/batches/${batch.id}`);
    }
  };

  const filteredBatches = statusFilter
    ? batches.filter((b) => {
      const st = (b.job_status || b.status || "").toUpperCase();
      const filter = statusFilter.toUpperCase();
      if (filter === "DONE") return st === "DONE" || st === "CLOSED" || st === "COMPLETED";
      if (filter === "APPROVED") return st === "APPROVED";
      if (filter === "UNDER REVIEW") return st === "UNDER REVIEW" || st === "REVIEWED";
      if (filter === "IN PROGRESS") return st === "IN PROGRESS" || st === "UPLOADED" || st === "SENDING";
      if (filter === "TO DO") return st === "TO DO";
      if (filter === "FAILED") return st === "FAILED";
      return st === filter;
    })
    : batches;
  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / BATCH_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedBatches = filteredBatches.slice((currentPage - 1) * BATCH_PAGE_SIZE, currentPage * BATCH_PAGE_SIZE);

  const downloadDetailedXLSX = async (batchId) => {
    try {
      const response = await api.get(apiPath(`batches/${batchId}/export-detailed-xlsx/`), { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `payroll_${batchId}_detailed.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("XLSX export failed:", err);
    }
  };

  if (selectedJobId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer bg-transparent border-none"
            onClick={() => setSelectedJobId(null)}
          >
            <ArrowLeft size={14} /> Back to Batch History
          </button>
          <span className="text-xs font-semibold text-slate-500">
            Batch Review Workspace
          </span>
        </div>
        <PayrollJobBatchReview jobId={selectedJobId} embedded={true} />
      </div>
    );
  }

  if (batchesQuery.isLoading) return null;

  if (batchesQuery.isError) {
    return <ErrorState onRetry={batchesQuery.refetch} />;
  }

  return (
    <Card className="overflow-hidden rounded-xl border border-slate-200/80 shadow-xs bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 bg-slate-50/80 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>📜</span> MONTHLY PAYROLL BATCH HISTORY
          </h3>
          <Badge tone="slate">{filteredBatches.length} batches</Badge>
        </div>
        <div className="flex items-center gap-2">
          <GlassDropdown
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={BATCH_STATUS_OPTIONS}
            placeholder="All Job Statuses"
            width="w-44"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200">
              {["📅 Period", "⚡ Live Status", "👥 Records", "✉️ Delivered", "⚠️ Failed", "🕒 Created At", "⚙️ Actions"].map((col) => (
                <th key={col} className="px-3.5 py-2.5 text-[10px] font-bold tracking-wider uppercase text-slate-600 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagedBatches.length > 0 ? (
              pagedBatches.map((batch) => {
                const displayStatus = batch.job_status || batch.status || "To Do";
                const StatusIcon = resolveStatusIcon(displayStatus);
                return (
                  <tr
                    key={batch.id}
                    className="transition-colors hover:bg-slate-50/70 cursor-pointer"
                    onClick={() => handleOpenBatchReview(batch)}
                  >
                    <td className="px-3.5 py-3 text-xs font-bold text-slate-800 whitespace-nowrap">
                      📅 {MONTHS[(batch.month || 1) - 1]} {batch.year}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={resolveStatusTone(displayStatus)}>
                          <StatusIcon size={11} className="mr-1 inline" />
                          {displayStatus}
                        </Badge>
                        {batch.email_sent > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
                            title={`${batch.email_sent} payslip emails sent`}
                          >
                            ✉️ Sent
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-xs font-semibold text-slate-700 whitespace-nowrap">
                      👥 {batch.total_records}
                    </td>
                    <td className="px-3.5 py-3 text-xs font-bold text-emerald-700 whitespace-nowrap">
                      {batch.email_sent}
                    </td>
                    <td className="px-3.5 py-3 text-xs font-bold whitespace-nowrap" style={{ color: batch.email_failed > 0 ? "var(--red-text-strong)" : "var(--text-muted)" }}>
                      {batch.email_failed}
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatDateTime(batch.created_at)}
                    </td>
                    <td className="px-3.5 py-3 text-xs whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => downloadDetailedXLSX(batch.id)}
                          title="Export detailed payroll spreadsheet (xlsx)"
                        >
                          📥 Detailed XLSX
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleOpenBatchReview(batch)}
                        >
                          👁️ Review
                        </Button>
                        {batch.status === "FAILED" && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => mutateSendEmails.mutate(batch.id)}
                              title="Retry send"
                            >
                              🔄 Retry Send
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                confirm({
                                  title: "Delete this batch?",
                                  description: "Permanently delete this failed batch and its payslip records? This cannot be undone.",
                                  variant: "danger",
                                  confirmLabel: "Delete",
                                  onConfirm: () => mutateDiscardBatch.mutateAsync(batch.id),
                                });
                              }}
                              title="Delete batch permanently"
                            >
                              <Trash2 size={12} style={{ color: "var(--red-text-strong)" }} />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center gap-3 py-16">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl"
                      style={{ background: "var(--blue-bg)", border: "1px solid var(--blue-bg-strong)" }}
                    >
                      <Clock size={22} className="text-blue-400" />
                    </div>
                    <p className="text-sm text-slate-500">No payroll batches found.</p>
                    <p className="text-xs text-slate-400">Monthly payroll batches are prepared and processed within active Payroll Jobs.</p>
                    <Button size="sm" onClick={() => navigate("/payroll/jobs")} style={{ background: "#1e3a8a", color: "#ffffff", border: "none", marginTop: 4 }}>
                      📋 Go to Payroll Jobs
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filteredBatches.length > BATCH_PAGE_SIZE && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={BATCH_PAGE_SIZE}
          totalCount={filteredBatches.length}
          onPageChange={setPage}
          noun="batches"
        />
      )}
    </Card>
  );
}

/* ==========================================================================
   PART 4: CLIENT EMAIL LOGS TAB (Consolidated from EmailLogs.jsx)
   ========================================================================== */

const EMAIL_STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "true", label: "Sent", dot: "var(--green-solid-dark)" },
  { value: "false", label: "Failed", dot: "var(--red-solid)" },
];

const EMAIL_BATCH_FILTER_OPTIONS = [
  { value: "all", label: "All Batches" },
  { value: "failed", label: "Has Failed Emails", dot: "var(--red-solid)" },
  { value: "sent", label: "All Sent", dot: "var(--green-solid-dark)" },
];

export function ClientEmailsTab({ clientId, clientName }) {
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { mutateResendEmail } = useAppMutations();

  const batchesQuery = useBatches({ client: clientId });
  const batches = unwrapList(batchesQuery.data);

  const selectedBatch = batches.find((b) => String(b.id) === String(selectedBatchId));
  const logsQuery = useEmailLogs(selectedBatchId ? { batch: selectedBatchId, success: statusFilter || undefined } : null);
  const logs = unwrapList(logsQuery?.data);

  const downloadBatchCSV = async (batch) => {
    try {
      const response = await api.get(apiPath(`batches/${batch.id}/export-csv/`), { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      const fileClientName = (clientName || "client").replace(/\s+/g, "");
      const monthLabel = MONTHS[(batch.month || 1) - 1] || "";
      link.download = `${fileClientName}_${monthLabel}_${batch.year}_emailstatus.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Email log CSV download failed:", err);
    }
  };

  if (selectedBatchId) {
    const totalLogPages = Math.max(1, Math.ceil(logs.length / BATCH_PAGE_SIZE));
    const currentLogPage = Math.min(page, totalLogPages);
    const pagedLogs = logs.slice((currentLogPage - 1) * BATCH_PAGE_SIZE, currentLogPage * BATCH_PAGE_SIZE);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer bg-transparent border-none"
            onClick={() => {
              setSelectedBatchId(null);
              setPage(1);
            }}
          >
            <ArrowLeft size={14} /> Back to Batches
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500">
              Batch: {selectedBatch ? `${MONTHS[(selectedBatch.month || 1) - 1]} ${selectedBatch.year}` : `#${selectedBatchId}`}
            </span>
            <GlassDropdown
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={EMAIL_STATUS_OPTIONS}
              placeholder="All Statuses"
              width="w-36"
            />
            <Button size="sm" variant="secondary" onClick={() => downloadBatchCSV(selectedBatch || { id: selectedBatchId })}>
              <Download size={12} /> CSV
            </Button>
          </div>
        </div>

        {logsQuery.isLoading ? null : logsQuery.isError ? (
          <ErrorState onRetry={logsQuery.refetch} />
        ) : (
          <Card className="overflow-hidden rounded-xl border border-slate-200/80 shadow-xs bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200">
                    {["🆔 Code", "👤 Employee Name", "📧 Recipient Email", "🔄 Attempt", "⚡ Status", "⚠️ Diagnostic", "🕒 Sent Timestamp", "⚙️ Action"].map((col) => (
                      <th key={col} className="px-3.5 py-2.5 text-[10px] font-bold tracking-wider uppercase text-slate-600 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedLogs.length > 0 ? (
                    pagedLogs.map((log) => (
                      <tr key={log.id} className="transition-colors hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5 text-xs font-mono font-semibold text-slate-700 whitespace-nowrap">
                          {log.employee_code || "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs font-bold text-slate-900 whitespace-nowrap">
                          {log.employee_name}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                          {log.recipient_email}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs text-center whitespace-nowrap">
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${log.attempt_number > 1
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                            }`}>
                            {log.attempt_number}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          <Badge tone={log.success ? "green" : "red"}>
                            {log.success ? "✓ Sent" : "✗ Failed"}
                          </Badge>
                        </td>
                        <td className="px-3.5 py-2.5 text-xs truncate max-w-[220px]" style={{ color: log.error_message ? "var(--red-text-strong)" : "var(--text-muted)" }} title={log.error_message || ""}>
                          {log.error_message || "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                          {formatDateTime(log.sent_at)}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs whitespace-nowrap">
                          {!log.success && (
                            <Button size="sm" variant="secondary" onClick={() => mutateResendEmail.mutate(log.payslip_record)}>
                              🔄 Retry Send
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="flex flex-col items-center gap-3 py-12">
                          <span className="text-3xl">✉️</span>
                          <p className="text-sm font-medium text-slate-500">No email delivery attempts logged for this batch.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {logs.length > BATCH_PAGE_SIZE && (
              <Pagination
                currentPage={currentLogPage}
                totalPages={totalLogPages}
                pageSize={BATCH_PAGE_SIZE}
                totalCount={logs.length}
                onPageChange={setPage}
                noun="logs"
              />
            )}
          </Card>
        )}
      </div>
    );
  }

  // Batches summary view
  if (batchesQuery.isLoading) return null;

  if (batchesQuery.isError) {
    return <ErrorState onRetry={batchesQuery.refetch} />;
  }

  const filteredEmailBatches = batches.filter((b) => {
    if (batchFilter === "failed") return (b.email_failed || 0) > 0;
    if (batchFilter === "sent") return (b.email_sent || 0) > 0 && !(b.email_failed > 0);
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEmailBatches.length / BATCH_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedBatches = filteredEmailBatches.slice((currentPage - 1) * BATCH_PAGE_SIZE, currentPage * BATCH_PAGE_SIZE);

  return (
    <Card className="overflow-hidden rounded-xl border border-slate-200/80 shadow-xs bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 bg-slate-50/80 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>✉️</span> EMAIL DELIVERY BATCHES
          </h3>
          <Badge tone="slate">{filteredEmailBatches.length} batches</Badge>
        </div>
        <div className="flex items-center gap-2">
          <GlassDropdown
            value={batchFilter}
            onChange={(v) => {
              setBatchFilter(v);
              setPage(1);
            }}
            options={EMAIL_BATCH_FILTER_OPTIONS}
            placeholder="All Email Batches"
            width="w-48"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200">
              {["📅 Period", "⚡ Live Status", "✉️ Delivered", "⚠️ Failed", "🕒 Created At", "⚙️ Action"].map((col) => (
                <th key={col} className="px-3.5 py-2.5 text-[10px] font-bold tracking-wider uppercase text-slate-600 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagedBatches.length > 0 ? (
              pagedBatches.map((batch) => {
                const displayStatus = batch.job_status || batch.status || "To Do";
                const StatusIcon = resolveStatusIcon(displayStatus);
                return (
                  <tr
                    key={batch.id}
                    className="transition-colors hover:bg-slate-50/70 cursor-pointer"
                    onClick={() => {
                      setSelectedBatchId(batch.id);
                      setPage(1);
                    }}
                  >
                    <td className="px-3.5 py-3 text-xs font-bold text-slate-800 whitespace-nowrap">
                      📅 {MONTHS[(batch.month || 1) - 1]} {batch.year}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <Badge tone={resolveStatusTone(displayStatus)}>
                        <StatusIcon size={11} className="mr-1 inline" />
                        {displayStatus}
                      </Badge>
                    </td>
                    <td className="px-3.5 py-3 text-xs font-bold text-emerald-700 whitespace-nowrap">
                      {batch.email_sent}
                    </td>
                    <td className="px-3.5 py-3 text-xs font-bold whitespace-nowrap" style={{ color: batch.email_failed > 0 ? "var(--red-text-strong)" : "var(--text-muted)" }}>
                      {batch.email_failed}
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatDateTime(batch.created_at)}
                    </td>
                    <td className="px-3.5 py-3 text-xs whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" onClick={() => downloadBatchCSV(batch)} title="Download delivery log CSV">
                        📥 Log CSV
                      </Button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6}>
                  <div className="flex flex-col items-center gap-3 py-16">
                    <Mail size={22} className="text-blue-400" />
                    <p className="text-sm text-slate-500">No email delivery batches found for this client.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filteredEmailBatches.length > BATCH_PAGE_SIZE && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={BATCH_PAGE_SIZE}
          totalCount={filteredEmailBatches.length}
          onPageChange={setPage}
          noun="batches"
        />
      )}
    </Card>
  );
}

/* ==========================================================================
   PART 5: BATCH REVIEW REDIRECT (Resolves historical /batches/:id to modern Jobs)
   ========================================================================== */

export function BatchReviewRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let alive = true;
    async function resolveJob() {
      try {
        const res = await api.get(apiPath(`batches/${id}/`));
        const batch = res.data;
        if (!alive) return;

        // 1. Direct job_id on batch serializer
        if (batch?.job_id) {
          navigate(`/payroll/jobs/${batch.job_id}/review`, { replace: true });
          return;
        }

        // 2. Query matching job by client, month, and year
        if (batch?.client && batch?.month && batch?.year) {
          const jobRes = await api.get(`/payroll/jobs/`, {
            params: { client: batch.client, month: batch.month, year: batch.year },
          });
          const list = Array.isArray(jobRes.data) ? jobRes.data : jobRes.data?.results || [];
          if (!alive) return;
          if (list.length > 0 && list[0].id) {
            navigate(`/payroll/jobs/${list[0].id}/review`, { replace: true });
            return;
          }
        }

        if (alive) {
          setResolving(false);
          setError("No active Payroll Job found for this historical batch. All reviews are managed within Jobs.");
        }
      } catch (err) {
        if (alive) {
          setResolving(false);
          setError(err?.response?.data?.detail || "Unable to locate batch or associated job.");
        }
      }
    }

    resolveJob();
    return () => { alive = false; };
  }, [id, navigate]);

  if (resolving) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3" style={{ minHeight: "60vh" }}>
        <PuffLoader color="#1e3a8a" size={44} />
        <p className="text-sm font-medium text-slate-500">Redirecting to modern Job Review…</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl mx-auto">
      <Card className="p-6 text-center space-y-4">
        <div className="text-3xl">📋</div>
        <h2 className="text-base font-bold text-slate-800">Job Review Redirection</h2>
        <p className="text-sm text-slate-500">{error}</p>
        <div className="pt-2">
          <Button onClick={() => navigate("/payroll/jobs")} style={{ background: "#1e3a8a", color: "#ffffff" }}>
            Go to Payroll Jobs
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ClientWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack("/payroll/workspace");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "details";
  const setTab = (tab) => setSearchParams({ tab });

  const clientQuery = useClient(id);
  const client = clientQuery.data;
  const batchesQuery = useBatches({ client: id });
  const rawBatches = unwrapList(batchesQuery.data);
  const batches = useMemo(() => {
    return [...rawBatches].sort((a, b) => {
      const aVal = (Number(a.year || 0) * 100) + Number(a.month || 0);
      const bVal = (Number(b.year || 0) * 100) + Number(b.month || 0);
      return bVal - aVal;
    });
  }, [rawBatches]);

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [choosingDesign, setChoosingDesign] = useState(false);
  const [employeesRefreshKey, setEmployeesRefreshKey] = useState(0);

  const emailLogsQuery = useEmailLogs({ client: id });
  const emailLogs = unwrapList(emailLogsQuery.data);
  const emailsSent = emailLogs.filter((log) => log.success === true || log.status === "sent" || log.status === "delivered").length;
  const emailsFailed = emailLogs.filter((log) => log.success === false || log.status === "failed" || log.status === "bounced").length;

  if (clientQuery.isLoading) return null;

  if (clientQuery.isError || !client) {
    return (
      <div className="payroll-scope p-4">
        <ErrorState message="Failed to load client details." onRetry={clientQuery.refetch} />
      </div>
    );
  }

  return (
    <PayrollWorkspaceShell
      sticky={false}
      breadcrumb={[
        { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
        { label: "Monthly Payroll", onClick: () => navigate("/payroll") },
        { label: "Client Master", onClick: () => navigate("/payroll/workspace") },
        { label: client.name ? client.name.toUpperCase() : "CLIENT" },
      ]}
      title={client.name ? client.name.toUpperCase() : "CLIENT"}
      statusNode={null}
      meta={[
        `📅 Client since ${formatDate(client.created_at)}`,
        `📜 ${batches.length} payroll batch${batches.length === 1 ? "" : "es"} on file`,
      ]}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <WsBtn size="sm" variant="ghost" onClick={() => setAddingEmployee(true)}>
            👤 + Add Employee
          </WsBtn>
          <WsBtn size="sm" variant="ghost" onClick={() => setImportingEmployees(true)}>
            📥 Import Roster
          </WsBtn>
          <WsBtn size="sm" variant="outline" onClick={() => setChoosingDesign(true)}>
            🎨 Choose Design
          </WsBtn>
        </div>
      }
      tabs={[
        { key: "details", label: "Client Details", icon: "🏢" },
        { key: "policy", label: "Salary Policy & Rules", icon: "⚖️" },
        { key: "employees", label: "Employees & Roster", icon: "👥" },
        { key: "batches", label: "Batch History", icon: "📜", badge: batches.length || undefined },
        { key: "emails", label: "Email Logs", icon: "✉️", badge: emailsFailed > 0 ? `${emailsFailed} failed` : undefined },
      ]}
      activeTab={activeTab}
      onTabChange={(tab) => {
        setTab(tab);
        window.scrollTo({ top: 0, behavior: "instant" });
      }}
      style={{
        minHeight: "100%",
        padding: "16px 20px 24px 20px",
        background: BG,
      }}
    >

      {activeTab === "details" && (
        <ClientDetailsTab
          client={client}
          batches={batches}
          emailsSent={emailsSent}
          emailsFailed={emailsFailed}
        />
      )}

      {activeTab === "policy" && (
        <ClientSalaryPolicyTab
          client={client}
          onUpdated={() => {
            clientQuery.refetch();
            setEmployeesRefreshKey((k) => k + 1);
          }}
        />
      )}

      {activeTab === "employees" && (
        <ClientEmployeesTab
          key={employeesRefreshKey}
          clientId={id}
          client={client}
          refreshKey={employeesRefreshKey}
          onOpenEmployee={(empId) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "employees");
            next.set("employee", empId);
            setSearchParams(next);
          }}
        />
      )}

      {activeTab === "batches" && (
        <ClientBatchesTab clientId={id} />
      )}

      {activeTab === "emails" && (
        <ClientEmailsTab clientId={id} clientName={client?.name} />
      )}

      {choosingDesign && (
        <ChooseDesignModal
          client={client}
          onClose={() => setChoosingDesign(false)}
          onSaved={clientQuery.refetch}
        />
      )}

      {addingEmployee && (
        <EmployeeFormModal
          clients={client ? [client] : []}
          clientName={client?.name}
          defaultClientId={id}
          onClose={() => setAddingEmployee(false)}
          onSaved={() => {
            setAddingEmployee(false);
            setEmployeesRefreshKey((k) => k + 1);
          }}
        />
      )}

      {importingEmployees && (
        <ImportEmployeesModal
          clientId={id}
          client={client}
          onClose={() => setImportingEmployees(false)}
          onImported={() => {
            setImportingEmployees(false);
            setEmployeesRefreshKey((k) => k + 1);
          }}
        />
      )}
    </PayrollWorkspaceShell>
  );
}



/* ==========================================================================
   PART 2: PORTAL USERS & PASSWORDS LOGIC & COMPONENTS
   (Consolidated from PortalUsers.jsx)
   ========================================================================== */

const ROLE_LABELS = { editor: "Editor", client_admin: "Client Admin" };
const ROLE_TONES = { editor: "blue", client_admin: "purple" };

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*?-_=+";

function generatePassword(length = 14) {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function passwordChecks(value) {
  const v = value || "";
  return [
    { key: "len", label: "At least 8 characters", ok: v.length >= 8 },
    { key: "num", label: "Not entirely numbers", ok: v.length > 0 && !/^\d+$/.test(v) },
    { key: "mix", label: "Letters and numbers", ok: /[a-zA-Z]/.test(v) && /\d/.test(v) },
    { key: "case", label: "Upper and lower case", ok: /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { key: "sym", label: "A symbol (recommended)", ok: /[^a-zA-Z0-9]/.test(v), optional: true },
  ];
}

function strengthOf(value) {
  const checks = passwordChecks(value);
  const passed = checks.filter((c) => c.ok).length;
  if (!value) return { score: 0, label: "", tone: "var(--border-3)" };
  if (passed <= 2) return { score: 1, label: "Weak", tone: "var(--red-solid, #dc2626)" };
  if (passed === 3) return { score: 2, label: "Fair", tone: "#d97706" };
  if (passed === 4) return { score: 3, label: "Good", tone: "#0284c7" };
  return { score: 4, label: "Strong", tone: "var(--green-solid, #16a34a)" };
}

function PasswordField({
  value,
  onChange,
  label = "Password",
  hint,
  optional = false,
  confirmValue,
  onConfirmChange,
}) {
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const checks = useMemo(() => passwordChecks(value), [value]);
  const strength = useMemo(() => strengthOf(value), [value]);
  const showFeedback = !!value || !optional;
  const mismatch = onConfirmChange && value && confirmValue && value !== confirmValue;

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const regenerate = () => {
    const next = generatePassword();
    onChange(next);
    if (onConfirmChange) onConfirmChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </label>
        <button
          type="button"
          onClick={regenerate}
          className="text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ color: "var(--blue-text)" }}
        >
          ⚡ Generate strong password
        </button>
      </div>

      <div className="relative flex items-center">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={optional ? "Leave blank to keep existing password" : "Enter password"}
          style={{ fontFamily: visible ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit", paddingRight: 72 }}
        />
        <div className="absolute right-2 flex items-center gap-1 text-xs">
          {value && (
            <button
              type="button"
              onClick={copy}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-slate-100"
              style={{ color: "var(--text-muted)" }}
              title="Copy password"
            >
              {copied ? "✅ Copied" : "📋 Copy"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="rounded px-1 py-0.5 text-slate-500 hover:text-slate-800"
            title={visible ? "Hide password" : "Show password"}
          >
            {visible ? "🙈" : "👁️"}
          </button>
        </div>
      </div>

      {onConfirmChange && (
        <div className="space-y-1">
          <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Confirm Password
          </label>
          <Input
          type={visible ? "text" : "password"}
          value={confirmValue || ""}
          onChange={(e) => onConfirmChange(e.target.value)}
          placeholder="Type it again to confirm"
          style={{ fontFamily: visible ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit" }}
          />
          {mismatch && (
            <p className="text-xs" style={{ color: "var(--red-text)" }}>
              Passwords do not match.
            </p>
          )}
        </div>
      )}

      {showFeedback && (
        <>
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: "var(--text-muted)" }}>Strength</span>
              <span className="font-semibold" style={{ color: strength.tone }}>
                {strength.label || "None"}
              </span>
            </div>
            <div className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
              {[1, 2, 3, 4].map((step) => (
                <div
                  key={step}
                  className="flex-1 transition-all duration-200"
                  style={{
                    background: strength.score >= step ? strength.tone : "transparent",
                    borderRadius: 9999,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {checks.map((c) => (
              <span
                key={c.key}
                className="flex items-center gap-1 text-xs"
                style={{ color: c.ok ? "var(--green-text)" : "var(--text-muted)" }}
              >
                <span className="text-[11px]">{c.ok ? "✅" : "⚪"}</span>
                {c.label}
              </span>
            ))}
          </div>
        </>
      )}

      {hint && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

function PasswordCell({ value }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  if (!value) {
    return (
      <span className="text-xs" style={{ color: "var(--text-subtle)" }} title="Set before passwords were recoverable — reset it to see the value.">
        password not recoverable
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <code
        className="rounded px-1.5 py-0.5 text-xs"
        style={{
          background: "var(--surface-2)", border: "1px solid var(--border-3)",
          color: shown ? "var(--text-primary)" : "var(--text-muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          letterSpacing: shown ? 0 : "0.12em",
        }}
      >
        {shown ? value : "•".repeat(Math.min(value.length, 12))}
      </code>
      <button type="button" onClick={() => setShown((v) => !v)} className="p-0.5 text-xs transition-opacity hover:opacity-70"
        title={shown ? "Hide password" : "Show password"} aria-label={shown ? "Hide password" : "Show password"}>
        {shown ? "🙈" : "👁️"}
      </button>
      <button type="button" onClick={copy} className="p-0.5 text-xs transition-opacity hover:opacity-70" title="Copy password" aria-label="Copy password">
        {copied ? "✅" : "📋"}
      </button>
    </span>
  );
}

function usePortalUsers() {
  const [state, setState] = useState({ data: undefined, isLoading: true, isError: false });
  const load = () => {
    setState((s) => ({ ...s, isLoading: true, isError: false }));
    api.get("payroll/portal-users/")
      .then((res) => setState({ data: res.data, isLoading: false, isError: false }))
      .catch(() => setState({ data: undefined, isLoading: false, isError: true }));
  };
  useEffect(load, []);
  return { ...state, refetch: load };
}

const EMPTY_FORM = {
  email: "", client: "", role: "editor", password: "", password_confirm: "",
  is_active: true, must_change_password: true,
};

function PortalUserModal({ user, clients, lockedClientId, onClose, onSaved }) {
  const [form, setForm] = useState(
    user
      ? {
        email: user.email || "",
        client: String(user.client || ""),
        role: user.role || "editor",
        password: "",
        password_confirm: "",
        is_active: user.is_active !== false,
        must_change_password: user.must_change_password !== false,
      }
      : {
        ...EMPTY_FORM,
        client: lockedClientId ? String(lockedClientId) : "",
      },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.email.trim()) { setError("Email is required."); return; }
    if (!form.client) { setError("A client must be selected."); return; }
    if (!user && !form.password) { setError("A password is required for a new portal user."); return; }
    if (form.password) {
      const failed = passwordChecks(form.password).filter((c) => !c.ok && !c.optional);
      if (failed.length) { setError(`Password is too weak — ${failed[0].label.toLowerCase()}.`); return; }
      if (form.password !== form.password_confirm) { setError("Passwords do not match."); return; }
    }
    setError(""); setSaving(true);
    const body = {
      email: form.email.trim().toLowerCase(),
      client: Number(form.client),
      role: form.role,
      is_active: form.is_active,
      must_change_password: form.must_change_password,
    };
    if (form.password) body.password = form.password;
    try {
      if (user) await api.patch(`payroll/portal-users/${user.id}/`, body);
      else await api.post("payroll/portal-users/", body);
      onSaved();
    } catch (err) {
      setError(
        typeof err?.response?.data === "string"
          ? err.response.data
          : err?.response?.data?.password?.[0]
          || err?.response?.data?.email?.[0]
          || "Failed to save portal user.",
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (label, node) => (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{label}</label>
      {node}
    </div>
  );

  const selectedClient = clients.find((c) => String(c.id) === String(form.client));
  const title = (
    <span className="flex items-center gap-3">
      <ClientLogo name={selectedClient?.name} logo={selectedClient?.logo || user?.client_logo} size={34} />
      <span>
        <span className="block text-base font-semibold" style={{ color: "var(--text-strong)" }}>
          {user ? "Edit Portal User" : "New Portal User"}
        </span>
        <span className="block text-xs font-normal" style={{ color: "var(--text-muted)" }}>
          {selectedClient?.name || user?.client_name || "Pick the client this login belongs to"}
        </span>
      </span>
    </span>
  );

  return (
    <Modal title={title} onClose={onClose} size="m">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {field("Email", (
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="hr@client.com" />
          ))}
          {field("Client", (
            <select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)", color: "var(--text-primary)" }}
            >
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ))}
          {field("Role", (
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)", color: "var(--text-primary)" }}
            >
              <option value="editor">Editor</option>
              <option value="client_admin">Client Admin</option>
            </select>
          ))}
        </div>

        {user && (
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Current Password
            </label>
            <div
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-3)" }}
            >
              <PasswordCell value={user.password_plain} />
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {user.password_plain
                ? "This is the password the client logs in with today."
                : "This login was created before passwords were recoverable — set a new one below to make it visible."}
            </p>
          </div>
        )}

        <PasswordField
          label={user ? "Reset Password (leave blank to keep the current one)" : "Password"}
          value={form.password}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          confirmValue={form.password_confirm}
          onConfirmChange={(v) => setForm((f) => ({ ...f, password_confirm: v }))}
          optional={!!user}
          hint="Share this with the client securely. They will be asked to change it on first login if the option below is ticked."
        />

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.must_change_password} onChange={(e) => setForm((f) => ({ ...f, must_change_password: e.target.checked }))} />
            Must change password on next login
          </label>
        </div>

        {error && <p className="text-xs" style={{ color: "var(--red-text)" }}>{error}</p>}

        <div className="flex justify-end gap-2 pt-1" style={{ borderTop: "1px solid var(--border-1)" }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>✖ Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : user ? "💾 Save Changes" : "➕ Create User"}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function PortalUsersView({ embedded = false, lockedClientId = null } = {}) {
  const { data: users, isLoading, isError, refetch } = usePortalUsers();
  const clientsQuery = useClients();
  const clients = Array.isArray(clientsQuery.data) ? clientsQuery.data : clientsQuery.data?.results || [];
  const rawList = Array.isArray(users) ? users : users?.results || [];
  const list = lockedClientId
    ? rawList.filter((u) => Number(u.client) === Number(lockedClientId))
    : rawList;
  const clientById = Object.fromEntries(clients.map((c) => [String(c.id), c]));
  const [modal, setModal] = useState(undefined);
  const [busyId, setBusyId] = useState(null);

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

  const toggleActive = async (u) => {
    setBusyId(u.id);
    try {
      await api.patch(`payroll/portal-users/${u.id}/`, { is_active: u.is_active === false });
      refetch();
    } catch { /* surface nothing; refetch shows truth */ }
    finally { setBusyId(null); }
  };

  const remove = (u) => {
    setDialogConfig({
      isOpen: true,
      type: "confirm",
      variant: "danger",
      title: "Delete Portal User",
      message: `Delete client portal login credentials for ${u.email}? The client user will no longer be able to log in.`,
      confirmText: "Delete Login",
      cancelText: "Cancel",
      onConfirm: async () => {
        closeDialog();
        setBusyId(u.id);
        try {
          await api.delete(`payroll/portal-users/${u.id}/`);
          refetch();
        } catch { /* noop */ }
        finally { setBusyId(null); }
      },
    });
  };

  return (
    <div className={`payroll-scope ${embedded ? "" : "space-y-4"}`}>
      <div className="flex items-center justify-between pb-3" style={{ borderBottom: "1px solid var(--border-2)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          Showing {list.length} portal user{list.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" onClick={() => setModal(null)}>➕ New Portal User</Button>
      </div>

      {isLoading ? null : isError ? (
        <ErrorState message="Failed to load portal users." onRetry={refetch} />
      ) : list.length === 0 ? (
        <Card className="p-5">
          <EmptyState emoji="🔑" message="No portal users yet. Create the first login for a client." />
        </Card>
      ) : (
        <Card className="divide-y" style={{ borderColor: "var(--border-3)" }}>
          {list.map((u) => (
            <div key={u.id} className="flex items-center gap-4 px-4 py-3">
              <ClientLogo
                name={u.client_name || clientById[String(u.client)]?.name}
                logo={u.client_logo || clientById[String(u.client)]?.logo}
                size={42}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>{u.email}</span>
                  <Badge tone={u.is_active === false ? "red" : "slate"}>
                    {u.is_active === false ? "🔴 Inactive" : "🟢 Active"}
                  </Badge>
                  <Badge tone={ROLE_TONES[u.role] || "slate"}>
                    {u.role === "client_admin" ? "👑 Client Admin" : "✏️ Editor"}
                  </Badge>
                  {u.must_change_password && <Badge tone="amber">🔑 Password reset pending</Badge>}
                </div>
                <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {u.client_name || `Client #${u.client}`}
                  {u.last_login ? ` · last login ${new Date(u.last_login).toLocaleDateString()}` : " · never logged in"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs" style={{ color: "var(--text-subtle)" }}>Password</span>
                  <PasswordCell value={u.password_plain} />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="secondary" disabled={busyId === u.id} onClick={() => setModal(u)}>
                  ✏️ Edit
                </Button>
                <Button size="sm" variant="secondary" disabled={busyId === u.id} onClick={() => toggleActive(u)}>
                  {u.is_active === false ? "⚡ Activate" : "⏸️ Deactivate"}
                </Button>
                <Button size="sm" variant="secondary" disabled={busyId === u.id} onClick={() => remove(u)} style={{ color: "var(--red-text)" }}>
                  🗑️ Delete
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {modal !== undefined && (
        <PortalUserModal
          user={modal}
          clients={clients}
          lockedClientId={lockedClientId}
          onClose={() => setModal(undefined)}
          onSaved={() => { setModal(undefined); refetch(); }}
        />
      )}

      <PayrollDialog {...dialogConfig} onCancel={closeDialog} />
    </div>
  );
}




/* ==========================================================================
   PART 4: UNIFIED PORTAL ADMIN HUB (Consolidated from PortalAdmin)
   Manages client portal access credentials for client HR managers.
   ========================================================================== */

export function PortalAdmin({ embedded = false, lockedClientId = null, onBack } = {}) {
  const navigate = useNavigate();

  if (embedded) {
    return <PortalUsersView embedded lockedClientId={lockedClientId} />;
  }

  return (
    <div className="payroll-scope p-4 space-y-6">
      {/* ── Breadcrumb ── */}
      <Breadcrumb
        items={[
          { label: "🏦 Payroll", onClick: () => navigate("/payroll") },
          { label: "Client Master", onClick: onBack || (() => navigate("/payroll/workspace")) },
          { label: "Client Portal Users" },
        ]}
      />

      {/* ── Page Hero ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHero
          eyebrow="Client Portal Hub"
          title="Portal Users & Passwords"
          subtitle="Manage client portal access credentials and security settings for client HR managers."
        />
        {onBack && (
          <Button size="sm" variant="secondary" onClick={onBack}>
            ← Back to Workspace Overview
          </Button>
        )}
      </div>

      <PortalUsersView />
    </div>
  );
}

export default function PayrollWorkspace({ initialView = "overview" } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") || initialView || "overview";
  const [clientView, setClientView] = useState("grid");
  const navigate = useNavigate();

  const clientsQuery = useClients();
  const allClients = Array.isArray(clientsQuery.data) ? clientsQuery.data : clientsQuery.data?.results || [];
  const isActivePayrollClient = (c) =>
    c.is_effectively_active !== undefined
      ? c.is_effectively_active === true
      : c.is_active === true;
  const clients = allClients.filter(isActivePayrollClient);
  const [clientSearch, setClientSearch] = useState("");
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.pan || "").toLowerCase().includes(q) ||
        (c.tan || "").toLowerCase().includes(q) ||
        (c.gstin || "").toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const batchesQuery = useBatches({});
  const batches = batchesQuery.data?.results ?? batchesQuery.data ?? [];

  useEffect(() => {
    if (view === "portal-submissions") {
      navigate("/payroll/jobs", { replace: true });
    }
  }, [view, navigate]);

  const openClientsDirectory = (status = "all") => {
    const p = new URLSearchParams(searchParams);
    p.set("view", "clients");
    if (status !== "all") p.set("status", status);
    else p.delete("status");
    setSearchParams(p);
  };

  const backToOverview = () => {
    const p = new URLSearchParams(searchParams);
    p.delete("view");
    p.delete("status");
    setSearchParams(p);
  };

  const openPortalUsers = () => {
    const p = new URLSearchParams(searchParams);
    p.set("view", "portal-users");
    setSearchParams(p);
  };

  return (
    <div className="payroll-scope p-4 flex min-h-full flex-col gap-4" style={{ fontFamily: WS_FONT, background: BG }}>
      {view === "clients" ? (
        <FirmDetailsView onBack={backToOverview} batches={batches} />
      ) : view === "portal-users" || view === "portal" ? (
        <div className="space-y-4">
          <div className="w-fit self-start">
            <JobBreadcrumb
              steps={[
                { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
                { label: "Monthly Payroll", onClick: () => navigate("/payroll") },
                { label: "Client Master", onClick: backToOverview },
                { label: "Client Portal Users" },
              ]}
            />
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 pb-3"
            style={{
              background: WH,
              border: `1px solid ${BRD}`,
              borderRadius: 12,
              padding: "14px 20px",
            }}
          >
            <div>
              <h2 className="text-base font-bold" style={{ color: INK }}>Client Portal Users & Credentials</h2>
              <p className="text-xs" style={{ color: MUT, marginTop: 2, marginBottom: 0 }}>
                Manage client portal access credentials and security settings for client HR managers.
              </p>
            </div>
            <WsBtn size="sm" variant="ghost" onClick={backToOverview}>
              ← Back to Workspace Overview
            </WsBtn>
          </div>

          <PortalUsersView />
        </div>
      ) : (
        <>
          <div className="w-fit self-start">
            <JobBreadcrumb
              steps={[
                { label: "Direct Tax", onClick: () => navigate("/direct-tax") },
                { label: "Monthly Payroll", onClick: () => navigate("/payroll") },
                { label: "Client Master Hub" },
              ]}
            />
          </div>

          <div
            style={{
              background: WH,
              border: `1px solid ${BRD}`,
              borderRadius: 12,
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: 0 }}>🏢 CLIENT MASTER HUB</h2>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: PL,
                    color: P,
                  }}
                >
                  {clients.length} Active Clients
                </span>
              </div>
              <p style={{ fontSize: 12, color: MUT, marginTop: 4, marginBottom: 0 }}>
                Central client master: manage client profiles, employee rosters, salary policies, and portal credentials.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <WsBtn size="sm" variant="outline" onClick={openPortalUsers}>
                🔑 Client Portal Logins
              </WsBtn>
            </div>
          </div>

          <div className="h-1" />

          <div className="flex flex-1 flex-col gap-4">
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <span>🏢</span> Active Clients
                  </h3>
                  {clientSearch.trim() ? (
                    <span className="text-xs text-slate-500 font-medium">
                      ({filteredClients.length} of {clients.length})
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 font-medium">
                      ({clients.length})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative w-56 sm:w-64">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
                    <input
                      type="text"
                      placeholder="Search clients by name, PAN, GST..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg transition-colors focus:outline-none bg-white border border-slate-300 text-slate-800 focus:ring-2 focus:ring-blue-500/20"
                    />
                    {clientSearch && (
                      <button
                        type="button"
                        onClick={() => setClientSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs hover:opacity-80 text-slate-400 cursor-pointer"
                        title="Clear search"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {clients.length > 0 && (
                    <div
                      className="flex items-center gap-0.5 rounded-lg p-0.5 bg-slate-100 border border-slate-200"
                    >
                      <button
                        onClick={() => setClientView("grid")}
                        title="Grid view"
                        className={`flex items-center justify-center rounded-md p-1.5 text-xs font-semibold transition-all ${clientView === "grid" ? "bg-white text-blue-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                          }`}
                      >
                        <LayoutGrid size={13} />
                      </button>
                      <button
                        onClick={() => setClientView("list")}
                        title="List view"
                        className={`flex items-center justify-center rounded-md p-1.5 text-xs font-semibold transition-all ${clientView === "list" ? "bg-white text-blue-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                          }`}
                      >
                        <List size={13} />
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => openClientsDirectory("all")}
                    className="flex items-center gap-1 text-xs font-bold transition-opacity hover:opacity-80 text-blue-700 cursor-pointer"
                  >
                    <span>🏛️</span> Manage All Clients ➔
                  </button>
                </div>
              </div>

              {clientsQuery.isLoading || batchesQuery.isLoading ? null : clientsQuery.isError ? (
                <ErrorState message="Failed to load clients." onRetry={clientsQuery.refetch} />
              ) : clients.length === 0 ? (
                <Card className="p-6">
                  <EmptyState
                    emoji="🏢"
                    message="No clients running payroll yet — open Manage all to switch payroll on for a client."
                  />
                </Card>
              ) : filteredClients.length === 0 ? (
                <Card className="p-6 text-center">
                  <EmptyState
                    emoji="🔍"
                    message={`No clients found matching "${clientSearch}".`}
                  />
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => setClientSearch("")}>
                      Clear Search
                    </Button>
                  </div>
                </Card>
              ) : clientView === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {filteredClients.map((client) => (
                    <ClientCard
                      key={client.id}
                      client={client}
                      batches={batches}
                      onOpen={(c) => navigate(`/payroll/clients/${c.id}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col rounded-xl px-3" style={{ background: "var(--surface-1)", border: "1px solid var(--border-3)" }}>
                  {filteredClients.map((client, i) => (
                    <ClientListRow
                      key={client.id}
                      client={client}
                      batches={batches}
                      onOpen={(c) => navigate(`/payroll/clients/${c.id}`)}
                      isLast={i === filteredClients.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export {
  PortalUsersView as PortalUsers,
  FirmDetailsView as FirmDetails,
};