/**
 * Модалка редактирования профиля сотрудника: имя, email, роль, активность,
 * конфиденциальность (только superadmin), пароль и набор подразделений (M2M).
 * Используется на странице сотрудника (/employees/:id) и в списке «Сотрудники».
 *
 * PATCH /api/users/{id} требует роль admin/superadmin (require_admin) — кнопку,
 * открывающую эту модалку, показывать только им.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth, isSuperadmin, type Role } from "../context/AuthContext";
import { listDepartments, type Department } from "../api/departments";

export function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user: me } = useAuth();
  const canEditConfidential = isSuperadmin(me?.role);
  const [form, setForm] = useState({
    name: user.name as string,
    email: (user.email || "") as string,
    role: user.role as Role,
    is_active: !!user.is_active,
    is_confidential: !!user.is_confidential,
    password: "",
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptIds, setDeptIds] = useState<number[]>(user.department_ids || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // all=true — показываем все подразделения org, чтобы можно было привязать любое.
    listDepartments(true).then(setDepartments).catch(() => {});
  }, []);

  function toggleDept(did: number) {
    setDeptIds((prev) => (prev.includes(did) ? prev.filter((x) => x !== did) : [...prev, did]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const body: any = {
        name: form.name,
        email: form.email || null,
        role: form.role,
        is_active: form.is_active,
        department_ids: deptIds,
      };
      // is_confidential отправляем только superadmin (бэкенд иначе вернёт 403).
      if (canEditConfidential) body.is_confidential = form.is_confidential;
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
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
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
              {/* Назначать superadmin может только сам superadmin */}
              {(canEditConfidential || form.role === "superadmin") && (
                <option value="superadmin">Суперадмин</option>
              )}
            </select>
          </div>
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <input type="checkbox" style={{ width: "auto" }}
                   checked={form.is_active}
                   onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span>Активен (если выкл — не сможет войти)</span>
          </label>
          {canEditConfidential && (
            <div>
              <label className="row" style={{ gap: 8, margin: 0, cursor: "pointer" }}>
                <input type="checkbox" style={{ width: "auto" }}
                       checked={form.is_confidential}
                       onChange={(e) => setForm({ ...form, is_confidential: e.target.checked })} />
                <span>Конфиденциальный сотрудник</span>
              </label>
              {form.is_confidential && (
                <div style={{
                  marginTop: 6, padding: "8px 10px", fontSize: 12,
                  background: "rgba(245, 158, 11, 0.15)", color: "var(--warning)", borderRadius: 6,
                }}>
                  Данные этого сотрудника (расходы, баланс, выдачи) будут скрыты
                  от всех, кроме Генерального директора и Суперадмина.
                </div>
              )}
            </div>
          )}
          <div>
            <label>Новый пароль (оставьте пустым, если не меняете)</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} />
          </div>
          {departments.length > 0 && (
            <div>
              <label>Подразделения (можно несколько)</label>
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
            <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
