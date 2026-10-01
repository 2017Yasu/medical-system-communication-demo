import { useEffect, useState } from "react";
import { FhirError, type FhirClient } from "../../fhir/client";
import { allItemKeys, labItem } from "../../fhir/builders/labOrder";
import { reportedItemKeys, submitFinalReport, submitPartialReport } from "../../fhir/labActions";
import { orderNumber, type OrderRow } from "../shared/orders";

/**
 * 結果値を入力して報告する。
 * - 「承認・報告」：残りの全項目を報告し、作業と依頼を完了にする（FR-015）。
 * - 「選んだ項目だけ先に報告」：チェックした項目だけを一部報告にする。作業と依頼は完了しない（FR-016）。
 * 先行報告済みの項目は表示せず、残りだけを扱う。
 */
export function ResultEntry({
  client,
  row,
  techRoleId,
  onDone,
  onError,
}: {
  client: FhirClient;
  row: OrderRow;
  techRoleId: string;
  onDone: () => void;
  onError: (e: unknown, operation: string) => void;
}) {
  const all = allItemKeys(row.sr.resource);
  const [reported, setReported] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Set<string> | null>(null); // null = 残りの全項目
  const [busy, setBusy] = useState(false);
  const order = { sr: row.sr, task: row.task! };

  // 先行報告済みの項目を調べる（版が変わるたびに取り直す）
  const versionKey = `${row.sr.etag}|${row.task?.etag}`;
  useEffect(() => {
    let cancelled = false;
    reportedItemKeys(client, order)
      .then((keys) => !cancelled && setReported(keys))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, versionKey]);

  const remaining = all.filter((k) => !reported.includes(k));
  const selected = chosen ? remaining.filter((k) => chosen.has(k)) : remaining;
  const parsed = (k: string) => (values[k] === undefined || values[k] === "" ? NaN : Number(values[k]));
  const filled = (keys: string[]) => keys.every((k) => !Number.isNaN(parsed(k)));
  const valueMap = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, parsed(k)]));

  const canFinal = remaining.length > 0 && filled(remaining);
  const canPartial = selected.length >= 1 && selected.length < remaining.length && filled(selected);

  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChosen(next);
  };
  const fillDefaults = () => setValues(Object.fromEntries(remaining.map((k) => [k, String(labItem(k).defaultValue)])));

  const run = async (operation: string, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (e) {
      if (e instanceof FhirError) onError(e, operation);
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" aria-label="結果入力" data-testid="result-entry">
      <strong>
        結果入力：{orderNumber(row.sr.resource)}（{row.patientName}）
      </strong>
      {reported.length > 0 && (
        <p className="muted" data-testid="already-reported">
          報告済み：{reported.map((k) => labItem(k).display).join("、")}（残り {remaining.length} 項目）
        </p>
      )}
      <table className="data">
        <thead>
          <tr>
            <th>今回報告</th>
            <th>項目</th>
            <th>値</th>
            <th>単位</th>
            <th>基準値</th>
          </tr>
        </thead>
        <tbody>
          {remaining.map((k) => {
            const item = labItem(k);
            return (
              <tr key={k}>
                <td>
                  <input type="checkbox" aria-label={`${item.display}を今回報告する`} checked={selected.includes(k)} onChange={() => toggle(k)} data-guide={`item-pick-${k}`} />
                </td>
                <td>{item.display}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    aria-label={item.display}
                    value={values[k] ?? ""}
                    onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  />
                </td>
                <td>{item.unitDisplay}</td>
                <td>
                  {item.low}–{item.high}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button type="button" onClick={fillDefaults} data-guide="result-defaults">
          既定値を入れる
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canFinal || busy}
          onClick={() => run("結果の報告", () => submitFinalReport(client, order, techRoleId, valueMap(remaining)))}
          data-guide="result-submit"
        >
          {busy ? "報告中…" : "承認・報告"}
        </button>
        <button
          type="button"
          disabled={!canPartial || busy}
          onClick={() => run("一部の結果の報告", () => submitPartialReport(client, order, techRoleId, selected, valueMap(selected)))}
          data-guide="partial-submit"
        >
          選んだ項目だけ先に報告
        </button>
      </div>
      {!canFinal && <p className="muted">「承認・報告」は、残りのすべての項目の値を入力すると押せます。</p>}
      {canFinal && remaining.length > 1 && !canPartial && (
        <p className="muted">先に報告する項目を 1 つ以上、全項目未満でチェックすると「選んだ項目だけ先に報告」を押せます。</p>
      )}
    </div>
  );
}
