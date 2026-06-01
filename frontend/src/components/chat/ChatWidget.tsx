import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getRooms, type ChatRoom } from "../../api/chat";
import { ensureNotificationPermission, onOpenChatRequest } from "../../lib/notify";
import { unlockAudio } from "../../lib/sound";
import { ChatPanel } from "./ChatPanel";
import { ChatSidebar } from "./ChatSidebar";

const POLL_MS = 30_000;  // фон-обновление списка комнат (бейджи непрочитанных)

export function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);

  async function reload() {
    if (!user) return;
    try {
      const list = await getRooms();
      setRooms(list);
    } catch {
      // молча — виджет не должен валиться, если бэк временно недоступен
    }
  }

  // загрузка списка комнат при логине + периодический фон-poll
  useEffect(() => {
    if (!user) {
      setRooms([]);
      setActiveRoomId(null);
      return;
    }
    reload();
    const t = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // когда открываем виджет — освежить список (новые сообщения могли прийти, пока виджет закрыт)
  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Клик по browser-notification → разворачиваем виджет.
  useEffect(() => onOpenChatRequest(() => setOpen(true)), []);

  if (!user) return null;

  const totalUnread = rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null;

  return (
    <>
      {/* FAB справа снизу — всегда виден.
          Клик — user gesture: разблокируем AudioContext и запрашиваем Notification.
          Браузеры требуют именно gesture-handler для этого, useEffect не сработает. */}
      <button
        className="chat-fab"
        onClick={() => {
          unlockAudio();
          ensureNotificationPermission();
          setOpen((v) => !v);
        }}
        aria-label={open ? "Закрыть чат" : "Открыть чат"}
      >
        <span className="chat-fab-icon">💬</span>
        {totalUnread > 0 && !open && (
          <span className="chat-fab-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>
        )}
      </button>

      {open && (
        <>
          <div
            className="chat-widget-overlay"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="chat-widget" role="dialog" aria-label="Чат">
            <div className="chat-widget-header">
              <strong>Чаты</strong>
              <button
                className="ghost chat-close"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className={`chat-widget-body ${activeRoom ? "with-panel" : ""}`}>
              <div className={`chat-sidebar-wrap ${activeRoom ? "hide-on-mobile" : ""}`}>
                <ChatSidebar
                  rooms={rooms}
                  activeRoomId={activeRoomId}
                  onSelect={(r) => setActiveRoomId(r.id)}
                  onRoomsChange={setRooms}
                />
              </div>
              {activeRoom && (
                <div className="chat-panel-wrap">
                  <ChatPanel
                    room={activeRoom}
                    onBack={() => setActiveRoomId(null)}
                  />
                </div>
              )}
              {!activeRoom && (
                <div className="chat-no-room muted hide-on-mobile">
                  Выберите чат, чтобы начать переписку
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
