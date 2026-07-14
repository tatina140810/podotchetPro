/**
 * Раздел «Авансы поставщикам» — депозиты в магазинах.
 * Список карточек с остатком, история транзакций, действия (довнести/вернуть/закрыть),
 * форма внесения нового аванса. Учёт без двойного списания — на бэкенде.
 */
import { useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { listColleagues } from "../api/users";
import type { UserOut } from "../context/AuthContext";
import {
  listSupplierAdvances,
  createSupplierAdvance,
  depositToAdvance,
  refundAdvance,
  closeAdvance,
  type SupplierAdvance,
} from "../api/supplierAdvances";

const money = (v: string | number) => Number(v).toLocaleString("ru-RU");
const STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  depleted: "Исчерпан",
  closed: "Закрыт",
};
const TX_LABEL: Record<string, string> = {
  deposit: "Внесение",
  purchase: "Покупка",
  refund: "Возврат",
};

export default function SupplierAdvances() {
  const toast = useToast();
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin" || me?.role === "superadmin"
    || me?.role === "gen_director" || me?.role === "auditor";

  const [items, setItems] = useState<SupplierAdvance[]>([]);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Форма создания
  const [form, setForm] = useState({
    employee_id: "" as number | "",
    supplier_name: "",
    amount: "" as any,
    currency: "KGS",
    date: new Date().toISOString().slice(0, 10),
    comment: "",
  });
  const [busy, setBusy] = useState(false);

  function reload() {
    listSupplierAdvances().then(setItems).catch((e) => toast.show("error", e.message));
  }
  useEffect(() => {
    reload();
    if (isAdmin) listColleagues().then(setColleagues).catch(() => {});
  }, [me?.id]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplier_name.trim()) { toast.show("error", "Укажите поставщика"); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { toast.show("error", "Сумма больше 0"); return; }
    setBusy(true);
    try {
      await createSupplierAdvance({
        employee_id: isAdmin && form.employee_id ? Number(form.employee_id) : undefined,
        supplier_name: form.supplier_name.trim(),
        amount: Number(form.amount),
        currency: form.currency,
        date: form.date ? new Date(form.date).toISOString() : undefined,
        comment: form.comment.trim() || null,
      });
      toast.show("success", "Аванс внесён");
      setShowForm(false);
      setForm({ employee_id: "", supplier_name: "", amount: "", currency: "KGS", date: new Date().toISOString().slice(0, 10), comment: "" });
      reload();
    } catch (err: any) {
      toast.show("error", err.message);
    } finally { setBusy(false); }
  }

  async function doDeposit(a: SupplierAdvance) {
    const raw = window.prompt(`Довнести на депозит «${a.supplier_name}» (${a.currency}):`);
    if (!raw) return;
    const amount = Number(raw.replace(/\s/g, "").replace(",", "."));
    if (!amount || amount <= 0) { toast.show("error", "Неверная сумма"); return; }
    try { await depositToAdvance(a.id, { amount }); toast.show("success", "Довнесено"); reload(); }
    catch (e: any) { toast.show("error", e.message); }
  }

  async function doRefund(a: SupplierAdvance) {
    const raw = window.prompt(`Вернуть остаток сотруднику (макс ${money(a.remaining)} ${a.currency}):`, a.remaining);
    if (!raw) return;
    const amount = Number(raw.replace(/\s/g, "").replace(",", "."));
    if (!amount || amount <= 0) { toast.show("error", "Неверная сумма"); return; }
    try { await refundAdvance(a.id, { amount }); toast.show("success", "Возвращено на баланс"); reload(); }
    catch (e: any) { toast.show("error", e.message); }
  }

  async function doClose(a: SupplierAdvance) {
    if (!window.confirm(`Закрыть депозит «${a.supplier_name}»?`)) return;
    try { await closeAdvance(a.id); toast.show("success", "Депозит закрыт"); reload(); }
    catch (e: any) { toast.show("error", e.message); }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Авансы поставщикам</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Отмена" : "+ Внести аванс"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitCreate} className="card grid" style={{ marginBottom: 16 }}>
          {isAdmin && (
            <div>
              <label>Сотрудник (с чьего баланса)</label>
              <select
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value ? Number(e.target.value) : "" })}
              >
                <option value="">Себя ({me?.name})</option>
                {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label>Поставщик</label>
            <input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                   placeholder="напр. «Строймаг»" required />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input type="number" min="0.01" step="0.01" value={form.amount}
                     onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label>Валюта</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="KGS">KGS — сом</option>
                <option value="USD">USD — $</option>
                <option value="EUR">EUR — €</option>
                <option value="RUB">RUB — ₽</option>
              </select>
            </div>
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label>Комментарий (необязательно)</label>
            <textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Баланс сотрудника уменьшится на сумму аванса. Это перемещение денег к поставщику,
            в отчётах расходов оно не отражается — расходы появятся при покупках с депозита.
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="submit" disabled={busy}>{busy ? "..." : "Внести аванс"}</button>
          </div>
        </form>
      )}

      {items.length === 0 && <div className="muted">Пока нет авансов поставщикам.</div>}

      <div className="grid" style={{ gap: 10 }}>
        {items.map((a) => {
          const pct = Number(a.deposited) > 0 ? Math.min(100, (Number(a.spent) / Number(a.deposited)) * 100) : 0;
          const isOpen = expanded === a.id;
          const canManage = a.status !== "closed";
          return (
            <div key={a.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }}
                   onClick={() => setExpanded(isOpen ? null : a.id)}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.supplier_name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{a.employee_name}</div>
                </div>
                <span className="badge" style={{
                  background: a.status === "active" ? "rgba(108,92,231,.15)" : "rgba(255,255,255,.08)",
                  padding: "2px 8px", borderRadius: 8, fontSize: 12,
                }}>{STATUS_LABEL[a.status] || a.status}</span>
              </div>

              <div className="row" style={{ gap: 16, marginTop: 8, fontSize: 14, flexWrap: "wrap" }}>
                <span>Внесено <b>{money(a.deposited)}</b></span>
                <span>Потрачено <b>{money(a.spent)}</b></span>
                {Number(a.refunded) > 0 && <span>Возвращено <b>{money(a.refunded)}</b></span>}
                <span>Остаток <b style={{ color: "var(--accent)" }}>{money(a.remaining)} {a.currency}</b></span>
              </div>

              <div style={{ height: 6, background: "rgba(255,255,255,.08)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
              </div>

              {canManage && (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button type="button" className="ghost" style={{ fontSize: 13 }} onClick={() => doDeposit(a)}>Довнести</button>
                  {Number(a.remaining) > 0 && (
                    <button type="button" className="ghost" style={{ fontSize: 13 }} onClick={() => doRefund(a)}>Вернуть остаток</button>
                  )}
                  {Number(a.remaining) <= 0 && (
                    <button type="button" className="ghost" style={{ fontSize: 13 }} onClick={() => doClose(a)}>Закрыть</button>
                  )}
                </div>
              )}

              {isOpen && (
                <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10 }}>
                  {a.transactions.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Нет операций.</div>}
                  {a.transactions.map((t) => (
                    <div key={t.id} className="row" style={{ justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                      <div>
                        <span style={{ color: t.type === "purchase" ? "inherit" : "var(--accent)" }}>{TX_LABEL[t.type]}</span>
                        {t.category_name && <span className="muted"> · {t.category_name}</span>}
                        {t.department_name && <span className="muted"> · {t.department_name}</span>}
                        {t.description && <span className="muted"> · {t.description}</span>}
                      </div>
                      <div style={{ whiteSpace: "nowrap" }}>
                        <span className="muted" style={{ marginRight: 8 }}>{t.date.slice(0, 10)}</span>
                        <b>{t.type === "deposit" ? "+" : "−"}{money(t.amount)}</b>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
