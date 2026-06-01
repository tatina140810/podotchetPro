import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../hooks/useChat";
import { markRead, type ChatMessage, type ChatRoom } from "../../api/chat";

interface Props {
  room: ChatRoom;
  onBack?: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({ room, onBack }: Props) {
  const { user } = useAuth();
  const { messages, connected, error, sendMessage } = useChat(room.id);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // автоскролл вниз при новых сообщениях
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // пометить как прочитанное при открытии и каждый раз, когда меняется длина messages
  useEffect(() => {
    markRead(room.id).catch(() => {});
  }, [room.id, messages.length]);

  function handleSend() {
    const t = text.trim();
    if (!t) return;
    sendMessage(t, replyTo ? replyTo.id : null);
    setText("");
    setReplyTo(null);
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        {onBack && (
          <button className="ghost chat-back" onClick={onBack} aria-label="Назад">
            ←
          </button>
        )}
        <div className="chat-panel-title">
          <div className="chat-panel-name">{room.name}</div>
          <div className="chat-panel-sub muted">
            {room.room_type === "group"
              ? `${room.members.length} участников`
              : "Личные сообщения"}
            {" · "}
            {connected ? "онлайн" : "соединение..."}
          </div>
        </div>
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="icon">💬</div>
            Сообщений пока нет
          </div>
        )}
        {messages.map((m) => {
          const mine = user && m.sender_id === user.id;
          return (
            <div
              key={m.id}
              className={`chat-msg ${mine ? "mine" : ""}`}
              onClick={() => setReplyTo(m)}
              title="Кликните, чтобы процитировать"
            >
              {!mine && (
                <div className="chat-avatar">{initials(m.sender_name)}</div>
              )}
              <div className="chat-bubble">
                {!mine && <div className="chat-msg-sender">{m.sender_name}</div>}
                {m.reply_to_id && m.reply_preview && (
                  <div className="chat-quote">
                    <div className="chat-quote-sender">
                      {m.reply_sender_name || "—"}
                    </div>
                    <div className="chat-quote-text">{m.reply_preview}</div>
                  </div>
                )}
                <div className="chat-msg-text">{m.content}</div>
                <div className="chat-msg-time muted">{formatTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {replyTo && (
        <div className="chat-reply-preview">
          <div className="chat-reply-info">
            <div className="chat-reply-sender">↪ {replyTo.sender_name}</div>
            <div className="chat-reply-text muted">{replyTo.content.slice(0, 120)}</div>
          </div>
          <button
            className="ghost chat-reply-cancel"
            onClick={() => setReplyTo(null)}
            aria-label="Отменить цитирование"
          >
            ×
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <input
          type="text"
          placeholder="Написать сообщение..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button onClick={handleSend} disabled={!text.trim() || !connected}>
          Отправить
        </button>
      </div>
    </div>
  );
}
