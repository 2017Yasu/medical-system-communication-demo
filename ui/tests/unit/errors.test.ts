import { describe, expect, it } from "vitest";
import { toDisplayError } from "../../src/fhir/errors";

function outcome(diagnostics: string) {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "processing", diagnostics }] };
}

// contracts/ui-screens.md「エラーの表示」
describe("toDisplayError", () => {
  it("400 without If-Match", () => {
    const e = toDisplayError({ status: 400, outcome: outcome("更新の前提となる版（If-Match）が指定されていません") }, "受付");
    expect(e.message).toBe("更新の前提となる版が指定されていません");
    expect(e.httpLabel).toBe("400 Bad Request");
    expect(e.text).toContain("400 Bad Request");
  });

  it("400 other: shows the reason from the OperationOutcome", () => {
    const e = toDisplayError({ status: 400, outcome: outcome("Bundle.entry[1]: 参照を解決できません") }, "依頼");
    expect(e.message).toBe("要求の内容に誤りがあります");
    expect(e.detail).toBe("Bundle.entry[1]: 参照を解決できません");
  });

  it("404", () => {
    const e = toDisplayError({ status: 404 }, "受付");
    expect(e.message).toBe("対象のデータが見つかりません（初期化された可能性があります）");
    expect(e.httpLabel).toBe("404 Not Found");
  });

  it("412 means someone else updated first", () => {
    const e = toDisplayError({ status: 412, outcome: outcome("他の利用者が先に更新しました（Task/1 の現在の版: 3）") }, "受付");
    expect(e.message).toBe("他の利用者が先に更新しました。最新の状態を表示します");
    expect(e.httpLabel).toBe("412 Precondition Failed");
    expect(e.kind).toBe("conflict");
  });

  it("422 names the operation and the current state", () => {
    const e = toDisplayError(
      { status: 422, outcome: outcome("この状態（実施中 in-progress）から 受付済み accepted へは変更できません") },
      "受付",
    );
    expect(e.message).toBe("この状態からは受付できません");
    expect(e.detail).toContain("実施中 in-progress");
    expect(e.httpLabel).toBe("422 Unprocessable Entity");
  });

  it("network failure", () => {
    const e = toDisplayError({ network: true }, "受付");
    expect(e.message).toBe("FHIR サーバーに接続できません");
    expect(e.httpLabel).toBeUndefined();
  });

  it("falls back for unexpected statuses", () => {
    const e = toDisplayError({ status: 500 }, "受付");
    expect(e.message).toContain("サーバーでエラーが発生しました");
    expect(e.httpLabel).toBe("500 Internal Server Error");
  });
});
