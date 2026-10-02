// デモのポリシーの購読状態（contracts/websocket.md）。純粋関数だけを置く。
import type { DemoPolicy, MonitorMessage } from "../realtime/types";

export const DEFAULT_POLICY: DemoPolicy = {
  ifMatchRequired: true,
  taskTransitionCheck: true,
  labSendsIfMatch: true,
  ehrUsesSlotHold: true,
  slotHoldSeconds: 30,
};

export interface PolicyState {
  /** まだ取得していないときは null。 */
  policy: DemoPolicy | null;
  /** 再接続などで取り直しが必要。 */
  stale: boolean;
}

export const INITIAL_POLICY_STATE: PolicyState = { policy: null, stale: false };

export function reducePolicy(state: PolicyState, message: MonitorMessage): PolicyState {
  switch (message.type) {
    case "demo.policy":
      return { policy: message.policy, stale: false };
    case "demo.reset":
      // 仮押さえの期限の既定値は環境変数で変わりうるため、サーバーが通知に載せた値を使う
      return { policy: message.policy ?? DEFAULT_POLICY, stale: false };
    case "socket.open":
      return message.reconnect ? { ...state, stale: true } : state;
    default:
      return state;
  }
}

/** デモ制御パネルが受け付ける仮押さえの期限（秒）。画面からは 10〜300 の整数（サーバーの API は自動テストのために 1〜300 を受け付ける）。 */
export const MIN_PANEL_HOLD_SECONDS = 10;
export const MAX_PANEL_HOLD_SECONDS = 300;

export function parseHoldSeconds(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_PANEL_HOLD_SECONDS && n <= MAX_PANEL_HOLD_SECONDS ? n : null;
}
