import { useEffect, useState } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api, getToken, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { CURRENCIES, CURRENCY_SYMBOL } from "../lib/currency";

// ---------- Типы ----------

type Tab = "summary" | "by-employee" | "by-category" | "balances";
type Preset = "today" | "week" | "month" | "quarter" | "custom";

type Filters = {
  preset: Preset;
  from: string;        // YYYY-MM-DD
  to: string;          // YYYY-MM-DD
  employee_id: string; // "" = все
  category: string;    // "" = все
  currency: string;    // KGS / USD / EUR / RUB
};

type EmployeeOpt = { id: number; name: string };
type CategoryOpt = { id: number; name: string };

type SummaryResp = {
  currency?: string;
  issued_total: string | number;
  spent_total: string | number;
  balance: string | number;
  pending_total: string | number;
  by_day: { date: string; issued: string | number; spent: string | number }[];
};

type ByEmployeeRow = {
  employee_id: number;
  employee_name: string;
  issued: string | number;
  spent: string | number;
  balance: string | number;
  pending: string | number;
};
type ExpenseDetail = {
  id: number;
  spent_at: string;
  category_name: string | null;
  amount: string | number;
  description: string | null;
  status: "pending" | "approved" | "rejected" | string;
  receipt_url: string | null;
};
type ByEmployeeResp = { rows: ByEmployeeRow[]; details: ExpenseDetail[] | null };

type ByCategoryRow = {
  category_id: number | null;
  category_name: string;
  operations: number;
  amount: string | number;
  percent: number;
};
type ByCategoryResp = { rows: ByCategoryRow[]; total_amount: string | number };

type BalanceRow = {
  employee_id: number;
  employee_name: string;
  issued_total: string | number;
  spent_total: string | number;
  balance: string | number;
  monthly_limit: string | number;
};
type BalancesResp = { rows: BalanceRow[] };

// ---------- Хелперы ----------

const COLORS = [
  "#6c5ce7", "#00b894", "#fdcb6e", "#e17055", "#0984e3",
  "#a29bfe", "#55efc4", "#ffeaa7", "#fab1a0", "#74b9ff",
];

function fmt(n: string | number): string {
  return Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function isoDate(d: Date): string {
  // Локальная дата (не UTC) — иначе в зонах +N утром получаем вчерашнюю дату.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function presetToRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = isoDate(today);
  if (p === "today") return { from: to, to };
  if (p === "week") {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    return { from: isoDate(d), to };
  }
  if (p === "month") {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(d), to };
  }
  if (p === "quarter") {
    const q = Math.floor(today.getMonth() / 3);
    const d = new Date(today.getFullYear(), q * 3, 1);
    return { from: isoDate(d), to };
  }
  return { from: "", to: "" };
}

