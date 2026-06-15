import { useEffect, useMemo, useState } from "react";
import {
  isDirectorOrAuditor,
  useAuth,
  type Role,
  type UserOut,
} from "../../context/AuthContext";
import { listColleagues } from "../../api/users";
import {
  createDirect,
  createRoom,
  type ChatRoom,
} from "../../api/chat";

interface Props {
  rooms: ChatRoom[];
  activeRoomId: number | null;
  onSelect: (room: ChatRoom) => void;
  onRoomsChange: (rooms: ChatRoom[]) => void;
}

const ROLE_SHORT: Record<Role, string> = {
  superadmin: "суперадмин",
  admin: "admin",
  gen_director: "директор",
  auditor: "аудитор",
  accountable: "",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function ChatSidebar({ rooms, activeRoomId, onSelect, onRoomsChange }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewDirect, setShowNewDirect] = useState(false);
  const [orgUsers, setOrgUsers] = useState<UserOut[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Подгружаем список коллег только при открытии диалога. /api/users/colleagues
  // доступен любой роли — поэтому новый direct может создавать каждый.
  useEffect(() => {
    if (!showNewGroup && !showNewDirect) return;
    if (orgUsers.length > 0 || !user) return;
    setLoadingUsers(true);
    listColleagues()
      .then(setOrgUsers)
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [showNewGroup, showNewDirect, user, orgUsers.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.last_message?.content || "").toLowerCase().includes(q)
    );
  }, [rooms, search]);

  const groups = filtered.filter((r) => r.room_type === "group");
  const directs = filtered.filter((r) => r.room_type === "direct");

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <input
          type="text"
          placeholder="Поиск чатов..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="chat-sidebar-section">
        <div className="chat-sidebar-section-title">
          <span>Группы</span>
          {isDirectorOrAuditor(user?.role) && (
            <button
              className="ghost chat-add-btn"
              onClick={() => setShowNewGroup(true)}
              aria-label="Новая группа"
            >
              +
            </button>
          )}
        </div>
        {groups.length === 0 && <div className="muted chat-empty-list">Нет групп</div>}
        {groups.map((r) => (
          <RoomRow
            key={r.id}
            room={r}
            active={r.id === activeRoomId}
            onClick={() => onSelect(r)}
          />
        ))}
      </div>

      <div className="chat-sidebar-section">
        <div className="chat-sidebar-section-title">
          <span>Личные сообщения</span>
          <button
            className="ghost chat-add-btn"
            onClick={() => setShowNewDirect(true)}
            aria-label="Новый личный чат"
          >
            ✉
          </button>
        </div>
        {directs.length === 0 && <div className="muted chat-empty-list">Нет личных чатов</div>}
        {directs.map((r) => (
          <RoomRow
            key={r.id}
            room={r}
            active={r.id === activeRoomId}
            onClick={() => onSelect(r)}
          />
        ))}
      </div>

      {showNewGroup && (
        <NewGroupDialog
          users={orgUsers}
          loading={loadingUsers}
          onClose={() => setShowNewGroup(false)}
          onCreated={(room) => {
            onRoomsChange([room, ...rooms]);
            onSelect(room);
            setShowNewGroup(false);
          }}
        />
      )}

      {showNewDirect && (
        <NewDirectDialog
          users={orgUsers}
          loading={loadingUsers}
          onClose={() => setShowNewDirect(false)}
          onCreated={(room) => {
            const exists = rooms.find((r) => r.id === room.id);
            const next = exists ? rooms : [room, ...rooms];
            onRoomsChange(next);
            onSelect(room);
            setShowNewDirect(false);
          }}
        />
      )}
    </div>
  );
}

function RoomRow({
  room,
  active,
  onClick,
}: {
  room: ChatRoom;
  active: boolean;
  onClick: () => void;
}) {
  const preview = room.last_message?.content || "";
  return (
    <button
      className={`chat-room-row ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <div className="chat-room-avatar">{initials(room.name)}</div>
      <div className="chat-room-info">
        <div className="chat-room-name">{room.name}</div>
        {preview && <div className="chat-room-preview muted">{preview}</div>}
      </div>
      {room.unread_count > 0 && (
        <div className="chat-unread-badge">{room.unread_count}</div>
      )}
    </button>
  );
}

function NewGroupDialog({
  users,
  loading,
  onClose,
  onCreated,
}: {
  users: UserOut[];
  loading: boolean;
  onClose: () => void;
  onCreated: (room: ChatRoom) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const room = await createRoom(name.trim(), selected);
      onCreated(room);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="chat-dialog-overlay" onClick={onClose}>
      <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="chat-dialog-title">Новая группа</div>
        <label>Название</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Бухгалтерия, Менеджеры..."
        />
        <div style={{ marginTop: 12 }}>
          <label>Участники</label>
          {loading && <div className="muted">Загрузка...</div>}
          <div className="chat-user-list">
            {users.map((u) => (
              <label key={u.id} className="chat-user-row">
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <span>{u.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {ROLE_SHORT[u.role] || ""}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Отмена</button>
          <button onClick={submit} disabled={!name.trim() || saving}>
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}

function NewDirectDialog({
  users,
  loading,
  onClose,
  onCreated,
}: {
  users: UserOut[];
  loading: boolean;
  onClose: () => void;
  onCreated: (room: ChatRoom) => void;
}) {
  const [saving, setSaving] = useState<number | null>(null);

  async function pick(uid: number) {
    setSaving(uid);
    try {
      const room = await createDirect(uid);
      onCreated(room);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="chat-dialog-overlay" onClick={onClose}>
      <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="chat-dialog-title">Новый личный чат</div>
        {loading && <div className="muted">Загрузка...</div>}
        <div className="chat-user-list">
          {users.map((u) => (
            <button
              key={u.id}
              className="ghost chat-user-pick"
              onClick={() => pick(u.id)}
              disabled={saving !== null}
            >
              <div className="chat-room-avatar">{initials(u.name)}</div>
              <span>{u.name}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
