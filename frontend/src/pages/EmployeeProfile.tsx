import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth, isDirectorLevel, isDirectorOrAuditor, type Role, type UserOut } from "../context/AuthContext";
import { useDisplayCurrency } from "../context/CurrencyContext";
import { useToast } from "../components/Toast";
import { StatusBadge } from "../components/StatusBadge";
import { ProfileEditableTable } from "../components/ProfileEditableTable";
import { api } from "../api/client";
import { listColleagues } from "../api/users";
import { listDepartments, type Department } from "../api/departments";
import {
  getEmployeeProfile, exportEmployeeProfile, profileApi, type EmployeeProfile,
} from "../api/employees";

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const ROLE_RU: Record<Role, string> = {
  superadmin: "суперадмин", admin: "admin", gen_director: "директор",
  auditor: "аудитор", accountable: "подотчётный",
};
type SectionKey = "received" | "transferred" | "expenses" | "requests";
interface CatOpt { id: number; name: string; display_name?: string | null }

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const uid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { display } = useDisplayCurrency();
  const [sp] = useSearchParams();
  const today = new Date();

  const [month, setMonth] = useState(Number(sp.get("month")) || today.getMonth() + 1);
  const [year, setYear] = useState(Number(sp.get("year")) || today.getFullYear());
  const [data, setData] = useState<EmployeeProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<SectionKey>>(new Set());
  const [exporting, setExporting] = useState(false);
  // Редактирование: только один редактор одновременно (ключ "kind:id" | "kind:new" | "req:id").
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [reqComment, setReqComment] = useState("");
  // Справочники для dropdown'ов (грузим только редакторам).
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [categories, setCategories] = useState<CatOpt[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Undo после удаления.
  const [undo, setUndo] = useState<{ label: string; fn: () => Promise<any> } | null>(null);

  const canEdit = isDirectorOrAuditor(user?.role);
  const canExport = isDirectorLevel(user?.role);

  const reload = () => getEmployeeProfile(uid, month, year, display).then(setData).catch((e) => setErr(e.message));

  useEffect(() => {
    setData(null); setErr(null); setEditingKey(null);
    getEmployeeProfile(uid, month, year, display).then(setData).catch((e) => setErr(e.message));
  }, [uid, month, year, display]);

  useEffect(() => {
    if (!canEdit) return;
    listColleagues().then(setColleagues).catch(() => {});
    api<CatOpt[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, [canEdit]);

  // Undo-таймер: 5 секунд.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  const sym = data?.currency === "USD" ? "$" : "с";
  const fmt = (n: number) => n.toLocaleString("ru-RU");

  function toggle(k: SectionKey) {
    setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  function openAndScroll(k: SectionKey) {
    setOpen((p) => new Set(p).add(k));
    setTimeout(() => document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function onDeleted(label: string, fn: () => Promise<any>) {
    setUndo({ label, fn });
  }
  async function doUndo() {
    if (!undo) return;
    try { await undo.fn(); toast.show("success", "Восстановлено"); reload(); }
    catch (e: any) { toast.show("error", e.message || "Не удалось восстановить"); }
    finally { setUndo(null); }
  }

  async function onExport() {
    if (!data) return;
    setExporting(true);
    try { await exportEmployeeProfile(uid, month, year, display, data.employee.name); }
    catch (e: any) { toast.show("error", e.message || "Не удалось скачать"); }
    finally { setExporting(false); }
  }

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div></div>;
  if (!data) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const s = data.summary;
  const emp = data.employee;
  const otherEditing = editingKey !== null;

  const tableProps = {
    sym, fmt, canEdit, editingKey, setEditingKey,
    colleagues, categories, employeeId: uid,
    employeeDeptIds: emp.department_ids || [], departments,
    onChanged: reload, onDeleted,
  };

  async function saveReqComment(reqId: number) {
    try { await profileApi.updateRequestComment(reqId, reqComment); toast.show("success", "Сохранено"); setEditingKey(null); reload(); }
    catch (e: any) { toast.show("error", e.message || "Ошибка"); }
  }
  async function delRequest(r: any) {
    if (!confirm("Удалить эту запись? Действие необратимо.")) return;
    try { await profileApi.deleteRequest(r.id); toast.show("success", "Удалено"); reload(); }
    catch (e: any) { toast.show("error", e.message || "Не удалось удалить"); }
  }

  return (
    <div className="container">
      <button className="ghost" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Назад</button>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "var(--accent)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18,
            }}>{initials(emp.name)}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{emp.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {ROLE_RU[emp.role as Role] || emp.role}{emp.department ? ` · ${emp.department}` : ""}
              </div>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <Link
                  to={`/requests/recurring?user_id=${id}&name=${encodeURIComponent(emp.name)}`}
                  style={{ fontSize: 13 }}
                >
                  Регулярные обязательства →
                </Link>
                <Link
                  to={`/reports/incomes?tab=expected&user_id=${id}&name=${encodeURIComponent(emp.name)}`}
                  style={{ fontSize: 13 }}
                >
                  Ожидаемые пополнения →
                </Link>
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label>Месяц</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label>Год</label>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            {canExport && (
              <button onClick={onExport} disabled={exporting} style={{ background: "#107C41", color: "#fff" }}>
                {exporting ? "..." : "Excel"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span>Текущий остаток / долг</span>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: s.balance < 0 ? "var(--danger)" : "var(--success)" }}>
              {fmt(s.balance)} {sym}
            </span>
            {s.debt > 0
              ? <span className="badge rejected">Долг {fmt(s.debt)} {sym}</span>
              : <span className="badge approved">Остаток {fmt(s.balance)} {sym}</span>}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        <MetricCard label="Получил" total={`${fmt(s.received.total)} ${sym}`} count={s.received.count} color="var(--success)" onClick={() => openAndScroll("received")} />
        <MetricCard label="Передал дальше" total={`${fmt(s.transferred.total)} ${sym}`} count={s.transferred.count} color="#e67e22" onClick={() => openAndScroll("transferred")} />
        <MetricCard label="Потратил" total={`${fmt(s.spent.total)} ${sym}`} count={s.spent.count} color="var(--danger)" onClick={() => openAndScroll("expenses")} />
        <MetricCard label="Заявки" total={`${data.requests_own.length + data.requests_approved_by.length}`} count={data.requests_own.length + data.requests_approved_by.length} color="#3b82f6" onClick={() => openAndScroll("requests")} />
      </div>

      <ProfileEditableTable anchorId="received" title="Приходы" color="var(--success)" sum={`${fmt(s.received.total)} ${sym}`}
        isOpen={open.has("received")} onToggle={() => toggle("received")} kind="received" rows={data.received} {...tableProps} />

      <ProfileEditableTable anchorId="transferred" title="Передал дальше" color="#e67e22" sum={`${fmt(s.transferred.total)} ${sym}`}
        isOpen={open.has("transferred")} onToggle={() => toggle("transferred")} kind="transferred" rows={data.transferred} {...tableProps} />

      <ProfileEditableTable anchorId="expenses" title="Расходы" color="var(--danger)" sum={`${fmt(s.spent.total)} ${sym}`}
        isOpen={open.has("expenses")} onToggle={() => toggle("expenses")} kind="expenses" rows={data.expenses} {...tableProps} />

      {/* Заявки — правка только комментария + удаление (auditor+). */}
      <div id="sec-requests" className="card" style={{ marginBottom: 10, padding: 0 }}>
        <div className="row between" style={{ padding: 14, borderLeft: "3px solid #3b82f6", cursor: "pointer" }} onClick={() => toggle("requests")}>
          <span style={{ fontWeight: 600 }}>{open.has("requests") ? "▼" : "▶"} Заявки</span>
          <span style={{ fontWeight: 700, color: "#3b82f6" }}>{data.requests_own.length + data.requests_approved_by.length}</span>
        </div>
        {open.has("requests") && (
          <div style={{ padding: 14, paddingTop: 0, overflow: "auto" }}>
            <div style={{ fontWeight: 600, margin: "4px 0 8px" }}>Мои заявки</div>
            <RequestTable rows={data.requests_own} withEmployee={false} sym={sym} fmt={fmt}
              canEdit={canEdit} otherEditing={otherEditing} editingKey={editingKey}
              onEdit={(r) => { setReqComment(r.comment || ""); setEditingKey(`req:${r.id}`); }}
              reqComment={reqComment} setReqComment={setReqComment}
              onSave={saveReqComment} onCancel={() => setEditingKey(null)} onDelete={delRequest} />
            {data.requests_approved_by.length > 0 && (
              <>
                <div style={{ fontWeight: 600, margin: "16px 0 8px" }}>Одобрял / отклонял</div>
                <RequestTable rows={data.requests_approved_by} withEmployee={true} sym={sym} fmt={fmt}
                  canEdit={canEdit} otherEditing={otherEditing} editingKey={editingKey}
                  onEdit={(r) => { setReqComment(r.comment || ""); setEditingKey(`req:${r.id}`); }}
                  reqComment={reqComment} setReqComment={setReqComment}
                  onSave={saveReqComment} onCancel={() => setEditingKey(null)} onDelete={delRequest} />
              </>
            )}
          </div>
        )}
      </div>

      {undo && createPortal(
        <div style={{
          position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          padding: "10px 16px", borderRadius: 10, background: "rgba(20,28,48,0.96)",
          border: "1px solid rgba(37,99,235,0.6)", boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
          display: "flex", gap: 12, alignItems: "center",
        }}>
          <span style={{ color: "#fff", fontSize: 14 }}>{undo.label}</span>
          <button onClick={doUndo} style={{ padding: "4px 12px", fontSize: 13 }}>Отменить</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function MetricCard({ label, total, count, color, onClick }: {
  label: string; total: string; count: number; color: string; onClick: () => void;
}) {
  return (
    <div className="card" onClick={onClick} style={{ cursor: "pointer", padding: 14 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4 }}>{total}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{count} операций ↓</div>
    </div>
  );
}

function RequestTable({ rows, withEmployee, sym, fmt, canEdit, otherEditing, editingKey, onEdit, reqComment, setReqComment, onSave, onCancel, onDelete }: {
  rows: any[]; withEmployee: boolean; sym: string; fmt: (n: number) => string;
  canEdit: boolean; otherEditing: boolean; editingKey: string | null;
  onEdit: (r: any) => void; reqComment: string; setReqComment: (s: string) => void;
  onSave: (id: number) => void; onCancel: () => void; onDelete: (r: any) => void;
}) {
  const head = withEmployee
    ? ["Дата", "Сотрудник", "Категория", "Сумма", "Решение", ""]
    : ["Дата", "Категория", "Сумма", "Статус", "Комментарий", ""];
  return (
    <table>
      <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={head.length} className="muted">Пусто</td></tr>}
        {rows.map((r) => {
          const editing = editingKey === `req:${r.id}`;
          const amount = <>{fmt(r.amount_kgs)} {sym}{r.currency !== "KGS" && <span className="muted" style={{ fontSize: 11 }}> ({fmt(r.amount)} {r.currency})</span>}</>;
          return (
            <tr key={r.id} className="prow">
              <td className="muted" style={{ fontSize: 12 }}>{r.date.slice(0, 10)}</td>
              {withEmployee && <td>{r.employee_name || "—"}</td>}
              <td className="muted">{r.category || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{amount}</td>
              <td><StatusBadge status={r.status} /></td>
              {!withEmployee && (
                <td className="muted" style={{ fontSize: 12 }}>
                  {editing
                    ? <input value={reqComment} onChange={(e) => setReqComment(e.target.value)} placeholder="Комментарий" />
                    : (r.comment || "")}
                </td>
              )}
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {canEdit && (editing ? (
                  <>
                    <button onClick={() => onSave(r.id)} style={{ padding: "2px 8px" }}>✓</button>
                    <button className="ghost" onClick={onCancel} style={{ padding: "2px 8px" }}>✗</button>
                  </>
                ) : (
                  <span className="prow-actions">
                    <button className="ghost" disabled={otherEditing} onClick={() => onEdit(r)} title="Изменить комментарий" style={{ padding: "2px 8px" }}>Изм.</button>
                    <button className="danger" disabled={otherEditing} onClick={() => onDelete(r)} title="Удалить" style={{ padding: "2px 8px" }}>Удал.</button>
                  </span>
                ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
