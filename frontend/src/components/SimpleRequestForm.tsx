/**
 * Упрощённая заявка (2026-09-28): сотрудник пишет свободно — описание, заказчик,
 * кол-во, сумма, комментарий. Ни категорий, ни подразделения, ни выбора адресата:
 * заявка сразу уходит принимающему (Индире), он её разнесёт при одобрении.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "./Toast";
import { createSimpleRequest, type SimpleItemIn } from "../api/requests";

interface Row { description: string; customer: string; quantity: string; amount: string; comment: string }
const EMPTY: Row = { description: "", customer: "", quantity: "1", amount: "", comment: "" };
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));

export default function SimpleRequestForm({ handlerName }: { handlerName: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  const [currency, setCurrency] = useState("KGS");
  const [busy, setBusy] = useState(false);

  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const total = useMemo(
    () => rows.reduce((s, r) => s + (num(r.amount) > 0 ? num(r.amount) * Math.max(1, num(r.quantity) || 1) : 0), 0),
    [rows],
  );

  async function send() {
    const items: SimpleItemIn[] = [];
    for (const [i, r] of rows.entries()) {
      if (!r.description.trim() && !r.amount.trim()) continue; // пустую строку пропускаем
      if (!r.description.trim()) { toast.show("error", `Строка ${i + 1}: опишите расход`); return; }
      if (!(num(r.amount) > 0)) { toast.show("error", `Строка ${i + 1}: укажите сумму`); return; }
      const q = Math.round(num(r.quantity) || 1);
      if (q < 1) { toast.show("error", `Строка ${i + 1}: количество не меньше 1`); return; }
      items.push({
        description: r.description.trim(), customer: r.customer.trim() || undefined, quantity: q,
        amount: String(num(r.amount).toFixed(2)), comment: r.comment.trim() || undefined,
      });
    }
    if (!items.length) { toast.show("error", "Заполните хотя бы одну строку"); return; }
    setBusy(true);
    try {
      const req = await createSimpleRequest({ currency, items });
      toast.show("success", `Заявка отправлена: ${handlerName}`);
      nav(`/requests/${req.id}`);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1 className="h1">Подать заявку</h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        Заявка уйдёт: <b>{handlerName}</b>. Категорию и подразделение она укажет сама при одобрении.
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Описание расхода</th>
              <th>Заказчик</th>
              <th style={{ width: 80 }}>Кол-во</th>
              <th style={{ width: 130, textAlign: "right" }}>Сумма</th>
              <th>Комментарий</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input value={r.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Бумага A4" maxLength={500} /></td>
                <td><input value={r.customer} onChange={(e) => upd(i, { customer: e.target.value })} placeholder="кто заказал" maxLength={200} /></td>
                <td><input value={r.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} inputMode="numeric" /></td>
                <td><input value={r.amount} onChange={(e) => upd(i, { amount: e.target.value })} inputMode="decimal" style={{ textAlign: "right" }} /></td>
                <td><input value={r.comment} onChange={(e) => upd(i, { comment: e.target.value })} maxLength={2000} /></td>
                <td>
                  <button type="button" className="ghost" style={{ padding: "4px 8px" }} disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="ghost" onClick={() => setRows((rs) => [...rs, { ...EMPTY }])}>+ Добавить строку</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row between" style={{ alignItems: "center", gap: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <label style={{ margin: 0 }}>Валюта</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: "auto" }}>
              {["KGS", "USD", "EUR", "RUB"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <span style={{ fontSize: 22, fontWeight: 700 }}>
            Итого: {total.toLocaleString("ru-RU")} {currency === "KGS" ? "с" : currency}
          </span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button type="button" onClick={send} disabled={busy}>Отправить заявку — {handlerName}</button>
      </div>
    </div>
  );
}
