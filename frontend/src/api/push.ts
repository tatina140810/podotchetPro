import { api } from "./client";

export interface PushSubscribePayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}

export function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return api<{ publicKey: string }>("/api/push/vapid-public-key");
}

export function subscribe(payload: PushSubscribePayload): Promise<{ status: string }> {
  return api<{ status: string }>("/api/push/subscribe", { method: "POST", body: payload });
}

export function unsubscribe(endpoint: string): Promise<{ status: string }> {
  return api<{ status: string }>("/api/push/unsubscribe", {
    method: "POST",
    body: { endpoint },
  });
}

export function getStatus(endpoint: string): Promise<{ subscribed: boolean }> {
  return api<{ subscribed: boolean }>(`/api/push/status?endpoint=${encodeURIComponent(endpoint)}`);
}
