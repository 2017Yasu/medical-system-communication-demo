package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import jp.example.demo.integration.LabFlow.Ids;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * S2：2 人の技師が同じ作業を同時に受付する（docs/02 S2、data-model.md §2・§3）。
 * S2-1（版の確認が無い → 後勝ち）、S2-2（版の確認あり → 後発は 412、同時でも必ず片方だけ成功）、S2-3（必須 → 確認の無い更新は 400）。
 */
class S2ScenarioIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    private static int repeat(int defaultValue) {
        return Integer.getInteger("s2.repeat", defaultValue);
    }

    /** 準備ボタンと同じ手順：初期化 → ポリシー → 依頼 → 採血。 */
    private Ids prepare(LabFlow flow, boolean ifMatchRequired, boolean labSendsIfMatch) throws Exception {
        demo.reset();
        JsonNode policy = demo.setPolicy(ifMatchRequired, labSendsIfMatch);
        assertThat(policy.get("ifMatchRequired").asBoolean()).isEqualTo(ifMatchRequired);
        assertThat(policy.get("labSendsIfMatch").asBoolean()).isEqualTo(labSendsIfMatch);
        assertThat(policy.get("taskTransitionCheck").asBoolean()).as("遷移チェックは S2 でも有効のまま").isTrue();
        Ids ids = flow.order("demo-taro", "CBC");
        flow.collect(ids);
        return ids;
    }

    private static long versionOf(Task t) {
        return Long.parseLong(t.getMeta().getVersionId());
    }

    private List<JsonNode> history(Ids ids) throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", "/Task/" + ids.task() + "/_history", Map.of(), null);
        assertThat(res.statusCode()).isEqualTo(200);
        List<JsonNode> out = new ArrayList<>();
        DemoServerExtension.JSON.readTree(res.body()).get("entry").forEach(e -> out.add(e.get("resource")));
        return out; // 新しい版が先頭
    }

    // ---- S2-1 ----

    @Test
    void s21WithoutVersionCheckTheLaterWriterOverwritesTheEarlierOne() throws Exception {
        LabFlow flow = new LabFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            Ids ids = prepare(flow, false, false);
            String loaded = flow.etagNow(ids); // 技師 A・技師 B が受付を始めた時点で読み込んだ版（両者とも同じ）
            long base = versionOf(flow.task(ids.task()));

            assertThat(flow.acceptWith(ids, "tech-a", null).statusCode()).as("run %d: A", run).isEqualTo(200);
            assertThat(flow.acceptWith(ids, "tech-b", null).statusCode()).as("run %d: B", run).isEqualTo(200);

            Task t = flow.task(ids.task());
            assertThat(versionOf(t)).isEqualTo(base + 2);
            assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.ACCEPTED);
            assertThat(LabFlow.businessStatusCode(t)).isEqualTo("received");
            assertThat(t.getOwner().getReference()).as("後から確定した技師 B の内容で上書きされる").isEqualTo("PractitionerRole/tech-b");
            assertThat(loaded).isEqualTo("W/\"" + base + "\"");

            List<JsonNode> versions = history(ids);
            assertThat(versions.get(1).at("/owner/reference").asText()).isEqualTo("PractitionerRole/tech-a");
            assertThat(versions.get(0).at("/owner/reference").asText()).isEqualTo("PractitionerRole/tech-b");
        }
    }

    // ---- S2-2 ----

    @Test
    void s22WithVersionCheckTheSecondWriterGets412() throws Exception {
        LabFlow flow = new LabFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            Ids ids = prepare(flow, true, true);
            String loaded = flow.etagNow(ids);
            long base = versionOf(flow.task(ids.task()));

            assertThat(flow.acceptWith(ids, "tech-a", loaded).statusCode()).as("run %d: A", run).isEqualTo(200);
            HttpResponse<String> b = flow.acceptWith(ids, "tech-b", loaded);
            assertThat(b.statusCode()).as("run %d: B", run).isEqualTo(412);
            assertThat(b.body()).contains("OperationOutcome");

            Task t = flow.task(ids.task());
            assertThat(versionOf(t)).as("後発の更新は反映されない").isEqualTo(base + 1);
            assertThat(t.getOwner().getReference()).isEqualTo("PractitionerRole/tech-a");
        }
    }

    @Test
    void s22SimultaneousConfirmationsLetExactlyOneSucceed() throws Exception {
        LabFlow flow = new LabFlow(demo);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int run = 1; run <= repeat(100); run++) {
                Ids ids = prepare(flow, true, true);
                String loaded = flow.etagNow(ids);
                long base = versionOf(flow.task(ids.task()));

                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch go = new CountDownLatch(1);
                List<Future<Integer>> results = new ArrayList<>();
                for (String tech : List.of("tech-a", "tech-b")) {
                    results.add(pool.submit(() -> {
                        ready.countDown();
                        go.await();
                        return flow.acceptWith(ids, tech, loaded).statusCode();
                    }));
                }
                assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
                go.countDown();
                int a = results.get(0).get(20, TimeUnit.SECONDS);
                int b = results.get(1).get(20, TimeUnit.SECONDS);

                assertThat(List.of(a, b)).as("run %d: ちょうど 1 つが 200、1 つが 412", run).containsExactlyInAnyOrder(200, 412);
                Task t = flow.task(ids.task());
                assertThat(versionOf(t)).isEqualTo(base + 1);
                String winner = a == 200 ? "tech-a" : "tech-b";
                assertThat(t.getOwner().getReference()).as("run %d: 担当は成功した側", run).isEqualTo("PractitionerRole/" + winner);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- S2-3 ----

    @Test
    void s23RequiredPolicyRejectsUpdatesWithoutVersionCheckWith400() throws Exception {
        LabFlow flow = new LabFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            Ids ids = prepare(flow, true, false);
            Task before = flow.task(ids.task());

            HttpResponse<String> rejected = flow.acceptWith(ids, "tech-a", null);
            assertThat(rejected.statusCode()).as("run %d", run).isEqualTo(400);
            assertThat(rejected.body()).contains("If-Match");
            Task after = flow.task(ids.task());
            assertThat(versionOf(after)).isEqualTo(versionOf(before));
            assertThat(after.getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
            assertThat(after.getOwner().getReference()).isEqualTo("Organization/lab-dept");

            // サーバーを「任意」に変えると、同じ要求が受け付けられる
            demo.setPolicy(false, null);
            assertThat(flow.acceptWith(ids, "tech-a", null).statusCode()).isEqualTo(200);
        }
    }

    @Test
    void s23RequiredPolicyDoesNotGetInTheWayOfAVersionedUpdate() throws Exception {
        LabFlow flow = new LabFlow(demo);
        Ids ids = prepare(flow, true, false);
        assertThat(flow.acceptWith(ids, "tech-a", flow.etagNow(ids)).statusCode()).isEqualTo(200);
        assertThat(flow.task(ids.task()).getOwner().getReference()).isEqualTo("PractitionerRole/tech-a");
    }
}
