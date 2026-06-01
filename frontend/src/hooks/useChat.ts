import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { playMessageBeep } from "../lib/sound";
import { showChatMessageNotification } from "../lib/notify";
import type { ChatMessage } from "../api/chat";

interface UseChat {
  messages: ChatMessage[];
  connected: boolean;
  error: string | null;
  sendMessage: (content: string, reply_to_id?: number | null) => void;
}

function buildWsUrl(roomId: number, token: string): string {
  // window.location.host работает и для prod (через nginx с wss), и для dev (через vite proxy)
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/chat/ws/${roomId}?token=${encodeURIComponent(token)}`;
}

export function useChat(roomId: number | null): UseChat {
  const { user } = useAuth();
  const myIdRef = useRef<number | null>(user?.id ?? null);
  myIdRef.current = user?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedManuallyRef = useRef(false);

  // Notification permission и AudioContext unlock делаются в ChatWidget на click по FAB —
  // там есть user gesture, без которого Chrome/Safari блокируют оба API.

  const connect = useCallback(() => {
    if (roomId === null) return;
    const token = getToken();
    if (!token) {
      setError("Нет токена");
      return;
    }
    closedManuallyRef.current = false;
    const ws = new WebSocket(buildWsUrl(roomId, token));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "history") {
          setMessages(data.messages as ChatMessage[]);
        } else if (data.type === "message") {
          const msg = data.message as ChatMessage;
          setMessages((prev) => [...prev, msg]);
          const fromMe = myIdRef.current !== null && msg.sender_id === myIdRef.current;
          if (fromMe) return;
          // Звук — всегда на чужие сообщения (как в Slack/Telegram).
          playMessageBeep();
          // Browser notification — только если вкладка скрыта (это проверяет сам notify.ts).
          showChatMessageNotification(msg.sender_name, msg.content);
        }
      } catch {
        // мусор — игнорируем
      }
    };
    ws.onerror = () => {
      setError("Ошибка соединения с чатом");
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!closedManuallyRef.current) {
        // авто-реконнект через 3 сек
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      }
    };
  }, [roomId]);

  useEffect(() => {
    setMessages([]);  // при смене комнаты — чистим
    if (roomId === null) return;
    connect();
    return () => {
      closedManuallyRef.current = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, connect]);

  const sendMessage = useCallback(
    (content: string, reply_to_id: number | null = null) => {
      const ws = wsRef.current;
      const text = content.trim();
      if (!ws || ws.readyState !== WebSocket.OPEN || !text) return;
      ws.send(JSON.stringify({ type: "message", content: text, reply_to_id }));
    },
    []
  );

  return { messages, connected, error, sendMessage };
}
