/** A message forwarded by the signaling server. */
export type ForwardedMessage = { from: string; to: string } & Record<
  string,
  unknown
>;

type ForwardHandler = (from: string, payload: ForwardedMessage) => void;
type NoticeHandler = (message: string) => void;

/**
 * Signaling client
 */
export class Signaling {
  private ws: WebSocket | null = null;
  private url = "";
  private id = "";
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private forwardHandlers = new Set<ForwardHandler>();
  private noticeHandlers = new Set<NoticeHandler>();
  private pendingQueries = new Map<string, (registered: boolean) => void>();

  connect(url: string, id: string): void {
    this.url = url;
    this.id = id;
    this.manuallyClosed = false;
    this.open();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.ws?.close();
  }

  onForward(handler: ForwardHandler): void {
    this.forwardHandlers.add(handler);
  }

  onNotice(handler: NoticeHandler): void {
    this.noticeHandlers.add(handler);
  }

  /** Send a payload to a peer. Returns false when the socket is down. */
  send(to: string, payload: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ from: this.id, to, ...payload }));
    return true;
  }

  /** Check if a device id currently registered on the signaling server */
  query(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }
      this.pendingQueries.set(id, resolve);
      setTimeout(() => {
        if (this.pendingQueries.delete(id)) resolve(false);
      }, 3000);
      this.ws.send(JSON.stringify({ query: id }));
    });
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      // Cold start politely; after a drop, force evict our own stale entry.
      ws.send(
        JSON.stringify({ register: this.id, force: this.reconnectAttempt > 0 })
      );
    };
    ws.onmessage = (ev) => this.handleMessage(String(ev.data));
    ws.onclose = () => {
      if (this.manuallyClosed) return;
      this.reconnectAttempt++;
      setTimeout(() => this.open(), 2000);
    };
  }

  private handleMessage(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.emitNotice(text); // server error notices are bare strings
      return;
    }

    if (typeof msg === "object" && msg !== null) {
      const m = msg as Record<string, unknown>;
      if (typeof m.from === "string" && typeof m.to === "string") {
        this.emitForward(m as unknown as ForwardedMessage);
        return;
      }
      if (typeof m.id === "string" && typeof m.registered === "boolean") {
        const resolve = this.pendingQueries.get(m.id);
        if (resolve) {
          this.pendingQueries.delete(m.id);
          resolve(m.registered);
        }
        return;
      }
    }
    this.emitNotice(text);
  }

  private emitForward(msg: ForwardedMessage): void {
    this.forwardHandlers.forEach((h) => h(msg.from, msg));
  }

  private emitNotice(message: string): void {
    this.noticeHandlers.forEach((h) => h(message));
  }
}
