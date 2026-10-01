import { useState } from "react";
import { FhirError, type FhirClient } from "../../fhir/client";
import { allItemKeys, labItem } from "../../fhir/builders/labOrder";
import { submitFinalReport } from "../../fhir/labActions";
import { orderNumber, type OrderRow } from "../shared/orders";

/** 結果値を入力して承認・報告する（FR-015）。先行報告済みの項目は除き、残りを報告する。 */
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
  const keys = allItemKeys(row.sr.resource);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const parsed = (k: string) => (values[k] === undefined || values[k] === "" ? NaN : Number(values[k]));
  const complete = keys.every((k) => !Number.isNaN(parsed(k)));

  const fillDefaults = () => setValues(Object.fromEntries(keys.map((k) => [k, String(labItem(k).defaultValue)])));

  const submit = async () => {
    setBusy(true);
    try {
      await submitFinalReport(
        client,
        { sr: row.sr, task: row.task! },
        techRoleId,
        Object.fromEntries(keys.map((k) => [k, parsed(k)])),
      );
      onDone();
    } catch (e) {
      if (e instanceof FhirError) onError(e, "結果の報告");
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" aria-label="結果入力" data-testid="result-entry">
      <strong>結果入力：{orderNumber(row.sr.resource)}（{row.patientName}）</strong>
      <table className="data">
        <thead>
          <tr>
            <th>項目</th>
            <th>値</th>
            <th>単位</th>
            <th>基準値</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const item = labItem(k);
            return (
              <tr key={k}>
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
        <button type="button" className="primary" disabled={!complete || busy} onClick={submit} data-guide="result-submit">
          {busy ? "報告中…" : "承認・報告"}
        </button>
        {!complete && <span className="muted">すべての項目の値を入力してください</span>}
      </div>
    </div>
  );
}
