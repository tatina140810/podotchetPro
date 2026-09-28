/** Блок упрощённой заявки в карточке: разноска принимающего и факт выдачи. */
import type { MoneyRequest } from "../api/requests";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="row between" style={{ fontSize: 13 }}><span className="muted">{k}</span><span>{v}</span></div>
);

export function SimpleRequestInfo({ req }: { req: MoneyRequest }) {
  if (!req.handler_category_name && !req.issued_at) return null;
  const cur = req.handler_currency === "KGS" || !req.handler_currency ? "с" : req.handler_currency;
  return (
    <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--success)" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Разноска ({req.approver_name})</div>
      <Row k="Категория" v={req.handler_category_name || "—"} />
      <Row k="Подразделение" v={req.department_name || "—"} />
      <Row k="Расчёт" v={req.handler_payment_method === "bank" ? "Безнал" : req.handler_payment_method === "cash" ? "Наличные" : "—"} />
      <Row k="Сумма к выдаче" v={<b>{Number(req.handler_amount ?? 0).toLocaleString("ru-RU")} {cur}</b>} />
      <Row k="Дата" v={req.handler_date ? new Date(req.handler_date).toLocaleDateString("ru-RU") : "—"} />
      {req.handler_comment && <Row k="Комментарий" v={req.handler_comment} />}
      {req.issued_at && (
        <Row k="Выдано" v={`${new Date(req.issued_at).toLocaleString("ru-RU")}${req.issued_by_name ? ` — ${req.issued_by_name}` : ""}`} />
      )}
      {req.closed_at && <Row k="Расход проведён" v={new Date(req.closed_at).toLocaleString("ru-RU")} />}
      {req.no_receipt && <Row k="Чек" v={`нет чека — ${req.no_receipt_comment ?? ""}`} />}
    </div>
  );
}
