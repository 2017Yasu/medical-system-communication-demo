// Transaction の通信記録から「一括送信の中身」の表を作る純粋関数（specs/003 contracts/ui-screens.md「通信モニタ」）。
// 成功なら各エントリの結果、失敗なら失敗したエントリと「全体が取り消された」ことを示す。

export type EntryState = "ok" | "failed" | "cancelled";

export interface TransactionEntryRow {
  index: number;
  /** 例：`PUT Slot/ct1-1000`。 */
  request: string;
  /** そのエントリの `ifMatch`。無ければ null。 */
  ifMatch: string | null;
  result: string;
  state: EntryState;
}

export interface TransactionSummary {
  rows: TransactionEntryRow[];
  /** 失敗したエントリの位置（OperationOutcome の `Bundle.entry[n]`）。特定できなければ null。 */
  failedIndex: number | null;
  /** Transaction が失敗し、全体が取り消された（何も登録されていない）。 */
  cancelledAll: boolean;
}

interface RequestEntry {
  request?: { method?: string; url?: string; ifMatch?: string };
}

interface ResponseEntry {
  response?: { status?: string; location?: string };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `Slot/ct1-1000/_history/3` → `Slot/ct1-1000`。 */
const withoutHistory = (location?: string) => location?.replace(/\/_history\/.*$/, "");

function failedIndexOf(outcome: unknown): number | null {
  const issues = (outcome as { issue?: { expression?: string[] }[] } | null)?.issue ?? [];
  for (const issue of issues) {
    for (const expression of issue.expression ?? []) {
      const m = /^Bundle\.entry\[(\d+)\]/.exec(expression);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Transaction でない・本文を読めない（切り詰め含む）ときは null。 */
export function summarizeTransaction(requestBody: string, responseStatus: number, responseBody: string): TransactionSummary | null {
  const bundle = parse(requestBody) as { resourceType?: string; type?: string; entry?: RequestEntry[] } | null;
  if (!bundle || bundle.resourceType !== "Bundle" || bundle.type !== "transaction") return null;
  const entries = bundle.entry ?? [];
  const describe = (e: RequestEntry, index: number) => ({
    index,
    request: `${e.request?.method ?? "?"} ${e.request?.url ?? ""}`.trim(),
    ifMatch: e.request?.ifMatch ?? null,
  });

  if (responseStatus >= 400) {
    const failedIndex = failedIndexOf(parse(responseBody));
    return {
      failedIndex,
      cancelledAll: true,
      rows: entries.map((e, i) =>
        i === failedIndex
          ? { ...describe(e, i), result: `失敗（${responseStatus}）`, state: "failed" as const }
          : { ...describe(e, i), result: "取り消し（登録されていない）", state: "cancelled" as const },
      ),
    };
  }

  const responses = ((parse(responseBody) as { entry?: ResponseEntry[] } | null)?.entry ?? []) as ResponseEntry[];
  return {
    failedIndex: null,
    cancelledAll: false,
    rows: entries.map((e, i) => {
      const r = responses[i]?.response;
      const target = withoutHistory(r?.location);
      return { ...describe(e, i), result: r?.status ? `${r.status}${target ? ` → ${target}` : ""}` : "—", state: "ok" as const };
    }),
  };
}
