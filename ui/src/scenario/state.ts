// シナリオの判定に使う、現在のデータの状態を FHIR から取得する。
import type { DiagnosticReport, Specimen } from "fhir/r4";
import type { FhirClient } from "../fhir/client";
import { businessStatusCode } from "../fhir/labels";
import { fetchLatestOrder } from "../fhir/labActions";
import type { ScenarioState } from "./types";

export async function loadScenarioState(client: FhirClient): Promise<ScenarioState> {
  const order = await fetchLatestOrder(client);
  if (!order) return { diagnosticReport: "none" };
  const specimenId = order.sr.resource.specimen?.[0]?.reference?.split("/")[1] ?? "";
  const [specimen, reports] = await Promise.all([
    client.read<Specimen>("Specimen", specimenId).catch(() => null),
    client.search<DiagnosticReport>("DiagnosticReport", { "based-on": `ServiceRequest/${order.sr.resource.id}` }),
  ]);
  const t = order.task.resource;
  return {
    serviceRequest: order.sr.resource.status,
    task: { status: t.status, businessStatus: businessStatusCode(t.businessStatus), owner: t.owner?.reference },
    specimen: specimen?.resource.collection?.collector ? "collected" : "not-collected",
    diagnosticReport: reports[0] ? (reports[0].resource.status === "final" ? "final" : "partial") : "none",
  };
}
