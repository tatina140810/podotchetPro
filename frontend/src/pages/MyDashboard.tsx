import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";

interface AccountableDash {
  view: "accountable";
  totals: {
    issued: number;
    spent: number;
    balance: number;
    monthly_spent: number;
    monthly_limit: number;
    monthly_remaining: number | null;
    current_balance: number;
    total_received: number;
    pending_my_requests: number;
  };
  recent_expenses: any[];
}

export default function MyDashboard() {
  const [data, setData] = useState<AccountableDash | null>(null);

  useEffect(() => { api<AccountableDash>("/api/dashboard").then(setData); }, []);
  if (!data) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const t = data.totals;
  return (
    <div className="container">
      <h1 className="h1">Мой баланс</h1>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Stat label="Текущий остаток" value={t.current_balance} accent />
        <Stat label="Получено всего" value={t.total_received} />
        <Stat label="Потрачено" value={t.spent} />
      </div>

      {t.pending_my_requests > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: "3px solid var(--warning)" }}>
          <div className="muted" style={{ fontSize: 12 }}>Заявки на одобрении</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {t.pending_my_requests}
            <Link to="/requests?status=pending" style={{ fontSize: 13, marginLeft: 10 }}>смотреть →</Link>
          </div>
        </div>
      )}

      {t.monthly_limit > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="h2">Лимит этого месяца</h2>
          <ProgressBar value={t.monthly_spent} max={t.monthly_limit} />
        </div>
      )}

      <div className="row between" style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
          <h2 className="h2" style={{ margin: 0 }}>Последние операции</h2>
          <Link to="/my-history" style={{ fontSize: 13 }}>вся история →</Link>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/requests/new"><button className="ghost">+ Заявка</button></Link>
          <Link to="/expenses/new"><button>+ Расход</button></Link>
        </div>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        {data.recent_expenses.length === 0 ? <div className="muted">Расходов пока нет</div> : (
          <table>
            <tbody>
              {data.recent_expenses.map((e: any) => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(e.spent_at).toLocaleDateString("ru-RU")}</td>
                  <td>{e.category}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{Number(e.amount).toLocaleString("ru-RU")} с</td>
                  <td><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 700, marginTop: 6,
        color: accent ? (value < 0 ? "var(--danger)" : "var(--accent-light)") : "var(--text)",
      }}>
        {Number(value).toLocaleString("ru-RU")} <span className="muted" style={{ fontSize: 13 }}>сом</span>
      </div>
    </div>
  );
}
