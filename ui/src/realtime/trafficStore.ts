// 通信記録の共通の保持部（通信モニタとシナリオの判定が使う）。
// 配信は seq の順とは限らない（要求の処理中に発生した通知は先に届く）ため、常に seq の順に並べて保持する。
import { fetchTraffic } from "./demoApi";
import { monitorSocket } from "./monitorSocket";
import type { TrafficRecord } from "./types";

type Listener = () => void;

export class TrafficStore {
  private records: TrafficRecord[] = [];
  private listeners = new Set<Listener>();

  /** 同じ seq は 1 件だけ保持する（再取得との重複を除く）。 */
  add(...incoming: TrafficRecord[]): void {
    const bySeq = new Map(this.records.map((r) => [r.seq, r]));
    let changed = false;
    for (const r of incoming) {
      if (!bySeq.has(r.seq)) {
        bySeq.set(r.seq, r);
        changed = true;
      }
    }
    if (changed) {
      this.records = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      this.emit();
    }
  }

  clear(): void {
    if (this.records.length > 0) {
      this.records = [];
      this.emit();
    }
  }

  /** useSyncExternalStore 用：変更があるまで同じ配列を返す。 */
  getSnapshot = (): TrafficRecord[] => this.records;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  maxSeq(): number {
    return this.records.length === 0 ? 0 : this.records[this.records.length - 1].seq;
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

export const trafficStore = new TrafficStore();

let users = 0;
let stop: (() => void) | null = null;

async function backfill(): Promise<void> {
  try {
    trafficStore.add(...(await fetchTraffic(0)));
  } catch {
    // 次の接続・再接続で取り直す
  }
}

/**
 * 通信記録の同期を開始する。先に /ws/monitor へ接続してから既存分を取得し、seq で重複を除いて結合する。
 * 初期化（demo.reset）では空にしてから取り直す。戻り値で停止（利用者がいなくなったとき）。
 */
export function startTrafficSync(): () => void {
  users += 1;
  if (users === 1) {
    const unsubscribe = monitorSocket.subscribe((m) => {
      if (m.type === "traffic") trafficStore.add(m.record);
      else if (m.type === "socket.open") void backfill();
      else if (m.type === "demo.reset") {
        trafficStore.clear();
        void backfill();
      }
    });
    stop = unsubscribe;
  }
  return () => {
    users -= 1;
    if (users === 0) {
      stop?.();
      stop = null;
    }
  };
}