function buildQs(f: Filters, opts: { skipDates?: boolean; skipCategory?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (!opts.skipDates && f.from) q.set("from", f.from);
  if (!opts.skipDates && f.to) q.set("to", f.to);
  if (f.employee_id) q.set("employee_id", f.employee_id);
  if (!opts.skipCategory && f.category) q.set("category", f.category);
  if (f.currency) q.set("currency", f.currency);
  const s = q.toString();
  return s ? "?" + s : "";
}

// ---------- Главный компонент ----------

export default function Reports() {
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("summary");
  const [filters, setFilters] = useState<Filters>({
    preset: "month",
    ...presetToRange("month"),
    employee_id: "",
    category: "",
    currency: "KGS",
  });
  const [draft, setDraft] = useState<Filters>(filters);

  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);

  // Данные секций
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [byEmp, setByEmp] = useState<ByEmployeeResp | null>(null);
  const [byCat, setByCat] = useState<ByCategoryResp | null>(null);
  const [balances, setBalances] = useState<BalancesResp | null>(null);

  const [loading, setLoading] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);
  const [empDetails, setEmpDetails] = useState<Record<number, ExpenseDetail[]>>({});

  // Опции для фильтров
  useEffect(() => {
    api<EmployeeOpt[]>("/api/users")
      .then((rows) => setEmployees(rows.map((u) => ({ id: u.id, name: (u as any).name }))))
      .catch(() => {});
    api<CategoryOpt[]>("/api/categories")
      .then((rows) => setCategories(rows.map((c) => ({ id: c.id, name: (c as any).name }))))
      .catch(() => {});
  }, []);

  // Загрузка данных при смене фильтров
  useEffect(() => {
    loadAll(filters);
  }, [filters]);

  async function loadAll(f: Filters) {
    setLoading(true);
    try {
      const tasks: Promise<any>[] = [
        api<SummaryResp>("/api/reports/summary" + buildQs(f)).then(setSummary),
        api<ByEmployeeResp>("/api/reports/by-employee" + buildQs(f)).then(setByEmp),
        api<ByCategoryResp>("/api/reports/by-category" + buildQs(f)).then(setByCat),
        api<BalancesResp>("/api/reports/balances" + buildQs({ ...f, from: "", to: "", category: "" }, { skipDates: true, skipCategory: true })).then(setBalances),
      ];
      await Promise.all(tasks);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Не удалось загрузить отчёты";
      toast.show("error", msg);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    setFilters(draft);
    toast.show("success", "Фильтры применены");
  }
  function resetFilters() {
    const reset: Filters = {
      preset: "month",
      ...presetToRange("month"),
      employee_id: "",
      category: "",
      currency: "KGS",
    };
    setDraft(reset);
    setFilters(reset);
    toast.show("info", "Фильтры сброшены");
  }

  function changePreset(p: Preset) {
    if (p === "custom") {
      setDraft({ ...draft, preset: p });
    } else {
      const r = presetToRange(p);
      setDraft({ ...draft, preset: p, from: r.from, to: r.to });
    }
  }

  function toggleEmpRow(empId: number) {
    if (expandedEmp === empId) {
      setExpandedEmp(null);
      return;
    }
    setExpandedEmp(empId);
    if (!empDetails[empId]) {
      api<ByEmployeeResp>("/api/reports/by-employee" + buildQs({ ...filters, employee_id: String(empId) }))
        .then((r) => setEmpDetails((m) => ({ ...m, [empId]: r.details ?? [] })))
        .catch(() => toast.show("error", "Не удалось загрузить детали"));
    }
  }

  async function downloadExcel() {
    const url = "/api/reports/export" + buildQs(filters);
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `podotchet_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.show("error", e.message || "Скачивание не удалось");
    }
  }

  return (
    <div className="container">
      <h1 className="h1">Отчёты</h1>

      {/* ---- Фильтры ---- */}
      <FilterPanel
        draft={draft}
        setDraft={setDraft}
        employees={employees}
        categories={categories}
        onApply={applyFilters}
        onReset={resetFilters}
        onPreset={changePreset}
        onExport={downloadExcel}
      />

      {/* ---- Табы ---- */}
      <div className="report-tabs">
        <TabBtn cur={tab} val="summary" onClick={setTab}>Итоги</TabBtn>
        <TabBtn cur={tab} val="by-employee" onClick={setTab}>По сотрудникам</TabBtn>
        <TabBtn cur={tab} val="by-category" onClick={setTab}>По категориям</TabBtn>
        <TabBtn cur={tab} val="balances" onClick={setTab}>Остатки</TabBtn>
      </div>

      {/* ---- Контент ---- */}
      {tab === "summary" && <SummarySection data={summary} loading={loading} currency={filters.currency} />}
      {tab === "by-employee" && (
        <ByEmployeeSection
          data={byEmp}
          loading={loading}
          selectedEmpId={filters.employee_id}
          expandedEmp={expandedEmp}
          empDetails={empDetails}
          onToggle={toggleEmpRow}
        />
      )}
      {tab === "by-category" && <ByCategorySection data={byCat} loading={loading} />}
      {tab === "balances" && <BalancesSection data={balances} loading={loading} />}
    </div>
  );
}

// ---------- Подкомпоненты ----------

function TabBtn({ cur, val, onClick, children }: { cur: Tab; val: Tab; onClick: (v: Tab) => void; children: React.ReactNode }) {
  return (
    <button className={`report-tab${cur === val ? " active" : ""}`} onClick={() => onClick(val)}>{children}</button>
  );
}

function FilterPanel(props: {
  draft: Filters;
  setDraft: (f: Filters) => void;
  employees: EmployeeOpt[];
  categories: CategoryOpt[];
  onApply: () => void;
  onReset: () => void;
  onPreset: (p: Preset) => void;
  onExport: () => void;
}) {
  const { draft, setDraft, employees, categories, onApply, onReset, onPreset, onExport } = props;
  const presets: { val: Preset; label: string }[] = [
    { val: "today", label: "Сегодня" },
    { val: "week", label: "Неделя" },
    { val: "month", label: "Месяц" },
    { val: "quarter", label: "Квартал" },
    { val: "custom", label: "Свой" },
  ];

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {presets.map((p) => (
          <button
            key={p.val}
            className={draft.preset === p.val ? "" : "ghost"}
            style={{ padding: "6px 12px", fontSize: 13 }}
            onClick={() => onPreset(p.val)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: "1 1 140px", minWidth: 140 }}>
          <label>С даты</label>
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value, preset: "custom" })}
          />
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 140 }}>
          <label>По дату</label>
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value, preset: "custom" })}
          />
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 200 }}>
          <label>Сотрудник</label>
          <select value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}>
            <option value="">Все</option>
            {employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 200 }}>
          <label>Категория</label>
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="">Все</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 140 }}>
          <label>Валюта</label>
          <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="ghost" onClick={onReset}>Сбросить</button>
        <button onClick={onApply}>Применить</button>
        <button className="success" onClick={onExport}>↓ Excel</button>
      </div>
    </div>
  );
}

// ---- Секция 1: Итоги ----

function SummarySection({ data, loading, currency }: { data: SummaryResp | null; loading: boolean; currency: string }) {
  if (loading && !data) return <SkeletonGrid />;
  if (!data) return <EmptyState text="Нет данных за выбранный период" />;

  const sym = CURRENCY_SYMBOL[currency] || currency;
  const cards = [
    { icon: "💰", label: "Выдано всего", val: data.issued_total },
    { icon: "🧾", label: "Потрачено всего", val: data.spent_total },
    { icon: "💵", label: "Остаток", val: data.balance, accent: true },
    { icon: "⏳", label: "На проверке", val: data.pending_total, warn: true },
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {cards.map((c, i) => (
        <div key={i} className="card">
          <div className="muted" style={{ fontSize: 12 }}>{c.icon} {c.label}</div>
          <div style={{
            fontSize: 22, fontWeight: 700, marginTop: 6,
            color: c.accent ? "var(--accent-light)" : c.warn ? "var(--warning)" : "var(--text)",
          }}>
            {fmt(c.val)} <span className="muted" style={{ fontSize: 13 }}>{sym}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Секция 2: По сотрудникам ----

function ByEmployeeSection(props: {
  data: ByEmployeeResp | null;
  loading: boolean;
  selectedEmpId: string;
  expandedEmp: number | null;
  empDetails: Record<number, ExpenseDetail[]>;
  onToggle: (id: number) => void;
}) {
  const { data, loading, selectedEmpId, expandedEmp, empDetails, onToggle } = props;
  if (loading && !data) return <SkeletonRows />;
  if (!data || data.rows.length === 0) return <EmptyState text="Нет операций за период" />;

  // Если выбран конкретный сотрудник — сразу детальная таблица
  if (selectedEmpId && data.details) {
    const r = data.rows[0];
    return (
      <>
        {r && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{r.employee_name}</div>
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <Stat label="Выдано" v={r.issued} />
              <Stat label="Потрачено" v={r.spent} />
              <Stat label="Остаток" v={r.balance} accent />
              <Stat label="На проверке" v={r.pending} warn />
            </div>
          </div>
        )}
        <DetailsTable rows={data.details} />
      </>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th style={{ textAlign: "right" }}>Выдано</th>
            <th style={{ textAlign: "right" }}>Потрачено</th>
            <th style={{ textAlign: "right" }}>Остаток</th>
            <th style={{ textAlign: "right" }}>На проверке</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <>
              <tr key={r.employee_id}>
                <td>{r.employee_name}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.issued)}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.spent)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(r.balance)}</td>
                <td style={{ textAlign: "right", color: Number(r.pending) > 0 ? "var(--warning)" : "var(--text-muted)" }}>{fmt(r.pending)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => onToggle(r.employee_id)}>
                    {expandedEmp === r.employee_id ? "Скрыть" : "Детали"}
                  </button>
                </td>
              </tr>
              {expandedEmp === r.employee_id && (
                <tr>
                  <td colSpan={6} style={{ padding: 0 }}>
                    <div style={{ background: "rgba(108,92,231,0.04)", padding: 8 }}>
                      <DetailsTable rows={empDetails[r.employee_id] || []} compact />
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailsTable({ rows, compact }: { rows: ExpenseDetail[]; compact?: boolean }) {
  if (rows.length === 0) return <div className="muted" style={{ padding: 12 }}>Нет расходов</div>;
  return (
    <div className={compact ? "" : "card"} style={{ padding: 0, overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Категория</th>
            <th style={{ textAlign: "right" }}>Сумма</th>
            <th>Описание</th>
            <th>Статус</th>
            <th>Чек</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="muted" style={{ fontSize: 12 }}>{new Date(e.spent_at).toLocaleDateString("ru-RU")}</td>
              <td>{e.category_name || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(e.amount)}</td>
              <td className="muted" style={{ fontSize: 13 }}>{e.description || "—"}</td>
              <td><span className={`badge ${e.status}`}>{e.status}</span></td>
              <td>
                {e.receipt_url
                  ? <a href={e.receipt_url} target="_blank" rel="noreferrer" title="Открыть чек">📎</a>
                  : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Секция 3: По категориям ----

function ByCategorySection({ data, loading }: { data: ByCategoryResp | null; loading: boolean }) {
  if (loading && !data) return <SkeletonRows />;
  if (!data || data.rows.length === 0) return <EmptyState text="Нет операций за период" />;

  const pieData = data.rows.map((r, i) => ({
    name: r.category_name,
    value: Number(r.amount),
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Категория</th>
              <th style={{ textAlign: "right" }}>Операций</th>
              <th style={{ textAlign: "right" }}>Сумма</th>
              <th style={{ textAlign: "right" }}>%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={(r.category_id ?? "none") + "-" + i}>
                <td>
                  <span style={{ display: "inline-block", width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 2, marginRight: 6 }} />
                  {r.category_name}
                </td>
                <td style={{ textAlign: "right" }}>{r.operations}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(r.amount)}</td>
                <td style={{ textAlign: "right" }}>{r.percent}%</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: "rgba(108,92,231,0.08)" }}>
              <td>ИТОГО</td>
              <td></td>
              <td style={{ textAlign: "right" }}>{fmt(data.total_amount)}</td>
              <td style={{ textAlign: "right" }}>100%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={100}
                paddingAngle={2}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                formatter={(v: any) => fmt(v) + " сом"}
              />
              <Legend wrapperStyle={{ color: "var(--text-muted)", fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---- Секция 4: Остатки (за всё время) ----

function BalancesSection({ data, loading }: { data: BalancesResp | null; loading: boolean }) {
  if (loading && !data) return <SkeletonRows />;
  if (!data || data.rows.length === 0) return <EmptyState text="Нет данных" />;

  return (
    <div className="card" style={{ padding: 0, overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th style={{ textAlign: "right" }}>Всего выдано</th>
            <th style={{ textAlign: "right" }}>Всего потрачено</th>
            <th style={{ textAlign: "right" }}>Остаток</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const balance = Number(r.balance);
            const limit = Number(r.monthly_limit);
            let bgColor = "transparent";
            if (balance < 0) bgColor = "rgba(225,112,85,0.12)";
            else if (limit > 0 && balance > limit * 0.5) bgColor = "rgba(253,203,110,0.10)";
            return (
              <tr key={r.employee_id} style={{ background: bgColor }}>
                <td>{r.employee_name}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.issued_total)}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.spent_total)}</td>
                <td style={{
                  textAlign: "right", fontWeight: 700,
                  color: balance < 0 ? "var(--danger)" : limit > 0 && balance > limit * 0.5 ? "var(--warning)" : "var(--text)",
                }}>{fmt(balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Утилиты ----

function Stat({ label, v, accent, warn }: { label: string; v: string | number; accent?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{
        fontSize: 17, fontWeight: 700,
        color: accent ? "var(--accent-light)" : warn ? "var(--warning)" : "var(--text)",
      }}>{fmt(v)}</div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {[0, 1, 2, 3].map((i) => <div key={i} className="card"><div className="skeleton" style={{ height: 56 }} /></div>)}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="card">
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 22, marginBottom: 8 }} />)}
    </div>
  );
}

function EmptyState({ text, inline }: { text: string; inline?: boolean }) {
  const inner = (
    <div className="empty-state">
      <div className="icon">📭</div>
      <div>{text}</div>
    </div>
  );
  return inline ? inner : <div className="card">{inner}</div>;
}
