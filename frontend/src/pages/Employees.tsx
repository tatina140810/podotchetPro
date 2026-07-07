import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import {
  isDirectorLevel,
  useAuth,
  type Role,
  type UserOut,
} from "../context/AuthContext";
import { topupUser } from "../api/transfers";
import { listDepartments, type Department } from "../api/departments";
import { EditUserModal } from "../components/EditUserModal";

interface UserWithBalance {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  supervisor_id: number | null;
  is_active: boolean;
  is_confidential: boolean;
  department_ids: number[];
  current_balance: string | number;
  total_issued: string | number;
  balance: string | number;
  monthly_spent: string | number;
  monthly_limit: string | number;
}

const ROLE_RU: Record<Role, string> = {
  superadmin: "суперадмин",
  admin: "admin",
  gen_director: "директор",
  auditor: "аудитор",
  accountable: "подотчётный",
};

const ROLE_BADGE: Record<Role, string> = {
  superadmin: "approved",
  admin: "approved",
  gen_director: "approved",
  auditor: "pending",
  accountable: "",
};

export default function Employees() {
  const { user } = useAuth();
  const [list, setList] = useState<UserWithBalance[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [topupTarget, setTopupTarget] = useState<UserWithBalance | null>(null);
  const [editTarget, setEditTarget] = useState<UserWithBalance | null>(null);
  const toast = useToast();

  const reload = () => api<UserWithBalance[]>("/api/users").then(setList);

  useEffect(() => { reload(); }, []);

  if (!list) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const byId = new Map(list.map((u) => [u.id, u]));

  // Кто может видеть «Выдано» и кнопку «Выдать»: admin + gen_director (те, кто может делать topup).
  const canIssue = isDirectorLevel(user?.role);
  // Редактировать профиль (роль, подразделения) может admin/superadmin (PATCH /api/users → require_admin).
  const canEdit = user?.role === "admin" || user?.role === "superadmin";
  const colCount = canIssue ? 7 : 6;

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Сотрудники</h1>
        <button onClick={() => setShowAdd(true)}>+ Добавить</button>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Роль</th>
              <th>Руководитель</th>
              <th style={{ textAlign: "right" }}>Баланс</th>
              {canIssue && <th style={{ textAlign: "right" }}>Выдано</th>}
              <th>Лимит месяца</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const cur = Number(u.current_balance);
              const issued = Number(u.total_issued);
              const sup = u.supervisor_id ? byId.get(u.supervisor_id) : null;
              // В пространстве баланс держат все участники (в т.ч. владелец-admin),
              // поэтому у владельца пространства показываем баланс по всем строкам.
              const isAccountable = u.role === "accountable" || !!user?.workspace_owner;
              return (
                <tr key={u.id}>
                  <td>
                    <Link to={`/employees/${u.id}`}>{u.name}</Link>
                    <div className="muted" style={{ fontSize: 11 }}>{u.phone}</div>
                  </td>
                  <td>
                    <span className={`badge ${ROLE_BADGE[u.role] || ""}`}>
                      {ROLE_RU[u.role] || u.role}
                    </span>
                  </td>
                  <td className="muted">{sup ? sup.name : "—"}</td>
                  {/* Баланс — только для accountable; для остальных прочерк. */}
                  <td style={{
                    textAlign: "right",
                    fontWeight: 600,
                    color: isAccountable && cur < 0 ? "var(--danger)" : undefined,
                  }}>
                    {isAccountable ? `${cur.toLocaleString("ru-RU")} с` : <span className="muted">—</span>}
                  </td>
                  {canIssue && (
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {issued > 0 ? `${issued.toLocaleString("ru-RU")} с` : <span className="muted">—</span>}
                    </td>
                  )}
                  <td style={{ minWidth: 180 }}>
                    {isAccountable
                      ? <ProgressBar value={Number(u.monthly_spent)} max={Number(u.monthly_limit)} />
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <Link to={`/reports/employees/${u.id}`} title="Профиль / отчёт сотрудника">
                        <button className="ghost" style={{ padding: "6px 10px" }}>Профиль</button>
                      </Link>
                      {canEdit && (
                        <button className="ghost" style={{ padding: "6px 10px" }}
                                title="Изменить роль, подразделения и данные"
                                onClick={() => setEditTarget(u)}>Изменить</button>
                      )}
                      {canIssue && <button onClick={() => setTopupTarget(u)}>Выдать</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={colCount} className="muted">Пока никого нет</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddEmployeeModal
          colleagues={list as unknown as UserOut[]}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
            toast.show("success", "Сотрудник добавлен");
          }}
        />
      )}

      {topupTarget && (
        <TopUpModal
          target={topupTarget}
          onClose={() => setTopupTarget(null)}
          onSaved={(amount) => {
            setTopupTarget(null);
            reload();
            toast.show("success", `Выдано: +${amount.toLocaleString("ru-RU")} с`);
          }}
        />
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            reload();
            toast.show("success", "Сохранено");
          }}
        />
      )}
    </div>
  );
}

