// 通信記録（TrafficRecord）をシーケンス図の要素へ変換する純粋関数（tasks.md T059、contracts/ui-screens.md）。
import type { TrafficRecord } from "../realtime/types";

export type Lane = "ehr" | "server" | "lis" | "monitor" | "other";

export interface SequenceItem {
  seq: number;
  kind: "http" | "notification" | "demo";
  from: Lane;
  to: Lane;
  /** 矢印の注記（メソッドとリソース、または ping と Subscription id）。 */
  label: string;
  /** 操作した人（または通知先）の名前。 */
  operator: string;
  /** 応答の業務上の意味（「200 成功」など）。通知・イベントには無い。 */
  result?: string;
  ok: boolean;
  /** 補足（通知のきっかけになったリソースなど）。 */
  detail?: string;
  record: TrafficRecord;
}

export interface SequenceOptions {
  /** 通信モニタ自身の通信（版の履歴の取得など）も表示する。 */
  showMonitor?: boolean;
}

const NAMES: Record<string, string> = {
  "ehr-doctor": "医師 X",
  "ehr-nurse": "看護師 D",
  "lis-tech-a": "技師 A",
  "lis-tech-b": "技師 B",
  monitor: "通信モニタ",
  unknown: "不明",
};

export function laneOf(client: string): Lane {
  if (client.startsWith("ehr-")) return "ehr";
  if (client.startsWith("lis-")) return "lis";
  if (client === "monitor") return "monitor";
  return "other";
}

export function clientName(client: string): string {
  return NAMES[client] ?? client;
}

const RESULT: Record<number, string> = {
  200: "成功",
  201: "成功",
  400: "要求の形式が不正",
  404: "対象が見つからない",
  412: "他の利用者が先に更新済み",
  422: "業務ルール違反",
};

export function resultText(status: number): string {
  return `${status} ${RESULT[status] ?? (status >= 500 ? "サーバーエラー" : status >= 400 ? "エラー" : "成功")}`;
}

function operationLabel(method: string, url: string, headers: Record<string, string> = {}): string {
  const path = url.replace(/^\/fhir\/?/, "");
  const [pathOnly] = path.split("?");
  const isSearch = path.includes("?") || (!pathOnly.includes("/") && method === "GET" && pathOnly !== "");
  if (pathOnly === "" && method === "POST") return "POST Transaction（一括登録）";
  if (pathOnly.endsWith("/_history")) return `${method} ${pathOnly.replace("/_history", "")} の履歴`;
  if (pathOnly === "metadata") return "GET metadata";
  if (method === "GET" && isSearch && !pathOnly.includes("/")) return `GET ${pathOnly} を検索`;
  if (method === "PUT" && pathOnly.startsWith("Subscription/")) return `PUT ${pathOnly}（通知の登録）`;
  if (method === "PUT" || method === "PATCH") {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === "if-match");
    return `${method} ${pathOnly}（${key ? `If-Match: ${headers[key]}` : "If-Match なし"}）`;
  }
  return `${method} ${pathOnly}`;
}

/** seq の昇順に並べた、シーケンス図の要素。 */
export function buildSequence(records: TrafficRecord[], options: SequenceOptions = {}): SequenceItem[] {
  const items: SequenceItem[] = [];
  for (const record of [...records].sort((a, b) => a.seq - b.seq)) {
    if (record.kind === "http" && record.request && record.response) {
      if (record.client === "monitor" && !options.showMonitor) continue;
      items.push({
        seq: record.seq,
        kind: "http",
        from: laneOf(record.client),
        to: "server",
        label: operationLabel(record.request.method, record.request.url, record.request.headers),
        operator: clientName(record.client),
        result: resultText(record.response.status),
        ok: record.response.status < 400,
        record,
      });
    } else if (record.kind === "notification" && record.notification) {
      items.push({
        seq: record.seq,
        kind: "notification",
        from: "server",
        to: laneOf(record.notification.targetClient),
        label: `ping ${record.notification.subscriptionId}`,
        operator: clientName(record.notification.targetClient),
        ok: true,
        detail: record.notification.resource,
        record,
      });
    } else if (record.kind === "demo") {
      const event = record.demoEvent?.event;
      items.push({
        seq: record.seq,
        kind: "demo",
        from: "server",
        to: "server",
        label: event === "reset" ? "初期化" : event === "policy" ? "ポリシーの変更" : (event ?? "デモ"),
        operator: "デモ制御",
        ok: true,
        record,
      });
    }
  }
  return items;
}

/** 要求に現れたリソースの参照（`Type/id`）。版の履歴の対象の候補。重複なし、昇順。 */
export function resourceRefsIn(records: TrafficRecord[]): string[] {
  const refs = new Set<string>();
  for (const r of records) {
    const m = r.request?.url.match(/^\/fhir\/([A-Za-z]+\/[^/?]+)/);
    if (m) refs.add(m[1]);
  }
  return [...refs].sort();
}
