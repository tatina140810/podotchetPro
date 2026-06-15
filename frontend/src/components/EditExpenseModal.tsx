import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useToast } from "./Toast";
import { listDepartments, type Department } from "../api/departments";

interface Category { id: number; name: string }

interface Props {
  expense: {
    id: number;
    amount: string | number;
    currency: string;
    category_id: number | null;
    description: string | null;
    spent_at: string;
  };
  onClose: () => void;
  onSaved: () => void;
}

export function EditExpenseModal({ expense, onClose, onSaved }: Props) {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [form, setForm] = useState({
    amount: String(expense.amount),
    currency: (expense.currency || "KGS") as "KGS" | "USD" | "RUB",
    category_id: expense.category_id ? String(expense.category_id) : "",
    description: expense.description || "",
    spent_at: expense.spent_at ? expense.spent_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Сумма > 0"); return; }
    setBusy(true);
    try {
      const body: any = {
        amount: amt,
        currency: form.currency,
        category_id: form.category_id ? Number(form.category_id) : null,
        description: form.description.trim() || null,
        spent_at: new Date(form.spent_at).toISOString(),
      };
      // department_id отправляем только если выбрали (иначе не трогаем текущее).
      if (departmentId) body.department_id = Number(departmentId);
      await api(`/api/expenses/${expense.id}`, { method: "PATCH", body });
      toast.show("success", "Расход обновлён");
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
        <h2 className="h2">Изменить расход</h2>
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
                <option value="RUB">RUB</option>
              </select>
            </div>
          </div>
          <div>
            <label>Категория</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— нет —</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Подразделение</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— не менять —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} />
          </div>
          <div>
            <label>Описание</label>
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
