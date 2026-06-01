/**
 * Web Push подписка с iOS-детектом. Поведение по платформам:
 *   - Desktop Chrome/Firefox/Safari, Android Chrome: работает напрямую
 *   - iPhone Safari ОБЫЧНЫЙ (вкладка): статус "ios-not-pwa", push невозможен (политика Apple)
 *   - iPhone "Добавлено на главный экран" (PWA): работает, нужен iOS 16.4+
 */
import { useCallback, useEffect, useState } from "react";
import { getStatus, getVapidPublicKey, subscribe, unsubscribe } from "../api/push";

export type PushStatus =
  | "loading"
  | "unsupported"
  | "ios-not-pwa"
  | "denied"
  | "off"
  | "on"
  | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isStandalone(): boolean {
  if ((navigator as any).standalone === true) return true;  // iOS-specific
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setStatus("ios-not-pwa");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      if (!existing || Notification.permission !== "granted") {
        setStatus("off");
        return;
      }

      // Сверка с сервером — подписка могла быть отозвана с другого устройства.
      try {
        const data = await getStatus(existing.endpoint);
        setStatus(data.subscribed ? "on" : "off");
      } catch {
        setStatus("on");  // локально подписка есть — считаем включённой
      }
    } catch (e: any) {
      setError(e?.message || "Не удалось проверить подписку");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    try {
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setStatus(perm === "denied" ? "denied" : "off");
          return;
        }
      } else if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }

      const keyData = await getVapidPublicKey();
      if (!keyData.publicKey) {
        setError("VAPID-ключ не настроен на сервере");
        setStatus("error");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
        });
      }
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribe({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        user_agent: navigator.userAgent.slice(0, 500),
      });
      setStatus("on");
    } catch (e: any) {
      setError(e?.message || "Не удалось включить уведомления");
      setStatus("error");
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (e: any) {
      setError(e?.message || "Не удалось отключить");
      setStatus("error");
    }
  }, []);

  return { status, error, enable, disable, refresh };
}
