import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { useAuth, type Role } from "../context/AuthContext";

export default function EmployeeCard() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const { user: me } = useAuth();
  const [user, setUser] = useState<any>(null);
  const [advances, setAdvances] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [spec, setSpec] = useState<any>(null);
  const [editing, setEditing] = useState(false);

  const reloadUser = () => api(`/api/users/${id}`).then(setUser);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      reloadUser(),
      api(`/api/advances?employee_id=${id}`).then(setAdvances),
      api(`/api/expenses?employee_id=${id}`).then(setExpenses),
      api(`/api/specs/${id}`).then(setSpec),
    ]).catch((e) => console.error(e));
  }, [id]);

  async function deleteUser() {
    if (!user) return;
    if (!confirm(
      `Деактивировать «${user.name}»?\n\n` +
      `Сотрудник пропадёт из списков и не сможет войти. ` +
      `История его расходов и заявок сохранится для отчётов.\n\n` +
      `Восстановить можно через «Изменить данные» → Активен.`
    )) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      toast.show("success", "Сотрудник деактивирован");
      nav("/employees");
    } catch (e: any) { toast.show("error", e.message); }
  }

  if (!user) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const isSelf = me?.id === user.id;

  return (
    <div className="container">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h1 className="h1" style={{ margin: 0 }}>{user.name}</h1>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {/* Редактирование и удаление — только admin (PATCH/DELETE /api/users требуют require_admin). */}
          {me?.role === "admin" && (
            <button className="ghost" onClick={() => setEditing(true)}>Изменить данные</button>
          )}
          <Link to={`/employees/${id}/chain`}><button className="ghost">Цепочка расходов</button></Link>
          <Link to={`/employees/${id}/spec`}><button>Спецификация</button></Link>
          {/* Удалить может: admin / gen_director / непосредственный supervisor.
              Самого себя удалить нельзя. */}
          {!isSelf && (
            me?.role === "admin"
            || me?.role === "gen_director"
            || user.supervisor_id === me?.id
          ) && (
            <button className="danger" onClick={deleteUser}>Удалить</button>
          )}
        </div>
      </div>
      <div className="muted">{user.phone} · {user.email || "—"} · {user.role}</div>

      {editing && <EditUserModal user={user} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadUser(); toast.show("success", "Сохранено"); }} />}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 16 }}>
        <Stat label="Выдано" value={user.issued_total} />
        <Stat label="Потрачено" value={user.spent_total} />
        <Stat label="Баланс" value={user.balance} accent />
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>Лимит месяца</div>
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={Number(user.monthly_spent)} max={Number(user.monthly_limit)} />
          </div>
        </div>
      </div>

      {spec && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="h2">Спецификация</h2>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div><div className="muted" style={{ fontSize: 12 }}>Месячный лимит</div>{Number(spec.monthly_limit).toLocaleString("ru-RU")} с</div>
            <div><div className="muted" style={{ fontSize: 12 }}>Лимит выдачи</div>{Number(spec.single_limit).toLocaleString("ru-RU")} с</div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Требования</div>
              {spec.requires_receipt && <span className="badge approved" style={{ marginRight: 4 }}>фото</span>}
              {spec.requires_approval && <span className="badge pending">одобрение</span>}
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
        <div className="card">
          <h2 className="h2">История выдач</h2>
          <table>
            <tbody>
              {advances.map((a: any) => (
                <tr key={a.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(a.issued_at).toLocaleDateString("ru-RU")}</td>
                  <td>{a.purpose || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{Number(a.amount).toLocaleString("ru-RU")} с</td>
                </tr>
              ))}
              {advances.length === 0 && <tr><td className="muted">Пусто</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2">История расходов</h2>
          <table>
            <tbody>
              {expenses.map((e: any) => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(e.spent_at).toLocaleDateString("ru-RU")}</td>
                  <td>{e.category_name || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{Number(e.amount).toLocaleString("ru-RU")} с</td>
                  <td><StatusBadge status={e.status} /></td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td className="muted">Пусто</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: accent ? "var(--accent-light)" : "var(--text)" }}>
        {Number(value).toLocaleString("ru-RU")} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>сом</span>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: user.name as string,
    email: (user.email || "") as string,
    role: user.role as Role,
    is_active: !!user.is_active,
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const body: any = {
        name: form.name,
        email: form.email || null,
        role: form.role,
        is_active: form.is_active,
      };
      if (form.password) body.password = form.password;
      await api(`/api/users/${user.id}`, { method: "PATCH", body });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2">Изменить данные сотрудника</h2>
        <form onSubmit={submit} className="grid">
          <div><label>Имя</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></div>
          <div><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="muted" style={{ fontSize: 12 }}>Телефон ({user.phone}) изменить нельзя — это логин.</div>
          <div>
            <label>Роль</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="accountable">Подотчётный</option>
              <option value="auditor">Аудитор</option>
              <option value="gen_director">Генеральный директор</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <input type="checkbox" style={{ width: "auto" }}
                   checked={form.is_active}
                   onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span>Активен (если выкл — не сможет войти)</span>
          </label>
          <div>
            <label>Новый пароль (оставьте пустым, если не меняете)</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} />
          </div>
          {err && <div className="badge rejected" style={{ padding: "8px 12px" }}>{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
