import { api } from "./client";

export interface ChatRoomMember {
  user_id: number;
  name: string;
  role: "admin" | "employee";
}

export interface ChatMessage {
  id: number;
  room_id: number;
  sender_id: number;
  sender_name: string;
  content: string;
  reply_to_id: number | null;
  reply_preview: string | null;
  reply_sender_name: string | null;
  created_at: string;
}

export interface ChatRoom {
  id: number;
  name: string;
  room_type: "group" | "direct";
  members: ChatRoomMember[];
  last_message: ChatMessage | null;
  unread_count: number;
}

export function getRooms(): Promise<ChatRoom[]> {
  return api<ChatRoom[]>("/api/chat/rooms");
}

export function createRoom(name: string, member_ids: number[]): Promise<ChatRoom> {
  return api<ChatRoom>("/api/chat/rooms", {
    method: "POST",
    body: { name, member_ids },
  });
}

export function createDirect(user_id: number): Promise<ChatRoom> {
  return api<ChatRoom>("/api/chat/rooms/direct", {
    method: "POST",
    body: { user_id },
  });
}

export function getMessages(
  roomId: number,
  before?: string
): Promise<ChatMessage[]> {
  const q = before ? `?before=${encodeURIComponent(before)}` : "";
  return api<ChatMessage[]>(`/api/chat/rooms/${roomId}/messages${q}`);
}

export function markRead(roomId: number): Promise<void> {
  return api<void>(`/api/chat/rooms/${roomId}/read`, { method: "POST" });
}
