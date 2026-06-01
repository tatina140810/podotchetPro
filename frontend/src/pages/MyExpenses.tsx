import { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { ReceiptLink } from "../components/ReceiptPreview";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { listTransfers, type MoneyTransfer } from "../api/transfers";
import { getCurrentRate } from "../api/exchange";
import { formatAmountWithEquivalent } from "../lib/format-currency";
import { NewExpenseForm } from "../components/NewExpenseForm";
import { ExpenseDetailModal } from "../components/ExpenseDetailModal";
import { EditExpenseModal } from "../components/EditExpenseModal";

// Унифицированный элемент ленты: либо расход, либо исходящая передача.
type FeedItem =
  | { kind: "expense"; date: string; data: any }
  | { kind: "transfer_out"; date: string; data: MoneyTransfer };

export default function MyExpenses() {
  const { user: me } = useAuth();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<MoneyTransfer[]>([]);
  const [usdKgs, setUsdKgs] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<any | null>(null); // открытая карточка расхода
  const [editing, setEditing] = useState<any | null>(null);    // расход в режиме правки
  const toast = useToast();

  function reload() {
    Promise.all([
      api<any[]>("/api/expenses").then((d) => setExpenses(d)),
      listTransfers().then((d) => setTransfers(d)),
    ]).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      api<any[]>("/api/expenses").then((d) => setExpenses(d)),
      listTransfers().then((d) => setTransfers(d)),
      getCurrentRate("USD", "KGS").then((r) => setUsdKgs(r.rate ? Number(r.rate) : null)).catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Смешанная лента: мои расходы + мои ИСХОДЯЩИЕ передачи (то что списано с моего баланса).
  // Входящие передачи и пополнения тут не показываем — это не расход.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const e of expenses) {
      items.push({ kind: "expense", date: e.spent_at, data: e });
    }
    for (const t of transfers) {
      if (me && t.from_user_id === me.id) {
        items.push({ kind: "transfer_out", date: t.created_at, data: t });
      }
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [expenses, transfers, me]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile("/api/expenses/export.xlsx", "expenses.xlsx");
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать файл");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Мои расходы</h1>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting || expenses.length === 0}
          style={{ background: "#107C41", color: "#fff" }}
        >
          {exporting ? "Готовлю…" : "Excel"}
        </button>
      </div>

      {/* Форма сверху — добавление расхода / передачи без перехода */}
      <div style={{ marginBottom: 18 }}>
        <NewExpenseForm onSaved={reload} compact />
      </div>

      <h2 className="h2">История</h2>
      <div className="grid" style={{ gap: 8 }}>
        {!loaded && <div className="muted">Загрузка...</div>}
        {loaded && feed.length === 0 && (
          <div className="card muted">Расходов и передач пока нет</div>
        )}
        {feed.map((item) =>
          item.kind === "expense" ? (
            <ExpenseCard key={`e-${item.data.id}`} e={item.data} rate={usdKgs} onOpen={() => setSelected(item.data)} />
          ) : (
            <TransferCard key={`t-${item.data.id}`} t={item.data} rate={usdKgs} />
          )
        )}
      </div>

      {selected && (
        <ExpenseDetailModal
          expense={selected}
          usdKgs={usdKgs}
          canEdit={selected.status === "pending" && selected.employee_id === me?.id}
          canAttach={selected.employee_id === me?.id}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onChanged={reload}
        />
      )}

      {editing && (
        <EditExpenseModal
          expense={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function ExpenseCard({ e, rate, onOpen }: { e: any; rate: number | null; onOpen: () => void }) {
  return (
    <div className="card" onClick={onOpen} style={{ cursor: "pointer" }} title="Открыть карточку расхода">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>
            🧾 {formatAmountWithEquivalent(e.amount, e.currency || "KGS", rate)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {e.category_name || "—"} · {new Date(e.spent_at).toLocaleDateString("ru-RU")}
          </div>
          {e.recorded_by_name && (
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              ✍️ внёс: {e.recorded_by_name} (admin)
            </div>
          )}
          {e.description && <div style={{ marginTop: 6, fontSize: 13 }}>{e.description}</div>}
          {e.status === "rejected" && e.review_comment && (
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--danger)" }}>
              Причина: {e.review_comment}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <ReceiptLink url={e.receipt_url} />
          <StatusBadge status={e.status} />
        </div>
      </div>
    </div>
  );
}

function TransferCard({ t, rate }: { t: MoneyTransfer; rate: number | null }) {
  // MoneyTransfer всегда в KGS (по архитектурному решению — multi-currency только у Expense).
  return (
    <div className="card">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>
            📤 {formatAmountWithEquivalent(t.amount, "KGS", rate)} →{" "}
            <span style={{ color: "var(--accent-light)" }}>{t.to_user_name}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Передача · {new Date(t.created_at).toLocaleDateString("ru-RU")}
          </div>
          {t.note && <div style={{ marginTop: 6, fontSize: 13 }}>{t.note}</div>}
        </div>
      </div>
    </div>
  );
}
