import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { listColleagues } from "../api/users";
import { updateIncome } from "../api/income";
import { listDepartments, type Department } from "../api/departments";
import type { UserOut } from "../context/AuthContext";

interface Props {
  income: {
    id: number;
    amount: string | number;
    currency: "KGS" | "USD" | "EUR" | "RUB" | string;
    source: string;
    description: string | null;
    received_by_id: number;
    department_id?: number | null;
    date: string;
  };
  onClose: () => void;
  onSaved: () => void;
}

export function EditIncomeModal({ income, onClose, onSaved }: Props) {
  const toast = useToast();
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    amount: String(income.amount),
    currency: (income.currency || "KGS") as "KGS" | "USD" | "EUR" | "RUB",
    source: income.source || "",
    description: income.description || "",
    received_by_id: String(income.received_by_id),
    department_id: income.department_id != null ? String(income.department_id) : "",
    date: income.date ? income.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listColleagues().then(setColleagues).catch(() => {});
    listDepartments(true).then(setDepartments).catch(() => {});
  }, []);

  // Жёсткая привязка получателя: подразделение прихода задаёт сервер.
  const receiver = colleagues.find((c) => String(c.id) === form.received_by_id);
  const forcedDeptId = receiver?.forced_department_id ?? null;
  const forcedDeptName = forcedDeptId
    ? (departments.find((d) => d.id === forcedDeptId)?.name || "закреплённое подразделение")
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Сумма > 0"); return; }
    setBusy(true);
    try {
      await updateIncome(income.id, {
        amount: amt,
        currency: form.currency,
        source: form.source.trim() || undefined,
        description: form.description.trim() || null,
        received_by_id: Number(form.received_by_id),
        department_id: form.department_id ? Number(form.department_id) : null,
        date: new Date(form.date).toISOString(),
      });
      toast.show("success", "Приход обновлён");
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "5vh 16px", overflowY: "auto",
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2">Изменить приход</h2>
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
          При смене суммы или валюты КГС-эквивалент пересчитается по текущему курсу.
        </div>
        <form onSubmit={submit} className="grid">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" required />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label>Валюта</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as any })}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="RUB">RUB</option>
              </select>
            </div>
          </div>
          <div>
            <label>Источник</label>
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </div>
          <div>
            <label>Получатель</label>
            <select value={form.received_by_id} onChange={(e) => setForm({ ...form, received_by_id: e.target.value })} required>
              {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label>Подразделение</label>
            {forcedDeptName ? (
              <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>
                {forcedDeptName} — закреплено за сотрудником, изменить нельзя
              </div>
            ) : (
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">— нет —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label>Комментарий</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
