/**
 * Принимающий проводит расход по выданной заявке (шаг 2, 2026-09-28): нужен чек или
 * «нет чека» с комментарием. Потрачено можно указать меньше выданного — остаток
 * останется на подотчёте сотрудника.
 */
import { useState } from "react";
import { closeRequest, type MoneyRequest } from "../api/requests";
import { useToast } from "./Toast";

export default function CloseRequestPanel({ req, onDone }: { req: MoneyRequest; onDone: (r: MoneyRequest) => void }) {
  const toast = useToast();
  const issued = Number(req.handler_amount ?? 0);
  const cur = req.handler_currency === "KGS" || !req.handler_currency ? "с" : req.handler_currency;
  const [amount, setAmount] = useState(String(issued));
  const [noReceipt, setNoReceipt] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const hasReceipt = (req.receipts || []).length > 0;

  async function save() {
    const amt = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!(amt > 0) || amt > issued) return toast.show("error", `Потрачено: от 0 до ${issued.toLocaleString("ru-RU")} ${cur}`);
    if (!hasReceipt && !noReceipt) return toast.show("error", "Приложите чек выше или отметьте «нет чека»");
    if (noReceipt && note.trim().length < 3) return toast.show("error", "Напишите, почему нет чека");
    setBusy(true);
    try {
      const r = await closeRequest(req.id, { amount: amt.toFixed(2), no_receipt: noReceipt, no_receipt_comment: noReceipt ? note.trim() : undefined });
      toast.show("success", "Расход проведён, заявка закрыта");
      onDone(r);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--accent)" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Провести расход и закрыть заявку</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Чек: {hasReceipt ? `приложен (${req.receipts.length})` : "не приложен"}. Выдано {issued.toLocaleString("ru-RU")} {cur}.
      </div>
      <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 180 }}>
          <label>Потрачено, {cur}</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ textAlign: "right" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", margin: 0 }}>
          <input type="checkbox" checked={noReceipt} onChange={(e) => setNoReceipt(e.target.checked)} style={{ width: "auto" }} />
          Нет чека
        </label>
      </div>
      {noReceipt && (
        <div style={{ marginTop: 8 }}>
          <label>Почему нет чека</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="например: оплата таксисту наличными" />
        </div>
      )}
      <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button type="button" className="success" onClick={save} disabled={busy}>Провести расход</button>
      </div>
    </div>
  );
}
