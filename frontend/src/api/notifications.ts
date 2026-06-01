import { api } from "./client";

export interface NotificationItem {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export function listNotifications(onlyUnread = false): Promise<NotificationItem[]> {
  return api<NotificationItem[]>(
    `/api/notifications${onlyUnread ? "?only_unread=true" : ""}`
  );
}

export function unreadCount(): Promise<{ count: number }> {
  return api<{ count: number }>("/api/notifications/unread-count");
}

export function markRead(id: number) {
  return api<void>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllRead() {
  return api<void>("/api/notifications/read-all", { method: "POST" });
}
