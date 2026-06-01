import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { CURRENCIES, CURRENCY_SYMBOL } from "../lib/currency";

type Subordinate = {
  id: number;
  name: string;
  phone: string;
  email?: string | null;
  balance: number;
  issued_total: number;
  spent_total: number;
  transferred_out_total: number;
  balances_by_currency?: Record<string, string | number>;
};

type Me = {
  id: number;
  name: string;
  balance: number;
  balances_by_currency?: Record<string, string | number>;
};

export default function MySubordinates() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [subs, setSubs] = useState<Subordinate[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", phone: "", password: "", email: "" });
  const [creating, setCreating] = useState(false);

  const [transferTo, setTransferTo] = useState<Subordinate | null>(null);
  const [transferForm, setTransferForm] = useState({ amount: "", currency: "KGS", purpose: "", comment: "" });
  const [transferring, setTransferring] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [meData, subsData] = await Promise.all([
        api<Me>("/api/users/me"),
        api<Subordinate[]>("/api/users/me/subordinates"),
      ]);
      setMe(meData);
      setSubs(subsData);
    } catch (e) {
      toast.show("error", "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.phone.trim() || createForm.password.length < 6) {
      toast.show("error", "Заполните имя, телефон и пароль (мин. 6 символов)");
      return;
    }
    setCreating(true);
    try {
      await api("/api/users/subordinates", {
        method: "POST",
        body: {
          name: createForm.name.trim(),
          phone: createForm.phone.trim(),
          password: createForm.password,
          email: createForm.email.trim() || null,
        },
      });
      toast.show("success", "Подотчётный создан");
      setShowCreate(false);
      setCreateForm({ name: "", phone: "", password: "", email: "" });
      reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Ошибка создания";
      toast.show("error", msg);
    } finally {
      setCreating(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTo) return;
    const amount = parseFloat(transferForm.amount.replace(",", "."));
    if (!amount || amount <= 0) {
      toast.show("error", "Введите сумму больше 0");
      return;
    }
    setTransferring(true);
    try {
      await api("/api/advances/transfer", {
        method: "POST",
        body: {
          subordinate_id: transferTo.id,
          amount,
          currency: transferForm.currency,
          purpose: transferForm.purpose.trim() || null,
          comment: transferForm.comment.trim() || null,
        },
      });
      const sym = CURRENCY_SYMBOL[transferForm.currency] || transferForm.currency;
      toast.show("success", `Переведено ${amount.toLocaleString("ru-RU")} ${sym} → ${transferTo.name}`);
      setTransferTo(null);
      setTransferForm({ amount: "", currency: "KGS", purpose: "", comment: "" });
      reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Ошибка перевода";
      toast.show("error", msg);
    } finally {
      setTransferring(false);
    }
  };

  if (loading) return <div className="container"><div className="muted">Загрузка...</div></div>;

  return (
    <div className="container">
      <h1 className="h1">Мои подотчётные</h1>

      {me && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>Мой баланс</div>
          <BalancesView b={me.balances_by_currency} fallback={me.balance} />
        </div>
      )}

      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ margin: 0 }}>Список</h2>
        <button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Отмена" : "+ Добавить"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <input placeholder="Имя" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
          <input placeholder="Телефон (логин)" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
          <input placeholder="Пароль (мин. 6)" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
          <input placeholder="Email (необязательно)" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          <button type="submit" disabled={creating}>{creating ? "Создаём…" : "Создать"}</button>
        </form>
      )}

      {subs.length === 0 ? (
        <div className="card muted">Пока никого нет. Создайте первого подотчётного.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>Имя</th><th>Баланс</th><th>Действие</th></tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div>{s.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{s.phone}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <BalancesView b={s.balances_by_currency} fallback={s.balance} compact />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button onClick={() => { setTransferTo(s); setTransferForm({ amount: "", currency: "KGS", purpose: "", comment: "" }); }}>
                      Перевести
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transferTo && (
        <div className="burger-overlay" onClick={() => setTransferTo(null)}>
          <div
            className="card"
            style={{ maxWidth: 380, margin: "10vh auto", padding: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="h2">Перевести → {transferTo.name}</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Мой баланс ({transferForm.currency}):{" "}
              {Number(me?.balances_by_currency?.[transferForm.currency] || 0).toLocaleString("ru-RU")}{" "}
              {CURRENCY_SYMBOL[transferForm.currency] || transferForm.currency}
            </div>
            <form onSubmit={handleTransfer} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  placeholder="Сумма"
                  value={transferForm.amount}
                  onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  inputMode="decimal"
                  autoFocus
                  style={{ flex: 2 }}
                />
                <select
                  value={transferForm.currency}
                  onChange={(e) => setTransferForm({ ...transferForm, currency: e.target.value })}
                  style={{ flex: 1, minWidth: 90 }}
                >
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <input
                placeholder="Цель (необязательно)"
                value={transferForm.purpose}
                onChange={(e) => setTransferForm({ ...transferForm, purpose: e.target.value })}
              />
              <textarea
                placeholder="Комментарий (необязательно)"
                value={transferForm.comment}
                onChange={(e) => setTransferForm({ ...transferForm, comment: e.target.value })}
                rows={2}
              />
              <div className="row" style={{ gap: 8 }}>
                <button type="submit" disabled={transferring} style={{ flex: 1 }}>
                  {transferring ? "Перевод…" : "Перевести"}
                </button>
                <button type="button" className="ghost" onClick={() => setTransferTo(null)}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function BalancesView({
  b,
  fallback,
  compact,
}: {
  b: Record<string, string | number> | undefined;
  fallback: string | number;
  compact?: boolean;
}) {
  const entries = b && Object.keys(b).length > 0
    ? Object.entries(b)
    : [["KGS", fallback]] as [string, string | number][];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? 8 : 14, justifyContent: compact ? "flex-end" : "flex-start" }}>
      {entries.map(([cur, val]) => (
        <div key={cur}>
          <span style={{
            fontSize: compact ? 14 : 22,
            fontWeight: 700,
            color: Number(val) < 0 ? "var(--danger)" : "var(--accent-light)",
          }}>
            {Number(val).toLocaleString("ru-RU")}
          </span>{" "}
          <span className="muted" style={{ fontSize: compact ? 11 : 13 }}>{CURRENCY_SYMBOL[cur] || cur}</span>
        </div>
      ))}
    </div>
  );
}
