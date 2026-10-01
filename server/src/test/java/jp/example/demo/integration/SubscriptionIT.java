package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import jp.example.demo.integration.DemoServerExtension.WsClient;
import jp.example.demo.integration.LabFlow.Ids;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Subscription;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** R-10：Subscription の登録・bind・ping（contracts/websocket.md）。 */
class SubscriptionIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    static final String LIS_CRITERIA =
            "Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b";
    static final String EHR_CRITERIA = "Task?requester=Practitioner/dr-x";

    private void register(String client, String id, String criteria) {
        Subscription s = new Subscription();
        s.setStatus(Subscription.SubscriptionStatus.REQUESTED);
        s.setReason("テスト");
        s.setCriteria(criteria);
        s.getChannel().setType(Subscription.SubscriptionChannelType.WEBSOCKET).setPayload("application/fhir+json");
        demo.fhir(client).update().resource(s).withId(id).execute();
    }

    private WsClient bind(String path, String id) throws Exception {
        WsClient ws = demo.connect(path);
        ws.send("bind " + id);
        assertThat(ws.await(m -> m.startsWith("bound"), 3000)).isEqualTo("bound " + id);
        return ws;
    }

    private static long pings(WsClient ws, String id) {
        return ws.received().stream().filter(m -> m.equals("ping " + id)).count();
    }

    @Test
    void subscriptionIsActivatedOnSaveAndInvalidOnesAreRejected() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        Subscription saved = demo.fhir("lis-tech-a").read().resource(Subscription.class).withId("lis-lab-dept").execute();
        assertThat(saved.getStatus()).isEqualTo(Subscription.SubscriptionStatus.ACTIVE);

        Subscription rest = new Subscription();
        rest.setId("bad");
        rest.setStatus(Subscription.SubscriptionStatus.REQUESTED);
        rest.setReason("x");
        rest.setCriteria(LIS_CRITERIA);
        rest.getChannel().setType(Subscription.SubscriptionChannelType.RESTHOOK).setEndpoint("http://x");
        assertThat(demo.fhirRaw("PUT", "/Subscription/bad", Map.of(), jp.example.demo.Fhir.json().encodeResourceToString(rest)).statusCode())
                .isEqualTo(422);
        Subscription bad = new Subscription();
        bad.setId("bad2");
        bad.setStatus(Subscription.SubscriptionStatus.REQUESTED);
        bad.setReason("x");
        bad.setCriteria("Task?unknown=1");
        bad.getChannel().setType(Subscription.SubscriptionChannelType.WEBSOCKET);
        assertThat(demo.fhirRaw("PUT", "/Subscription/bad2", Map.of(), jp.example.demo.Fhir.json().encodeResourceToString(bad)).statusCode())
                .isEqualTo(422);
    }

    @Test
    void bindingToAnUnknownSubscriptionIsAnError() throws Exception {
        WsClient ws = demo.connect("/ws/subscription?client=lis-tech-a");
        ws.send("bind nothing");
        assertThat(ws.await(m -> m.startsWith("error"), 3000)).startsWith("error nothing");
    }

    @Test
    void pingsAreSentToTheMatchingSubscriptionsOnly() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        register("ehr-doctor", "ehr-dr-x", EHR_CRITERIA);
        WsClient lis = bind("/ws/subscription?client=lis-tech-a", "lis-lab-dept");
        WsClient ehr = bind("/ws/subscription?client=ehr-doctor", "ehr-dr-x");
        LabFlow flow = new LabFlow(demo);

        // 依頼：検査部宛て & 医師 X が依頼者 → 両方に 1 回ずつ
        Ids ids = flow.order("demo-taro", "CBC");
        assertThat(lis.await(m -> m.equals("ping lis-lab-dept"), 3000)).isNotNull();
        assertThat(ehr.await(m -> m.equals("ping ehr-dr-x"), 3000)).isNotNull();

        // 採血（Specimen と Task の更新）：ping は Subscription ごとに 1 回
        lis.drain(300);
        ehr.drain(300);
        flow.collect(ids);
        assertThat(lis.drain(500)).containsExactly("ping lis-lab-dept");
        assertThat(ehr.drain(500)).containsExactly("ping ehr-dr-x");

        // 受付：owner が技師に変わっても検査部の Subscription には届く（criteria は更新後の値で評価）
        flow.accept(ids, "tech-a");
        assertThat(lis.drain(500)).containsExactly("ping lis-lab-dept");
        assertThat(ehr.drain(500)).containsExactly("ping ehr-dr-x");

        // 別の部門宛ての作業：どちらにも届かない
        Task other = new Task();
        other.setStatus(Task.TaskStatus.REQUESTED);
        other.setIntent(Task.TaskIntent.ORDER);
        other.setOwner(new Reference("Organization/other"));
        other.setRequester(new Reference("Practitioner/dr-y"));
        demo.fhir("x").create().resource(other).execute();
        assertThat(lis.drain(500)).isEmpty();
        assertThat(ehr.drain(500)).isEmpty();
    }

    @Test
    void oneTransactionTouchingSeveralMatchingResourcesPingsOnce() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        WsClient lis = bind("/ws/subscription?client=lis-tech-a", "lis-lab-dept");
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        for (int i = 0; i < 3; i++) {
            Task t = new Task();
            t.setStatus(Task.TaskStatus.REQUESTED);
            t.setIntent(Task.TaskIntent.ORDER);
            t.setOwner(new Reference("Organization/lab-dept"));
            b.addEntry().setFullUrl("urn:uuid:t" + i).setResource(t).getRequest().setMethod(HTTPVerb.POST).setUrl("Task");
        }
        demo.fhir("ehr-doctor").transaction().withBundle(b).execute();
        assertThat(lis.drain(700)).containsExactly("ping lis-lab-dept");
    }

    @Test
    void failedTransactionsSendNoPing() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        WsClient lis = bind("/ws/subscription?client=lis-tech-a", "lis-lab-dept");
        LabFlow flow = new LabFlow(demo);
        Ids ids = flow.order("demo-taro", "CBC");
        lis.drain(500);
        flow.cancel(ids);
        lis.drain(500);
        // 取消済みの依頼への採血は 422 で拒否され、何も変わらず、通知も出ない
        Task t = flow.task(ids.task());
        org.hl7.fhir.r4.model.Specimen sp = flow.specimen(ids.specimen());
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        sp.setStatus(org.hl7.fhir.r4.model.Specimen.SpecimenStatus.AVAILABLE);
        b.addEntry().setResource(sp).getRequest().setMethod(HTTPVerb.PUT).setUrl("Specimen/" + ids.specimen()).setIfMatch(LabFlow.etag(sp));
        b.addEntry().setResource(t).getRequest().setMethod(HTTPVerb.PUT).setUrl("Task/" + ids.task()).setIfMatch(LabFlow.etag(t));
        assertThat(demo.fhirRaw("POST", "", Map.of(), jp.example.demo.Fhir.json().encodeResourceToString(b)).statusCode()).isEqualTo(422);
        assertThat(lis.drain(500)).isEmpty();
        assertThat(flow.specimen(ids.specimen()).hasStatus()).isFalse();
    }

    @Test
    void resetDropsAllBindings() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        WsClient lis = bind("/ws/subscription?client=lis-tech-a", "lis-lab-dept");
        demo.reset();
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA); // 登録し直しても、bind し直すまでは届かない
        new LabFlow(demo).order("demo-taro", "CBC");
        assertThat(lis.drain(700)).isEmpty();
        // bind し直せば届く
        lis.send("bind lis-lab-dept");
        assertThat(lis.await(m -> m.startsWith("bound"), 3000)).isNotNull();
        new LabFlow(demo).order("demo-hanako", "BIO");
        assertThat(lis.await(m -> m.equals("ping lis-lab-dept"), 3000)).isNotNull();
    }

    @Test
    void notificationsAreRecordedInTheTrafficLogWithTheTargetClient() throws Exception {
        register("lis-tech-a", "lis-lab-dept", LIS_CRITERIA);
        bind("/ws/subscription?client=lis-tech-b", "lis-lab-dept");
        new LabFlow(demo).order("demo-taro", "CBC");
        Thread.sleep(300);
        JsonNode records = DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body()).get("records");
        List<JsonNode> notes = new java.util.ArrayList<>();
        records.forEach(r -> {
            if ("notification".equals(r.get("kind").asText())) {
                notes.add(r);
            }
        });
        assertThat(notes).hasSize(1);
        assertThat(notes.get(0).get("notification").get("subscriptionId").asText()).isEqualTo("lis-lab-dept");
        assertThat(notes.get(0).get("notification").get("targetClient").asText()).isEqualTo("lis-tech-b");
        assertThat(notes.get(0).get("notification").get("resource").asText()).startsWith("Task/1/_history/");
        // 通知は、その原因になった Transaction の要求より大きい seq を持つ
        long txSeq = 0;
        for (JsonNode r : records) {
            if ("http".equals(r.get("kind").asText()) && "POST".equals(r.get("request").get("method").asText())
                    && r.get("request").get("url").asText().equals("/fhir")) {
                txSeq = r.get("seq").asLong();
            }
        }
        assertThat(notes.get(0).get("seq").asLong()).isGreaterThan(txSeq);
    }
}
