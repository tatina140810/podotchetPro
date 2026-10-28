import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useToast } from "./Toast";
import { listColleagues } from "../api/users";
import { updateTopup, type BalanceTopUp } from "../api/transfers";
import { listDepartments, type Department } from "../api/departments";
import type { UserOut } from "../context/AuthContext";

interface Props {
  topup: BalanceTopUp;
  onClose: () => void;
  onSaved: () => void;
}

interface CategoryOpt { id: number; name: string }

export function EditTopUpModal({ topup, onClose, onSaved }: Props) {
  const toast = useToast();
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    amount: String(topup.amount),
    currency: (topup.currency || "KGS") as "KGS" | "USD" | "EUR" | "RUB",
    note: topup.note || "",
    user_id: String(topup.user_id),
    admin_id: String(topup.admin_id),
    category_id: topup.category_id ? String(topup.category_id) : "",
    department_id: topup.department_id ? String(topup.department_id) : "",
    payment_method: topup.payment_method || "",
    date: topup.date ? topup.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listColleagues(true).then(setColleagues).catch(() => {});
    api<CategoryOpt[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Сумма > 0"); return; }
    setBusy(true);
    try {
      await updateTopup(topup.id, {
        amount: amt,
        currency: form.currency,
        note: form.note.trim() || null,
        user_id: Number(form.user_id),
        admin_id: Number(form.admin_id),
        date: new Date(form.date).toISOString(),
        category_id: form.category_id ? Number(form.category_id) : null,
        department_id: form.department_id ? Number(form.department_id) : null,
        payment_method: (form.payment_method || null) as "cash" | "bank" | null,
      });
      toast.show("success", "Выдача обновлена");
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setBusy(false); }
  }

  // Портал в body: иначе окно живёт в стекинг-контексте страницы
  // (панель импорта, шапка) и прячется под ними.
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "5vh 16px", overflowY: "auto",
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <h2 className="h2">Изменить выдачу</h2>
        <form onSubmit={submit} className="grid">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" required />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label>Валюта</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as "KGS" | "USD" | "EUR" | "RUB" })}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="RUB">RUB</option>
              </select>
            </div>
          </div>
          {form.currency !== "KGS" && (
            <div className="muted" style={{ fontSize: 11 }}>
              При смене валюты КГС-эквивалент пересчитается по текущему курсу.
            </div>
          )}
          <div>
            <label>Выдал</label>
            <select value={form.admin_id} onChange={(e) => setForm({ ...form, admin_id: e.target.value })} required>
              {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label>Получатель</label>
            <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required>
              {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label>Категория (необязательно)</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— нет —</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Подразделение</label>
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">— нет —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label>Форма расчёта</label>
            <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="">— не указано —</option>
              <option value="cash">Наличный расчёт</option>
              <option value="bank">Безналичный расчёт</option>
            </select>
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label>Комментарий</label>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
