// 通知で一覧を取り直したとき、作業の状態・業務上の状態・担当者が変わった行を見つける（D-28、specs/002 R-06）。
// 検体検査の一覧（diffRows）のほか、CT の枠の一覧（specs/003、systems/shared/slots.ts の diffSlotRows）も同じ仕組みで示す。
// これは「表示が変わった」ことの強調であって、サーバーが上書きを検知したわけではない。エラー・警告としては扱わない。
import { useEffect, useRef, useState } from "react";
import { businessStatusLabel, formatStatus } from "../../fhir/labels";
import { taskBusinessStatus, type OrderRow } from "./orders";
import { ownerLabel } from "./StatusBadges";

/** 「変更前 → 変更後」を残す時間。 */
export const CHANGE_TTL_MS = 10_000;

export type ChangeField = "status" | "businessStatus" | "owner";

export interface FieldChange {
  /** 変わった項目（検体検査は ChangeField、CT の枠は "status" | "holder" | "bookings"）。 */
  field: string;
  before: string;
  after: string;
}

export interface RowChange {
  /** 変わった行の id（検体検査は依頼の id、CT の枠は枠の id）。 */
  srId: string;
  fields: FieldChange[];
}

export interface StampedChange extends RowChange {
  /** 検出した時刻（ms）。 */
  detectedAt: number;
}

const FIELD_ORDER: ChangeField[] = ["status", "businessStatus", "owner"];

function valuesOf(row: OrderRow): Record<ChangeField, string> {
  const task = row.task?.resource;
  const business = taskBusinessStatus(task);
  return {
    status: task?.status ? formatStatus("task", task.status) : "—",
    businessStatus: business ? businessStatusLabel(business) : "—",
    owner: ownerLabel(row),
  };
}

/** 直前の表示（prev）と取り直した結果（next）を依頼の id で突き合わせる。prev が無いとき（初回・初期化の直後）は比べない。 */
export function diffRows(prev: OrderRow[] | null, next: OrderRow[]): RowChange[] {
  if (!prev) return [];
  const before = new Map(prev.map((r) => [r.sr.resource.id ?? "", r]));
  const changes: RowChange[] = [];
  for (const row of next) {
    const srId = row.sr.resource.id ?? "";
    const old = before.get(srId);
    if (!old) continue;
    const a = valuesOf(old);
    const b = valuesOf(row);
    const fields = FIELD_ORDER.filter((f) => a[f] !== b[f]).map((f) => ({ field: f, before: a[f], after: b[f] }));
    if (fields.length > 0) changes.push({ srId, fields });
  }
  return changes;
}

export function pruneChanges(changes: StampedChange[], now: number): StampedChange[] {
  return changes.filter((c) => now - c.detectedAt < CHANGE_TTL_MS);
}

/** 同じ行の古い変更は新しい変更で置き換える。 */
export function mergeChanges(existing: StampedChange[], fresh: RowChange[], now: number): StampedChange[] {
  const replaced = new Set(fresh.map((c) => c.srId));
  return [...existing.filter((c) => !replaced.has(c.srId)), ...fresh.map((c) => ({ ...c, detectedAt: now }))];
}

/**
 * 一覧が取り直されるたびに前回の表示と比べ、変わった行を 10 秒間保持する。
 * rows が null（読み込み中・初期化の直後）のときは比較の基準を捨てる。
 */
export function useRowChanges<T = OrderRow>(
  rows: T[] | null | undefined,
  diff: (prev: T[] | null, next: T[]) => RowChange[] = diffRows as unknown as (prev: T[] | null, next: T[]) => RowChange[],
): StampedChange[] {
  const prev = useRef<T[] | null>(null);
  const [changes, setChanges] = useState<StampedChange[]>([]);

  useEffect(() => {
    if (!rows) {
      prev.current = null;
      setChanges([]);
      return;
    }
    const fresh = diff(prev.current, rows);
    prev.current = rows;
    if (fresh.length > 0) {
      const now = Date.now();
      setChanges((c) => mergeChanges(pruneChanges(c, now), fresh, now));
    }
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps -- diff は呼び出し側で固定の関数を渡す

  useEffect(() => {
    if (changes.length === 0) return;
    const timer = setInterval(() => setChanges((c) => pruneChanges(c, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [changes.length]);

  return changes;
}
