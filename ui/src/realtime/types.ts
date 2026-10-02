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

export interface TrafficRecord {
  seq: number;
  timestamp: string;
  kind: "http" | "notification" | "demo";
  client: string;
  request: TrafficRequest | null;
  response: TrafficResponse | null;
  notification: { subscriptionId: string; targetClient: string; resource: string } | null;
  demoEvent: { event: string; detail?: unknown } | null;
}

export interface DemoPolicy {
  ifMatchRequired: boolean;
  taskTransitionCheck: boolean;
  /** 検体検査システムが更新時に If-Match を付けるか（デモ専用。サーバーの判定には使わない）。 */
  labSendsIfMatch: boolean;
}

export type MonitorMessage =
  | { type: "traffic"; record: TrafficRecord }
  | { type: "demo.reset"; timestamp: string }
  | { type: "demo.policy"; policy: DemoPolicy }
  /** 接続が確立した（reconnect = 切断後の再接続）。サーバーからのメッセージではなくクライアント側の合図。 */
  | { type: "socket.open"; reconnect: boolean };
