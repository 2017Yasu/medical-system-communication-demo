// デモ制御 API（contracts/demo-control-api.md）。FHIR の API ではない。
import type { DemoPolicy, TrafficRecord } from "./types";

export async function resetDemo(): Promise<{ resetAt: string; seedResources: number }> {
  const res = await fetch("/demo/reset", { method: "POST" });
  if (!res.ok) {
    throw new Error(`初期化に失敗しました（${res.status}）`);
  }
  return res.json();
}

export async function getPolicy(): Promise<DemoPolicy> {
  const res = await fetch("/demo/policy");
  return res.json();
}

export async function fetchTraffic(after = 0): Promise<TrafficRecord[]> {
  const res = await fetch(`/demo/traffic?after=${after}`);
  if (!res.ok) {
    throw new Error(`通信記録を取得できません（${res.status}）`);
  }
  return (await res.json()).records as TrafficRecord[];
}
