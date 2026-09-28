/** Правка строки отчёта принимающего владельцем (шаг 3): категория, подразделение,
 *  расчёт, сумма (не больше выданного), дата, описание. */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { listDepartments, type Department } from "../api/departments";
import { editHandlerReportRow, type HandlerReportRow } from "../api/requests";
import { CategoryPicker, type CatOpt } from "./CategoryPicker";
import { useToast } from "./Toast";

export default function HandlerReportEditDialog({ row, onClose, onDone }: {
  row: HandlerReportRow; onClose: () => void; onDone: (r: HandlerReportRow) => void;
}) {
  const toast = useToast();
  const [cats, setCats] = useState<CatOpt[]>([]);
  const [deps, setDeps] = useState<Department[]>([]);
  const [categoryId, setCategoryId] = useState(row.category_id ? String(row.category_id) : "");
  const [departmentId, setDepartmentId] = useState(row.department_id ? String(row.department_id) : "");
  const [method, setMethod] = useState<"cash" | "bank">(row.payment_method ?? "cash");
  const [amount, setAmount] = useState(String(Number(row.amount)));
  const [date, setDate] = useState(row.spent_at.slice(0, 10));
  const [description, setDescription] = useState(row.description ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CatOpt[]>("/api/categories").then(setCats).catch(() => {});
    listDepartments(true).then(setDeps).catch(() => {});
  }, []);

  async function save() {
    const amt = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!(amt > 0)) return toast.show("error", "Укажите сумму");
    setBusy(true);
    try {
      const r = await editHandlerReportRow(row.expense_id, {
        category_id: categoryId ? Number(categoryId) : undefined,
        department_id: departmentId ? Number(departmentId) : undefined,
        payment_method: method, amount: amt.toFixed(2), spent_date: date, description: description.trim() || undefined,
      });
      toast.show("success", "Строка исправлена");
      onDone(r);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const cur = row.currency === "KGS" ? "с" : row.currency;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Исправить: {row.requester_name} — {row.request_title}</h2>
        <div className="grid" style={{ gap: 10 }}>
          <div><label>Категория</label><CategoryPicker cats={cats} value={categoryId} onChange={setCategoryId} /></div>
          <div>
            <label>Подразделение</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {(["cash", "bank"] as const).map((m) => (
              <button key={m} type="button" className={method === m ? "" : "ghost"} onClick={() => setMethod(m)}>
                {m === "cash" ? "Наличные" : "Безнал"}
              </button>
            ))}
          </div>
          <div>
            <label>Сумма, {cur} (выдано {Number(row.issued_amount ?? 0).toLocaleString("ru-RU")})</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ textAlign: "right" }} />
          </div>
          <div><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label>Описание</label><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" onClick={save} disabled={busy}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}
