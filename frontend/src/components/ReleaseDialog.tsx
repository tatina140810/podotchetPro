/**
 * Еженедельная выдача владельца принимающему (шаг 4, 2026-09-28): одна выдача
 * Ice → Индира, и все одобренные, ещё не выпущенные строки её отчёта уходят в три
 * отчёта (по категориям, по сотрудникам, по подразделениям) и в Google-таблицу.
 * Сумма по умолчанию — итог этих строк; её можно поменять (выдать больше/меньше).
 */
import { useMemo, useState } from "react";
import { releaseHandlerReport, type HandlerReportRow } from "../api/requests";
import { useToast } from "./Toast";

export default function ReleaseDialog({ rows, handler, onClose, onDone }: {
  rows: HandlerReportRow[]; handler: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const byCur = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.currency] = (t[r.currency] ?? 0) + Number(r.amount);
    return t;
  }, [rows]);
  const firstCur = Object.keys(byCur)[0] ?? "KGS";
  const [currency, setCurrency] = useState(firstCur);
  const [amount, setAmount] = useState(String(byCur[firstCur] ?? ""));
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const amt = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!(amt > 0)) return toast.show("error", "Укажите сумму выдачи");
    setBusy(true);
    try {
      const r = await releaseHandlerReport({ amount: amt.toFixed(2), currency, payment_method: method, note: note.trim() || undefined });
      toast.show("success", `Выдано ${handler}; в отчёты ушло строк: ${r.released}`);
      onDone();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto" }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Выдача: {handler}</h2>
        <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          Одобренных строк ждёт выпуска: {rows.length} на {Object.entries(byCur).map(([c, v]) => `${v.toLocaleString("ru-RU")} ${c === "KGS" ? "с" : c}`).join(" + ")}.
          После выдачи они появятся в отчётах по категориям, сотрудникам и подразделениям.
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>Сумма выдачи</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ textAlign: "right" }} />
          </div>
          <div style={{ width: 110 }}>
            <label>Валюта</label>
            <select value={currency} onChange={(e) => { setCurrency(e.target.value); if (byCur[e.target.value]) setAmount(String(byCur[e.target.value])); }}>
              {["KGS", "USD", "EUR", "RUB"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          {(["cash", "bank"] as const).map((m) => (
            <button key={m} type="button" className={method === m ? "" : "ghost"} onClick={() => setMethod(m)}>
              {m === "cash" ? "Наличные" : "Безнал"}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Комментарий</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="например: неделя 22–28 сентября" />
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" onClick={save} disabled={busy}>Выдать и выпустить в отчёты</button>
        </div>
      </div>
    </div>
  );
}
