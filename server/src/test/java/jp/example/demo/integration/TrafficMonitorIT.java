package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import jp.example.demo.integration.DemoServerExtension.WsClient;
import jp.example.demo.integration.LabFlow.Ids;
import org.hl7.fhir.r4.model.Subscription;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** US2：通信モニタに届く通信の件数・順序・送信元・結果が、実際の通信と一致する（SC-006、取りこぼし 0 件）。 */
class TrafficMonitorIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    private static List<JsonNode> trafficEvents(List<String> messages) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String m : messages) {
            JsonNode n = DemoServerExtension.JSON.readTree(m);
            if ("traffic".equals(n.get("type").asText())) {
                out.add(n.get("record"));
            }
        }
        return out;
    }

    private static JsonNode logRecords() throws Exception {
        return DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body()).get("records");
    }

    @Test
    void everyRequestResponseAndNotificationIsDeliveredExactlyOnceAndInSeqOrder() throws Exception {
        long baseline = logRecords().get(logRecords().size() - 1).get("seq").asLong(); // 接続前の初期化イベント
        WsClient monitor = demo.connect("/ws/monitor");
        // 通知の登録・bind も通信として記録される
        Subscription s = new Subscription();
        s.setStatus(Subscription.SubscriptionStatus.REQUESTED);
        s.setReason("テスト");
        s.setCriteria("Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b");
        s.getChannel().setType(Subscription.SubscriptionChannelType.WEBSOCKET);
        demo.fhir("lis-tech-a").update().resource(s).withId("lis-lab-dept").execute();
        WsClient lis = demo.connect("/ws/subscription?client=lis-tech-a");
        lis.send("bind lis-lab-dept");
        assertThat(lis.await(m -> m.startsWith("bound"), 3000)).isNotNull();

        LabFlow flow = new LabFlow(demo);
        Ids ids = flow.order("demo-taro", "CBC");
        flow.collect(ids);
        flow.accept(ids, "tech-a");
        flow.start(ids, "tech-a");
        flow.reportAll(ids, "tech-a");
        Thread.sleep(500);

        List<JsonNode> delivered = trafficEvents(monitor.drain(500));
        JsonNode all = logRecords();
        List<JsonNode> loggedList = new ArrayList<>();
        all.forEach(r -> {
            if (r.get("seq").asLong() > baseline) {
                loggedList.add(r);
            }
        });
        JsonNode logged = DemoServerExtension.JSON.valueToTree(loggedList);

        // 件数・内容が一致（取りこぼし 0 件、重複なし）
        assertThat(delivered).hasSameSizeAs(logged);
        Map<Long, JsonNode> bySeq = new TreeMap<>();
        for (JsonNode r : delivered) {
            assertThat(bySeq.put(r.get("seq").asLong(), r)).as("seq %s の重複", r.get("seq")).isNull();
        }
        List<Long> loggedSeqs = new ArrayList<>();
        logged.forEach(r -> loggedSeqs.add(r.get("seq").asLong()));
        assertThat(bySeq.keySet()).containsExactlyElementsOf(loggedSeqs);
        // seq は初期化からの連番で欠番なし
        for (int i = 0; i < loggedSeqs.size(); i++) {
            assertThat(loggedSeqs.get(i)).isEqualTo(baseline + 1 + i);
        }
        for (JsonNode l : logged) {
            assertThat(bySeq.get(l.get("seq").asLong())).isEqualTo(l);
        }

        // 実際に送った書き込み系の要求が、順序・送信元・結果どおりに記録されている
        List<String> writes = new ArrayList<>();
        for (JsonNode r : logged) {
            if ("http".equals(r.get("kind").asText()) && !r.get("request").get("method").asText().equals("GET")) {
                writes.add(r.get("client").asText() + " " + r.get("request").get("method").asText() + " "
                        + r.get("request").get("url").asText() + " -> " + r.get("response").get("status").asInt());
            }
        }
        assertThat(writes).containsExactly(
                "lis-tech-a PUT /fhir/Subscription/lis-lab-dept -> 201",
                "ehr-doctor POST /fhir -> 200",
                "ehr-nurse POST /fhir -> 200",
                "lis-tech-a PATCH /fhir/Task/1 -> 200",
                "lis-tech-a PATCH /fhir/Task/1 -> 200",
                "lis-tech-a POST /fhir -> 200");

        // 通知は、原因になった要求より後の seq で、通知先の画面とともに記録される
        List<JsonNode> notes = new ArrayList<>();
        logged.forEach(r -> {
            if ("notification".equals(r.get("kind").asText())) {
                notes.add(r);
            }
        });
        assertThat(notes).hasSize(5); // 依頼・採血・受付・測定開始・結果報告
        assertThat(notes).allSatisfy(n -> assertThat(n.get("notification").get("targetClient").asText()).isEqualTo("lis-tech-a"));
        // 通知が先に配信されることがあっても、seq で並べれば「原因の要求 → 通知」の順になる
        long firstTransactionSeq = 0;
        for (JsonNode r : logged) {
            if (r.hasNonNull("request") && r.get("request").get("method").asText().equals("POST")
                    && r.get("request").get("url").asText().equals("/fhir")) {
                firstTransactionSeq = r.get("seq").asLong();
                break;
            }
        }
        assertThat(firstTransactionSeq).isGreaterThan(0);
        assertThat(notes.get(0).get("seq").asLong()).isGreaterThan(firstTransactionSeq);
    }

    @Test
    void errorResponsesAreAlsoRecordedWithTheirStatus() throws Exception {
        WsClient monitor = demo.connect("/ws/monitor");
        LabFlow flow = new LabFlow(demo);
        Ids ids = flow.order("demo-taro", "CBC");
        // 古い版での更新 → 412、If-Match 無し → 400、存在しない → 404
        var task = flow.task(ids.task());
        flow.accept(ids, "tech-a");
        demo.fhirRaw("PATCH", "/Task/" + ids.task(), flow.headers("lis-tech-b", LabFlow.etag(task)),
                "[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"accepted\"}]");
        demo.fhirRaw("PATCH", "/Task/" + ids.task(), flow.headers("lis-tech-b", null),
                "[{\"op\":\"replace\",\"path\":\"/status\",\"value\":\"in-progress\"}]");
        demo.fhirRaw("GET", "/Task/999", Map.of("X-Demo-Client", "ehr-doctor"), null);
        Thread.sleep(300);

        List<JsonNode> delivered = trafficEvents(monitor.drain(500));
        List<Integer> statuses = new ArrayList<>();
        for (JsonNode r : delivered) {
            if (!r.hasNonNull("request")) {
                continue;
            }
            String method = r.get("request").get("method").asText();
            if (!method.equals("GET") || r.get("request").get("url").asText().endsWith("/Task/999")) {
                statuses.add(r.get("response").get("status").asInt());
            }
        }
        assertThat(statuses).endsWith(412, 400, 404);
        JsonNode conflict = delivered.stream().filter(r -> r.get("response") != null && r.get("response").get("status").asInt() == 412).findFirst().orElseThrow();
        assertThat(conflict.get("client").asText()).isEqualTo("lis-tech-b");
        assertThat(conflict.get("request").get("headers").get("If-Match").asText()).startsWith("W/");
        assertThat(conflict.get("response").get("body").asText()).contains("他の利用者が先に更新しました");
    }

    @Test
    void resetBroadcastsDemoResetAndClearsTheLog() throws Exception {
        new LabFlow(demo).order("demo-taro", "CBC");
        WsClient monitor = demo.connect("/ws/monitor");
        demo.reset();
        String reset = monitor.await(m -> m.contains("\"demo.reset\""), 3000);
        assertThat(reset).isNotNull();
        JsonNode logged = logRecords();
        assertThat(logged).hasSize(1);
        assertThat(logged.get(0).get("kind").asText()).isEqualTo("demo");
        assertThat(logged.get(0).get("demoEvent").get("event").asText()).isEqualTo("reset");
        assertThat(logged.get(0).get("seq").asLong()).isEqualTo(1);
    }

    @Test
    void policyChangesAreBroadcastAndRecorded() throws Exception {
        WsClient monitor = demo.connect("/ws/monitor");
        demo.raw("PUT", "/demo/policy", Map.of("Content-Type", "application/json"), "{\"ifMatchRequired\":false,\"taskTransitionCheck\":false}");
        String msg = monitor.await(m -> m.contains("\"demo.policy\""), 3000);
        assertThat(msg).isNotNull();
        JsonNode n = DemoServerExtension.JSON.readTree(msg);
        assertThat(n.get("policy").get("ifMatchRequired").asBoolean()).isFalse();
        assertThat(n.get("policy").get("taskTransitionCheck").asBoolean()).isFalse();
        JsonNode last = logRecords().get(logRecords().size() - 1);
        assertThat(last.get("demoEvent").get("event").asText()).isEqualTo("policy");
    }
}
