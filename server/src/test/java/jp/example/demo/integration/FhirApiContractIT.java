package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpResponse;
import java.util.Map;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.CapabilityStatement;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Specimen;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** contracts/fhir-api.md と quickstart.md §3 の確認。 */
class FhirApiContractIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    static Bundle orderBundle() {
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        ServiceRequest sr = new ServiceRequest();
        sr.setStatus(ServiceRequest.ServiceRequestStatus.ACTIVE);
        sr.setIntent(ServiceRequest.ServiceRequestIntent.ORDER);
        sr.setSubject(new Reference("Patient/demo-taro"));
        sr.setRequester(new Reference("Practitioner/dr-x"));
        Task t = new Task();
        t.setStatus(Task.TaskStatus.REQUESTED);
        t.setIntent(Task.TaskIntent.ORDER);
        t.setFocus(new Reference("urn:uuid:sr-1"));
        t.setFor(new Reference("Patient/demo-taro"));
        t.setRequester(new Reference("Practitioner/dr-x"));
        t.setOwner(new Reference("Organization/lab-dept"));
        Specimen sp = new Specimen();
        sp.setSubject(new Reference("Patient/demo-taro"));
        sr.addSpecimen(new Reference("urn:uuid:sp-1"));
        entry(b, "urn:uuid:sr-1", sr);
        entry(b, "urn:uuid:t-1", t);
        entry(b, "urn:uuid:sp-1", sp);
        return b;
    }

    static void entry(Bundle b, String fullUrl, org.hl7.fhir.r4.model.Resource r) {
        Bundle.BundleEntryComponent e = b.addEntry().setFullUrl(fullUrl).setResource(r);
        e.getRequest().setMethod(HTTPVerb.POST).setUrl(r.fhirType());
    }

    static final Map<String, String> PATCH = Map.of("Content-Type", "application/json-patch+json", "X-Demo-Client", "lis-tech-a");

    static String patch(String status) {
        return "[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"" + status + "\"}]";
    }

    @Test
    void resetRestoresTheSeedAndPatientsCanBeSearched() throws Exception {
        JsonNode r = demo.reset();
        assertThat(r.get("seedResources").asInt()).isEqualTo(37);

        HttpResponse<String> res = demo.fhirRaw("GET", "/Patient", Map.of(), null);
        assertThat(res.statusCode()).isEqualTo(200);
        Bundle bundle = Fhir.json().parseResource(Bundle.class, res.body());
        assertThat(bundle.getEntry()).hasSize(5);
        assertThat(bundle.getTotal()).isEqualTo(5);

        HttpResponse<String> one = demo.fhirRaw("GET", "/Patient/demo-taro", Map.of(), null);
        assertThat(one.statusCode()).isEqualTo(200);
        assertThat(one.headers().firstValue("ETag")).contains("W/\"1\"");
        assertThat(demo.fhirRaw("GET", "/Patient/nobody", Map.of(), null).statusCode()).isEqualTo(404);
        assertThat(demo.fhirRaw("GET", "/Patient?unknown=1", Map.of(), null).statusCode()).isEqualTo(400);
    }

    @Test
    void transactionCreatesThreeResourcesWithRewrittenReferences() throws Exception {
        Bundle response = demo.fhir("ehr-doctor").transaction().withBundle(orderBundle()).execute();
        assertThat(response.getType()).isEqualTo(Bundle.BundleType.TRANSACTIONRESPONSE);
        assertThat(response.getEntry()).hasSize(3);
        assertThat(response.getEntry()).allSatisfy(e -> assertThat(e.getResponse().getStatus()).startsWith("201"));
        Task task = demo.fhir("ehr-doctor").read().resource(Task.class).withId("1").execute();
        assertThat(task.getFocus().getReference()).isEqualTo("ServiceRequest/1");
        assertThat(task.getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
    }

    @Test
    void patchRulesAndHeaders() throws Exception {
        demo.fhir("ehr-doctor").transaction().withBundle(orderBundle()).execute();

        // If-Match 無し → 400
        HttpResponse<String> noHeader = demo.fhirRaw("PATCH", "/Task/1", PATCH, patch("accepted"));
        assertThat(noHeader.statusCode()).isEqualTo(400);
        assertThat(noHeader.body()).contains("If-Match");

        // 正しい版 → 200、ETag が進む
        Map<String, String> withMatch = new java.util.LinkedHashMap<>(PATCH);
        withMatch.put("If-Match", "W/\"1\"");
        HttpResponse<String> ok = demo.fhirRaw("PATCH", "/Task/1", withMatch, patch("accepted"));
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(ok.headers().firstValue("ETag")).contains("W/\"2\"");
        assertThat(ok.headers().firstValue("Location").orElse("")).endsWith("/Task/1/_history/2");
        assertThat(ok.body()).contains("\"accepted\"");

        // 古い版 → 412（Task は変わらない）
        HttpResponse<String> stale = demo.fhirRaw("PATCH", "/Task/1", withMatch, patch("in-progress"));
        assertThat(stale.statusCode()).isEqualTo(412);
        assertThat(stale.body()).contains("他の利用者が先に更新しました");
        Task current = demo.fhir("x").read().resource(Task.class).withId("1").execute();
        assertThat(current.getStatus()).isEqualTo(Task.TaskStatus.ACCEPTED);

        // 許可されない遷移（accepted → requested）→ 422
        Map<String, String> v2 = new java.util.LinkedHashMap<>(PATCH);
        v2.put("If-Match", "W/\"2\"");
        HttpResponse<String> bad = demo.fhirRaw("PATCH", "/Task/1", v2, patch("requested"));
        assertThat(bad.statusCode()).isEqualTo(422);

        // 履歴
        HttpResponse<String> history = demo.fhirRaw("GET", "/Task/1/_history", Map.of(), null);
        Bundle h = Fhir.json().parseResource(Bundle.class, history.body());
        assertThat(h.getEntry()).hasSize(2);
        assertThat(((Task) h.getEntry().get(0).getResource()).getStatus()).isEqualTo(Task.TaskStatus.ACCEPTED);
        assertThat(demo.fhirRaw("GET", "/Task/1/_history/1", Map.of(), null).statusCode()).isEqualTo(200);
    }

    @Test
    void putRequiresIfMatchAndReturnsEtag() throws Exception {
        demo.fhir("ehr-doctor").transaction().withBundle(orderBundle()).execute();
        Task t = demo.fhir("x").read().resource(Task.class).withId("1").execute();
        t.setStatus(Task.TaskStatus.ACCEPTED);
        t.getMeta().setVersionId(null);
        String body = Fhir.json().encodeResourceToString(t);

        assertThat(demo.fhirRaw("PUT", "/Task/1", Map.of(), body).statusCode()).isEqualTo(400);
        HttpResponse<String> ok = demo.fhirRaw("PUT", "/Task/1", Map.of("If-Match", "W/\"1\""), body);
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(ok.headers().firstValue("ETag")).contains("W/\"2\"");
        assertThat(demo.fhirRaw("PUT", "/Task/1", Map.of("If-Match", "W/\"1\""), body).statusCode()).isEqualTo(412);
    }

    @Test
    void createIsAssignedSequentialIdsAndReturns201() throws Exception {
        Task t = new Task();
        t.setStatus(Task.TaskStatus.REQUESTED);
        t.setIntent(Task.TaskIntent.ORDER);
        HttpResponse<String> res = demo.fhirRaw("POST", "/Task", Map.of(), Fhir.json().encodeResourceToString(t));
        assertThat(res.statusCode()).isEqualTo(201);
        assertThat(res.headers().firstValue("Location").orElse("")).contains("/Task/1/_history/1");
        assertThat(res.headers().firstValue("ETag")).contains("W/\"1\"");
    }

    @Test
    void readOnlyTypesCannotBeWritten() throws Exception {
        HttpResponse<String> res = demo.fhirRaw("POST", "/Patient", Map.of(), "{\"resourceType\":\"Patient\"}");
        assertThat(res.statusCode()).isIn(400, 404, 405, 422);
    }

    @Test
    void trafficLogRecordsEveryRequestInOrder() throws Exception {
        demo.fhirRaw("GET", "/Patient", Map.of("X-Demo-Client", "ehr-doctor"), null);
        demo.fhirRaw("GET", "/Patient/nobody", Map.of("X-Demo-Client", "ehr-doctor"), null);
        demo.fhirRaw("GET", "/Task?status=requested", Map.of(), null);

        JsonNode traffic = DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body());
        JsonNode records = traffic.get("records");
        // 先頭は初期化のイベント
        assertThat(records.get(0).get("kind").asText()).isEqualTo("demo");
        assertThat(records.get(1).get("request").get("url").asText()).isEqualTo("/fhir/Patient");
        assertThat(records.get(1).get("client").asText()).isEqualTo("ehr-doctor");
        assertThat(records.get(1).get("response").get("status").asInt()).isEqualTo(200);
        assertThat(records.get(2).get("response").get("status").asInt()).isEqualTo(404);
        assertThat(records.get(3).get("client").asText()).isEqualTo("unknown");
        assertThat(records.get(3).get("request").get("url").asText()).isEqualTo("/fhir/Task?status=requested");
        long prev = 0;
        for (JsonNode r : records) {
            assertThat(r.get("seq").asLong()).isGreaterThan(prev);
            prev = r.get("seq").asLong();
        }
        JsonNode after = DemoServerExtension.JSON.readTree(
                demo.raw("GET", "/demo/traffic?after=" + records.get(2).get("seq").asLong(), Map.of(), null).body());
        assertThat(after.get("records")).hasSize(1);
    }

    @Test
    void capabilityStatementAdvertisesTheWebsocketUrl() throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", "/metadata", Map.of(), null);
        assertThat(res.statusCode()).isEqualTo(200);
        CapabilityStatement cs = Fhir.json().parseResource(CapabilityStatement.class, res.body());
        assertThat(cs.getFhirVersion().toCode()).startsWith("4.0");
        var ext = cs.getRestFirstRep().getExtensionByUrl("http://hl7.org/fhir/StructureDefinition/capabilitystatement-websocket");
        assertThat(ext).isNotNull();
        assertThat(ext.getValue().primitiveValue()).startsWith("ws://localhost:").endsWith("/ws/subscription");
    }

    @Test
    void policyCanBeSwitchedAndReset() throws Exception {
        demo.fhir("ehr-doctor").transaction().withBundle(orderBundle()).execute();
        assertThat(demo.raw("PUT", "/demo/policy", Map.of("Content-Type", "application/json"),
                "{\"ifMatchRequired\":false}").statusCode()).isEqualTo(200);
        // 任意になると If-Match 無しの PATCH が通る（後勝ち）
        assertThat(demo.fhirRaw("PATCH", "/Task/1", PATCH, patch("accepted")).statusCode()).isEqualTo(200);
        demo.reset();
        JsonNode policy = DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/policy", Map.of(), null).body());
        assertThat(policy.get("ifMatchRequired").asBoolean()).isTrue();
    }

    // ---- S3（specs/003 contracts/fhir-api.md）----

    static final Map<String, String> JSON_PUT = Map.of("Content-Type", "application/fhir+json", "X-Demo-Client", "ehr-doctor");

    static String slotJson(String status, String comment) {
        return "{\"resourceType\":\"Slot\",\"id\":\"ct1-1000\",\"schedule\":{\"reference\":\"Schedule/ct-1\"},"
                + "\"status\":\"" + status + "\",\"start\":\"2026-10-04T10:00:00+09:00\",\"end\":\"2026-10-04T10:30:00+09:00\""
                + (comment == null ? "" : ",\"comment\":\"" + comment + "\"") + "}";
    }

    static Map<String, String> ifMatch(String v) {
        Map<String, String> h = new java.util.LinkedHashMap<>(JSON_PUT);
        if (v != null) {
            h.put("If-Match", v);
        }
        return h;
    }

    @Test
    void scheduleDeviceAndSlotsAreReadableAndTheSeedIsInPlace() throws Exception {
        demo.reset();
        assertThat(demo.fhirRaw("GET", "/Schedule/ct-1", Map.of(), null).statusCode()).isEqualTo(200);
        assertThat(demo.fhirRaw("GET", "/Device/ct-1", Map.of(), null).statusCode()).isEqualTo(200);
        Bundle slots = Fhir.json().parseResource(Bundle.class, demo.fhirRaw("GET", "/Slot?schedule=Schedule/ct-1", Map.of(), null).body());
        assertThat(slots.getEntry()).hasSize(6);
        Bundle booked = Fhir.json().parseResource(
                Bundle.class, demo.fhirRaw("GET", "/Appointment?slot=Slot/ct1-0900&status=booked", Map.of(), null).body());
        assertThat(booked.getEntry()).hasSize(1);
        assertThat(demo.fhirRaw("GET", "/ServiceRequest?category=108252007", Map.of(), null).statusCode()).isEqualTo(200);
    }

    @Test
    void slotHoldFollowsTheIfMatchRule() throws Exception {
        demo.reset();
        HttpResponse<String> first = demo.fhirRaw("PUT", "/Slot/ct1-1000", ifMatch("W/\"1\""), slotJson("busy-tentative", "仮押さえ：医師 X"));
        assertThat(first.statusCode()).isEqualTo(200);
        assertThat(first.headers().firstValue("ETag")).contains("W/\"2\"");
        HttpResponse<String> second = demo.fhirRaw("PUT", "/Slot/ct1-1000", ifMatch("W/\"1\""), slotJson("busy-tentative", "仮押さえ：医師 Y"));
        assertThat(second.statusCode()).isEqualTo(412);
        assertThat(demo.fhirRaw("PUT", "/Slot/ct1-1000", ifMatch(null), slotJson("busy-tentative", "仮押さえ：医師 Y")).statusCode())
                .isEqualTo(400);
    }

    @Test
    void scheduleAndDeviceAreReadOnlyAndResetRestoresSlots() throws Exception {
        demo.reset();
        String schedule = "{\"resourceType\":\"Schedule\",\"id\":\"ct-1\",\"active\":false}";
        assertThat(demo.fhirRaw("PUT", "/Schedule/ct-1", ifMatch("W/\"1\""), schedule).statusCode()).isEqualTo(400);
        assertThat(demo.fhirRaw("PUT", "/Slot/ct1-1000", ifMatch("W/\"1\""), slotJson("busy-tentative", "仮押さえ：医師 X")).statusCode())
                .isEqualTo(200);
        demo.reset();
        HttpResponse<String> slot = demo.fhirRaw("GET", "/Slot/ct1-1000", Map.of(), null);
        assertThat(slot.headers().firstValue("ETag")).contains("W/\"1\"");
        assertThat(slot.body()).contains("\"free\"");
    }

    @Test
    void subscriptionCanUseSlotCriteria() throws Exception {
        demo.reset();
        String sub = "{\"resourceType\":\"Subscription\",\"id\":\"ehr-ct-slots\",\"status\":\"requested\",\"reason\":\"CT 枠\","
                + "\"criteria\":\"Slot?schedule=Schedule/ct-1\",\"channel\":{\"type\":\"websocket\",\"payload\":\"application/fhir+json\"}}";
        HttpResponse<String> res = demo.fhirRaw("PUT", "/Subscription/ehr-ct-slots", JSON_PUT, sub);
        assertThat(res.statusCode()).isEqualTo(201);
        assertThat(res.body()).contains("\"active\"");
    }

    // ---- S4 処方調剤（specs/004 contracts/fhir-api.md） ----

    @Test
    void s4SeedResourcesAreReadable() throws Exception {
        demo.reset();
        for (String path : new String[] {"/Encounter/adm-saburo", "/Location/ward-surgery", "/Organization/pharmacy-dept", "/PractitionerRole/ph-c"}) {
            assertThat(demo.fhirRaw("GET", path, Map.of(), null).statusCode()).as(path).isEqualTo(200);
        }
        HttpResponse<String> enc = demo.fhirRaw("GET", "/Encounter?location=Location/ward-surgery&status=in-progress", Map.of(), null);
        assertThat(Fhir.json().parseResource(Bundle.class, enc.body()).getEntry()).hasSize(1);
        assertThat(demo.fhirRaw("GET", "/Practitioner/dr-y", Map.of(), null).body()).contains("医師 Y");
    }

    @Test
    void medicationRequestAndDispenseAreWritableWithIfMatch() throws Exception {
        demo.reset();
        Map<String, String> headers = Map.of("Content-Type", "application/fhir+json", "X-Demo-Client", "ehr-doctor");
        String mr = "{\"resourceType\":\"MedicationRequest\",\"status\":\"active\",\"intent\":\"order\","
                + "\"subject\":{\"reference\":\"Patient/demo-taro\"},\"medicationCodeableConcept\":{\"text\":\"x\"}}";
        HttpResponse<String> created = demo.fhirRaw("POST", "/MedicationRequest", headers, mr);
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.headers().firstValue("ETag")).contains("W/\"1\"");
        String completed = "{\"resourceType\":\"MedicationRequest\",\"id\":\"1\",\"status\":\"completed\",\"intent\":\"order\","
                + "\"subject\":{\"reference\":\"Patient/demo-taro\"},\"medicationCodeableConcept\":{\"text\":\"x\"}}";
        assertThat(demo.fhirRaw("PUT", "/MedicationRequest/1", ifMatch("W/\"1\""), completed).statusCode()).isEqualTo(200);
        assertThat(demo.fhirRaw("PUT", "/MedicationRequest/1", ifMatch("W/\"1\""), completed).statusCode()).isEqualTo(412);

        String md = "{\"resourceType\":\"MedicationDispense\",\"status\":\"completed\",\"medicationCodeableConcept\":{\"text\":\"x\"},"
                + "\"authorizingPrescription\":[{\"reference\":\"MedicationRequest/1\"}]}";
        assertThat(demo.fhirRaw("POST", "/MedicationDispense", headers, md).statusCode()).isEqualTo(201);
        HttpResponse<String> found = demo.fhirRaw("GET", "/MedicationDispense?prescription=MedicationRequest/1", Map.of(), null);
        assertThat(Fhir.json().parseResource(Bundle.class, found.body()).getEntry()).hasSize(1);

        demo.reset();
        assertThat(Fhir.json().parseResource(Bundle.class, demo.fhirRaw("GET", "/MedicationRequest", Map.of(), null).body()).getEntry()).isEmpty();
        assertThat(Fhir.json().parseResource(Bundle.class, demo.fhirRaw("GET", "/MedicationDispense", Map.of(), null).body()).getEntry()).isEmpty();
    }

    @Test
    void encounterAndLocationAreReadOnly() throws Exception {
        demo.reset();
        String loc = "{\"resourceType\":\"Location\",\"id\":\"ward-surgery\",\"name\":\"x\"}";
        String enc = "{\"resourceType\":\"Encounter\",\"id\":\"adm-saburo\",\"status\":\"finished\",\"class\":{\"code\":\"IMP\"}}";
        assertThat(demo.fhirRaw("PUT", "/Location/ward-surgery", ifMatch("W/\"1\""), loc).statusCode()).isGreaterThanOrEqualTo(400);
        assertThat(demo.fhirRaw("PUT", "/Encounter/adm-saburo", ifMatch("W/\"1\""), enc).statusCode()).isGreaterThanOrEqualTo(400);
    }

    @Test
    void subscriptionCanUseTaskEncounterCriteria() throws Exception {
        demo.reset();
        String sub = "{\"resourceType\":\"Subscription\",\"id\":\"ehr-ward-surgery\",\"status\":\"requested\",\"reason\":\"病棟\","
                + "\"criteria\":\"Task?encounter=Encounter/adm-saburo\",\"channel\":{\"type\":\"websocket\",\"payload\":\"application/fhir+json\"}}";
        HttpResponse<String> res = demo.fhirRaw("PUT", "/Subscription/ehr-ward-surgery", JSON_PUT, sub);
        assertThat(res.statusCode()).isEqualTo(201);
        assertThat(res.body()).contains("\"active\"");
    }
}
