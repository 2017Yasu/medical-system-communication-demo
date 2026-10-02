// 電子カルテの CT 予約画面が持つ、予約中の枠の状態（specs/003 data-model.md §7）。サーバーには保存しない。
// 「枠を選ぶ」で取得した版を、仮押さえ・確定まで保持する。通知で一覧が取り直されても変えない（S2 の AcceptDraft と同じ考え方）。
import type { Slot } from "fhir/r4";
import type { Versioned } from "../../fhir/client";

export type BookingMode = "hold" | "direct";

export interface BookingDraft {
  /** 枠を選んだときの `GET /Slot/{id}` の応答（リソースと ETag）。 */
  slot: Versioned<Slot>;
  /** 仮押さえの応答（仮押さえに成功したとき）。確定・取りやめの If-Match はこの ETag を使う。 */
  held: Versioned<Slot> | null;
  /** 仮押さえの応答の `meta.lastUpdated`（残り時間の起点）。 */
  heldAt: string | null;
  /** 仮押さえの時点の期限（秒）。残り時間の表示用で、判定はサーバーが行う。 */
  holdSeconds: number | null;
  patientId: string;
  procedureCode: string;
  /** 枠を選んだ時点の予約方式。予約欄を開いている間にポリシーが変わっても変えない。 */
  mode: BookingMode;
}

export type CloseReason = "hold-conflict" | "booked" | "expired" | "released" | "cancelled" | "error";

export type BookingEvent =
  | { type: "select"; slot: Versioned<Slot>; mode: BookingMode; patientId: string; procedureCode: string }
  | { type: "held"; held: Versioned<Slot>; holdSeconds: number }
  | { type: "edit"; patientId?: string; procedureCode?: string }
  | { type: "close"; reason: CloseReason }
  | { type: "reset" }
  /** 通知で枠の一覧を取り直した。予約中の内容は変えない。 */
  | { type: "refresh" };

export function reduceBookingDraft(state: BookingDraft | null, event: BookingEvent): BookingDraft | null {
  switch (event.type) {
    case "select":
      // 1 つのウィンドウで同時に持てる予約中の枠は 1 つ
      if (state) return state;
      return { slot: event.slot, held: null, heldAt: null, holdSeconds: null, patientId: event.patientId, procedureCode: event.procedureCode, mode: event.mode };
    case "held":
      if (!state) return null;
      return { ...state, held: event.held, heldAt: event.held.resource.meta?.lastUpdated ?? null, holdSeconds: event.holdSeconds };
    case "edit":
      if (!state) return null;
      return {
        ...state,
        patientId: event.patientId ?? state.patientId,
        procedureCode: event.procedureCode ?? state.procedureCode,
      };
    case "close":
    case "reset":
      return null;
    case "refresh":
      return state;
  }
}

/** 仮押さえの確定までの残り秒数（切り上げ、0 が下限）。仮押さえ前は null。表示の目安で、期限の判定はサーバーが行う。 */
export function remainingSeconds(draft: BookingDraft, now: number): number | null {
  if (!draft.heldAt || draft.holdSeconds === null) return null;
  const deadline = new Date(draft.heldAt).getTime() + draft.holdSeconds * 1000;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
