import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useDisplayCurrency } from "../context/CurrencyContext";

interface Op {
  type: "expense" | "income" | "transfer";
  id: number;
  date: string;
  datetime: string;
  amount: number;
  currency: string;
  amount_kgs: number;
  description?: string | null;
  source?: string | null;
  category?: string | null;
  who?: string | null;
  from?: string | null;
  to?: string | null;
  color: "red" | "green" | "gray";
}

interface DayBlock {
  date: string;
  operations: Op[];
  day_result: number;
  cumulative_balance: number;
}

interface Report {
  from: string;
  to: string;
  opening_balance: number;
  closing_balance: number;
  days: DayBlock[];
  period_total: { income: number; expenses: number; result: number };
  currency: "KGS" | "USD";
  rate: number | null;
}

function currentMonthRange(): { from: string; to: string } {
  const t = new Date();
  const from = new Date(t.getFullYear(), t.getMonth(), 1);
  const to = new Date(t.getFullYear(), t.getMonth() + 1, 0); // последний день месяца
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

const MONTH_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH_RU[d.getMonth()]} ${d.getFullYear()}`;
}

const COLOR: Record<string, string> = {
  red: "var(--danger)",
  green: "var(--success)",
  gray: "var(--muted, #94a3b8)",
};

export default function BalanceReport() {
  const init = currentMonthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const { display } = useDisplayCurrency();
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    setErr(null);
    api<Report>(`/api/reports/balance?from=${from}&to=${to}&currency=${display}&_t=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setData(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, display]);

  const sym = data?.currency === "USD" ? "$" : "с";

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Общий баланс</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>От</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>До</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Валюта: <b>{display === "USD" ? "USD ($)" : "KGS (с)"}</b> — меняется в шапке.
            <br />Остаток org = Σ Income − Σ Expense (передачи не влияют).
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 16 }}>
            <Stat label="Остаток на начало" value={data.opening_balance} sym={sym} />
            <Stat label="Приход за период" value={data.period_total.income} sym={sym} color="var(--success)" />
            <Stat label="Расход за период" value={data.period_total.expenses} sym={sym} color="var(--danger)" />
            <Stat
              label="Остаток на конец"
              value={data.closing_balance}
              sym={sym}
              color={data.closing_balance >= 0 ? "var(--success)" : "var(--danger)"}
            />
          </div>

          {data.days.length === 0 && (
            <div className="card muted">За этот период операций нет</div>
          )}

          {data.days.map((d) => (
            <div key={d.date} className="card" style={{ marginBottom: 12 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 15 }}>{formatDayLabel(d.date)}</b>
                <span className="muted" style={{ fontSize: 12 }}>
                  Остаток на конец дня:&nbsp;
                  <b style={{ color: d.cumulative_balance >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {d.cumulative_balance.toLocaleString("ru-RU")} {sym}
                  </b>
                </span>
              </div>
              <table>
                <tbody>
                  {d.operations.map((op) => (
                    <tr key={`${op.type}-${op.id}`}>
                      <td style={{ width: 110, color: COLOR[op.color] }}>
                        {op.type === "expense" && `−${op.amount.toLocaleString("ru-RU")} ${op.currency}`}
                        {op.type === "income" && `+${op.amount.toLocaleString("ru-RU")} ${op.currency}`}
                        {op.type === "transfer" && `→ ${op.amount.toLocaleString("ru-RU")} ${op.currency}`}
                      </td>
                      <td style={{ width: 200 }}>
                        {op.type === "transfer" ? (
                          <span className="muted" style={{ fontSize: 13 }}>
                            {op.from} → {op.to}
                          </span>
                        ) : (
                          <span>{op.who || "—"}</span>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>{op.description || op.source || ""}</td>
                      <td className="muted" style={{ fontSize: 12, textAlign: "right" }}>
                        {op.category || (op.type === "income" ? "Приход" : op.type === "transfer" ? "Передача" : "Без категории")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sym, color }: { label: string; value: number; sym: string; color?: string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color }}>
        {value.toLocaleString("ru-RU")} {sym}
      </div>
    </div>
  );
}
