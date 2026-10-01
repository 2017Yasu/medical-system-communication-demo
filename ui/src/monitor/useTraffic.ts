import { useEffect, useSyncExternalStore } from "react";
import { startTrafficSync, trafficStore } from "../realtime/trafficStore";
import type { TrafficRecord } from "../realtime/types";

/** 通信記録（seq の昇順）。使っている間だけ /ws/monitor と同期する。 */
export function useTraffic(): TrafficRecord[] {
  useEffect(() => startTrafficSync(), []);
  return useSyncExternalStore(trafficStore.subscribe, trafficStore.getSnapshot);
}
