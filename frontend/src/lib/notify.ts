// Браузерные уведомления (Notification API) для входящих сообщений чата.
// Запрашивается один раз при первом открытии чата; показывается только когда
// вкладка скрыта (document.hidden). Клик — фокус на вкладку + открыть чат.

const CHAT_OPEN_EVENT = "podotchetpro:chat:open";

let requested = false;

export function ensureNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (requested) return;
  requested = true;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

export function emitOpenChatEvent(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT));
}

export function onOpenChatRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHAT_OPEN_EVENT, handler);
  return () => window.removeEventListener(CHAT_OPEN_EVENT, handler);
}

export function showChatMessageNotification(
  senderName: string,
  content: string
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // Показываем только когда пользователь НЕ смотрит на вкладку.
  if (!document.hidden) return;
  try {
    const preview = content.length > 80 ? content.slice(0, 80) + "..." : content;
    const n = new Notification(senderName, {
      body: preview,
      icon: "/icons/icon-192.png",
      tag: "podotchetpro-chat",  // объединяет повторы в одно
    });
    n.onclick = () => {
      window.focus();
      try { n.close(); } catch { /* noop */ }
      emitOpenChatEvent();
    };
    window.setTimeout(() => {
      try { n.close(); } catch { /* noop */ }
    }, 4000);
  } catch {
    // молча
  }
}
