package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import jp.example.demo.integration.DemoServerExtension.WsClient;
import jp.example.demo.integration.PharmacyFlow.Ids;
import org.hl7.fhir.r4.model.MedicationDispense;
import org.hl7.fhir.r4.model.MedicationRequest;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * S4：処方 → 調剤 → 監査 → お渡し（外来）／払出（入院）（docs/02 S4、specs/004 data-model.md §3.1）。
 * 外来は処方まで completed、入院は処方が active のまま（D-43）。調剤の記録はどちらも 1 件。
 */
class S4ScenarioIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    private static int repeat() {
        return Integer.getInteger("s4.repeat", 20);
    }

    private static String sub(String id, String criteria) {
        return "{\"resourceType\":\"Subscription\",\"id\":\"" + id + "\",\"status\":\"requested\",\"reason\":\"S4\","
                + "\"criteria\":\"" + criteria + "\",\"channel\":{\"type\":\"websocket\",\"payload\":\"application/fhir+json\"}}";
    }

    /** Subscription を登録して bind する（各画面が開いたときと同じ）。 */
    private WsClient bind(String client, String id, String criteria) throws Exception {
        assertThat(demo.fhirRaw("PUT", "/Subscription/" + id, Map.of("X-Demo-Client", client, "Content-Type", "application/fhir+json"), sub(id, criteria))
                .statusCode()).isIn(200, 201);
        WsClient ws = demo.connect("/ws/subscription?client=" + client);
        ws.send("bind " + id);
        assertThat(ws.await(m -> m.startsWith("bound"), 3000)).isEqualTo("bound " + id);
        return ws;
    }

    private static long version(String etag) {
        return Long.parseLong(etag.replaceAll("[^0-9]", ""));
    }

    private static List<JsonNode> traffic() throws Exception {
        JsonNode records = DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body()).get("records");
        List<JsonNode> out = new ArrayList<>();
        records.forEach(out::add);
        return out;
    }

    /** 処方 → 受付（薬剤師 C）→ 監査（薬剤師 E）まで進め、作業の最新の版を返す。 */
    private String toAudit(PharmacyFlow flow, Ids ids) throws Exception {
        HttpResponse<String> task = flow.read("Task", ids.task());
        HttpResponse<String> accepted = flow.accept("pharmacy-ph-c", ids.task(), PharmacyFlow.etag(task), "ph-c");
        assertThat(accepted.statusCode()).isEqualTo(200);
        HttpResponse<String> audited = flow.startAudit("pharmacy-ph-e", ids.task(), PharmacyFlow.etag(accepted), "ph-e");
        assertThat(audited.statusCode()).isEqualTo(200);
        return PharmacyFlow.etag(audited);
    }

    // ---- 外来 ----

    @Test
    void outpatientEndsWithTheTaskAndThePrescriptionCompletedAndOneDispense() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        for (int run = 1; run <= repeat(); run++) {
            demo.reset();
            Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
            MedicationRequest mr0 = flow.parse(MedicationRequest.class, flow.read("MedicationRequest", ids.mr()));
            assertThat(mr0.getStatus()).as("run %d", run).isEqualTo(MedicationRequest.MedicationRequestStatus.ACTIVE);
            assertThat(mr0.getCategory().get(0).getCodingFirstRep().getCode()).isEqualTo("OHP");
            Task t0 = flow.parse(Task.class, flow.read("Task", ids.task()));
            assertThat(t0.getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
            assertThat(t0.getOwner().getReference()).isEqualTo("Organization/pharmacy-dept");

            String taskEtag = toAudit(flow, ids);
            Task audit = flow.parse(Task.class, flow.read("Task", ids.task()));
            assertThat(audit.getStatus()).isEqualTo(Task.TaskStatus.INPROGRESS);
            assertThat(audit.getBusinessStatus().getCodingFirstRep().getCode()).isEqualTo("auditing");
            assertThat(audit.getOwner().getReference()).isEqualTo("PractitionerRole/ph-e");
            assertThat(flow.dispenserFromHistory("pharmacy-ph-e", ids.task())).as("run %d: 調剤した薬剤師", run).isEqualTo("ph-c");
            assertThat(flow.dispenses(ids.mr())).isZero();

            String mrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
            HttpResponse<String> done = flow.handOver("pharmacy-ph-e", ids.mr(), mrEtag, ids.task(), taskEtag, "ph-c", "ph-e");
            assertThat(done.statusCode()).as("run %d: %s", run, done.body()).isEqualTo(200);

            MedicationRequest mr = flow.parse(MedicationRequest.class, flow.read("MedicationRequest", ids.mr()));
            assertThat(mr.getStatus()).isEqualTo(MedicationRequest.MedicationRequestStatus.COMPLETED);
            assertThat(mr.getMeta().getVersionId()).isEqualTo("2");
            Task task = flow.parse(Task.class, flow.read("Task", ids.task()));
            assertThat(task.getStatus()).isEqualTo(Task.TaskStatus.COMPLETED);
            assertThat(task.hasBusinessStatus()).isFalse();
            assertThat(flow.dispenses(ids.mr())).as("run %d: 調剤の記録は 1 件", run).isEqualTo(1);
            MedicationDispense md = flow.dispense(ids.mr());
            assertThat(md.getStatus()).isEqualTo(MedicationDispense.MedicationDispenseStatus.COMPLETED);
            assertThat(md.getPerformer()).hasSize(2);
            assertThat(md.getPerformer().get(0).getFunction().getCodingFirstRep().getCode()).isEqualTo("packager");
            assertThat(md.getPerformer().get(0).getActor().getReference()).isEqualTo("PractitionerRole/ph-c");
            assertThat(md.getPerformer().get(1).getFunction().getCodingFirstRep().getCode()).isEqualTo("checker");
            assertThat(md.getPerformer().get(1).getActor().getReference()).isEqualTo("PractitionerRole/ph-e");
            assertThat(md.getReceiverFirstRep().getReference()).isEqualTo("Patient/demo-taro");
            assertThat(md.hasDestination()).isFalse();
            assertThat(task.getOutputFirstRep().getValue()).isInstanceOf(org.hl7.fhir.r4.model.Reference.class);
            assertThat(((org.hl7.fhir.r4.model.Reference) task.getOutputFirstRep().getValue()).getReference())
                    .isEqualTo("MedicationDispense/" + md.getIdElement().getIdPart());
        }
    }

    @Test
    void aHandOverIsRejectedAsAWholeWhenThePrescriptionWasUpdatedMeanwhile() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        demo.reset();
        Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
        String taskEtag = toAudit(flow, ids);
        String staleMrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));

        // 別の操作が処方を先に更新する
        MedicationRequest mr = flow.parse(MedicationRequest.class, flow.read("MedicationRequest", ids.mr()));
        mr.setStatus(MedicationRequest.MedicationRequestStatus.ONHOLD);
        mr.getMeta().setVersionId(null);
        assertThat(demo.fhirRaw("PUT", "/MedicationRequest/" + ids.mr(),
                Map.of("X-Demo-Client", "ehr-doctor", "Content-Type", "application/fhir+json", "If-Match", staleMrEtag),
                jp.example.demo.Fhir.json().encodeResourceToString(mr)).statusCode()).isEqualTo(200);

        HttpResponse<String> res = flow.handOver("pharmacy-ph-e", ids.mr(), staleMrEtag, ids.task(), taskEtag, "ph-c", "ph-e");
        assertThat(res.statusCode()).isEqualTo(412);
        assertThat(flow.dispenses(ids.mr())).as("調剤の記録は作られない").isZero();
        Task task = flow.parse(Task.class, flow.read("Task", ids.task()));
        assertThat(task.getStatus()).isEqualTo(Task.TaskStatus.INPROGRESS);
        assertThat(task.getBusinessStatus().getCodingFirstRep().getCode()).isEqualTo("auditing");
    }

    @Test
    void aCompletedTaskCannotBeHandedOverAgain() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        demo.reset();
        Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
        String taskEtag = toAudit(flow, ids);
        String mrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
        assertThat(flow.handOver("pharmacy-ph-e", ids.mr(), mrEtag, ids.task(), taskEtag, "ph-c", "ph-e").statusCode()).isEqualTo(200);

        String latestTask = PharmacyFlow.etag(flow.read("Task", ids.task()));
        String latestMr = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
        HttpResponse<String> again = flow.handOver("pharmacy-ph-e", ids.mr(), latestMr, ids.task(), latestTask, "ph-c", "ph-e");
        assertThat(again.statusCode()).isEqualTo(422);
        assertThat(flow.dispenses(ids.mr())).isEqualTo(1);
    }

    @Test
    void theMonitorShowsWhoCompletedThePrescription() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        demo.reset();
        Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
        String taskEtag = toAudit(flow, ids);
        String mrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
        assertThat(version(mrEtag)).isEqualTo(1);
        flow.handOver("pharmacy-ph-e", ids.mr(), mrEtag, ids.task(), taskEtag, "ph-c", "ph-e");

        boolean found = false;
        for (JsonNode r : traffic()) {
            if ("http".equals(r.get("kind").asText()) && "POST".equals(r.get("request").get("method").asText())
                    && r.get("request").get("url").asText().equals("/fhir") && r.get("request").get("body").asText().contains("\"MedicationRequest/" + ids.mr() + "\"")) {
                assertThat(r.get("client").asText()).isEqualTo("pharmacy-ph-e");
                found = true;
            }
        }
        assertThat(found).as("お渡しの Transaction が薬剤部門システム（薬剤師 E）の送信元で記録される").isTrue();
    }

    @Test
    void theLabScreensDoNotSeeThePrescriptionTask() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        demo.reset();
        WsClient lab = bind("lis-tech-a", "lis-lab-dept", "Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b");
        WsClient pharmacy = bind("pharmacy", "pharmacy-dept", "Task?owner=Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e");
        WsClient doctor = bind("ehr-doctor", "ehr-rx-dr-x", "Task?requester=Practitioner/dr-x");
        WsClient ward = bind("ehr-nurse-f", "ehr-ward-surgery", "Task?encounter=Encounter/adm-saburo");

        Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
        assertThat(pharmacy.await(m -> m.equals("ping pharmacy-dept"), 3000)).as("処方で薬剤部に ping").isNotNull();
        assertThat(doctor.await(m -> m.equals("ping ehr-rx-dr-x"), 3000)).as("処方で医師 X に ping").isNotNull();
        String taskEtag = toAudit(flow, ids);
        // 受付・監査の通知（薬剤部・医師 X に届く）
        assertThat(pharmacy.drain(300).stream().filter(m -> m.equals("ping pharmacy-dept")).count()).isGreaterThanOrEqualTo(2);
        String mrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
        flow.handOver("pharmacy-ph-e", ids.mr(), mrEtag, ids.task(), taskEtag, "ph-c", "ph-e");
        assertThat(pharmacy.await(m -> m.equals("ping pharmacy-dept"), 3000)).as("お渡しで薬剤部に ping").isNotNull();
        assertThat(doctor.await(m -> m.equals("ping ehr-rx-dr-x"), 3000)).as("お渡しで医師 X に ping").isNotNull();

        assertThat(lab.drain(300)).as("検体検査システムには何も届かない").noneMatch(m -> m.startsWith("ping"));
        assertThat(ward.drain(300)).as("外来の処方は病棟に届かない").noneMatch(m -> m.startsWith("ping"));
    }

    @Test
    void noTrafficIsLostAndEveryRequestIsAttributedToItsScreen() throws Exception {
        PharmacyFlow flow = new PharmacyFlow(demo);
        for (int run = 1; run <= repeat(); run++) {
            demo.reset();
            Ids ids = flow.prescribeOk("ehr-doctor", "dr-x", "demo-taro", null, "amlodipine");
            String taskEtag = toAudit(flow, ids);
            flow.dispenserFromHistory("pharmacy-ph-e", ids.task());
            String mrEtag = PharmacyFlow.etag(flow.read("MedicationRequest", ids.mr()));
            flow.handOver("pharmacy-ph-e", ids.mr(), mrEtag, ids.task(), taskEtag, "ph-c", "ph-e");

            List<JsonNode> records = traffic();
            TreeSet<Long> seqs = new TreeSet<>();
            for (JsonNode r : records) {
                assertThat(seqs.add(r.get("seq").asLong())).as("run %d: seq の重複", run).isTrue();
            }
            assertThat(seqs.last() - seqs.first() + 1).as("run %d: seq に欠番がない", run).isEqualTo(seqs.size());
            Map<String, Long> http = new java.util.TreeMap<>();
            for (JsonNode r : records) {
                if ("http".equals(r.get("kind").asText())) {
                    http.merge(r.get("client").asText(), 1L, Long::sum);
                }
            }
            assertThat(http.get("ehr-doctor")).as("run %d: 処方 1 回", run).isEqualTo(1);
            assertThat(http.get("pharmacy-ph-c")).as("受付 1 回").isEqualTo(1);
            // 監査 1 回 + 版の履歴 1 回 + お渡し 1 回
            assertThat(http.get("pharmacy-ph-e")).as("監査・履歴・お渡し").isEqualTo(3);
        }
    }
}
