import { useEffect, useState } from "react";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";

// Соответствует _KIND_RU на бэкенде (routers/reports.py).
const KIND_RU: Record<string, string> = {
  topup: "Выдача (получено)",
  topup_out: "Выдача (отдано)",
  income: "Приход",
  transfer_in: "Получен перевод",
  transfer_out: "Передан перевод",
  request_approved: "Заявка (получено)",
  request_approved_out: "Заявка (выдано)",
  expense: "Расход",
};

interface HistoryEntry {
  kind: string;
  amount: string | number; // знак: + приход, − расход (в родной валюте)
  currency: string;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  ref_id: number | null;
}

interface BalanceDetails {
  current_balance: string | number;
  total_received: string | number;
  total_spent: string | number;
  entries: HistoryEntry[];
}

function fmt(amount: number, currency: string): string {
  const suffix = currency === "KGS" ? "с" : currency === "USD" ? "$" : currency;
  const sign = amount > 0 ? "+" : "";
  return `${sign}${Math.round(amount).toLocaleString("ru-RU")} ${suffix}`;
}

export default function MyHistory() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<BalanceDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!me) return;
    api<BalanceDetails>(`/api/users/${me.id}/balance`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [me]);

  async function onExport() {
    if (!me) return;
    setExporting(true);
    try {
      await downloadFile(`/api/reports/employees/${me.id}/history.xlsx`, "history.xlsx");
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать файл");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Моя история</h1>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting || !data || data.entries.length === 0}
          style={{ background: "#107C41", color: "#fff" }}
        >
          {exporting ? "Готовлю…" : "Excel"}
        </button>
      </div>

      {data && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 16 }}>
          <Stat label="Текущий остаток" value={Number(data.current_balance)} accent />
          <Stat label="Получено всего" value={Number(data.total_received)} />
          <Stat label="Потрачено" value={Number(data.total_spent)} />
        </div>
      )}

      <h2 className="h2">Все операции</h2>
      <div className="grid" style={{ gap: 8 }}>
        {!loaded && <div className="muted">Загрузка...</div>}
        {loaded && (!data || data.entries.length === 0) && (
          <div className="card muted">Операций пока нет</div>
        )}
        {data?.entries.map((e, i) => {
          const amt = Number(e.amount);
          return (
            <div className="card" key={`${e.kind}-${e.ref_id ?? "x"}-${i}`}>
              <div className="row between">
                <div>
                  <div style={{ fontWeight: 600 }}>{KIND_RU[e.kind] || e.kind}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleDateString("ru-RU")}
                    {e.counterparty ? ` · ${e.counterparty}` : ""}
                  </div>
                  {e.note && <div style={{ marginTop: 6, fontSize: 13 }}>{e.note}</div>}
                </div>
                <div style={{ fontWeight: 700, color: amt > 0 ? "var(--success)" : "var(--danger)", whiteSpace: "nowrap" }}>
                  {fmt(amt, e.currency || "KGS")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ? "var(--accent-light)" : undefined }}>
        {Math.round(value).toLocaleString("ru-RU")} <span style={{ fontSize: 13 }}>сом</span>
      </div>
    </div>
  );
}
