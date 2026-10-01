// Subscription の登録と、R4 websocket チャネル（bind / ping）の接続（contracts/websocket.md、research.md R-10）。
import type { Subscription } from "fhir/r4";
import { FhirError, type FhirClient } from "../fhir/client";
import { wsUrl } from "./monitorSocket";

export interface SubscriptionSpec {
  /** 画面ごとに固定の ID（contracts/ui-screens.md）。 */
  id: string;
  criteria: string;
  reason: string;
}

/** 同じ ID の Subscription が既にあるか（GET で確認）。 */
async function exists(client: FhirClient, id: string): Promise<boolean> {
  try {
    await client.read<Subscription>("Subscription", id);
    return true;
  } catch (e) {
    if (e instanceof FhirError && e.status === 404) return false;
    throw e;
  }
}

/**
 * 開いた時点で GET し、無ければ PUT で作成する（既にあればそれを使う）。
 * 同じ画面を複数のウィンドウで開くと同じ ID を同時に作ろうとして、後から来た PUT が失敗する（既存の更新には If-Match が必要）。
 * その場合は、他の画面が先に作ったとみなして、あらためて確認する。
 */
export async function ensureSubscription(client: FhirClient, spec: SubscriptionSpec): Promise<void> {
  if (await exists(client, spec.id)) return;
  const resource: Subscription = {
    resourceType: "Subscription",
    id: spec.id,
    status: "requested",
    reason: spec.reason,
    criteria: spec.criteria,
    channel: { type: "websocket", payload: "application/fhir+json" },
  };
  try {
    await client.update("Subscription", spec.id, resource, null, "通知の登録");
  } catch (e) {
    if (e instanceof FhirError && (e.status === 400 || e.status === 412 || e.status === 409) && (await exists(client, spec.id))) {
      return;
    }
    throw e;
  }
}

export interface SubscriptionSocketHandlers {
  /** 接続して bind が成功した（再接続を含む）。表示データを取り直す契機。 */
  onBound: () => void;
  /** 条件に合う変更があった合図。中身は取りに行く。 */
  onPing: () => void;
  /** bind が拒否された（Subscription が無い等）。登録し直す契機。 */
  onBindError: (reason: string) => void;
}

export interface SubscriptionSocket {
  close: () => void;
}

/** /ws/subscription に接続して bind する。切断されたら自動で再接続して bind し直す。 */
export function openSubscriptionSocket(
  clientId: string,
  subscriptionId: string,
  handlers: SubscriptionSocketHandlers,
): SubscriptionSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const socket = new WebSocket(wsUrl(`/ws/subscription?client=${encodeURIComponent(clientId)}`));
    ws = socket;
    socket.onopen = () => socket.send(`bind ${subscriptionId}`);
    socket.onmessage = (ev) => {
      const text = String(ev.data);
      const [kind, id, ...rest] = text.split(" ");
      if (id !== subscriptionId && kind !== "error") return;
      if (kind === "bound") handlers.onBound();
      else if (kind === "ping") handlers.onPing();
      else if (kind === "error") handlers.onBindError(rest.join(" "));
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (!closed) timer = setTimeout(connect, 1000);
    };
    socket.onerror = () => socket.close();
  };
  connect();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
