import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { listOrgs, createOrg, setPlan, deleteOrg, type SuperOrg, type SuperOrgCreateOut } from "../api/super";

const PLANS = ["free", "pro", "business", "legacy"];

export function SuperPanel() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<SuperOrg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<SuperOrgCreateOut | null>(null);

  async function load() {
    try { setErr(null); setOrgs(await listOrgs()); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (!user?.is_platform_owner) {
    return <div style={{ padding: 16 }}><div className="card"><p className="muted">Доступ только для владельца платформы.</p></div></div>;
  }

  async function changePlan(o: SuperOrg, plan: string) {
    if (plan === o.plan) return;
    try { const upd = await setPlan(o.id, plan); setOrgs((s) => s!.map((x) => (x.id === o.id ? upd : x))); }
    catch (e: any) { alert(e.message); }
  }
  async function removeOrg(o: SuperOrg) {
    if (!window.confirm(`Удалить организацию «${o.name}» со ВСЕМИ данными? Необратимо.`)) return;
    try { await deleteOrg(o.id); setOrgs((s) => s!.filter((x) => x.id !== o.id)); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="h2">Платформа — организации</h1>
        <button type="button" onClick={() => { setCreated(null); setShowCreate(true); }}>+ Организация</button>
      </div>
      {err && <p style={{ color: "#e55" }}>{err}</p>}

      {!orgs ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div className="card" style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8a8f98", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>ID</th>
                <th style={{ padding: "6px 8px" }}>Организация</th>
                <th style={{ padding: "6px 8px" }}>Владелец</th>
                <th style={{ padding: "6px 8px" }}>Сотр.</th>
                <th style={{ padding: "6px 8px" }}>План</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: "8px" }}>{o.id}</td>
                  <td style={{ padding: "8px" }}>{o.name}</td>
                  <td style={{ padding: "8px", fontSize: 13 }}>
                    {o.admin_name || "—"}
                    {o.admin_phone && <><br /><span className="muted">{o.admin_phone}</span></>}
                  </td>
                  <td style={{ padding: "8px" }}>{o.employees_count}</td>
                  <td style={{ padding: "8px" }}>
                    <select value={o.plan} onChange={(e) => changePlan(o, e.target.value)}>
                      {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <button
                      type="button" className="ghost"
                      onClick={() => removeOrg(o)}
                      disabled={o.id === user.org_id}
                      title={o.id === user.org_id ? "Своя организация" : "Удалить"}
                    >Удалить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={(c) => { setCreated(c); setShowCreate(false); load(); }} />}
      {created && <CredsModal data={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: SuperOrgCreateOut) => void }) {
  const [orgName, setOrgName] = useState("");
  const [phone, setPhone] = useState("");
  const [adminName, setAdminName] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("free");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (orgName.trim().length < 2 || phone.trim().length < 5) { setErr("Заполните название и телефон"); return; }
    setBusy(true); setErr(null);
    try {
      const out = await createOrg({
        org_name: orgName.trim(),
        admin_phone: phone.trim(),
        admin_name: adminName.trim() || undefined,
        admin_password: password.trim() || undefined, // пусто → бэкенд сгенерит 6 цифр
        plan,
      });
      onCreated(out);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className="h2">Новая организация</h2>
      <Field label="Название организации"><input value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field>
      <Field label="Телефон владельца (логин)"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996..." /></Field>
      <Field label="Имя владельца (необязательно)"><input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="= название орг" /></Field>
      <Field label="Пароль (пусто → сгенерится 6 цифр)"><input value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="План">
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </Field>
      {err && <p style={{ color: "#e55" }}>{err}</p>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        <button type="button" onClick={submit} disabled={busy}>{busy ? "Создание…" : "Создать"}</button>
      </div>
    </Overlay>
  );
}

function CredsModal({ data, onClose }: { data: SuperOrgCreateOut; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <h2 className="h2">Организация создана</h2>
      <p className="muted" style={{ fontSize: 13 }}>Сохраните доступ — пароль показывается один раз.</p>
      <div style={{ marginTop: 10, fontSize: 15, lineHeight: 1.8 }}>
        <div>Организация: <b>{data.org_name}</b></div>
        <div>Логин (телефон): <b>{data.admin_phone}</b></div>
        <div>Пароль: <b style={{ fontFamily: "monospace" }}>{data.admin_password}</b></div>
        <div>План: <b>{data.plan}</b></div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" onClick={onClose}>Готово</button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginTop: 10 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}
