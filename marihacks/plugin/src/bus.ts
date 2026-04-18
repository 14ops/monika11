/**
 * WebSocket client with reconnect + typed event fan-out.
 * One instance lives on the plugin and is shared by both views.
 */

export type MonikaEvent = {
  type: string;
  ts: number;
  [key: string]: unknown;
};

type Handler = (event: MonikaEvent) => void;

export class MonikaBus {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectTimer: number | null = null;
  private stopped = false;
  public connected = false;

  constructor(public wsUrl: string) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  setUrl(url: string): void {
    if (url === this.wsUrl) return;
    this.wsUrl = url;
    if (!this.stopped) {
      this.stop();
      this.start();
    }
  }

  private connect(): void {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.emit({ type: "ws_open", ts: Date.now() });
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.emit({ type: "ws_close", ts: Date.now() });
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.emit({ type: "ws_error", ts: Date.now() });
    };
    this.ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as MonikaEvent;
        this.emit(payload);
      } catch {
        /* ignore malformed */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private emit(event: MonikaEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        /* ignore */
      }
    }
  }
}
