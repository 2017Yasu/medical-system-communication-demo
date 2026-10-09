// S4 のシナリオの判定に使う、現在のデータの状態を FHIR から取得する（specs/004 data-model.md §4.4）。
import type { MedicationDispense } from "fhir/r4";
import type { FhirClient } from "../fhir/client";
import { businessStatusCode } from "../fhir/labels";
import { fetchLatestPrescription } from "../fhir/prescriptionActions";
import type { ScenarioState } from "./types";

/** その医師の最新の処方・その作業・その調剤の記録から、シナリオが注目する状態を作る。処方が無ければ調剤の記録なし。 */
export function loadPrescriptionScenarioState(doctorRef: string) {
  return async (client: FhirClient): Promise<ScenarioState> => {
    const cur = await fetchLatestPrescription(client, doctorRef);
    if (!cur) return { medicationDispense: "none" };
    const dispenses = await client.search<MedicationDispense>("MedicationDispense", { prescription: `MedicationRequest/${cur.mr.resource.id}` });
    const task = cur.task.resource;
    return {
      medicationRequest: cur.mr.resource.status,
      task: { status: task.status, businessStatus: businessStatusCode(task.businessStatus), owner: task.owner?.reference },
      medicationDispense: dispenses.length > 0 ? "completed" : "none",
    };
  };
}
