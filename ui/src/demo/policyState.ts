// デモのポリシーの購読状態（contracts/websocket.md）。純粋関数だけを置く。
import type { DemoPolicy, MonitorMessage } from "../realtime/types";

export const DEFAULT_POLICY: DemoPolicy = { ifMatchRequired: true, taskTransitionCheck: true, labSendsIfMatch: true };

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
      return { policy: DEFAULT_POLICY, stale: false };
    case "socket.open":
      return message.reconnect ? { ...state, stale: true } : state;
    default:
      return state;
  }
}