interface CategoryOpt { id: number; name: string; is_system?: boolean }

function TopUpModal({
  target,
  onClose,
  onSaved,
}: {
  target: UserWithBalance;
  onClose: () => void;
  onSaved: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"KGS" | "USD" | "EUR" | "RUB">("KGS");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CategoryOpt[]>("/api/categories").then((cats) => {
      setCategories(cats);
      // По умолчанию выбираем «Подотчёт» — безопасный вариант, получатель отчитается сам.
      const podotchet = cats.find((c) => c.is_system && c.name === "Подотчёт");
      if (podotchet) setCategoryId(String(podotchet.id));
    }).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  const selectedCat = categories.find((c) => String(c.id) === categoryId);
  const isPodotchet = !!selectedCat?.is_system;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) {
      setErr("Введите сумму больше 0");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await topupUser(target.id, {
        amount: amt,
        currency,
        note: note.trim() || null,
        date: date ? new Date(date).toISOString() : undefined,
        category_id: categoryId ? Number(categoryId) : null,
        department_id: departmentId ? Number(departmentId) : null,
      });
      onSaved(amt);
    } catch (e: any) {
      setErr(e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, width: "100%" }}>
        <h2 className="h2">Выдать → {target.name}</h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Текущий баланс: {Number(target.current_balance).toLocaleString("ru-RU")} с
        </div>
        <form onSubmit={submit} className="grid">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label>Валюта</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as "KGS" | "USD" | "EUR" | "RUB")}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="RUB">RUB</option>
              </select>
            </div>
          </div>
          {currency !== "KGS" && (
            <div className="muted" style={{ fontSize: 11, color: "var(--warning)" }}>
              Курс {currency}/KGS должен быть установлен — иначе backend вернёт ошибку.
              КГС-эквивалент зафиксируется в момент сохранения.
            </div>
          )}
          <div>
            <label>Категория</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— не указано (= Подотчёт) —</option>
              {/* Системная «Подотчёт» сверху */}
              {categories.filter((c) => c.is_system).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {categories.filter((c) => !c.is_system).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {isPodotchet || categoryId === "" ? (
              <div style={{
                marginTop: 6, padding: "8px 10px", fontSize: 12,
                background: "rgba(59, 130, 246, 0.1)",
                color: "var(--accent-light)", borderRadius: 6,
              }}>
                <b>Подотчёт</b>. {target.name} получит деньги на баланс
                и сам внесёт расходы — каждый с реальной категорией.
              </div>
            ) : (
              <div style={{
                marginTop: 6, padding: "8px 10px", fontSize: 12,
                background: "rgba(245, 158, 11, 0.15)",
                color: "var(--warning)", borderRadius: 6,
              }}>
                <b>Деньги сразу спишутся как расход «{selectedCat?.name}»</b>.
                {" "}{target.name} не будет отчитываться по этой сумме —
                {" "}авто-создастся Expense на его имя.
              </div>
            )}
          </div>
          <div>
            <label>Подразделение</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— нет —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label>Дата выдачи</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Для записи в прошлом — выберите старую дату.
            </div>
          </div>
          <div>
            <label>Комментарий (необязательно)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="badge rejected" style={{ padding: "8px 12px" }}>{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Выдать"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddEmployeeModal({
  colleagues,
  onClose,
  onSaved,
}: {
  colleagues: UserOut[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    role: "accountable" as Role,
    supervisor_id: "" as number | "",
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptIds, setDeptIds] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  function toggleDept(id: number) {
    setDeptIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await api("/api/users", {
        method: "POST",
        body: {
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          password: form.password,
          role: form.role,
          supervisor_id: form.supervisor_id || null,
          department_ids: deptIds,
        },
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%" }}>
        <h2 className="h2">Новый сотрудник</h2>
        <form onSubmit={submit} className="grid">
          <div><label>Имя</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></div>
          <div><label>Телефон</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
          <div><label>Email (необязательно)</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label>Пароль</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>
          <div>
            <label>Роль</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="accountable">Подотчётный</option>
              <option value="auditor">Аудитор</option>
              <option value="gen_director">Генеральный директор</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <div>
            <label>Руководитель (опционально)</label>
            <select
              value={form.supervisor_id}
              onChange={(e) => setForm({ ...form, supervisor_id: e.target.value ? Number(e.target.value) : "" })}
            >
              <option value="">— нет —</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {departments.length > 0 && (
            <div>
              <label>Подразделения (необязательно)</label>
              <div className="grid" style={{ gap: 4, marginTop: 4 }}>
                {departments.map((d) => (
                  <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={deptIds.includes(d.id)}
                      onChange={() => toggleDept(d.id)}
                      style={{ width: "auto", margin: 0 }}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {err && <div className="badge rejected" style={{ padding: "8px 12px" }}>{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Создать"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
