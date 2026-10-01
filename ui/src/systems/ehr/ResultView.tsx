import { useEffect, useState } from "react";
import type { DiagnosticReport, Observation } from "fhir/r4";
import type { FhirClient } from "../../fhir/client";
import { statusLabel } from "../../fhir/labels";
import type { OrderRow } from "../shared/orders";
import { orderNumber } from "../shared/orders";

/** 報告された結果を、項目名・値・単位・基準値・基準値外の印（H/L）とともに表示する（FR-009）。 */
export function ResultView({ client, row }: { client: FhirClient; row: OrderRow | null }) {
  const srId = row?.sr.resource.id;
  // 依頼・作業の版が変わったら（通知で一覧が更新されたら）取り直す
  const versionKey = `${row?.sr.etag}|${row?.task?.etag}`;
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);

  useEffect(() => {
    if (!srId) return;
    let cancelled = false;
    (async () => {
      const [reports, obs] = await Promise.all([
        client.search<DiagnosticReport>("DiagnosticReport", { "based-on": `ServiceRequest/${srId}` }),
        client.search<Observation>("Observation", { "based-on": `ServiceRequest/${srId}` }),
      ]);
      if (cancelled) return;
      setReport(reports[0]?.resource ?? null);
      setObservations(obs.map((o) => o.resource).reverse());
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, srId, versionKey]);

  if (!row) {
    return (
      <section className="panel" aria-label="結果">
        <h2>結果</h2>
        <p className="muted">一覧の「結果を見る」を押すと、報告された結果が表示されます。</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-label="結果" data-testid="result-view">
      <h2>結果：{orderNumber(row.sr.resource)}（{row.patientName}）</h2>
      {!report ? (
        <p className="muted">結果はまだ報告されていません。</p>
      ) : (
        <>
          <p>
            検査報告：<strong>{statusLabel("diagnosticReport", report.status)}</strong> <span className="code">{report.status}</span>
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>項目</th>
                <th>値</th>
                <th>単位</th>
                <th>基準値</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => {
                const flag = o.interpretation?.[0]?.coding?.[0]?.code;
                const range = o.referenceRange?.[0];
                return (
                  <tr key={o.id}>
                    <td>{o.code?.text}</td>
                    <td>{o.valueQuantity?.value}</td>
                    <td>{o.valueQuantity?.unit}</td>
                    <td>
                      {range?.low?.value}–{range?.high?.value}
                    </td>
                    <td>{flag === "H" || flag === "L" ? <span className={`flag-${flag}`}>{flag}</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
