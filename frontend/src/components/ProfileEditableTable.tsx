import { Fragment, useState } from "react";
import { useToast } from "./Toast";
import { profileApi } from "../api/employees";
import type { UserOut } from "../context/AuthContext";

type Kind = "received" | "transferred" | "expenses";
interface CatOpt { id: number; name: string; display_name?: string | null }

interface Props {
  anchorId: string;
  title: string;
  color: string;
  sum: string;
  isOpen: boolean;
  onToggle: () => void;
  kind: Kind;
  rows: any[];
  sym: string;
  fmt: (n: number) => string;
  /** Валюта, в которой показаны amount_kgs/итоги (KGS/USD/RUB/EUR). */
  displayCurrency: string;
  canEdit: boolean;
  /** Может одобрять/отклонять расходы на проверке (директор/админ). */
  canReview: boolean;
  editingKey: string | null;
  setEditingKey: (k: string | null) => void;
  colleagues: UserOut[];
  categories: CatOpt[];
  employeeId: number;
  employeeDeptIds: number[];
  departments: { id: number; name: string }[];
  onChanged: () => void;
  onDeleted: (label: string, undo: () => Promise<any>) => void;
}

const COLS: Record<Kind, string[]> = {
  received: ["Дата", "От кого", "Сумма", "Комментарий"],
  transferred: ["Дата", "Кому", "Категория", "Сумма", "Комментарий"],
  expenses: ["Дата", "Категория", "Сумма", "Комментарий"],
};

function today() { return new Date().toISOString().slice(0, 10); }

