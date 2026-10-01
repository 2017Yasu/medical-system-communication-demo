// エラーの表示（contracts/ui-screens.md「エラーの表示」、FR-032）。
// HTTP のステータスだけでなく、業務上の意味を日本語で示す。

export interface ErrorInput {
  /** HTTP ステータス。ネットワークに接続できない場合は network: true。 */
  status?: number;
  network?: boolean;
  outcome?: { issue?: { diagnostics?: string }[] } | null;
}

export type DisplayErrorKind = "conflict" | "invalid" | "notFound" | "rule" | "network" | "server";

export interface DisplayError {
  kind: DisplayErrorKind;
  /** 画面に出す業務上のメッセージ。 */
  message: string;
  /** サーバーが返した理由（あれば）。 */
  detail?: string;
  /** 「412 Precondition Failed」のような HTTP の表記。 */
  httpLabel?: string;
  /** メッセージと HTTP の表記を合わせた 1 行。 */
  text: string;
}

const REASONS: Record<number, string> = {
  400: "Bad Request",
  404: "Not Found",
  412: "Precondition Failed",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
};

export function httpLabel(status: number): string {
  return `${status} ${REASONS[status] ?? "Error"}`;
}

export function diagnosticsOf(outcome: ErrorInput["outcome"]): string | undefined {
  return outcome?.issue?.find((i) => i.diagnostics)?.diagnostics;
}

/** @param operationName 失敗した操作の名前（例：「受付」「測定開始」）。 */
export function toDisplayError(input: ErrorInput, operationName: string): DisplayError {
  if (input.network || input.status === undefined) {
    return build("network", "FHIR サーバーに接続できません");
  }
  const detail = diagnosticsOf(input.outcome);
  const label = httpLabel(input.status);
  switch (input.status) {
    case 400:
      if (detail?.includes("If-Match")) {
        return build("invalid", "更新の前提となる版が指定されていません", undefined, label);
      }
      return build("invalid", "要求の内容に誤りがあります", detail, label);
    case 404:
      return build("notFound", "対象のデータが見つかりません（初期化された可能性があります）", undefined, label);
    case 412:
      return build("conflict", "他の利用者が先に更新しました。最新の状態を表示します", detail, label);
    case 422:
      return build("rule", `この状態からは${operationName}できません`, detail, label);
    default:
      return build("server", `サーバーでエラーが発生しました（${operationName}）`, detail, label);
  }
}

function build(kind: DisplayErrorKind, message: string, detail?: string, label?: string): DisplayError {
  return { kind, message, detail, httpLabel: label, text: label ? `${message}（${label}）` : message };
}
