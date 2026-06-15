import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type NotificationItem,
} from "../api/notifications";
import { usePushNotifications } from "../hooks/usePushNotifications";

const POLL_MS = 30_000;

interface Describe {
  icon: string;
  title: string;
  subtitle?: string;
  href?: string;
}

function describe(n: NotificationItem): Describe {
  const p = (n.payload || {}) as Record<string, unknown>;
  const reqId = typeof p.request_id === "number" ? (p.request_id as number) : null;
  const amount = p.amount ? Number(p.amount as string).toLocaleString("ru-RU") : "";
  const title = (p.title as string) || "";
  const comment = (p.comment as string) || "";
  const note = (p.note as string) || "";

  switch (n.type) {
    case "request_submitted":
      return {
        icon: "",
        title: `Новая заявка${title ? ": " + title : ""}`,
        subtitle: amount ? `Сумма: ${amount} с` : undefined,
        href: reqId ? `/requests/${reqId}` : undefined,
      };
    case "request_approved":
      return {
        icon: "",
        title: `Заявка одобрена${title ? ": " + title : ""}`,
        subtitle: amount ? `Зачислено: ${amount} с` : undefined,
        href: reqId ? `/requests/${reqId}` : undefined,
      };
    case "request_rejected":
      return {
        icon: "",
        title: `Заявка отклонена${title ? ": " + title : ""}`,
        subtitle: comment || undefined,
        href: reqId ? `/requests/${reqId}` : undefined,
      };
    case "transfer_received":
      return {
        icon: "",
        title: `Вам передали${amount ? ` ${amount} с` : " деньги"}`,
        subtitle: note || undefined,
        href: "/transfers",
      };
    case "balance_topup":
      return {
        icon: "",
        title: `Пополнен баланс${amount ? `: +${amount} с` : ""}`,
        subtitle: note || undefined,
      };
    default:
      return { icon: "", title: n.type };
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const push = usePushNotifications();
  const containerRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  // Polling счётчика — независимо от открыт ли дропдаун.
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      unreadCount()
        .then((r) => { if (!stopped) setCount(r.count); })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  // При открытии — грузим последние 10 уведомлений.
  useEffect(() => {
    if (!open) return;
    listNotifications(false)
      .then((list) => setItems(list.slice(0, 10)))
      .catch(() => setItems([]));
  }, [open]);

  // Клик вне дропдауна — закрыть.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleClickItem(n: NotificationItem) {
    const d = describe(n);
    if (!n.is_read) {
      try {
        await markRead(n.id);
        setCount((c) => Math.max(0, c - 1));
        setItems((prev) =>
          prev ? prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)) : prev
        );
      } catch {
        // не критично
      }
    }
    setOpen(false);
    if (d.href) nav(d.href);
  }

  async function handleMarkAll() {
    setBusyAll(true);
    try {
      await markAllRead();
      setCount(0);
      setItems((prev) => (prev ? prev.map((x) => ({ ...x, is_read: true })) : prev));
    } catch {
      // не критично
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <div ref={containerRef} className="notif-wrap">
      <button
        type="button"
        className="ghost notif-btn"
        aria-label="Уведомления"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="notif-icon">Увед.</span>
        {count > 0 && (
          <span className="notif-badge">{count > 99 ? "99+" : count}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown" role="menu">
          <div className="notif-header">
            <strong>Уведомления</strong>
            {count > 0 && (
              <button
                type="button"
                className="ghost notif-mark-all"
                onClick={handleMarkAll}
                disabled={busyAll}
              >
                Прочитать все
              </button>
            )}
          </div>

          <div className="notif-list">
            {items === null && (
              <div className="muted notif-empty">Загрузка...</div>
            )}
            {items && items.length === 0 && (
              <div className="muted notif-empty">Уведомлений нет</div>
            )}
            {items && items.map((n) => {
              const d = describe(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item${n.is_read ? "" : " unread"}`}
                  onClick={() => handleClickItem(n)}
                >
                  <span className="notif-item-icon">{d.icon}</span>
                  <span className="notif-item-body">
                    <span className="notif-item-title">{d.title}</span>
                    {d.subtitle && (
                      <span className="notif-item-subtitle muted">{d.subtitle}</span>
                    )}
                  </span>
                  <span className="notif-item-time muted">{formatTime(n.created_at)}</span>
                </button>
              );
            })}
          </div>

          {/* Footer: управление push-подпиской. Не показываем при unsupported/loading. */}
          {push.status !== "loading" && push.status !== "unsupported" && (
            <div className="notif-footer">
              {push.status === "on" && (
                <>
                  <span>Push на это устройство <strong>включены</strong></span>
                  <button type="button" className="ghost notif-footer-btn" onClick={() => push.disable()}>
                    Выключить
                  </button>
                </>
              )}
              {(push.status === "off" || push.status === "error") && (
                <>
                  <span>Push на это устройство выключены</span>
                  <button type="button" className="notif-footer-btn" onClick={() => push.enable()}>
                    Включить
                  </button>
                </>
              )}
              {push.status === "denied" && (
                <span className="muted">Push запрещены в настройках браузера</span>
              )}
              {push.status === "ios-not-pwa" && (
                <>
                  <span>Чтобы включить push на iPhone</span>
                  <button type="button" className="ghost notif-footer-btn" onClick={() => setShowIosHelp(true)}>
                    Как?
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showIosHelp && (
        <div className="push-iohelp-overlay" onClick={() => setShowIosHelp(false)}>
          <div className="card push-iohelp" onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">Уведомления на iPhone</h2>
            <p className="muted">
              Чтобы получать push-уведомления, нужно один раз добавить сайт
              на главный экран. После этого открывайте PodotchetPRO с иконки.
            </p>
            <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Нажмите кнопку <strong>«Поделиться»</strong> в Safari
                (квадрат со стрелкой вверх внизу экрана)</li>
              <li>Прокрутите вниз → <strong>«На экран „Домой"»</strong></li>
              <li>Нажмите <strong>«Добавить»</strong></li>
              <li>Закройте Safari, откройте PodotchetPRO с новой иконки</li>
              <li>Откройте → «Включить»</li>
            </ol>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Требуется iPhone с iOS 16.4 или новее.
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setShowIosHelp(false)}>Понятно</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
