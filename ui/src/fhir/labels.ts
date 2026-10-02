// 表示ラベル（docs/04-design-rules.md「表示ラベル」、data-model.md §3.3）。
// 画面は業務用語を主に表示し、FHIR のコード値を併記する（原則 V）。
import master from "../master/fhir-master.json";

export type StatusKind = "task" | "serviceRequest" | "diagnosticReport" | "slot" | "appointment";

const LABELS: Record<StatusKind, Record<string, string>> = {
  task: {
    requested: "依頼済み",
    accepted: "受付済み",
    rejected: "受付不可",
    "in-progress": "実施中",
    "on-hold": "保留",
    completed: "完了",
    failed: "中断（失敗）",
    cancelled: "取消",
  },
  serviceRequest: {
    active: "有効（依頼中）",
    revoked: "取消",
    completed: "完了",
    "on-hold": "保留",
  },
  diagnosticReport: {
    partial: "一部報告",
    final: "確定",
  },
  slot: {
    free: "空き",
    "busy-tentative": "仮押さえ中",
    busy: "予約済み",
  },
  appointment: {
    booked: "予約確定",
    cancelled: "予約取消",
  },
};

const BUSINESS_STATUS: Record<string, string> = Object.fromEntries(
  master.businessStatuses.map((b) => [b.code, b.display]),
);

/** 業務用語のラベル。未知のコードはそのまま返す。 */
export function statusLabel(kind: StatusKind, code: string): string {
  return LABELS[kind][code] ?? code;
}

/** 「受付済み accepted」のように、業務用語に FHIR のコード値を併記する。 */
export function formatStatus(kind: StatusKind, code: string): string {
  return `${statusLabel(kind, code)} ${code}`;
}

export function businessStatusLabel(code: string): string {
  return BUSINESS_STATUS[code] ?? code;
}

/** 業務上の状態（Task.businessStatus）のコード。 */
export function businessStatusCode(businessStatus?: { coding?: { code?: string }[] }): string | undefined {
  return businessStatus?.coding?.[0]?.code;
}

const RAD_BUSINESS_STATUS: Record<string, string> = Object.fromEntries(
  master.radBusinessStatuses.map((b) => [b.code, b.display]),
);

/** 放射線の業務上の状態（Task.businessStatus のコード）の表示。未知のコードはそのまま返す。 */
export function radBusinessStatusLabel(code: string): string {
  return RAD_BUSINESS_STATUS[code] ?? code;
}

const JAPAN_DATE = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const JAPAN_TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 日本時間の「10/3（土）10:00–10:30」。ブラウザ・サーバーのタイムゾーンに依存しない（specs/003 R-02）。 */
export function formatSlotTime(start: string, end: string): string {
  const s = new Date(start);
  const parts = Object.fromEntries(JAPAN_DATE.formatToParts(s).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day}（${parts.weekday}）${JAPAN_TIME.format(s)}–${JAPAN_TIME.format(new Date(end))}`;
}

const HOLD_PREFIX = "仮押さえ：";

/**
 * 仮押さえ中の枠の Slot.comment（「仮押さえ：医師 X」）から押さえた人の名前を取り出す。
 * comment は表示用で、確定できるかどうかの判定には使わない（D-35）。
 */
export function holderName(comment: string | undefined | null): string | null {
  if (!comment || !comment.startsWith(HOLD_PREFIX)) return null;
  const name = comment.slice(HOLD_PREFIX.length).trim();
  return name === "" ? null : name;
}

/** 仮押さえの comment（「仮押さえ：医師 X」）。 */
export function holdComment(doctorName: string): string {
  return `${HOLD_PREFIX}${doctorName}`;
}
