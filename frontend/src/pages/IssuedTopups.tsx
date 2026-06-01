import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteTopup, listMyIssuedTopups, type BalanceTopUp } from "../api/transfers";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { EditTopUpModal } from "../components/EditTopUpModal";

export default function IssuedTopups() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<BalanceTopUp[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<BalanceTopUp | null>(null);
  const canEdit = user?.role === "admin";

  function reload() {
    listMyIssuedTopups()
      .then(setItems)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { reload(); }, []);

  async function onDelete(t: BalanceTopUp) {
    if (!confirm(`Удалить выдачу ${Number(t.amount).toLocaleString("ru-RU")} с → ${t.user_name}? Баланс получателя уменьшится.`)) return;
    try {
      await deleteTopup(t.id);
      toast.show("success", "Выдача удалена");
      reload();
    } catch (e: any) { toast.show("error", e.message); }
  }

  const total = useMemo(
    () => (items || []).reduce((sum, t) => sum + Number(t.amount), 0),
    [items]
  );

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>{err}</div></div>;
  if (!items) return <div className="container"><div className="muted">Загрузка...</div></div>;

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Выдано мной</h1>
        <Link to="/" className="muted" style={{ fontSize: 13 }}>← На главную</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Итого выдано</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent-light)" }}>
          {total.toLocaleString("ru-RU")} <span className="muted" style={{ fontSize: 14 }}>сом</span>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="icon">💼</div>
            Выдач пока не было
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Кому</th>
                <th>Категория</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Комментарий</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const cur = t.currency || "KGS";
                const sym = cur === "KGS" ? "с" : cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur;
                const kgsEq = t.amount_kgs && cur !== "KGS"
                  ? ` (~${Math.round(Number(t.amount_kgs)).toLocaleString("ru-RU")} с)`
                  : "";
                return (
                <tr key={t.id}>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(t.date).toLocaleDateString("ru-RU")}
                  </td>
                  <td>{t.user_name || "—"}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{t.category_name || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {Number(t.amount).toLocaleString("ru-RU")} {sym}
                    {kgsEq && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{kgsEq}</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{t.note || ""}</td>
                  {canEdit && (
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="ghost" style={{ padding: "4px 8px", fontSize: 13 }}
                                onClick={() => setEditing(t)} title="Изменить">✏️</button>
                        <button className="danger" style={{ padding: "4px 8px", fontSize: 13 }}
                                onClick={() => onDelete(t)} title="Удалить">🗑</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditTopUpModal
          topup={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
