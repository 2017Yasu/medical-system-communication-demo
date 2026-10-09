package jp.example.demo.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.BundleEntryComponent;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Dosage;
import org.hl7.fhir.r4.model.Duration;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.MedicationDispense;
import org.hl7.fhir.r4.model.MedicationRequest;
import org.hl7.fhir.r4.model.Quantity;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.Task;

/**
 * 処方・調剤の各操作を、UI と同じ要求（specs/004 data-model.md §2、contracts/fhir-api.md）で組み立てて実行するテスト用の補助。
 * 薬剤・コードは UI と共通の FHIR マスタ（ui/src/master/fhir-master.json）から読む。どの操作も生の HTTP 応答を返す。
 */
public final class PharmacyFlow {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode MASTER = readMaster();

    public record Ids(String mr, String task) {}

    private final DemoServerExtension demo;
    private int orderSeq = 0;

    public PharmacyFlow(DemoServerExtension demo) {
        this.demo = demo;
    }

    private static JsonNode readMaster() {
        try {
            return JSON.readTree(new File("../ui/src/master/fhir-master.json"));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Map<String, String> headers(String client, String contentType, String ifMatch) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("X-Demo-Client", client);
        h.put("Content-Type", contentType);
        if (ifMatch != null) {
            h.put("If-Match", ifMatch);
        }
        return h;
    }

    private static String json(Resource r) {
        return Fhir.json().encodeResourceToString(r);
    }

    private static Coding coding(JsonNode c) {
        return new Coding(c.path("system").asText(), c.path("code").asText(), c.path("display").asText(null));
    }

    private static Coding coding(String key) {
        return coding(MASTER.path("codings").path(key));
    }

    private static JsonNode medication(String key) {
        for (JsonNode m : MASTER.path("medications")) {
            if (key.equals(m.path("key").asText())) {
                return m;
            }
        }
        throw new IllegalArgumentException("未知の薬剤: " + key);
    }

    public static String etag(HttpResponse<String> response) {
        return response.headers().firstValue("ETag").orElse(null);
    }

    // ---- 取得 ----

    public HttpResponse<String> read(String type, String id) throws Exception {
        return demo.fhirRaw("GET", "/" + type + "/" + id, Map.of("X-Demo-Client", "monitor"), null);
    }

    public <T extends Resource> T parse(Class<T> type, HttpResponse<String> response) {
        return Fhir.json().parseResource(type, response.body());
    }

    /** 調剤の記録の件数（その処方に基づくもの）。 */
    public int dispenses(String mrId) throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", "/MedicationDispense?prescription=MedicationRequest/" + mrId, Map.of(), null);
        return Fhir.json().parseResource(Bundle.class, res.body()).getEntry().size();
    }

