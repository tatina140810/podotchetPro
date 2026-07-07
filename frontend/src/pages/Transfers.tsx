import { useEffect, useMemo, useState } from "react";
import { useAuth, isDirectorOrAuditor, type UserOut } from "../context/AuthContext";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import {
  createTransfer,
  listTransfers,
  type MoneyTransfer,
} from "../api/transfers";
import { listColleagues } from "../api/users";
import { CURRENCIES, CURRENCY_SYMBOL } from "../lib/currency";

interface MeBalance {
  current_balance: string | number;
}

export default function Transfers() {
  const { user } = useAuth();
  const toast = useToast();
  const [transfers, setTransfers] = useState<MoneyTransfer[]>([]);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [toUserId, setToUserId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KGS");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function reload() {
    listTransfers().then(setTransfers).catch(() => {});
    api<MeBalance>("/api/users/me").then((m) => setBalance(Number(m.current_balance) || 0));
  }

  useEffect(() => {
    reload();
    listColleagues().then(setColleagues).catch(() => {});
  }, []);

  // Получатели:
  //  - admin/gen_director/auditor — любой коллега
  //  - accountable — только свои прямые подотчётные
  const recipients = useMemo(() => {
    if (!user) return [];
    if (isDirectorOrAuditor(user.role)) return colleagues;
    return colleagues.filter((c) => c.supervisor_id === user.id);
  }, [colleagues, user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toUserId) {
      toast.show("error", "Выберите получателя");
      return;
    }
    const amt = parseFloat(amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) {
      toast.show("error", "Введите сумму больше 0");
      return;
    }
    setBusy(true);
    try {
      await createTransfer({
        to_user_id: Number(toUserId),
        amount: amt,
        currency,
        note: note.trim() || null,
      });
      toast.show("success", "Деньги переданы");
      setAmount("");
      setCurrency("KGS");
      setNote("");
      setToUserId("");
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1 className="h1">Передача денег</h1>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Мой текущий баланс</div>
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          color: balance < 0 ? "var(--danger)" : "var(--accent-light)",
        }}>
          {balance.toLocaleString("ru-RU")} <span className="muted" style={{ fontSize: 14 }}>сом</span>
        </div>
      </div>

      {recipients.length === 0 ? (
        <div className="card muted">
          Передавать пока некому. У вас нет подотчётных.
        </div>
      ) : (
        <form onSubmit={submit} className="card grid">
          <div>
            <label>Кому</label>
            <select
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value ? Number(e.target.value) : "")}
              required
            >
              <option value="">— Выбрать —</option>
              {recipients.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label>Валюта</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Заметка (необязательно)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="submit" disabled={busy}>{busy ? "..." : "Передать"}</button>
          </div>
        </form>
      )}

      <h2 className="h2" style={{ marginTop: 18 }}>История</h2>
      <div className="card" style={{ overflow: "auto" }}>
        {transfers.length === 0 ? (
          <div className="empty-state">
            <div className="icon"></div>
            Передач пока не было
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>От кого</th>
                <th>Кому</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Заметка</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const mineOut = t.from_user_id === user?.id;
                return (
                  <tr key={t.id}>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleString("ru-RU")}
                    </td>
                    <td>{t.from_user_name || "—"}</td>
                    <td>{t.to_user_name || "—"}</td>
                    <td style={{
                      textAlign: "right",
                      fontWeight: 600,
                      color: mineOut ? "var(--danger)" : "var(--success)",
                    }}>
                      {mineOut ? "−" : "+"}{Number(t.amount).toLocaleString("ru-RU")} {CURRENCY_SYMBOL[t.currency] || t.currency || "с"}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>{t.note || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
