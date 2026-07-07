import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../api/client";
import {
  createWorkspace,
  listWorkspaces,
  type Workspace,
} from "../api/workspaces";

function fmt(v: number | string): string {
  return `${Number(v).toLocaleString("ru-RU")} сом`;
}

const CAN_MANAGE = ["superadmin", "gen_director"];

export default function Workspaces() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const allowed = !!user && CAN_MANAGE.includes(user.role);

  function load() {
    listWorkspaces().then(setList).catch((e) => toast.show("error", e.message));
  }

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="container">
        <div className="card muted">Раздел доступен только директору и суперадмину.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, alignItems: "center" }}>
        <h1 className="h1">Проектные пространства</h1>
        <button onClick={() => setShowCreate(true)}>+ Добавить пространство</button>
      </div>

      {list === null ? (
        <div className="card muted">Загрузка...</div>
      ) : list.length === 0 ? (
        <div className="card muted">
          Пространств пока нет. Создайте первое — выделенная среда учёта для отдельного
          сотрудника со своими категориями.
        </div>
      ) : (
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}
        >
          {list.map((ws) => (
            <div
              key={ws.id}
              className="card"
              style={{ cursor: "pointer", opacity: ws.is_active ? 1 : 0.6 }}
              onClick={() => nav(`/workspaces/${ws.id}`)}
            >
              <div className="row between" style={{ alignItems: "baseline" }}>
                <strong style={{ fontSize: 16 }}>{ws.name}</strong>
                {!ws.is_active && <span className="muted" style={{ fontSize: 12 }}>в архиве</span>}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Владелец: {ws.owner?.name || "—"}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Участников: {ws.members_count}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0" }} />
              <div className="row between"><span className="muted">Получено:</span><span>{fmt(ws.total_received)}</span></div>
              <div className="row between"><span className="muted">Потрачено:</span><span>{fmt(ws.total_spent)}</span></div>
              <div className="row between" style={{ fontWeight: 600, marginTop: 4 }}>
                <span>Остаток:</span><span>{fmt(ws.balance)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

interface Employee {
  id: number;
  name: string;
  role: string;
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Employee[]>("/api/users").then(setEmployees).catch(() => {});
  }, []);

  async function submit() {
    if (!name.trim()) { toast.show("error", "Укажите название"); return; }
    if (!ownerId) { toast.show("error", "Выберите владельца"); return; }
    setBusy(true);
    try {
      await createWorkspace({
        name: name.trim(),
        description: description.trim() || null,
        owner_id: Number(ownerId),
      });
      toast.show("success", "Пространство создано");
      onCreated();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "100%" }}>
        <h2 style={{ marginTop: 0 }}>Новое пространство</h2>
        <label className="muted" style={{ fontSize: 13 }}>Название</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Объект на Чуй" />
        <label className="muted" style={{ fontSize: 13, marginTop: 10, display: "block" }}>Описание</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <label className="muted" style={{ fontSize: 13, marginTop: 10, display: "block" }}>Владелец</label>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">— выберите сотрудника —</option>
          {employees.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button onClick={submit} disabled={busy}>{busy ? "..." : "Создать"}</button>
        </div>
      </div>
    </div>
  );
}
