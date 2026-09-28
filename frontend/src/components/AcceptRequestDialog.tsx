/**
 * «Одобрить» упрощённую заявку (2026-09-28): принимающий разносит её так же, как
 * строку «Импорта истории» — категория, подразделение, нал/безнал, сумма и валюта
 * к выдаче, дата, комментарий. Деньги при этом НЕ двигаются: выдача — кнопкой «Выдал».
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { listDepartments, type Department } from "../api/departments";
import { acceptRequest, type MoneyRequest } from "../api/requests";
import { CategoryPicker, type CatOpt } from "./CategoryPicker";
import { useToast } from "./Toast";

const today = () => new Date().toLocaleDateString("en-CA");

export default function AcceptRequestDialog({ req, onClose, onDone }: {
  req: MoneyRequest; onClose: () => void; onDone: (r: MoneyRequest) => void;
}) {
  const toast = useToast();
  const [cats, setCats] = useState<CatOpt[]>([]);
  const [deps, setDeps] = useState<Department[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState(req.department_id ? String(req.department_id) : "");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [amount, setAmount] = useState(String(Number(req.total_amount)));
  const [currency, setCurrency] = useState(req.currency || "KGS");
  const [date, setDate] = useState(today());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CatOpt[]>("/api/categories").then(setCats).catch(() => {});
    listDepartments(true).then((ds) => {
      setDeps(ds);
      if (!req.department_id && ds.length === 1) setDepartmentId(String(ds[0].id));
    }).catch(() => {});
  }, [req.department_id]);

  async function save() {
    const amt = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!categoryId) return toast.show("error", "Выберите категорию расхода");
    if (!departmentId) return toast.show("error", "Выберите подразделение");
    if (!(amt > 0)) return toast.show("error", "Укажите сумму");
    setBusy(true);
    try {
      const r = await acceptRequest(req.id, {
        category_id: Number(categoryId), department_id: Number(departmentId), payment_method: method,
        amount: amt.toFixed(2), currency, spent_date: date, comment: comment.trim() || undefined,
      });
      toast.show("success", "Одобрено — сотруднику ушло «можете забрать у бухгалтерии»");
      onDone(r);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Одобрить: {req.title}</h2>
        <div className="muted" style={{ marginBottom: 12 }}>
          {req.requester_name} просит {Number(req.total_amount).toLocaleString("ru-RU")} {req.currency === "KGS" ? "с" : req.currency}
        </div>
        <div className="grid" style={{ gap: 10 }}>
          <div>
            <label>Категория расхода</label>
            <CategoryPicker cats={cats} value={categoryId} onChange={setCategoryId} />
          </div>
          <div>
            <label>Подразделение</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— выберите —</option>
              {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label>Тип расчёта</label>
            <div className="row" style={{ gap: 8 }}>
              {(["cash", "bank"] as const).map((m) => (
                <button key={m} type="button" className={method === m ? "" : "ghost"} onClick={() => setMethod(m)}>
                  {m === "cash" ? "Наличные" : "Безнал"}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Сумма к выдаче</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ textAlign: "right" }} />
            </div>
            <div style={{ width: 110 }}>
              <label>Валюта</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["KGS", "USD", "EUR", "RUB"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Комментарий</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" onClick={save} disabled={busy}>Одобрить</button>
        </div>
      </div>
    </div>
  );
}
