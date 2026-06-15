import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { CURRENCIES } from "../lib/currency";

export default function NewAdvance() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();

  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState({
    employee_id: Number(params.get("employee") || 0),
    amount: "" as string,
    currency: "KGS",
    payment_type: "cash",
    purpose: "",
    comment: "",
    force: false,
  });
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/api/users").then(setEmployees); }, []);

  async function submit(e: React.FormEvent, force = false) {
    e.preventDefault();
    setBusy(true);
    setWarnings(null);
    try {
      const res = await fetch("/api/advances", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("pp_token")}` },
        body: JSON.stringify({ ...form, force, amount: Number(form.amount) }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setWarnings(data.warnings);
        return;
      }
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      toast.show("success", "Выдача создана");
      nav("/");
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 className="h1">Выдача денег</h1>

      <form onSubmit={(e) => submit(e, false)} className="card grid">
        <div>
          <label>Сотрудник</label>
          <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })} required>
            <option value="">— выберите —</option>
            {employees.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name} ({u.phone})</option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label>Сумма</label>
            <input type="number" min={1} step="0.01" value={form.amount}
                   onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label>Валюта</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label>Тип оплаты</label>
          <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="transfer">Перевод</option>
          </select>
        </div>
        <div><label>Цель выдачи</label><input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
        <div><label>Комментарий</label><textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>

        {warnings && (
          <div className="card" style={{ borderColor: "var(--warning)", background: "rgba(253,203,110,0.1)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Превышение лимитов:</div>
            {warnings.map((w, i) => <div key={i}>• {w}</div>)}
            <button type="button" className="danger" style={{ marginTop: 12 }}
                    onClick={(e) => submit(e as any, true)} disabled={busy}>
              Всё равно выдать
            </button>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={() => nav(-1)}>Отмена</button>
          <button type="submit" disabled={busy || !form.employee_id || !Number(form.amount)}>{busy ? "..." : "Выдать"}</button>
        </div>
      </form>
    </div>
  );
}