    public MedicationDispense dispense(String mrId) throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", "/MedicationDispense?prescription=MedicationRequest/" + mrId, Map.of(), null);
        return (MedicationDispense) Fhir.json().parseResource(Bundle.class, res.body()).getEntry().get(0).getResource();
    }

    // ---- 医師：処方 ----

    /** 処方（Transaction：MedicationRequest + Task）。入院は encounterId を渡す。 */
    public HttpResponse<String> prescribe(String client, String doctor, String patientId, String encounterId, String medicationKey)
            throws Exception {
        JsonNode med = medication(medicationKey);
        int days = med.path("defaultDays").asInt();
        int dose = med.path("doseValue").asInt();
        Reference patient = new Reference("Patient/" + patientId);
        Reference requester = new Reference("Practitioner/" + doctor);

        MedicationRequest mr = new MedicationRequest();
        mr.getMeta().addProfile(MASTER.path("profiles").path("MedicationRequest").asText());
        mr.addIdentifier(new Identifier().setSystem(MASTER.path("systems").path("rpNumber").asText()).setValue("1"));
        mr.addIdentifier(new Identifier().setSystem(MASTER.path("systems").path("orderInRp").asText()).setValue("1"));
        mr.addIdentifier(new Identifier().setSystem(MASTER.path("systems").path("orderNumber").asText())
                .setValue("P-TEST-" + (++orderSeq)));
        mr.setStatus(MedicationRequest.MedicationRequestStatus.ACTIVE);
        mr.setIntent(MedicationRequest.MedicationRequestIntent.ORDER);
        String[] categories = encounterId == null
                ? new String[] {"categoryOutpatient", "categoryInHospital"}
                : new String[] {"categoryInpatient", "categoryTemporary"};
        for (String c : categories) {
            mr.addCategory(new CodeableConcept().addCoding(coding(c)));
        }
        mr.setMedication(new CodeableConcept().addCoding(coding(med.path("coding"))));
        mr.setSubject(patient);
        if (encounterId != null) {
            mr.setEncounter(new Reference("Encounter/" + encounterId));
        }
        mr.setAuthoredOn(new Date());
        mr.setRequester(requester);
        Coding unit = coding(med.path("doseUnit"));
        Dosage dosage = mr.addDosageInstruction();
        dosage.setText(med.path("usageText").asText());
        dosage.getTiming().setCode(new CodeableConcept().addCoding(coding(med.path("usage"))));
        dosage.getDoseAndRateFirstRep().setDose(new Quantity().setValue(dose).setUnit(unit.getDisplay()).setSystem(unit.getSystem()).setCode(unit.getCode()));
        mr.getDispenseRequest().setQuantity(new Quantity().setValue(dose * med.path("timesPerDay").asInt() * days)
                .setUnit(unit.getDisplay()).setSystem(unit.getSystem()).setCode(unit.getCode()));
        Duration supply = new Duration();
        supply.setValue(days);
        supply.setUnit("日");
        supply.setSystem(MASTER.path("systems").path("ucum").asText());
        supply.setCode("d");
        mr.getDispenseRequest().setExpectedSupplyDuration(supply);

        Task task = new Task();
        task.setStatus(Task.TaskStatus.REQUESTED);
        task.setIntent(Task.TaskIntent.ORDER);
        task.setFocus(new Reference("urn:uuid:mr-1"));
        task.setFor(patient);
        if (encounterId != null) {
            task.setEncounter(new Reference("Encounter/" + encounterId));
        }
        task.setRequester(requester);
        task.setOwner(new Reference("Organization/pharmacy-dept"));
        task.setAuthoredOn(new Date());
        task.setLastModified(new Date());

        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        post(b, "urn:uuid:mr-1", mr);
        post(b, "urn:uuid:task-1", task);
        return demo.fhirRaw("POST", "", headers(client, "application/fhir+json", null), json(b));
    }

    /** 処方して、MedicationRequest と Task の id を返す（失敗は例外）。 */
    public Ids prescribeOk(String client, String doctor, String patientId, String encounterId, String medicationKey) throws Exception {
        HttpResponse<String> res = prescribe(client, doctor, patientId, encounterId, medicationKey);
        if (res.statusCode() != 200) {
            throw new IllegalStateException("処方に失敗しました: " + res.statusCode() + " " + res.body());
        }
        Bundle response = Fhir.json().parseResource(Bundle.class, res.body());
        String mr = null;
        String task = null;
        for (BundleEntryComponent e : response.getEntry()) {
            String loc = e.getResponse().getLocation();
            if (loc.startsWith("MedicationRequest/")) {
                mr = loc.split("/")[1];
            } else if (loc.startsWith("Task/")) {
                task = loc.split("/")[1];
            }
        }
        return new Ids(mr, task);
    }

    // ---- 薬剤師：受付・調剤開始、監査開始 ----

    private HttpResponse<String> patch(String client, String taskId, String ifMatch, String ops) throws Exception {
        return demo.fhirRaw("PATCH", "/Task/" + taskId, headers(client, "application/json-patch+json", ifMatch), ops);
    }

    private static String businessStatusJson(String code, String display) {
        return "{\"coding\":[{\"system\":\"" + MASTER.path("systems").path("pharmBusinessStatus").asText() + "\",\"code\":\"" + code
                + "\",\"display\":\"" + display + "\"}],\"text\":\"" + display + "\"}";
    }

    public HttpResponse<String> accept(String client, String taskId, String ifMatch, String pharmacist) throws Exception {
        return patch(client, taskId, ifMatch,
                "[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"in-progress\"},"
                        + "{\"op\":\"add\",\"path\":\"/businessStatus\",\"value\":" + businessStatusJson("dispensing", "調剤中") + "},"
                        + "{\"op\":\"replace\",\"path\":\"/owner\",\"value\":{\"reference\":\"PractitionerRole/" + pharmacist + "\"}}]");
    }

    public HttpResponse<String> startAudit(String client, String taskId, String ifMatch, String pharmacist) throws Exception {
        return patch(client, taskId, ifMatch,
                "[{\"op\":\"add\",\"path\":\"/businessStatus\",\"value\":" + businessStatusJson("auditing", "監査中") + "},"
                        + "{\"op\":\"replace\",\"path\":\"/owner\",\"value\":{\"reference\":\"PractitionerRole/" + pharmacist + "\"}}]");
    }

    /** 調剤した薬剤師：Task の版の履歴のうち、業務上の状態が調剤中だった最後の版の担当者（D-51）。 */
    public String dispenserFromHistory(String client, String taskId) throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", "/Task/" + taskId + "/_history", Map.of("X-Demo-Client", client), null);
        Bundle history = Fhir.json().parseResource(Bundle.class, res.body());
        long best = -1;
        String owner = null;
        for (BundleEntryComponent e : history.getEntry()) {
            Task t = (Task) e.getResource();
            boolean dispensing = t.hasBusinessStatus() && t.getBusinessStatus().getCodingFirstRep().getCode().equals("dispensing");
            long version = Long.parseLong(t.getMeta().getVersionId());
            if (dispensing && version > best) {
                best = version;
                owner = t.getOwner().getReference().replace("PractitionerRole/", "");
            }
        }
        return owner;
    }

    // ---- 薬剤師：お渡し（外来）・払出（入院） ----

    private MedicationDispense dispenseOf(MedicationRequest mr, String packager, String checker, boolean toWard) {
        MedicationDispense md = new MedicationDispense();
        md.getMeta().addProfile(MASTER.path("profiles").path("MedicationDispense").asText());
        md.addIdentifier(new Identifier().setSystem(MASTER.path("systems").path("rpNumber").asText()).setValue("1"));
        md.addIdentifier(new Identifier().setSystem(MASTER.path("systems").path("orderInRp").asText()).setValue("1"));
        md.setStatus(MedicationDispense.MedicationDispenseStatus.COMPLETED);
        md.setMedication(mr.getMedicationCodeableConcept());
        md.setSubject(mr.getSubject());
        if (toWard && mr.hasEncounter()) {
            md.setContext(mr.getEncounter());
        }
        md.addPerformer().setFunction(new CodeableConcept().addCoding(coding("performerPackager")))
                .setActor(new Reference("PractitionerRole/" + packager));
        md.addPerformer().setFunction(new CodeableConcept().addCoding(coding("performerChecker")))
                .setActor(new Reference("PractitionerRole/" + checker));
        md.addAuthorizingPrescription(new Reference("MedicationRequest/" + mr.getIdElement().getIdPart()));
        md.setQuantity(mr.getDispenseRequest().getQuantity());
        md.setWhenHandedOver(new Date());
        if (toWard) {
            md.setDestination(new Reference("Location/ward-surgery"));
        } else {
            md.addReceiver(mr.getSubject());
        }
        return md;
    }

    private Task completedTask(Task task, String checker) {
        task.setStatus(Task.TaskStatus.COMPLETED);
        task.setBusinessStatus(null);
        task.setOwner(new Reference("PractitionerRole/" + checker));
        task.getOutput().clear();
        task.addOutput().setType(new CodeableConcept().setText("調剤の記録")).setValue(new Reference("urn:uuid:md-1"));
        task.getMeta().setVersionId(null);
        return task;
    }

    private static void post(Bundle b, String fullUrl, Resource r) {
        BundleEntryComponent e = b.addEntry().setFullUrl(fullUrl).setResource(r);
        e.getRequest().setMethod(HTTPVerb.POST).setUrl(r.fhirType());
    }

    private static void put(Bundle b, Resource r, String id, String ifMatch) {
        r.getMeta().setVersionId(null);
        BundleEntryComponent e = b.addEntry().setResource(r);
        e.getRequest().setMethod(HTTPVerb.PUT).setUrl(r.fhirType() + "/" + id).setIfMatch(ifMatch);
    }

    /** お渡し：MedicationDispense（POST）+ Task（PUT、ifMatch）+ MedicationRequest（PUT、ifMatch）。 */
    public HttpResponse<String> handOver(String client, String mrId, String mrEtag, String taskId, String taskEtag, String packager,
            String checker) throws Exception {
        MedicationRequest mr = parse(MedicationRequest.class, read("MedicationRequest", mrId));
        Task task = parse(Task.class, read("Task", taskId));
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        post(b, "urn:uuid:md-1", dispenseOf(mr, packager, checker, false));
        put(b, completedTask(task, checker), taskId, taskEtag);
        mr.setStatus(MedicationRequest.MedicationRequestStatus.COMPLETED);
        put(b, mr, mrId, mrEtag);
        return demo.fhirRaw("POST", "", headers(client, "application/fhir+json", null), json(b));
    }

    /** 払出：MedicationDispense（POST）+ Task（PUT、ifMatch）。処方は含めない（D-43）。 */
    public HttpResponse<String> dispenseToWard(String client, String mrId, String taskId, String taskEtag, String packager,
            String checker) throws Exception {
        MedicationRequest mr = parse(MedicationRequest.class, read("MedicationRequest", mrId));
        Task task = parse(Task.class, read("Task", taskId));
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        post(b, "urn:uuid:md-1", dispenseOf(mr, packager, checker, true));
        put(b, completedTask(task, checker), taskId, taskEtag);
        return demo.fhirRaw("POST", "", headers(client, "application/fhir+json", null), json(b));
    }
}
