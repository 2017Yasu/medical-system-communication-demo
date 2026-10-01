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
