import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { EditExpenseModal } from "../components/EditExpenseModal";
import { isDirectorLevel, useAuth } from "../context/AuthContext";

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

interface Op {
  kind: "expense" | "income" | "topup" | "request";
  id: number; date: string; who: string | null;
  amount: number; currency: string;
  description: string | null; category_name: string | null; source?: string | null;
  is_personal_contribution?: boolean; expense_type?: string; category_id?: number | null;
  status?: string;
}
interface Dept {
  id: number; name: string;
  summary: { received: number; spent: number; result: number; operations_count: number };
  employees: { id: number; name: string; spent: number; received: number }[];
}

const fmt = (n: number) => Number(n).toLocaleString("ru-RU");
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export default function DepartmentDetail() {
  const { id } = useParams();
  const deptId = Number(id);
  const toast = useToast();
  const { user } = useAuth();
  const canReview = isDirectorLevel(user?.role);
  const [sp, setSp] = useSearchParams();
  const today = new Date();
  const year = Number(sp.get("year")) || today.getFullYear();
  const month = Number(sp.get("month")) || today.getMonth() + 1;

  const [dept, setDept] = useState<Dept | null>(null);
  const [ops, setOps] = useState<Op[] | null>(null);
  const [open, setOpen] = useState<string | null>("expenses");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Op | null>(null);
  const [catId, setCatId] = useState<number | "">("");

  function loadDept() {
    api<{ departments: Dept[] }>(`/api/reports/by-department?year=${year}&month=${month}&currency=KGS&_t=${Date.now()}`)
      .then((d) => setDept(d.departments.find((x) => x.id === deptId) || null))
      .catch((e) => toast.show("error", e.message));
  }
  function loadOps() {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const to = `${year}-${String(month).padStart(2, "0")}-${lastDay(year, month)}`;
    api<{ items: Op[] }>(`/api/admin/recent-operations?department_id=${deptId}&date_from=${from}&date_to=${to}&limit=200&_t=${Date.now()}`)
      .then((d) => setOps(d.items)).catch((e) => toast.show("error", e.message));
  }
  useEffect(() => { loadDept(); loadOps(); }, [deptId, year, month]);

  function setPeriod(patch: { year?: number; month?: number }) {
    const next = new URLSearchParams(sp);
    next.set("year", String(patch.year ?? year));
    next.set("month", String(patch.month ?? month));
    setSp(next);
  }
  async function togglePersonal(op: Op, enabled: boolean) {
    setBusyId(op.id);
    try {
      await api(`/api/expenses/${op.id}/personal-contribution`, { method: "POST", body: { enabled } });
      toast.show("success", enabled ? "Отмечено как личный вклад" : "Метка снята");
      loadOps(); loadDept();
    } catch (e: any) { toast.show("error", e.message); }
    finally { setBusyId(null); }
  }
  async function review(op: Op, status: "approved" | "rejected") {
    if (status === "rejected" && !confirm("Отклонить расход?")) return;
    setBusyId(op.id);
    try {
      await api(`/api/expenses/${op.id}/review`, { method: "POST", body: { status, review_comment: null } });
      toast.show("success", status === "approved" ? "Принято" : "Отклонено");
      loadOps(); loadDept();
    } catch (e: any) { toast.show("error", e.message); }
    finally { setBusyId(null); }
  }

  const incomeOps = (ops || []).filter((o) => o.kind === "topup" || o.kind === "income");
  const allExpenseOps = (ops || []).filter((o) => o.kind === "expense");
  // Категории, встречающиеся в расходах подразделения (для фильтра).
  const catOptions = Array.from(
    new Map(allExpenseOps.filter((o) => o.category_id != null)
      .map((o) => [o.category_id as number, o.category_name || "—"])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const expenseOps = catId === "" ? allExpenseOps : allExpenseOps.filter((o) => o.category_id === catId);
  const expenseFilteredSum = expenseOps.reduce((s, o) => s + Number(o.amount), 0);
  const sym = "с";

  function Card({ k, title, value, color }: { k: string; title: string; value: number; color: string }) {
    const isOpen = open === k;
    return (
      <div className="card" style={{ cursor: "pointer", borderColor: isOpen ? "var(--accent)" : undefined }}
        onClick={() => setOpen(isOpen ? null : k)}>
        <div className="muted" style={{ fontSize: 12 }}>{title} {isOpen ? "▲" : "▼"}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color }}>{value >= 0 ? "" : ""}{fmt(value)} {sym}</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 className="h1" style={{ margin: 0 }}>{dept?.name || "Подразделение"}</h1>
        <Link className="ghost" to="/reports/departments" style={{ padding: "6px 12px" }}>← К подразделениям</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label>Месяц</label>
            <select value={month} onChange={(e) => setPeriod({ month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select></div>
          <div><label>Год</label>
            <input type="number" value={year} onChange={(e) => setPeriod({ year: Number(e.target.value) })} style={{ width: 90 }} /></div>
          <div style={{ minWidth: 220 }}><label>Категория (расходы)</label>
            <select value={catId} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Все категории</option>
              {catOptions.map(([cid, name]) => <option key={cid} value={cid}>{name}</option>)}
            </select></div>
        </div>
      </div>

      {!dept ? <div className="muted">Загрузка...</div> : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
          <Card k="incomes" title="Приходы" value={dept.summary.received} color="var(--success)" />
          <Card k="expenses" title="Расходы" value={dept.summary.spent} color="var(--danger)" />
          <Card k="employees" title="Сотрудники" value={dept.summary.result} color={dept.summary.result >= 0 ? "var(--success)" : "var(--danger)"} />
        </div>
      )}

      {open === "incomes" && (
        <div className="card"><div style={{ fontWeight: 600, marginBottom: 8 }}>Приходы и выдачи</div>
          <OpsTable ops={incomeOps} sym={sym} />
        </div>
      )}
      {open === "expenses" && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Расходы{catId !== "" ? " — фильтр по категории" : ""}</span>
            {catId !== "" && (
              <span className="muted">Итого по категории: <b style={{ color: "var(--danger)" }}>{fmt(expenseFilteredSum)} {sym}</b> · {expenseOps.length} опер.</span>
            )}
          </div>
          {ops === null ? <div className="muted">Загрузка...</div> : expenseOps.length === 0 ? <div className="muted">Нет расходов</div> : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%" }}>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Дата</th><th style={{ textAlign: "left" }}>Категория</th>
                  <th style={{ textAlign: "left" }}>Кто</th><th style={{ textAlign: "right" }}>Сумма</th>
                  <th style={{ textAlign: "left" }}>Описание</th><th></th>
                </tr></thead>
                <tbody>
                  {expenseOps.map((op) => (
                    <tr key={op.id}>
                      <td>{new Date(op.date).toLocaleDateString("ru-RU")}</td>
                      <td>{op.category_name || "—"}</td>
                      <td>{op.who || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "var(--danger)" }}>−{fmt(op.amount)} {op.currency === "KGS" ? sym : op.currency}</td>
                      <td style={{ maxWidth: 220 }}>{op.description || "—"}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {op.expense_type !== "transfer" && (
                          <>
                            {op.status === "pending" && (
                              <span className="muted" style={{ fontSize: 11, marginRight: 6 }}>на проверке</span>
                            )}
                            {canReview && op.status === "pending" && (
                              <>
                                <button type="button" className="success" style={{ padding: "2px 8px", marginRight: 4 }}
                                  disabled={busyId === op.id} onClick={() => review(op, "approved")}>✓</button>
                                <button type="button" className="danger" style={{ padding: "2px 8px", marginRight: 6 }}
                                  disabled={busyId === op.id} onClick={() => review(op, "rejected")}>✗</button>
                              </>
                            )}
                            <button type="button" className="ghost" style={{ padding: "2px 8px", marginRight: 6 }} onClick={() => setEditing(op)}>Изм.</button>
                            <label title="Расход из личных средств в счёт подразделения" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                              <input type="checkbox" checked={!!op.is_personal_contribution} disabled={busyId === op.id}
                                onChange={(e) => togglePersonal(op, e.target.checked)} style={{ width: "auto", margin: 0 }} />
                              из личных
                            </label>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {open === "employees" && dept && (
        <div className="card"><div style={{ fontWeight: 600, marginBottom: 8 }}>Сотрудники</div>
          <table style={{ width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left" }}>Имя</th><th style={{ textAlign: "right" }}>Получил</th><th style={{ textAlign: "right" }}>Потратил</th></tr></thead>
            <tbody>
              {dept.employees.length === 0 && <tr><td colSpan={3} className="muted">Нет сотрудников</td></tr>}
              {dept.employees.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/reports/employees/${e.id}?month=${month}&year=${year}`}>{e.name}</Link></td>
                  <td style={{ textAlign: "right" }}>{fmt(e.received)} {sym}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(e.spent)} {sym}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditExpenseModal
          expense={{ id: editing.id, amount: editing.amount, currency: editing.currency, category_id: editing.category_id ?? null, description: editing.description ?? null, spent_at: editing.date }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadOps(); loadDept(); }}
        />
      )}
    </div>
  );
}

function OpsTable({ ops, sym }: { ops: Op[]; sym: string }) {
  if (ops.length === 0) return <div className="muted">Нет операций</div>;
  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%" }}>
        <thead><tr>
          <th style={{ textAlign: "left" }}>Дата</th><th style={{ textAlign: "left" }}>Тип</th>
          <th style={{ textAlign: "left" }}>Категория / источник</th><th style={{ textAlign: "left" }}>Кто</th>
          <th style={{ textAlign: "right" }}>Сумма</th><th style={{ textAlign: "left" }}>Описание</th>
        </tr></thead>
        <tbody>
          {ops.map((op) => (
            <tr key={`${op.kind}-${op.id}`}>
              <td>{new Date(op.date).toLocaleDateString("ru-RU")}</td>
              <td>{op.kind === "topup" ? "Выдача" : "Приход"}</td>
              <td>{op.category_name || op.source || "—"}</td>
              <td>{op.who || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600, color: "var(--success)" }}>+{fmt(op.amount)} {op.currency === "KGS" ? sym : op.currency}</td>
              <td style={{ maxWidth: 220 }}>{op.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
