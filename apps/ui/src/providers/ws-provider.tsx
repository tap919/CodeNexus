'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type WSMessageHandler = (data: unknown) => void;

interface WSContextValue {
  connected: boolean;
  send: (type: string, payload: unknown) => void;
  subscribe: (event: string, handler: WSMessageHandler) => () => void;
}

const WSContext = createContext<WSContextValue>({
  connected: false,
  send: () => {},
  subscribe: () => () => {},
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<WSMessageHandler>>>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const attemptRef = useRef(0);

  const connect = () => {
    if (!mountedRef.current) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8787';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      setConnected(true);
    };
    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      if (attemptRef.current >= 10) return;
      const delay = Math.min(1000 * Math.pow(2, attemptRef.current), 30000);
      attemptRef.current++;
      reconnectRef.current = setTimeout(connect, delay);
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const handlers = handlersRef.current.get(msg.type);
        if (handlers) handlers.forEach((h) => h(msg.payload));
      } catch { /* ignore parse errors */ }
    };
  };

  useEffect(() => {
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((type: string, payload: unknown) => {
    wsRef.current?.send(JSON.stringify({ type, payload }));
  }, []);

  const subscribe = useCallback((event: string, handler: WSMessageHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => {
      handlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  return (
    <WSContext.Provider value={{ connected, send, subscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WSContext);
}
