import { StatusBadge } from "./StatusBadge";
import { ReceiptLink } from "./ReceiptPreview";
import { ActionsMenu } from "./ActionsMenu";
import { formatAmountWithEquivalent } from "../lib/format-currency";
import type { Income } from "../api/income";
import type { MoneyTransfer } from "../api/transfers";

const APPROVED_TIP = "Запись подтверждена — обратитесь к администратору";

interface Handlers {
  onEdit: () => void;
  onDelete: () => void;
}

export function ExpenseCard({ e, rate, mine, onOpen, onEdit, onDelete }: {
  e: any; rate: number | null; mine: boolean;
} & { onOpen: () => void } & Handlers) {
  const modifiable = mine && (e.status === "pending" || e.status === "rejected");
  const reason = !mine
    ? "Можно менять только свои записи"
    : e.status === "approved" ? APPROVED_TIP : undefined;
  return (
    <div className="card" onClick={onOpen} style={{ cursor: "pointer" }} title="Открыть карточку расхода">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>
            {formatAmountWithEquivalent(e.amount, e.currency || "KGS", rate)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {e.category_name || "—"} · {new Date(e.spent_at).toLocaleDateString("ru-RU")}
          </div>
          {e.recorded_by_name && (
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>внёс: {e.recorded_by_name} (admin)</div>
          )}
          {e.description && <div style={{ marginTop: 6, fontSize: 13 }}>{e.description}</div>}
          {e.status === "rejected" && e.review_comment && (
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--danger)" }}>Причина: {e.review_comment}</div>
          )}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <ReceiptLink url={e.receipt_url} />
          <StatusBadge status={e.status} />
          <ActionsMenu items={[
            { label: "Редактировать", onClick: onEdit, disabled: !modifiable, title: reason },
            { label: "Удалить", danger: true, onClick: onDelete, disabled: !modifiable, title: reason },
          ]} />
        </div>
      </div>
    </div>
  );
}

export function IncomeCard({ inc, rate, mine, onEdit, onDelete }: {
  inc: Income; rate: number | null; mine: boolean;
} & Handlers) {
  const reason = mine ? undefined : "Внесён администратором — обратитесь к нему";
  return (
    <div className="card" style={mine ? undefined : { opacity: 0.85 }}>
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600, color: "var(--success, #16a34a)" }}>
            + {formatAmountWithEquivalent(inc.amount, inc.currency || "KGS", rate)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Приход · {inc.source} · {new Date(inc.date).toLocaleDateString("ru-RU")}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {mine ? "мой приход" : `внёс: ${inc.created_by_name || "администратор"}`}
          </div>
          {inc.description && <div style={{ marginTop: 6, fontSize: 13 }}>{inc.description}</div>}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <span className="badge" style={{ fontSize: 11 }}>ПРИХОД</span>
          <ActionsMenu items={[
            { label: "Редактировать", onClick: onEdit, disabled: !mine, title: reason },
            { label: "Удалить", danger: true, onClick: onDelete, disabled: !mine, title: reason },
          ]} />
        </div>
      </div>
    </div>
  );
}

export function TransferCard({ t, rate, onEdit, onDelete }: {
  t: MoneyTransfer; rate: number | null;
} & Handlers) {
  return (
    <div className="card">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>
            {formatAmountWithEquivalent(t.amount, "KGS", rate)} →{" "}
            <span style={{ color: "var(--accent-light)" }}>{t.to_user_name}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Передача · {new Date(t.created_at).toLocaleDateString("ru-RU")}
          </div>
          {t.note && <div style={{ marginTop: 6, fontSize: 13 }}>{t.note}</div>}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <ActionsMenu items={[
            { label: "Редактировать", onClick: onEdit },
            { label: "Удалить", danger: true, onClick: onDelete },
          ]} />
        </div>
      </div>
    </div>
  );
}
