import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { api } from "../api/client";
import {
  addWorkspaceMember,
  deactivateWorkspace,
  getWorkspace,
  listWorkspaceExpenses,
  listWorkspaceMembers,
  removeWorkspaceMember,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceExpense,
} from "../api/workspaces";

function fmt(v: number | string): string {
  return `${Number(v).toLocaleString("ru-RU")} сом`;
}

type Tab = "overview" | "members" | "expenses";

export default function WorkspaceDetail() {
  const { id } = useParams();
  const wsId = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  function loadWs() {
    getWorkspace(wsId).then(setWs).catch((e) => toast.show("error", e.message));
  }

  useEffect(() => { loadWs(); }, [wsId]);

  async function archive() {
    if (!confirm("Перенести пространство в архив? Записи и журнал сохранятся.")) return;
    try {
      await deactivateWorkspace(wsId);
      toast.show("success", "Пространство в архиве");
      nav("/workspaces");
    } catch (e: any) {
      toast.show("error", e.message);
    }
  }

  if (!ws) return <div className="container"><div className="card muted">Загрузка...</div></div>;

  return (
    <div className="container">
      <div className="row between" style={{ alignItems: "center", marginBottom: 8 }}>
        <h1 className="h1" style={{ margin: 0 }}>{ws.name}</h1>
        <button className="ghost" onClick={() => nav("/workspaces")}>← К списку</button>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>Владелец: {ws.owner?.name}</div>

      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Обзор</TabBtn>
        <TabBtn active={tab === "members"} onClick={() => setTab("members")}>Участники</TabBtn>
        <TabBtn active={tab === "expenses"} onClick={() => setTab("expenses")}>Расходы</TabBtn>
      </div>

      {tab === "overview" && <Overview ws={ws} onArchive={archive} />}
      {tab === "members" && <Members wsId={wsId} ownerId={ws.owner?.id} onChange={loadWs} />}
      {tab === "expenses" && <ExpensesTab wsId={wsId} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={active ? "" : "ghost"}
      style={{ padding: "6px 16px" }}
    >
      {children}
    </button>
  );
}

function Overview({ ws, onArchive }: { ws: Workspace; onArchive: () => void }) {
  return (
    <>
      <div className="card">
        {ws.description && <p style={{ marginTop: 0 }}>{ws.description}</p>}
        <div className="row between"><span className="muted">Получено:</span><span>{fmt(ws.total_received)}</span></div>
        <div className="row between"><span className="muted">Потрачено:</span><span>{fmt(ws.total_spent)}</span></div>
        <div className="row between" style={{ fontWeight: 600, fontSize: 17, marginTop: 6 }}>
          <span>Остаток:</span><span>{fmt(ws.balance)}</span>
        </div>
      </div>
      {ws.is_active && (
        <button className="ghost" style={{ marginTop: 16, color: "var(--danger)" }} onClick={onArchive}>
          В архив
        </button>
      )}
    </>
  );
}

interface Employee { id: number; name: string; }

function Members({ wsId, ownerId, onChange }: { wsId: number; ownerId?: number; onChange: () => void }) {
  const toast = useToast();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [addId, setAddId] = useState("");

  function load() {
    listWorkspaceMembers(wsId).then(setMembers).catch((e) => toast.show("error", e.message));
  }
  useEffect(() => {
    load();
    api<Employee[]>("/api/users").then(setEmployees).catch(() => {});
  }, [wsId]);

  async function add() {
    if (!addId) return;
    try {
      await addWorkspaceMember(wsId, Number(addId));
      setAddId("");
      load();
      onChange();
    } catch (e: any) { toast.show("error", e.message); }
  }

  async function remove(userId: number) {
    try {
      await removeWorkspaceMember(wsId, userId);
      load();
      onChange();
    } catch (e: any) { toast.show("error", e.message); }
  }

  return (
    <div className="card">
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1 }}>
          <option value="">+ добавить участника —</option>
          {employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button onClick={add} disabled={!addId}>Добавить</button>
      </div>
      {members === null ? (
        <div className="muted">Загрузка...</div>
      ) : (
        <table style={{ width: "100%" }}>
          <thead>
            <tr><th style={{ textAlign: "left" }}>ФИО</th><th style={{ textAlign: "left" }}>Добавлен</th><th></th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.user?.name}{m.user_id === ownerId ? " (владелец)" : ""}</td>
                <td className="muted">{new Date(m.added_at).toLocaleDateString("ru-RU")}</td>
                <td style={{ textAlign: "right" }}>
                  {m.user_id !== ownerId && (
                    <button className="ghost" style={{ color: "var(--danger)", padding: "2px 8px" }}
                      onClick={() => remove(m.user_id)}>Удалить</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ExpensesTab({ wsId }: { wsId: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<WorkspaceExpense[] | null>(null);
  useEffect(() => {
    listWorkspaceExpenses(wsId).then(setRows).catch((e) => toast.show("error", e.message));
  }, [wsId]);

  if (rows === null) return <div className="card muted">Загрузка...</div>;
  if (rows.length === 0) return <div className="card muted">Расходов пока нет.</div>;

  return (
    <div className="card" style={{ overflow: "auto" }}>
      <table style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Дата</th>
            <th style={{ textAlign: "left" }}>Категория</th>
            <th style={{ textAlign: "right" }}>Сумма</th>
            <th style={{ textAlign: "left" }}>Описание</th>
            <th style={{ textAlign: "left" }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.spent_at).toLocaleDateString("ru-RU")}</td>
              <td>{e.category_name || "—"}</td>
              <td style={{ textAlign: "right" }}>{fmt(e.amount)}</td>
              <td>{e.description || "—"}</td>
              <td className="muted">{e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
