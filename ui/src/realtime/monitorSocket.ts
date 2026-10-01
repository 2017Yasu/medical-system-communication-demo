// /ws/monitor：通信記録とデモの合図の受信。切断時は自動で再接続する。
import type { MonitorMessage } from "./types";

type Listener = (message: MonitorMessage) => void;

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

class MonitorSocket {
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private opened = false;

  /** 購読する。戻り値で購読解除。購読者がいなくなったら少し待って切断する。 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.closeTimer = setTimeout(() => this.disconnect(), 500);
      }
    };
  }

  private connect(): void {
    if (this.ws || this.listeners.size === 0) return;
    const ws = new WebSocket(wsUrl("/ws/monitor"));
    this.ws = ws;
    ws.onopen = () => {
      this.emit({ type: "socket.open", reconnect: this.opened });
      this.opened = true;
    };
    ws.onmessage = (ev) => {
      try {
        this.emit(JSON.parse(ev.data as string) as MonitorMessage);
      } catch {
        // 不正なメッセージは無視する
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.listeners.size > 0) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.opened = false;
    ws?.close();
  }

  private emit(message: MonitorMessage): void {
    for (const l of [...this.listeners]) l(message);
  }
}

export const monitorSocket = new MonitorSocket();
