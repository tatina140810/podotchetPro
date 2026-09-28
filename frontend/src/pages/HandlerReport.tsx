/**
 * Отчёт принимающего заявки на одобрении у владельца (шаг 3, 2026-09-28): расходы,
 * которые Индира провела по заявкам сотрудников. Владелец одобряет (по одной или
 * отмеченные), правит или отклоняет с причиной — тогда расход отменяется, а заявка
 * возвращается Индире на правку.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import HandlerReportEditDialog from "../components/HandlerReportEditDialog";
import {
  approveHandlerReport, getHandlerReport, getRequestsConfig, rejectHandlerReportRow, type HandlerReportRow,
} from "../api/requests";

type Tab = "pending" | "approved" | "all";
const cur = (c: string) => (c === "KGS" ? "с" : c);
const money = (v: string | number) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export default function HandlerReport() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<HandlerReportRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<HandlerReportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [handler, setHandler] = useState("принимающего");

  const reload = () => {
    setErr(null);
    getHandlerReport(tab).then((r) => { setRows(r); setPicked(new Set()); }).catch((e) => setErr(e.message));
  };
  useEffect(reload, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getRequestsConfig().then((c) => c.handler_name && setHandler(c.handler_name)).catch(() => {}); }, []);

  // Итоги по валютам: разные валюты не складываем в одну цифру.
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows ?? []) t[r.currency] = (t[r.currency] ?? 0) + Number(r.amount);
    return Object.entries(t);
  }, [rows]);
  const pending = (rows ?? []).filter((r) => r.status === "pending");

  async function approve(ids: number[]) {
    if (!ids.length) return;
    setBusy(true);
    try {
      await approveHandlerReport(ids);
      toast.show("success", ids.length > 1 ? `Одобрено строк: ${ids.length}` : "Одобрено");
      reload();
    } catch (e: any) { toast.show("error", e.message || "Ошибка"); } finally { setBusy(false); }
  }
  async function reject(r: HandlerReportRow) {
    const comment = prompt(`Причина — строка вернётся ${handler} на правку, расход будет отменён:`) || "";
    if (comment.trim().length < 3) return;
    setBusy(true);
    try {
      await rejectHandlerReportRow(r.expense_id, comment.trim());
      toast.show("success", `Отклонено, заявка вернулась: ${handler}`);
      reload();
    } catch (e: any) { toast.show("error", e.message || "Ошибка"); } finally { setBusy(false); }
  }
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="container">
      <h1 className="h1">Отчёт: {handler}</h1>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["pending", "approved", "all"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "" : "ghost"} onClick={() => setTab(t)}>
            {t === "pending" ? "На одобрении" : t === "approved" ? "Одобренные" : "Все"}
          </button>
        ))}
        {tab !== "approved" && pending.length > 0 && (
          <button className="success" style={{ marginLeft: "auto" }} disabled={busy || picked.size === 0}
            onClick={() => approve([...picked])}>Одобрить отмеченные ({picked.size})</button>
        )}
      </div>
      {err && <div className="card" style={{ color: "var(--danger)" }}>{err}</div>}
      {!rows && !err && <div className="muted">Загрузка...</div>}
      {rows && (
        <div className="card" style={{ overflow: "auto" }}>
          {rows.length === 0 ? <div className="empty-state">Строк нет</div> : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={pending.length > 0 && picked.size === pending.length}
                      onChange={(e) => setPicked(e.target.checked ? new Set(pending.map((r) => r.expense_id)) : new Set())} />
                  </th>
                  <th>Дата</th><th>Сотрудник</th><th>Заявка</th><th>Категория</th><th>Подразделение</th>
                  <th>Расчёт</th><th style={{ textAlign: "right" }}>Сумма</th><th>Чек</th><th>Статус</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.expense_id}>
                    <td>{r.status === "pending" && (
                      <input type="checkbox" style={{ width: "auto" }} checked={picked.has(r.expense_id)} onChange={() => toggle(r.expense_id)} />
                    )}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(r.spent_at).toLocaleDateString("ru-RU")}</td>
                    <td>{r.requester_name}</td>
                    <td>
                      <Link to={`/requests/${r.request_id}`}>№{r.request_id}</Link>{" "}
                      <span className="muted" style={{ fontSize: 12 }}>
                        {r.items.map((it) => `${it.description}${it.customer ? ` (${it.customer})` : ""}`).join("; ")}
                      </span>
                    </td>
                    <td>{r.category_name || "—"}</td>
                    <td className="muted">{r.department_name || "—"}</td>
                    <td className="muted">{r.payment_method === "bank" ? "Безнал" : r.payment_method === "cash" ? "Нал" : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.amount)} {cur(r.currency)}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.receipts.length
                        ? r.receipts.map((f, i) => <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer">чек{r.receipts.length > 1 ? ` ${i + 1}` : ""} </a>)
                        : <span className="muted" title={r.no_receipt_comment ?? ""}>нет чека{r.no_receipt_comment ? `: ${r.no_receipt_comment}` : ""}</span>}
                    </td>
                    <td><span className={`badge ${r.status === "approved" ? "approved" : "pending"}`}>{r.status === "approved" ? "Одобрено" : "На одобрении"}</span></td>
                    <td>{r.status === "pending" && (
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="success" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => approve([r.expense_id])}>Одобрить</button>
                        <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => setEditing(r)}>Изменить</button>
                        <button className="danger" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy} onClick={() => reject(r)}>Отклонить</button>
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ textAlign: "right", fontWeight: 600 }}>Итого:</td>
                  <td colSpan={4} style={{ fontWeight: 700 }}>{totals.map(([c, v]) => `${money(v)} ${cur(c)}`).join(" · ")}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
      {editing && (
        <HandlerReportEditDialog row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}