export function ProfileEditableTable(p: Props) {
  const toast = useToast();
  const [limit, setLimit] = useState(10);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const addKey = `${p.kind}:new`;
  const isAdding = p.editingKey === addKey;
  const cols = COLS[p.kind];
  const colSpan = cols.length + 1;

  function startAdd() {
    setForm({
      date: today(), amount: "", currency: p.displayCurrency, comment: "",
      from_id: "", to_user_id: "", category_id: "",
      department_id: p.employeeDeptIds.length === 1 ? String(p.employeeDeptIds[0]) : "",
    });
    p.setEditingKey(addKey);
  }
  function startEdit(r: any) {
    setForm({
      date: (r.date || "").slice(0, 10),
      amount: String(r.amount ?? ""),
      currency: r.currency || "KGS",
      comment: r.comment || "",
      from_id: r.from_id != null ? String(r.from_id) : "",
      from_text: r.kind === "income" ? (r.from_name || "") : "",
      to_user_id: r.to_user_id != null ? String(r.to_user_id) : "",
      category_id: r.category_id != null ? String(r.category_id) : "",
      department_id: r.department_id != null ? String(r.department_id) : "",
    });
    p.setEditingKey(`${p.kind}:${r.id}`);
  }
  function cancel() { p.setEditingKey(null); setForm({}); }

  function validate(): string | null {
    if (!form.date) return "Укажите дату";
    const amt = parseFloat(String(form.amount).replace(",", "."));
    if (!isFinite(amt) || amt <= 0) return "Сумма должна быть больше 0";
    if (p.kind === "transferred" && !isAddingTarget()) return "Выберите получателя";
    return null;
  }
  function isAddingTarget() {
    // для transferred нужен получатель (to_user_id) и при добавлении, и при правке
    return !!form.to_user_id;
  }

  async function save(row: any | null) {
    const err = validate();
    if (err) { toast.show("error", err); return; }
    const amount = parseFloat(String(form.amount).replace(",", "."));
    const dateISO = new Date(form.date).toISOString();
    const catId = form.category_id ? Number(form.category_id) : null;
    const depId = form.department_id ? Number(form.department_id) : null;
    setBusy(true);
    try {
      if (p.kind === "received") {
        if (!row) {
          await profileApi.createReceived(p.employeeId, {
            amount, currency: form.currency, date: dateISO, note: form.comment || null,
            department_id: depId, issued_by_id: form.from_id ? Number(form.from_id) : undefined,
          });
        } else if (row.kind === "income") {
          await profileApi.updateIncome(row.id, {
            amount, currency: form.currency, date: dateISO,
            source: form.from_text || "—", description: form.comment || null,
          });
        } else {
          await profileApi.updateTopup(row.id, {
            amount, currency: form.currency, date: dateISO, department_id: depId,
            admin_id: form.from_id ? Number(form.from_id) : undefined,
            note: form.comment || null,
          });
        }
      } else if (p.kind === "transferred") {
        if (!row) {
          await profileApi.createTransfer(Number(form.to_user_id), p.employeeId, {
            amount, currency: form.currency, date: dateISO, department_id: depId,
            category_id: catId, note: form.comment || null,
          });
        } else {
          await profileApi.updateTopup(row.id, {
            amount, currency: form.currency, date: dateISO, department_id: depId,
            user_id: Number(form.to_user_id), category_id: catId, note: form.comment || null,
          });
        }
      } else {
        const body: any = {
          amount, currency: form.currency, spent_at: dateISO,
          category_id: catId, description: form.comment || null, department_id: depId,
        };
        if (!row) await profileApi.createExpense(p.employeeId, body);
        else await profileApi.updateExpense(row.id, body);
      }
      toast.show("success", "Сохранено");
      cancel();
      p.onChanged();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка сохранения");
    } finally { setBusy(false); }
  }

  function delEndpoint(r: any): Promise<any> {
    if (p.kind === "received") return r.kind === "income" ? profileApi.deleteIncome(r.id) : profileApi.deleteTopup(r.id);
    if (p.kind === "transferred") return profileApi.deleteTopup(r.id);
    return profileApi.deleteExpense(r.id);
  }
  function recreate(r: any): () => Promise<any> {
    const base = { amount: r.amount, currency: r.currency, date: r.date };
    if (p.kind === "received") {
      return r.kind === "income"
        ? () => profileApi.createIncome(p.employeeId, { ...base, source: r.from_name || "—", description: r.comment || null })
        : () => profileApi.createReceived(p.employeeId, { ...base, note: r.comment || null, department_id: r.department_id ?? null, issued_by_id: r.from_id ?? undefined });
    }
    if (p.kind === "transferred") {
      return () => profileApi.createTransfer(r.to_user_id, p.employeeId, { ...base, department_id: r.department_id ?? null, category_id: r.category_id ?? null, note: r.comment || null });
    }
    return () => profileApi.createExpense(p.employeeId, { amount: r.amount, currency: r.currency, spent_at: r.date, category_id: r.category_id ?? null, description: r.comment || null, department_id: r.department_id ?? null });
  }
  async function remove(r: any) {
    if (!confirm("Удалить эту запись? Действие необратимо.")) return;
    try {
      await delEndpoint(r);
      p.onDeleted("Удалено", recreate(r));
      p.onChanged();
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось удалить");
    }
  }

  async function review(r: any, status: "approved" | "rejected") {
    if (status === "rejected" && !confirm("Отклонить этот расход?")) return;
    try {
      await profileApi.reviewExpense(r.id, status);
      toast.show("success", status === "approved" ? "Одобрено" : "Отклонено");
      p.onChanged();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    }
  }

  // ---- рендер полей формы (общие) ----
  const otherEditing = p.editingKey !== null && p.editingKey !== addKey;
  const deptChoices = p.employeeDeptIds.length
    ? p.departments.filter((d) => p.employeeDeptIds.includes(d.id))
    : p.departments;

  // ВАЖНО: это обычная функция, а НЕ вложенный компонент (<FormCells/>).
  // Если рендерить как компонент, он пересоздаётся на каждый ре-рендер и input
  // теряет фокус после каждого символа. Поэтому вызываем formRow(row) напрямую.
  const formRow = (row: any | null) => {
    const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
    const dateInp = <input type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} />;
    const amountInp = <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} style={{ textAlign: "right", width: 90 }} />;
    const curInp = (
      <select value={form.currency} onChange={(e) => set("currency", e.target.value)} style={{ width: 72, padding: "6px 6px" }}>
        <option value="KGS">KGS</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="RUB">RUB</option>
      </select>
    );
    const moneyCell = (
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>{amountInp}{curInp}</div>
    );
    const commentInp = <input value={form.comment} onChange={(e) => set("comment", e.target.value)} placeholder="Комментарий" />;
    const userSel = (key: string) => (
      <select value={form[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">— выбрать —</option>
        {p.colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    );
    const catSel = (
      <select value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
        <option value="">—</option>
        {p.categories.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
      </select>
    );
    const fromCell = row && row.kind === "income"
      ? <input value={form.from_text} onChange={(e) => set("from_text", e.target.value)} placeholder="Источник" />
      : userSel("from_id");

    const cells: React.ReactNode[] = [];
    if (p.kind === "received") cells.push(dateInp, fromCell, moneyCell, commentInp);
    else if (p.kind === "transferred") cells.push(dateInp, userSel("to_user_id"), catSel, moneyCell, commentInp);
    else cells.push(dateInp, catSel, moneyCell, commentInp);
    return (
      <tr style={{ background: "rgba(255,255,255,0.04)" }}>
        {cells.map((c, i) => <td key={i}>{c}</td>)}
        <td>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
            <select value={form.department_id} onChange={(e) => set("department_id", e.target.value)} title="Подразделение" style={{ width: 130 }}>
              <option value="">подразделение…</option>
              {deptChoices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button disabled={busy} onClick={() => save(row)} style={{ padding: "2px 8px" }}>✓</button>
            <button className="ghost" disabled={busy} onClick={cancel} style={{ padding: "2px 8px" }}>✗</button>
          </div>
        </td>
      </tr>
    );
  }

  function displayCells(r: any): React.ReactNode[] {
    const amountTd = (
      <span>{p.fmt(r.amount_kgs)} {p.sym}
        {r.currency !== p.displayCurrency && <span className="muted" style={{ fontSize: 11 }}> ({p.fmt(r.amount)} {r.currency})</span>}
      </span>
    );
    if (p.kind === "received") return [r.date.slice(0, 10), r.from_name || "—", amountTd, r.comment || ""];
    if (p.kind === "transferred") return [r.date.slice(0, 10), r.to_name || "—", r.category || "—", amountTd, r.comment || ""];
    return [r.date.slice(0, 10), r.category || "—", amountTd, r.comment || ""];
  }

  return (
    <div id={`sec-${p.anchorId}`} className="card" style={{ marginBottom: 10, padding: 0 }}>
      <div className="row between" style={{ padding: 14, borderLeft: `3px solid ${p.color}`, alignItems: "center" }}>
        <span style={{ fontWeight: 600, cursor: "pointer" }} onClick={p.onToggle}>{p.isOpen ? "▼" : "▶"} {p.title}</span>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {p.canEdit && (
            <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}
              disabled={otherEditing} onClick={() => { if (!p.isOpen) p.onToggle(); startAdd(); }}>
              + Добавить
            </button>
          )}
          <span style={{ fontWeight: 700, color: p.color }}>{p.sum}</span>
        </div>
      </div>
      {p.isOpen && (
        <div style={{ padding: 14, paddingTop: 0, overflow: "auto" }}>
          <table>
            <thead><tr>{cols.map((h, i) => <th key={i}>{h}</th>)}<th></th></tr></thead>
            <tbody>
              {isAdding && formRow(null)}
              {p.rows.length === 0 && !isAdding && <tr><td colSpan={colSpan} className="muted">Пусто</td></tr>}
              {p.rows.slice(0, limit).map((r) => (
                p.editingKey === `${p.kind}:${r.id}`
                  ? <Fragment key={r.id}>{formRow(r)}</Fragment>
                  : (
                    <tr key={r.id} className={`prow${p.kind === "expenses" && r.status === "pending" ? " pending-row" : ""}`}>
                      {displayCells(r).map((c, i) => <td key={i} style={i === (p.kind === "transferred" ? 3 : 2) ? { textAlign: "right", fontWeight: 600 } : undefined}>{c}</td>)}
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {p.kind === "expenses" && r.status === "pending" && (
                          p.canReview ? (
                            <span style={{ marginRight: 6, whiteSpace: "nowrap" }}>
                              <button className="success" disabled={otherEditing} onClick={() => review(r, "approved")} title="Одобрить" style={{ padding: "2px 8px" }}>✓</button>
                              <button className="danger" disabled={otherEditing} onClick={() => review(r, "rejected")} title="Отклонить" style={{ padding: "2px 8px", marginLeft: 4 }}>✗</button>
                            </span>
                          ) : (
                            <span className="badge pending" style={{ fontSize: 11, marginRight: 6 }}>на проверке</span>
                          )
                        )}
                        {p.canEdit && (
                          <span className="prow-actions">
                            <button className="ghost" disabled={otherEditing} onClick={() => startEdit(r)} title="Изменить" style={{ padding: "2px 8px" }}>Изм.</button>
                            <button className="danger" disabled={otherEditing} onClick={() => remove(r)} title="Удалить" style={{ padding: "2px 8px" }}>Удал.</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
              ))}
            </tbody>
          </table>
          {p.rows.length > limit && (
            <button className="ghost" onClick={() => setLimit(limit + 10)} style={{ marginTop: 8, fontSize: 13 }}>
              Показать ещё {p.rows.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
