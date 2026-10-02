package jp.example.demo.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import java.io.File;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.BundleEntryComponent;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.DateTimeType;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Quantity;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Specimen;
import org.hl7.fhir.r4.model.Task;

/**
 * 検体検査の各操作を、UI と同じ要求（data-model.md §4）で組み立てて実行するテスト用の補助。
 * 検査項目・コードは UI と共通の FHIR マスタ（ui/src/master/fhir-master.json）から読む。
 */
public final class LabFlow {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode MASTER = readMaster();

    public record Ids(String sr, String task, String specimen) {}

    private final DemoServerExtension demo;
    private int orderSeq = 0;

    public LabFlow(DemoServerExtension demo) {
        this.demo = demo;
    }

    private static JsonNode readMaster() {
        try {
            return JSON.readTree(new File("../ui/src/master/fhir-master.json"));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- 取得 ----

    public IGenericClient client(String clientId) {
        return demo.fhir(clientId);
    }

    public Task task(String id) {
        return client("monitor").read().resource(Task.class).withId(id).execute();
    }

    public ServiceRequest serviceRequest(String id) {
        return client("monitor").read().resource(ServiceRequest.class).withId(id).execute();
    }

    public Specimen specimen(String id) {
        return client("monitor").read().resource(Specimen.class).withId(id).execute();
    }

    public List<DiagnosticReport> reports(String srId) {
        Bundle b = client("monitor").search().forResource(DiagnosticReport.class)
                .where(DiagnosticReport.BASED_ON.hasId("ServiceRequest/" + srId)).returnBundle(Bundle.class).execute();
        List<DiagnosticReport> out = new ArrayList<>();
        b.getEntry().forEach(e -> out.add((DiagnosticReport) e.getResource()));
        return out;
    }

    public List<Observation> observations(String srId) {
        Bundle b = client("monitor").search().forResource(Observation.class)
                .where(Observation.BASED_ON.hasId("ServiceRequest/" + srId)).returnBundle(Bundle.class).execute();
        List<Observation> out = new ArrayList<>();
        b.getEntry().forEach(e -> out.add((Observation) e.getResource()));
        return out;
    }

    public static String etag(Resource r) {
        return "W/\"" + r.getMeta().getVersionId() + "\"";
    }

    public static String businessStatusCode(Task t) {
        return t.getBusinessStatus().getCodingFirstRep().getCode();
    }

    // ---- 操作 ----

    /** 医師が依頼する（ServiceRequest + Task + Specimen の Transaction）。 */
    public Ids order(String patientId, String... setCodes) {
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        Date now = new Date();
        ServiceRequest sr = new ServiceRequest();
        sr.getMeta().addProfile(MASTER.at("/profiles/ServiceRequest").asText());
        sr.addIdentifier(new Identifier().setSystem(MASTER.at("/systems/orderNumber").asText())
                .setValue(String.format("L-20261001-%04d", ++orderSeq)));
        sr.setStatus(ServiceRequest.ServiceRequestStatus.ACTIVE);
        sr.setIntent(ServiceRequest.ServiceRequestIntent.ORDER);
        sr.addCategory(new CodeableConcept(coding("serviceRequestCategory")).setText("検体検査"));
        sr.setCode(new CodeableConcept(coding("serviceRequestCode")).setText("検体検査"));
        for (String set : setCodes) {
            JsonNode s = findSet(set);
            sr.addOrderDetail(new CodeableConcept(new Coding(MASTER.at("/systems/labSet").asText(), set, s.get("display").asText()))
                    .setText(s.get("display").asText()));
        }
        sr.setSubject(new Reference("Patient/" + patientId));
        sr.setRequester(new Reference("Practitioner/dr-x"));
        sr.addPerformer(new Reference("Organization/lab-dept"));
        sr.setAuthoredOn(now);
        sr.addSpecimen(new Reference("urn:uuid:specimen"));

        Task t = new Task();
        t.setStatus(Task.TaskStatus.REQUESTED);
        t.setIntent(Task.TaskIntent.ORDER);
        t.setCode(new CodeableConcept(coding("taskCode")));
        t.setFocus(new Reference("urn:uuid:sr"));
        t.setFor(new Reference("Patient/" + patientId));
        t.setRequester(new Reference("Practitioner/dr-x"));
        t.setOwner(new Reference("Organization/lab-dept"));
        t.setBusinessStatus(businessStatus("not-collected"));
        t.setAuthoredOn(now);
        t.setLastModified(now);

        Specimen sp = new Specimen();
        sp.getMeta().addProfile(MASTER.at("/profiles/Specimen").asText());
        sp.setType(new CodeableConcept(coding("specimenType")).setText("血液"));
        sp.setSubject(new Reference("Patient/" + patientId));
        sp.addRequest(new Reference("urn:uuid:sr"));

        post(b, "urn:uuid:sr", sr);
        post(b, "urn:uuid:task", t);
        post(b, "urn:uuid:specimen", sp);
        Bundle res = client("ehr-doctor").transaction().withBundle(b).execute();
        return new Ids(idOf(res.getEntry().get(0)), idOf(res.getEntry().get(1)), idOf(res.getEntry().get(2)));
    }

    /** 看護師が採血を記録する（Specimen + Task の Transaction、どちらも ifMatch）。 */
    public Bundle collect(Ids ids) {
        Specimen sp = specimen(ids.specimen());
        Task t = task(ids.task());
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        sp.setStatus(Specimen.SpecimenStatus.AVAILABLE);
        sp.getCollection().setCollector(new Reference("Practitioner/ns-d"));
        sp.getCollection().setCollected(new DateTimeType(new Date()));
        t.setBusinessStatus(businessStatus("collected"));
        t.setLastModified(new Date());
        put(b, sp, ids.specimen(), etag(sp));
        put(b, t, ids.task(), etag(t));
        return client("ehr-nurse").transaction().withBundle(b).execute();
    }

    public HttpResponse<String> accept(Ids ids, String tech) throws Exception {
        return patchTask(ids, tech, "accepted", "received", "PractitionerRole/" + tech);
    }

    /** 受付の PATCH を、渡した If-Match の値で送る（null なら If-Match を付けない）。本文は {@link #accept} と同じ。 */
    public HttpResponse<String> acceptWith(Ids ids, String tech, String ifMatchOrNull) throws Exception {
        return patchTaskWith(ids, tech, "accepted", "received", "PractitionerRole/" + tech, ifMatchOrNull);
    }

    /** 現在の作業の ETag（`W/"n"`）。 */
    public String etagNow(Ids ids) {
        return etag(task(ids.task()));
    }

    public HttpResponse<String> start(Ids ids, String tech) throws Exception {
        return patchTask(ids, tech, "in-progress", "measuring", null);
    }

    public HttpResponse<String> reject(Ids ids, String tech, String reason) throws Exception {
        Task t = task(ids.task());
        String body = "[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"rejected\"},"
                + "{\"op\":\"add\",\"path\":\"/statusReason\",\"value\":{\"text\":" + JSON.writeValueAsString(reason) + "}},"
                + "{\"op\":\"add\",\"path\":\"/lastModified\",\"value\":\"" + OffsetDateTime.now() + "\"}]";
        return demo.fhirRaw("PATCH", "/Task/" + ids.task(), headers("lis-" + tech, etag(t)), body);
    }

    /** 再検：測定中の作業を保留・再検中にして、実施中・測定中に戻す。 */
    public List<HttpResponse<String>> rerun(Ids ids, String tech) throws Exception {
        List<HttpResponse<String>> out = new ArrayList<>();
        out.add(patchTask(ids, tech, "on-hold", "rerun", null));
        out.add(patchTask(ids, tech, "in-progress", "measuring", null));
        return out;
    }

    private HttpResponse<String> patchTask(Ids ids, String tech, String status, String business, String owner) throws Exception {
        return patchTaskWith(ids, tech, status, business, owner, etag(task(ids.task())));
    }

    private HttpResponse<String> patchTaskWith(Ids ids, String tech, String status, String business, String owner, String ifMatch)
            throws Exception {
        JsonNode bs = JSON.valueToTree(Map.of(
                "coding", List.of(Map.of("system", MASTER.at("/systems/businessStatus").asText(), "code", business, "display", businessDisplay(business))),
                "text", businessDisplay(business)));
        StringBuilder ops = new StringBuilder("[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"" + status + "\"},");
        ops.append("{\"op\":\"add\",\"path\":\"/businessStatus\",\"value\":").append(bs).append("},");
        if (owner != null) {
            ops.append("{\"op\":\"add\",\"path\":\"/owner\",\"value\":{\"reference\":\"").append(owner).append("\"}},");
        }
        ops.append("{\"op\":\"add\",\"path\":\"/lastModified\",\"value\":\"").append(OffsetDateTime.now()).append("\"}]");
        return demo.fhirRaw("PATCH", "/Task/" + ids.task(), headers("lis-" + tech, ifMatch), ops.toString());
    }

    /** 全項目の結果を承認・報告する（依頼が一部報告済みなら、その DiagnosticReport を final に更新する）。 */
    public Bundle reportAll(Ids ids, String tech) {
        // 先行報告済みの項目は除き、残りを報告する
        java.util.Set<String> reported = new java.util.HashSet<>();
        observations(ids.sr()).forEach(o -> reported.add(o.getCode().getCodingFirstRep().getCode()));
        List<String> remaining = new ArrayList<>();
        for (String key : allItemKeys(ids)) {
            if (!reported.contains(findItem(key).at("/coding/code").asText())) {
                remaining.add(key);
            }
        }
        return report(ids, tech, remaining, true);
    }

    /** 指定した項目だけを先行して報告する（DiagnosticReport は partial、Task の状態は変えない）。 */
    public Bundle reportPartial(Ids ids, String tech, List<String> itemKeys) {
        return report(ids, tech, itemKeys, false);
    }

    private Bundle report(Ids ids, String tech, List<String> itemKeys, boolean complete) {
        Task t = task(ids.task());
        ServiceRequest sr = serviceRequest(ids.sr());
        Specimen sp = specimen(ids.specimen());
        List<DiagnosticReport> existing = reports(ids.sr());
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        Date now = new Date();
        DiagnosticReport dr = existing.isEmpty() ? new DiagnosticReport() : existing.get(0);
        List<Reference> results = new ArrayList<>(dr.getResult());
        int i = 0;
        for (String key : itemKeys) {
            JsonNode item = findItem(key);
            double value = item.get("defaultValue").asDouble();
            Observation o = new Observation();
            o.getMeta().addProfile(MASTER.at("/profiles/Observation").asText());
            o.setStatus(Observation.ObservationStatus.FINAL);
            o.addCategory(new CodeableConcept(coding("observationCategory")));
            o.setCode(new CodeableConcept(new Coding(item.at("/coding/system").asText(), item.at("/coding/code").asText(), item.get("display").asText()))
                    .setText(item.get("display").asText()));
            o.setSubject(sr.getSubject());
            o.addBasedOn(new Reference("ServiceRequest/" + ids.sr()));
            o.setSpecimen(new Reference("Specimen/" + ids.specimen()));
            o.setEffective(sp.getCollection().getCollected());
            o.setIssued(now);
            o.addPerformer(new Reference("PractitionerRole/" + tech));
            o.setValue(new Quantity().setValue(value).setUnit(item.get("unitDisplay").asText())
                    .setSystem(MASTER.at("/systems/ucum").asText()).setCode(item.get("unit").asText()));
            o.addReferenceRange().setLow(new Quantity().setValue(item.get("low").asDouble()))
                    .setHigh(new Quantity().setValue(item.get("high").asDouble()));
            String interp = value > item.get("high").asDouble() ? "interpretationHigh" : value < item.get("low").asDouble() ? "interpretationLow" : "interpretationNormal";
            o.addInterpretation(new CodeableConcept(coding(interp)));
            String uuid = "urn:uuid:obs-" + (i++);
            post(b, uuid, o);
            results.add(new Reference(uuid));
        }
        dr.getMeta().addProfile(MASTER.at("/profiles/DiagnosticReport").asText());
        dr.setStatus(complete ? DiagnosticReport.DiagnosticReportStatus.FINAL : DiagnosticReport.DiagnosticReportStatus.PARTIAL);
        dr.setCategory(List.of(new CodeableConcept(coding("diagnosticReportCategory"))));
        dr.setCode(new CodeableConcept(coding("diagnosticReportCode")).setText("検体検査報告書"));
        dr.setSubject(sr.getSubject());
        dr.setBasedOn(List.of(new Reference("ServiceRequest/" + ids.sr())));
        dr.addSpecimen(new Reference("Specimen/" + ids.specimen()));
        dr.setIssued(now);
        dr.setPerformer(List.of(new Reference("Organization/lab-dept")));
        dr.setResult(results);
        if (existing.isEmpty()) {
            post(b, "urn:uuid:dr", dr);
        } else {
            put(b, dr, existing.get(0).getIdElement().getIdPart(), etag(existing.get(0)));
        }
        String drRef = existing.isEmpty() ? "urn:uuid:dr" : "DiagnosticReport/" + existing.get(0).getIdElement().getIdPart();
        t.setLastModified(now);
        if (complete) {
            t.setStatus(Task.TaskStatus.COMPLETED);
            t.setBusinessStatus(businessStatus("reported"));
        } else {
            t.setBusinessStatus(businessStatus("partial-reported"));
        }
        t.getOutput().removeIf(o -> true);
        t.addOutput().setType(new CodeableConcept().setText("DiagnosticReport")).setValue(new Reference(drRef));
        put(b, t, ids.task(), etag(t));
        if (complete) {
            sr.setStatus(ServiceRequest.ServiceRequestStatus.COMPLETED);
            put(b, sr, ids.sr(), etag(sr));
        }
        return client("lis-" + tech).transaction().withBundle(b).execute();
    }

    /** 医師が依頼を取り消す（ServiceRequest + Task の Transaction）。 */
    public Bundle cancel(Ids ids) {
        ServiceRequest sr = serviceRequest(ids.sr());
        Task t = task(ids.task());
        sr.setStatus(ServiceRequest.ServiceRequestStatus.REVOKED);
        t.setStatus(Task.TaskStatus.CANCELLED);
        t.setLastModified(new Date());
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        put(b, sr, ids.sr(), etag(sr));
        put(b, t, ids.task(), etag(t));
        return client("ehr-doctor").transaction().withBundle(b).execute();
    }

    // ---- 部品 ----

    public List<String> allItemKeys(Ids ids) {
        List<String> keys = new ArrayList<>();
        for (Coding c : orderSets(serviceRequest(ids.sr()))) {
            findSet(c.getCode()).get("items").forEach(k -> keys.add(k.asText()));
        }
        return keys;
    }

    private static List<Coding> orderSets(ServiceRequest sr) {
        List<Coding> out = new ArrayList<>();
        sr.getOrderDetail().forEach(cc -> out.add(cc.getCodingFirstRep()));
        return out;
    }

    public Map<String, String> headers(String client, String ifMatch) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Content-Type", "application/json-patch+json");
        h.put("X-Demo-Client", client);
        if (ifMatch != null) {
            h.put("If-Match", ifMatch);
        }
        return h;
    }

    private static JsonNode findSet(String code) {
        for (JsonNode s : MASTER.get("labSets")) {
            if (s.get("code").asText().equals(code)) {
                return s;
            }
        }
        throw new IllegalArgumentException(code);
    }

    private static JsonNode findItem(String key) {
        for (JsonNode s : MASTER.get("labItems")) {
            if (s.get("key").asText().equals(key)) {
                return s;
            }
        }
        throw new IllegalArgumentException(key);
    }

    private static String businessDisplay(String code) {
        for (JsonNode s : MASTER.get("businessStatuses")) {
            if (s.get("code").asText().equals(code)) {
                return s.get("display").asText();
            }
        }
        throw new IllegalArgumentException(code);
    }

    private static CodeableConcept businessStatus(String code) {
        return new CodeableConcept(new Coding(MASTER.at("/systems/businessStatus").asText(), code, businessDisplay(code)))
                .setText(businessDisplay(code));
    }

    private static Coding coding(String key) {
        JsonNode c = MASTER.at("/codings/" + key);
        return new Coding(c.get("system").asText(), c.get("code").asText(), c.get("display").asText());
    }

    private static void post(Bundle b, String fullUrl, Resource r) {
        BundleEntryComponent e = b.addEntry().setFullUrl(fullUrl).setResource(r);
        e.getRequest().setMethod(HTTPVerb.POST).setUrl(r.fhirType());
    }

    private static void put(Bundle b, Resource r, String id, String ifMatch) {
        BundleEntryComponent e = b.addEntry().setResource(r);
        e.getRequest().setMethod(HTTPVerb.PUT).setUrl(r.fhirType() + "/" + id).setIfMatch(ifMatch);
    }

    private static String idOf(BundleEntryComponent e) {
        return e.getResource().getIdElement().getIdPart();
    }

    @SuppressWarnings("unused")
    private static String json(Resource r) {
        return Fhir.json().encodeResourceToString(r);
    }
}
