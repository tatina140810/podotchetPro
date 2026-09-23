import { useEffect, useState } from "react";
import { api, uploadReceipts } from "../api/client";
import { useToast } from "./Toast";
import { listDepartments, type Department } from "../api/departments";
import { listColleagues } from "../api/users";
import { useAuth, type UserOut } from "../context/AuthContext";

interface Category { id: number; name: string }
interface Receipt { id: number; file_url: string; file_name?: string | null }

interface Props {
  expense: {
    id: number;
    amount: string | number;
    currency: string;
    category_id: number | null;
    description: string | null;
    spent_at: string;
    /** На кого оформлен расход. Есть не во всех списках — тогда селект сотрудника скрыт. */
    employee_id?: number | null;
    department_id?: number | null;
  };
  onClose: () => void;
  onSaved: () => void;
}

export function EditExpenseModal({ expense, onClose, onSaved }: Props) {
  const toast = useToast();
  const { user: me } = useAuth();
  // Менять сотрудника, на которого оформлен расход, может только директор/админ/аудитор
  // (бэкенд иначе вернёт 403) и только там, где список даёт employee_id.
  const canEditEmployee =
    expense.employee_id != null &&
    ["superadmin", "admin", "gen_director", "auditor"].includes(me?.role || "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [employeeId, setEmployeeId] = useState(
    expense.employee_id != null ? String(expense.employee_id) : ""
  );
  const [departmentId, setDepartmentId] = useState(
    expense.department_id != null ? String(expense.department_id) : ""
  );
  const [form, setForm] = useState({
    amount: String(expense.amount),
    currency: (expense.currency || "KGS") as "KGS" | "USD" | "EUR" | "RUB",
    category_id: expense.category_id ? String(expense.category_id) : "",
    description: expense.description || "",
    spent_at: expense.spent_at ? expense.spent_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");

  function loadReceipts() {
    api<Receipt[]>(`/api/expenses/${expense.id}/receipts`).then(setReceipts).catch(() => {});
  }
  useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments(true).then(setDepartments).catch(() => {});
    if (canEditEmployee) listColleagues().then(setColleagues).catch(() => {});
    loadReceipts();
  }, []);

  // Жёсткая привязка выбранного сотрудника: подразделение у такого расхода не
  // выбирается — сервер всё равно поставит закреплённое, поэтому показываем его текстом.
  const selectedEmployee = colleagues.find((c) => String(c.id) === employeeId);
  const forcedDeptId = selectedEmployee?.forced_department_id ?? null;
  const forcedDeptName = forcedDeptId
    ? (departments.find((d) => d.id === forcedDeptId)?.name || "закреплённое подразделение")
    : null;

  async function onReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    // Множественный выбор: грузим по очереди и прикрепляем все файлы разом.
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // тот же файл можно выбрать повторно
    if (files.length === 0) return;
    setUploading(true);
    setProgress(files.length > 1 ? `0 / ${files.length}` : "");
    let done = 0;
    try {
      const uploaded = await uploadReceipts(files, (n, total) => {
        if (total > 1) setProgress(`${n} / ${total}`);
      });
      for (const u of uploaded) {
        await api(`/api/expenses/${expense.id}/receipts`, { method: "POST", body: { file_url: u.url, file_name: u.name } });
        done += 1;
      }
      toast.show("success", done > 1 ? `Прикреплено чеков: ${done}` : "Чек прикреплён");
      loadReceipts();
    } catch (err: any) {
      toast.show("error", err.message);
      if (done) loadReceipts();  // часть могла прикрепиться — показываем её
    } finally { setUploading(false); setProgress(""); }
  }

  async function removeReceipt(id: number) {
    try {
      await api(`/api/expenses/${expense.id}/receipts/${id}`, { method: "DELETE" });
      loadReceipts();
    } catch (err: any) {
      toast.show("error", err.message);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Сумма > 0"); return; }
    setBusy(true);
    try {
      const body: any = {
        amount: amt,
        currency: form.currency,
        category_id: form.category_id ? Number(form.category_id) : null,
        description: form.description.trim() || null,
        spent_at: new Date(form.spent_at).toISOString(),
      };
      // department_id отправляем только если выбрали (иначе не трогаем текущее).
      if (departmentId) body.department_id = Number(departmentId);
      if (canEditEmployee && employeeId && Number(employeeId) !== expense.employee_id) {
        body.employee_id = Number(employeeId);
      }
      await api(`/api/expenses/${expense.id}`, { method: "PATCH", body });
      toast.show("success", "Расход обновлён");
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "5vh 16px", overflowY: "auto",
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2">Изменить расход</h2>
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
          При смене суммы или валюты КГС-эквивалент пересчитается по текущему курсу.
        </div>
        <form onSubmit={submit} className="grid">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" required />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label>Валюта</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as any })}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="RUB">RUB</option>
              </select>
            </div>
          </div>
          <div>
            <label>Категория</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— нет —</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
          {canEditEmployee && (
            <div>
              <label>Сотрудник</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Расход перейдёт на выбранного сотрудника — изменятся балансы обоих.
              </div>
            </div>
          )}
          <div>
            <label>Подразделение</label>
            {forcedDeptName ? (
              <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>
                {forcedDeptName} — закреплено за сотрудником, изменить нельзя
              </div>
            ) : (
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">— не менять —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} />
          </div>
          <div>
            <label>Описание</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label>Чеки / документы</label>
            {receipts.length > 0 && (
              <div className="grid" style={{ gap: 4, marginBottom: 6 }}>
                {receipts.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                    <a href={r.file_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.file_name || "документ"}
                    </a>
                    <button type="button" className="ghost" style={{ fontSize: 11, padding: "1px 6px" }} onClick={() => removeReceipt(r.id)}>убрать</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ cursor: "pointer", color: "var(--accent)", fontSize: 13 }}>
              {uploading ? (progress ? `загружаю ${progress}...` : "загружаю...") : "+ прикрепить чеки/документы"}
              <input type="file" multiple accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx,.csv" style={{ display: "none" }} onChange={onReceiptFile} disabled={uploading} />
            </label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
