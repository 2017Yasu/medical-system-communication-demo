// サーバーの TrafficRecord と /ws/monitor のメッセージ（contracts/websocket.md）。

export interface TrafficRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface TrafficResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  truncated: boolean;
}

/** サーバー内の処理（仮押さえの期限切れ。specs/003 data-model.md §6）。 */
export interface ServerAction {
  action: "slot-hold-expired";
  /** 期限切れで作った版（例：`Slot/ct1-1000/_history/3`）。 */
  resource: string;
  before: { status: string; versionId: string; comment?: string };
  after: { status: string; versionId: string };
  holdSeconds: number;
}

export interface TrafficRecord {
  seq: number;
  timestamp: string;
  kind: "http" | "notification" | "demo" | "server";
  client: string;
  request: TrafficRequest | null;
  response: TrafficResponse | null;
  notification: { subscriptionId: string; targetClient: string; resource: string } | null;
  demoEvent: { event: string; detail?: unknown } | null;
  /** `kind = "server"` のときだけ。サーバーは常に送る（ほかの種別では null）。 */
  serverAction?: ServerAction | null;
}

export interface DemoPolicy {
  ifMatchRequired: boolean;
  taskTransitionCheck: boolean;
  /** 検体検査システムが更新時に If-Match を付けるか（デモ専用。サーバーの判定には使わない）。 */
  labSendsIfMatch: boolean;
  /** 電子カルテの CT 予約が仮押さえを使うか（false は直接予約する。デモ専用。サーバーの判定には使わない）。 */
  ehrUsesSlotHold: boolean;
  /** 仮押さえの期限（秒）。 */
  slotHoldSeconds: number;
}

export type MonitorMessage =
  | { type: "traffic"; record: TrafficRecord }
  /** 初期化。初期化後のポリシー（既定値）を含む（サーバーの環境変数で既定値が変わりうるため）。 */
  | { type: "demo.reset"; timestamp: string; policy?: DemoPolicy }
  | { type: "demo.policy"; policy: DemoPolicy }
  /** 接続が確立した（reconnect = 切断後の再接続）。サーバーからのメッセージではなくクライアント側の合図。 */
  | { type: "socket.open"; reconnect: boolean };
