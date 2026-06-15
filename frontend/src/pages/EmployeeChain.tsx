import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getExpenseChain,
  type ChainExpense,
  type ChainNode,
  type ChainTransfer,
} from "../api/users";

export default function EmployeeChain() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<ChainNode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setErr(null);
    getExpenseChain(Number(id))
      .then(setNode)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>{err}</div></div>;
  if (!node) return <div className="container"><div className="muted">Загрузка...</div></div>;

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Цепочка расходов</h1>
        <Link to={`/employees/${id}`} className="muted" style={{ fontSize: 13 }}>← К карточке</Link>
      </div>
      <div className="card">
        <ChainTree node={node} depth={0} />
      </div>
    </div>
  );
}

function ChainTree({ node, depth }: { node: ChainNode; depth: number }) {
  // Считаем "потрачено по этой ветке": approved+pending расходы + рекурсивно по подветкам.
  // Pending включаем — это в процессе trat, чтобы директор видел реалистичный план.
  const branchSpent = sumBranch(node);

  return (
    <div className="chain-node" style={{ marginLeft: depth === 0 ? 0 : 18 }}>
      <div className="chain-user-header">
        <span className="chain-user-name">{node.user_name}</span>
        <span className="chain-stats">
          <span className="muted" style={{ fontSize: 12 }}>
            потрачено по ветке: <strong>{branchSpent.toLocaleString("ru-RU")} с</strong>
          </span>
          {" · "}
          <span style={{
            color: Number(node.current_balance) < 0 ? "var(--danger)" : "var(--accent-light)",
            fontSize: 12,
            fontWeight: 600,
          }}>
            остаток: {Number(node.current_balance).toLocaleString("ru-RU")} с
          </span>
        </span>
      </div>

      <div className="chain-children">
        {node.expenses.map((e) => <ExpenseRow key={`e-${e.id}`} e={e} />)}
        {node.transfers_out.map((t) => <TransferRow key={`t-${t.id}`} t={t} depth={depth + 1} />)}
        {node.expenses.length === 0 && node.transfers_out.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: "4px 0 4px 14px" }}>
            нет расходов и передач
          </div>
        )}
      </div>
    </div>
  );
}

function ExpenseRow({ e }: { e: ChainExpense }) {
  const muted = e.status === "rejected";
  return (
    <div className="chain-row" style={{ opacity: muted ? 0.5 : 1 }}>
      <span className="chain-row-prefix">├──</span>
      <span className="chain-row-icon"></span>
      <span className="chain-row-text">
        {e.category_name || "—"}
        {e.description && <span className="muted"> · {e.description}</span>}
      </span>
      <span className="chain-row-amount" style={{ color: "var(--danger)" }}>
        −{Number(e.amount).toLocaleString("ru-RU")} с
      </span>
      <span className="chain-row-meta muted">
        {new Date(e.spent_at).toLocaleDateString("ru-RU")}
        {e.status === "pending" && " ·"}
        {e.status === "rejected" && " · ✗ отклонён"}
      </span>
    </div>
  );
}

function TransferRow({ t, depth }: { t: ChainTransfer; depth: number }) {
  return (
    <div className="chain-transfer">
      <div className="chain-row">
        <span className="chain-row-prefix">├──</span>
        <span className="chain-row-icon"></span>
        <span className="chain-row-text">
          Передано <strong>{t.to_user_name}</strong>
          {t.note && <span className="muted"> · {t.note}</span>}
        </span>
        <span className="chain-row-amount" style={{ color: "var(--accent-light)" }}>
          −{Number(t.amount).toLocaleString("ru-RU")} с
        </span>
        <span className="chain-row-meta muted">
          {new Date(t.created_at).toLocaleDateString("ru-RU")}
        </span>
      </div>
      {t.child && <ChainTree node={t.child} depth={depth} />}
      {!t.child && depth >= 5 && (
        <div className="muted" style={{ fontSize: 11, marginLeft: 32 }}>... (максимум 5 уровней)</div>
      )}
    </div>
  );
}

// approved+pending по всему поддереву (рекурсия)
function sumBranch(node: ChainNode): number {
  let total = 0;
  for (const e of node.expenses) {
    if (e.status === "approved" || e.status === "pending") {
      total += Number(e.amount);
    }
  }
  for (const t of node.transfers_out) {
    if (t.child) total += sumBranch(t.child);
  }
  return total;
}
