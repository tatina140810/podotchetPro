import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { ReceiptLink } from "../components/ReceiptPreview";
import { useToast } from "../components/Toast";
import { isDirectorLevel, useAuth } from "../context/AuthContext";
import { listTransfers, type MoneyTransfer } from "../api/transfers";
import { getCurrentRate } from "../api/exchange";
import { formatAmountWithEquivalent } from "../lib/format-currency";
import { NewExpenseForm } from "../components/NewExpenseForm";
import { EditExpenseModal } from "../components/EditExpenseModal";
import { ExpenseDetailModal } from "../components/ExpenseDetailModal";
import { IncomeModal } from "./Dashboard";

type FeedRow =
  | { kind: "expense"; date: string; data: any }
  | { kind: "transfer"; date: string; data: MoneyTransfer };

export default function Expenses() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [list, setList] = useState<any[] | null>(null);
  const [transfers, setTransfers] = useState<MoneyTransfer[]>([]);
  const [usdKgs, setUsdKgs] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const canReview = isDirectorLevel(user?.role);
  const canVerify = user?.role === "admin" || user?.role === "auditor" || user?.role === "superadmin";
  const canEdit = user?.role === "admin" || user?.role === "superadmin";
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [viewingExpense, setViewingExpense] = useState<any>(null);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const canRecordIncome = isDirectorLevel(user?.role);
  const [filter, setFilter] = useState({
    status: params.get("status") || "",
    employee_id: "",
    category_id: "",
    date_from: "",
    date_to: "",
  });
  const [employees, setEmployees] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);

  function buildQuery() {
    const q = new URLSearchParams();
    if (filter.status) q.set("status", filter.status);
    if (filter.employee_id) q.set("employee_id", filter.employee_id);
    if (filter.category_id) q.set("category_id", filter.category_id);
    if (filter.date_from) q.set("date_from", new Date(filter.date_from).toISOString());
    if (filter.date_to) {
      // включаем сам день "по": до конца дня (00:00 следующего)
      const d = new Date(filter.date_to);
      d.setDate(d.getDate() + 1);
      q.set("date_to", d.toISOString());
    }
    return q.toString();
  }

  const load = () => {
    api(`/api/expenses?${buildQuery()}`).then((d: any) => setList(d));
    // Передачи не имеют фильтров по статусу/категории/сотруднику в этом UI —
    // подгружаем все и фильтруем по дате локально.
    listTransfers().then(setTransfers).catch(() => {});
  };

  useEffect(() => {
    api("/api/users").then(setEmployees);
    api("/api/categories").then(setCats);
    getCurrentRate("USD", "KGS").then((r) => setUsdKgs(r.rate ? Number(r.rate) : null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [filter.status, filter.employee_id, filter.category_id, filter.date_from, filter.date_to]);

  function reset() {
    setFilter({ status: "", employee_id: "", category_id: "", date_from: "", date_to: "" });
    setParams({});
  }

  async function onExport() {
    setExporting(true);
    try {
      const qs = buildQuery();
      const url = qs ? `/api/expenses/export.xlsx?${qs}` : "/api/expenses/export.xlsx";
      await downloadFile(url, "expenses.xlsx");
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать файл");
    } finally {
      setExporting(false);
    }
  }

  async function review(id: number, status: "approved" | "rejected") {
    let comment = "";
    if (status === "rejected") {
      comment = prompt("Причина отклонения?") || "";
      if (!comment) return;
    }
    try {
      await api(`/api/expenses/${id}/review`, { method: "POST", body: { status, review_comment: comment || null } });
      toast.show("success", status === "approved" ? "Принято" : "Отклонено");
      load();
    } catch (e: any) { toast.show("error", e.message); }
  }

  async function verify(id: number) {
    try {
      await api(`/api/expenses/${id}/verify`, { method: "POST" });
      toast.show("success", "Верифицировано");
      load();
    } catch (e: any) { toast.show("error", e.message); }
  }

  async function onDeleteExpense(e: any) {
    if (!confirm(
      `Удалить расход ${Number(e.amount).toLocaleString("ru-RU")} ${e.currency}` +
      `${e.description ? ` («${e.description.slice(0, 40)}»)` : ""}?\n\n` +
      `Баланс ${e.employee_name} вернётся к прежнему значению. Действие необратимо.`
    )) return;
    try {
      await api(`/api/expenses/${e.id}`, { method: "DELETE" });
      toast.show("success", "Расход удалён");
      load();
    } catch (err: any) { toast.show("error", err.message); }
  }

  // map id → name для отображения "верифицировал X"
  const employeeNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of employees) m.set(u.id, u.name);
    return m;
  }, [employees]);

  // Смешанная лента: Expense + MoneyTransfer, отсортировано по дате.
  // Transfer фильтруется только по диапазону дат (статус/категория/сотрудник к нему не применимы);
  // фильтр по сотруднику для transfer — если выбран employee_id, показывать только те где он from или to.
  const feed = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];
    for (const e of list || []) {
      rows.push({ kind: "expense", date: e.spent_at, data: e });
    }
    // Transfer-ы скрываем если применён фильтр статуса или категории (для них таких полей нет)
    if (!filter.status && !filter.category_id) {
      const fromDt = filter.date_from ? new Date(filter.date_from) : null;
      const toDt = filter.date_to ? (() => { const d = new Date(filter.date_to); d.setDate(d.getDate() + 1); return d; })() : null;
      const empId = filter.employee_id ? Number(filter.employee_id) : null;
      for (const t of transfers) {
        const td = new Date(t.created_at);
        if (fromDt && td < fromDt) continue;
        if (toDt && td >= toDt) continue;
        if (empId && t.from_user_id !== empId && t.to_user_id !== empId) continue;
        rows.push({ kind: "transfer", date: t.created_at, data: t });
      }
    }
    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return rows;
  }, [list, transfers, filter.status, filter.category_id, filter.date_from, filter.date_to, filter.employee_id]);

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Расходы</h1>
        <div className="row" style={{ gap: 8 }}>
          {canRecordIncome && (
            <button type="button" onClick={() => setShowIncomeModal(true)}>+ Приход</button>
          )}
          <button type="button" onClick={onExport} disabled={exporting || !list || list.length === 0} style={{ background: "#107C41", color: "#fff" }}>
            {exporting ? "Готовлю…" : "Excel"}
          </button>
        </div>
      </div>

      {showIncomeModal && (
        <IncomeModal
          onClose={() => setShowIncomeModal(false)}
          onSaved={() => { setShowIncomeModal(false); load(); }}
        />
      )}

      {/* Форма сверху — расход / передача / приём денег без отдельной страницы */}
      <div style={{ marginBottom: 18 }}>
        <NewExpenseForm onSaved={load} compact />
      </div>

      <div className="card grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
        <div>
          <label>Статус</label>
          <select value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setParams(e.target.value ? { status: e.target.value } : {}); }}>
            <option value="">Все</option>
            <option value="pending">На проверке</option>
            <option value="approved">Принят</option>
            <option value="rejected">Отклонён</option>
          </select>
        </div>
        <div>
          <label>Сотрудник</label>
          <select value={filter.employee_id} onChange={(e) => setFilter({ ...filter, employee_id: e.target.value })}>
            <option value="">Все</option>
            {employees.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label>Категория</label>
          <select value={filter.category_id} onChange={(e) => setFilter({ ...filter, category_id: e.target.value })}>
            <option value="">Все</option>
            {cats.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
          </select>
        </div>
        <div>
          <label>С даты</label>
          <input type="date" value={filter.date_from} onChange={(e) => setFilter({ ...filter, date_from: e.target.value })} />
        </div>
        <div>
          <label>По дату</label>
          <input type="date" value={filter.date_to} onChange={(e) => setFilter({ ...filter, date_to: e.target.value })} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" className="ghost" onClick={reset} style={{ width: "100%" }}>Сбросить</button>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сотрудник</th>
              <th>Категория</th>
              <th>Сумма</th>
              <th>Описание</th>
              <th>Чек</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {feed.map((row) =>
              row.kind === "expense" ? (
                <tr
                  key={`e-${row.data.id}`}
                  className={row.data.status === "pending" ? "pending-row" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => setViewingExpense(row.data)}
                  title="Открыть карточку расхода"
                >
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(row.data.spent_at).toLocaleDateString("ru-RU")}</td>
                  <td>🧾 {row.data.employee_name}</td>
                  <td>{row.data.category_name || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {formatAmountWithEquivalent(row.data.amount, row.data.currency || "KGS", usdKgs)}
                  </td>
                  <td>{row.data.description}</td>
                  <td><ReceiptLink url={row.data.receipt_url} /></td>
                  <td>
                    <StatusBadge status={row.data.status} />
                    {row.data.review_comment && <div className="muted" style={{ fontSize: 11, color: "var(--danger)" }}>{row.data.review_comment}</div>}
                    {row.data.is_verified && (
                      <div style={{ fontSize: 11, color: "var(--success)", marginTop: 2 }}>
                        ✓ Аудит{row.data.verified_by_id ? `: ${employeeNameById.get(row.data.verified_by_id) || ""}` : ""}
                      </div>
                    )}
                    {row.data.recorded_by_name && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        ✍️ внёс: {row.data.recorded_by_name}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {canReview && row.data.status === "pending" && (
                        <>
                          <button className="success" style={{ padding: "4px 10px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); review(row.data.id, "approved"); }}>✓</button>
                          <button className="danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); review(row.data.id, "rejected"); }}>✗</button>
                        </>
                      )}
                      {canVerify && !row.data.is_verified && (
                        <button
                          className="ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={(e) => { e.stopPropagation(); verify(row.data.id); }}
                          title="Верифицировать как аудитор"
                        >
                          Верифицировать
                        </button>
                      )}
                      {canEdit && (
                        <>
                          <button
                            className="ghost"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            onClick={(e) => { e.stopPropagation(); setEditingExpense(row.data); }}
                            title="Изменить запись"
                          >✏️</button>
                          <button
                            className="danger"
                            style={{ padding: "4px 8px", fontSize: 13 }}
                            onClick={(e) => { e.stopPropagation(); onDeleteExpense(row.data); }}
                            title="Удалить запись"
                          >🗑</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={`t-${row.data.id}`} style={{ background: "rgba(108,92,231,0.04)" }}>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(row.data.created_at).toLocaleDateString("ru-RU")}</td>
                  <td>📤 {row.data.from_user_name}</td>
                  <td>→ {row.data.to_user_name}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: "var(--accent-light)" }}>
                    {formatAmountWithEquivalent(row.data.amount, "KGS", usdKgs)}
                  </td>
                  <td>{row.data.note || ""}</td>
                  <td></td>
                  <td><span className="badge approved">Передача</span></td>
                  <td></td>
                </tr>
              )
            )}
            {feed.length === 0 && <tr><td colSpan={8} className="muted">Расходов и передач нет</td></tr>}
          </tbody>
        </table>
      </div>

      {viewingExpense && !editingExpense && (
        <ExpenseDetailModal
          expense={viewingExpense}
          usdKgs={usdKgs}
          canEdit={canEdit}
          canAttach={user?.role === "admin" || user?.role === "gen_director" || user?.role === "superadmin"}
          onClose={() => setViewingExpense(null)}
          onEdit={() => { setEditingExpense(viewingExpense); setViewingExpense(null); }}
          onChanged={load}
        />
      )}

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSaved={() => { setEditingExpense(null); load(); }}
        />
      )}
    </div>
  );
}
