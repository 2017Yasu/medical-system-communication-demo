import { useState } from "react";
import type { Patient } from "fhir/r4";
import { FhirError, type FhirClient, type Versioned } from "../../fhir/client";
import { buildOrderTransaction, LAB_SETS, labItem, nextOrderNumber } from "../../fhir/builders/labOrder";
import { patientName } from "../shared/orders";

/** 医師が患者と検査セット（1 つ以上）を選んで依頼する（FR-005、FR-006）。 */
export function OrderForm({
  client,
  patients,
  existingOrderCount,
  onDone,
  onError,
}: {
  client: FhirClient;
  patients: Versioned<Patient>[];
  existingOrderCount: number;
  onDone: () => void;
  onError: (e: unknown, operation: string) => void;
}) {
  const [patientId, setPatientId] = useState<string>("");
  const [sets, setSets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = patientId || patients[0]?.resource.id || "";

  const toggle = (code: string) => setSets((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const submit = async () => {
    setBusy(true);
    try {
      const now = new Date();
      await client.transaction(
        buildOrderTransaction({ patientId: selected, sets, orderNumber: nextOrderNumber(now, existingOrderCount), now }),
        "検査の依頼",
      );
      setSets([]);
      onDone();
    } catch (e) {
      if (e instanceof FhirError) onError(e, "検査の依頼");
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label="検査の依頼">
      <h2>検体検査を依頼する</h2>
      <div className="field">
        <label htmlFor="patient">患者</label>
        <select id="patient" value={selected} onChange={(e) => setPatientId(e.target.value)} data-guide="order-patient">
          {patients.map((p) => (
            <option key={p.resource.id} value={p.resource.id}>
              {patientName(p.resource)}（{p.resource.identifier?.[0]?.value}）
            </option>
          ))}
        </select>
      </div>
      <fieldset className="field" style={{ border: "none", padding: 0 }}>
        <legend>検査セット</legend>
        <div className="checks">
          {LAB_SETS.map((s) => (
            <label key={s.code}>
              <input type="checkbox" checked={sets.includes(s.code)} onChange={() => toggle(s.code)} data-guide={`order-set-${s.code}`} />{" "}
              {s.display} <span className="muted">（{s.items.map((k) => labItem(k).display).join("、")}）</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="primary" disabled={busy || sets.length === 0 || !selected} onClick={submit} data-guide="order-submit">
        {busy ? "依頼中…" : "依頼する"}
      </button>
      {sets.length === 0 && <span className="muted"> 検査セットを 1 つ以上選んでください</span>}
    </section>
  );
}
