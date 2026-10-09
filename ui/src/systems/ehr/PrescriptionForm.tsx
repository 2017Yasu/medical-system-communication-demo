import { useState } from "react";
import type { Encounter, Patient } from "fhir/r4";
import { FhirError, type FhirClient, type Versioned } from "../../fhir/client";
import { MEDICATIONS, PRESCRIPTION_DEFAULTS, medication, type PrescriberId } from "../../fhir/builders/prescription";
import { placePrescription } from "../../fhir/prescriptionActions";
import { patientName } from "../shared/orders";

/** 医師が患者と薬剤（1 剤）を選んで処方する（FR-005、FR-006）。区分は患者に入院中の入院があるかで決まる（D-44）。 */
export function PrescriptionForm({
  client,
  doctor,
  patients,
  encounters,
  onDone,
  onError,
}: {
  client: FhirClient;
  doctor: PrescriberId;
  patients: Versioned<Patient>[];
  encounters: Versioned<Encounter>[];
  onDone: () => void;
  onError: (e: unknown, operation: string) => void;
}) {
  const defaults = PRESCRIPTION_DEFAULTS[doctor];
  const [patientId, setPatientId] = useState(defaults.patientId);
  const [medicationKey, setMedicationKey] = useState(defaults.medication);
  const med = medication(medicationKey);
  const [doseValue, setDoseValue] = useState(med.doseValue);
  const [days, setDays] = useState(med.defaultDays);
  const [busy, setBusy] = useState(false);

  const admission = encounters.find((e) => e.resource.status === "in-progress" && e.resource.subject?.reference === `Patient/${patientId}`);
  const ward = admission?.resource.location?.[0]?.location?.display;
  const quantity = doseValue * med.timesPerDay * days;
  const valid = Number.isFinite(doseValue) && doseValue > 0 && Number.isInteger(days) && days > 0;

  const chooseMedication = (key: string) => {
    const next = medication(key);
    setMedicationKey(key);
    setDoseValue(next.doseValue);
    setDays(next.defaultDays);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await placePrescription(client, doctor, { patientId, medicationKey, doseValue, days });
      onDone();
    } catch (e) {
      if (e instanceof FhirError) onError(e, "処方");
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label="処方" data-testid="rx-form">
      <h2>処方する</h2>
      <div className="field">
        <label htmlFor="rx-patient">患者</label>
        <select id="rx-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} data-guide="rx-patient">
          {patients.map((p) => (
            <option key={p.resource.id} value={p.resource.id}>
              {patientName(p.resource)}（{p.resource.identifier?.[0]?.value}）
            </option>
          ))}
        </select>
        <span className="muted" data-testid="rx-category">
          {" "}
          区分：{admission ? `入院処方・臨時処方${ward ? `（${ward}）` : ""}` : "外来処方・院内処方"}
        </span>
      </div>
      <div className="field">
        <label htmlFor="rx-drug">薬剤</label>
        <select id="rx-drug" value={medicationKey} onChange={(e) => chooseMedication(e.target.value)} data-guide="rx-drug">
          {MEDICATIONS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.display}（HOT {m.coding.code}）
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label>
          1 回量（{med.doseUnit.display}）{" "}
          <input type="number" min={1} step={1} value={doseValue} onChange={(e) => setDoseValue(Number(e.target.value))} style={{ width: "5em" }} />
        </label>
        <label>
          日数{" "}
          <input type="number" min={1} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: "5em" }} />
        </label>
        <span className="muted">
          用法：{med.usageText}（JAMI {med.usage.code}）／数量：{quantity} {med.doseUnit.display}
        </span>
      </div>
      <button type="button" className="primary" disabled={busy || !valid} onClick={submit} data-guide="rx-submit" style={{ marginTop: "var(--sp-2)" }}>
        {busy ? "処方中…" : "処方する"}
      </button>
    </section>
  );
}
