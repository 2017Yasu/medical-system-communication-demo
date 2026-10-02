// 通信記録（TrafficRecord）をシーケンス図の要素へ変換する純粋関数（tasks.md T059、contracts/ui-screens.md）。
import { statusLabel } from "../fhir/labels";
import type { TrafficRecord } from "../realtime/types";

export type Lane = "ehr" | "server" | "lis" | "ris" | "monitor" | "other";

export interface SequenceItem {
  seq: number;
  kind: "http" | "notification" | "demo" | "server";
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
  "ehr-doctor-y": "医師 Y",
  "ehr-nurse": "看護師 D",
  "lis-tech-a": "技師 A",
  "lis-tech-b": "技師 B",
  ris: "放射線部門システム",
  "server-slot-expiry": "FHIR サーバー（仮押さえの期限切れ）",
  monitor: "通信モニタ",
  unknown: "不明",
};

export function laneOf(client: string): Lane {
  if (client.startsWith("ehr-")) return "ehr";
  if (client.startsWith("lis-")) return "lis";
  if (client === "ris") return "ris";
  if (client.startsWith("server-")) return "server";
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

export function resultText(status: number, body = ""): string {
  if (status === 400 && body.includes("If-Match")) return "400 版の確認が必要";
  return `${status} ${RESULT[status] ?? (status >= 500 ? "サーバーエラー" : status >= 400 ? "エラー" : "成功")}`;
}

/** Transaction の要求本文のエントリ（読めない・切り詰められた本文では空）。 */
function transactionEntries(body: string | undefined, truncated: boolean | undefined): { resource?: { resourceType?: string; slot?: { reference?: string }[] }; request?: { method?: string; url?: string } }[] {
  if (!body || truncated) return [];
  try {
    const bundle = JSON.parse(body) as { type?: string; entry?: never[] };
    return bundle.type === "transaction" ? (bundle.entry ?? []) : [];
  } catch {
    return [];
  }
}

function operationLabel(method: string, url: string, headers: Record<string, string> = {}, body?: string, truncated?: boolean): string {
  const path = url.replace(/^\/fhir\/?/, "");
  const [pathOnly] = path.split("?");
  const isSearch = path.includes("?") || (!pathOnly.includes("/") && method === "GET" && pathOnly !== "");
  if (pathOnly === "" && method === "POST") {
    const checksSlot = transactionEntries(body, truncated).some((e) => e.request?.method === "PUT" && e.request.url?.startsWith("Slot/"));
    return checksSlot ? "POST Transaction（一括登録・枠の版の確認あり）" : "POST Transaction（一括登録）";
  }
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
        label: operationLabel(record.request.method, record.request.url, record.request.headers, record.request.body, record.request.truncated),
        operator: clientName(record.client),
        result: resultText(record.response.status, record.response.body),
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
    } else if (record.kind === "server" && record.serverAction) {
      // サーバー内の処理（仮押さえの期限切れ）。FHIR サーバーの列の中の閉じた矢印として示す
      const a = record.serverAction;
      const ref = a.resource.replace(/\/_history\/.*$/, "");
      items.push({
        seq: record.seq,
        kind: "server",
        from: "server",
        to: "server",
        label: `仮押さえの期限切れ ${ref}（${statusLabel("slot", a.before.status)} → ${statusLabel("slot", a.after.status)}、版 ${a.before.versionId} → ${a.after.versionId}）`,
        operator: clientName(record.client),
        ok: true,
        detail: "サーバーの規則による自動の更新",
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

/** 要求に現れたリソースの参照（`Type/id`）。版の履歴の対象の候補。重複なし、昇順。
 *  Transaction は、更新（PUT）のエントリ・応答の `location`・予約（Appointment）が参照する枠も候補にする（S3-1 のように枠を一度も更新しなくても、枠の版の履歴を選べる）。 */
export function resourceRefsIn(records: TrafficRecord[]): string[] {
  const refs = new Set<string>();
  for (const r of records) {
    const m = r.request?.url.match(/^\/fhir\/([A-Za-z]+\/[^/?]+)/);
    if (m) refs.add(m[1]);
    if (r.request?.method !== "POST" || !/^\/fhir\/?$/.test(r.request.url)) continue;
    for (const e of transactionEntries(r.request.body, r.request.truncated)) {
      if (e.request?.method === "PUT" && /^[A-Za-z]+\/[^/?]+$/.test(e.request.url ?? "")) refs.add(e.request.url!);
      if (e.resource?.resourceType === "Appointment") {
        for (const slot of e.resource.slot ?? []) if (slot.reference?.startsWith("Slot/")) refs.add(slot.reference);
      }
    }
    if (r.response && !r.response.truncated) {
      try {
        const body = JSON.parse(r.response.body) as { entry?: { response?: { location?: string } }[] };
        for (const e of body.entry ?? []) {
          const location = e.response?.location?.replace(/\/_history\/.*$/, "");
          if (location && /^[A-Za-z]+\/[^/?]+$/.test(location)) refs.add(location);
        }
      } catch {
        // 本文を読めない応答は候補にしない
      }
    }
  }
  return [...refs].sort();
}

/** シーケンス図に出す列。電子カルテ・FHIR サーバーは常に、検体検査システム・放射線部門システムは記録があるときだけ（どちらも無ければ検体検査システム）。 */
export function lanesFor(items: SequenceItem[]): Lane[] {
  const used = new Set<Lane>();
  for (const i of items) {
    used.add(i.from);
    used.add(i.to);
  }
  const lanes: Lane[] = ["ehr", "server"];
  if (used.has("lis") || !used.has("ris")) lanes.push("lis");
  if (used.has("ris")) lanes.push("ris");
  return lanes;
}
