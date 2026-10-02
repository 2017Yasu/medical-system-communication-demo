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
import jp.example.demo.integration.DemoServerExtension.WsClient;
import org.hl7.fhir.r4.model.Slot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * S3：2 人の医師が同じ CT の枠を取り合う（docs/02 S3、specs/003 data-model.md §3.2）。
 * S3-1（枠を確認せずに予約 → 二重予約）、S3-2（仮押さえ → 確定、後発は 412、同時でも必ず片方だけ成功）、S3-3（期限切れ）。
 */
class S3ScenarioIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    private static final String SLOT = "ct1-1000";

    private static int repeat(int defaultValue) {
        return Integer.getInteger("s3.repeat", defaultValue);
    }

    /** 準備ボタンと同じ手順：初期化 → 予約方式の切り替え。 */
    private void prepare(boolean ehrUsesSlotHold) throws Exception {
        demo.reset();
        HttpResponse<String> res = demo.putPolicy(Map.of("ehrUsesSlotHold", ehrUsesSlotHold));
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(DemoServerExtension.JSON.readTree(res.body()).get("ehrUsesSlotHold").asBoolean()).isEqualTo(ehrUsesSlotHold);
    }

    private static long versionOf(Slot s) {
        return Long.parseLong(s.getMeta().getVersionId());
    }

    // ---- S3-1 ----

    @Test
    void s31BookingWithoutCheckingTheSlotCreatesADoubleBooking() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            prepare(false);
            Slot slot = flow.slot(SLOT);
            assertThat(slot.getStatus()).isEqualTo(Slot.SlotStatus.FREE);
            assertThat(versionOf(slot)).isEqualTo(1);

            assertThat(flow.bookDirect("ehr-doctor", "dr-x", "demo-taro", slot).statusCode()).as("run %d: 医師 X", run).isEqualTo(200);
            assertThat(flow.bookDirect("ehr-doctor-y", "dr-y", "demo-hanako", slot).statusCode()).as("run %d: 医師 Y", run).isEqualTo(200);

            assertThat(flow.bookedAppointments(SLOT)).as("run %d: 二重予約が成立する", run).isEqualTo(2);
            Slot after = flow.slot(SLOT);
            assertThat(after.getStatus()).as("枠は空きのまま").isEqualTo(Slot.SlotStatus.FREE);
            assertThat(versionOf(after)).as("枠の版は変わらない").isEqualTo(1);
            assertThat(flow.count("/Task?owner=Organization/rad-dept")).isEqualTo(2);
            // FR-025：医師 X の検体検査の依頼の一覧（category で絞る）に CT の依頼は出ない
            assertThat(flow.count("/ServiceRequest?requester=Practitioner/dr-x&category=108252007")).isZero();
            assertThat(flow.count("/ServiceRequest?category=363679005")).isEqualTo(2);
        }
    }

    // ---- S3-2 ----

    @Test
    void s32TheSecondHoldGets412AndTheFirstDoctorCanConfirm() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            prepare(true);
            HttpResponse<String> selectedByX = flow.select(SLOT);
            HttpResponse<String> selectedByY = flow.select(SLOT);
            assertThat(SlotFlow.etag(selectedByX)).isEqualTo("W/\"1\"");
            assertThat(SlotFlow.etag(selectedByY)).isEqualTo("W/\"1\"");
            Slot slotX = flow.slot(SLOT);
            Slot slotY = flow.slot(SLOT);

            HttpResponse<String> heldX = flow.hold("ehr-doctor", slotX, "医師 X", "W/\"1\"");
            assertThat(heldX.statusCode()).as("run %d", run).isEqualTo(200);
            assertThat(SlotFlow.etag(heldX)).isEqualTo("W/\"2\"");
            assertThat(flow.slot(SLOT).getComment()).isEqualTo("仮押さえ：医師 X");

            HttpResponse<String> heldY = flow.hold("ehr-doctor-y", slotY, "医師 Y", "W/\"1\"");
            assertThat(heldY.statusCode()).as("run %d: 後発は 412", run).isEqualTo(412);
            assertThat(versionOf(flow.slot(SLOT))).as("枠は医師 X の仮押さえのまま").isEqualTo(2);

            Slot held = flow.slot(SLOT);
            HttpResponse<String> confirmed = flow.confirm("ehr-doctor", "dr-x", "demo-taro", held, SlotFlow.etag(heldX));
            assertThat(confirmed.statusCode()).as("run %d", run).isEqualTo(200);

            Slot after = flow.slot(SLOT);
            assertThat(after.getStatus()).isEqualTo(Slot.SlotStatus.BUSY);
            assertThat(after.hasComment()).isFalse();
            assertThat(versionOf(after)).isEqualTo(3);
            assertThat(flow.bookedAppointments(SLOT)).isEqualTo(1);
            JsonNode appointment = DemoServerExtension.JSON.readTree(
                    demo.fhirRaw("GET", "/Appointment?slot=Slot/" + SLOT + "&status=booked", Map.of(), null).body());
            assertThat(appointment.get("entry").get(0).get("resource").toString()).contains("Patient/demo-taro");
        }
    }

    @Test
    void s32SimultaneousHoldsLetExactlyOneSucceed() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int run = 1; run <= repeat(100); run++) {
                prepare(true);
                Slot slotX = flow.slot(SLOT);
                Slot slotY = flow.slot(SLOT);

                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch go = new CountDownLatch(1);
                List<Future<Integer>> results = new ArrayList<>();
                results.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return flow.hold("ehr-doctor", slotX, "医師 X", "W/\"1\"").statusCode();
                }));
                results.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return flow.hold("ehr-doctor-y", slotY, "医師 Y", "W/\"1\"").statusCode();
                }));
                assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
                go.countDown();
                int x = results.get(0).get(20, TimeUnit.SECONDS);
                int y = results.get(1).get(20, TimeUnit.SECONDS);

                assertThat(List.of(x, y)).as("run %d: ちょうど 1 つが 200、1 つが 412", run).containsExactlyInAnyOrder(200, 412);
                Slot after = flow.slot(SLOT);
                assertThat(versionOf(after)).isEqualTo(2);
                assertThat(after.getComment()).as("run %d: 押さえた人は成功した側", run).isEqualTo(x == 200 ? "仮押さえ：医師 X" : "仮押さえ：医師 Y");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void s32ReleasingAHeldSlotPutsItBackToFree() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        prepare(true);
        Slot selected = flow.slot(SLOT);
        HttpResponse<String> held = flow.hold("ehr-doctor", selected, "医師 X", "W/\"1\"");
        assertThat(held.statusCode()).isEqualTo(200);

        Slot current = flow.slot(SLOT);
        assertThat(flow.release("ehr-doctor", current, SlotFlow.etag(held)).statusCode()).isEqualTo(200);
        Slot after = flow.slot(SLOT);
        assertThat(after.getStatus()).isEqualTo(Slot.SlotStatus.FREE);
        assertThat(after.hasComment()).isFalse();
        assertThat(versionOf(after)).isEqualTo(3);
        // 戻した直後は、ほかの医師が（戻した後の版で）仮押さえできる
        assertThat(flow.hold("ehr-doctor-y", after, "医師 Y", "W/\"3\"").statusCode()).isEqualTo(200);
    }

    // ---- S3-3 ----

    private void shortHold(int seconds) throws Exception {
        assertThat(demo.putPolicy(Map.of("slotHoldSeconds", seconds)).statusCode()).isEqualTo(200);
    }

    /** `ehr-ct-slots` を登録して bind する（期限切れで ping が届くことの確認用）。 */
    private WsClient bindSlotSubscription() throws Exception {
        String sub = "{\"resourceType\":\"Subscription\",\"id\":\"ehr-ct-slots\",\"status\":\"requested\",\"reason\":\"CT 枠\","
                + "\"criteria\":\"Slot?schedule=Schedule/ct-1\",\"channel\":{\"type\":\"websocket\",\"payload\":\"application/fhir+json\"}}";
        assertThat(demo.fhirRaw("PUT", "/Subscription/ehr-ct-slots", Map.of("X-Demo-Client", "ehr-doctor"), sub).statusCode()).isIn(200, 201);
        WsClient ws = demo.connect("/ws/subscription?client=ehr-doctor");
        ws.send("bind ehr-ct-slots");
        assertThat(ws.await(m -> m.startsWith("bound"), 3000)).isEqualTo("bound ehr-ct-slots");
        return ws;
    }

    private static List<JsonNode> serverRecords() throws Exception {
        JsonNode records = DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body()).get("records");
        List<JsonNode> out = new ArrayList<>();
        records.forEach(r -> {
            if ("server".equals(r.get("kind").asText())) {
                out.add(r);
            }
        });
        return out;
    }

    @Test
    void s33AnExpiredHoldGoesBackToFreeAndALateConfirmationIsRejectedAsAWhole() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            prepare(true);
            shortHold(1);
            WsClient ws = bindSlotSubscription();

            Slot selected = flow.slot(SLOT);
            HttpResponse<String> held = flow.hold("ehr-doctor", selected, "医師 X", "W/\"1\"");
            assertThat(held.statusCode()).isEqualTo(200);
            long heldAt = System.nanoTime();

            // 期限（1 秒）の後 2 秒以内に空きに戻る（SC-005）
            Slot back = flow.slot(SLOT);
            while (back.getStatus() != Slot.SlotStatus.FREE && (System.nanoTime() - heldAt) < TimeUnit.SECONDS.toNanos(3)) {
                Thread.sleep(100);
                back = flow.slot(SLOT);
            }
            assertThat(back.getStatus()).as("run %d: 3 秒以内に空きに戻る", run).isEqualTo(Slot.SlotStatus.FREE);
            assertThat(back.hasComment()).isFalse();
            assertThat(versionOf(back)).isEqualTo(3);

            // 通信記録（kind = server）と、その後の通知（ping）
            List<JsonNode> records = serverRecords();
            assertThat(records).as("run %d", run).hasSize(1);
            JsonNode action = records.get(0).get("serverAction");
            assertThat(records.get(0).get("client").asText()).isEqualTo("server-slot-expiry");
            assertThat(action.get("resource").asText()).isEqualTo("Slot/ct1-1000/_history/3");
            assertThat(action.get("before").get("comment").asText()).isEqualTo("仮押さえ：医師 X");
            assertThat(action.get("holdSeconds").asInt()).isEqualTo(1);
            JsonNode notification = null;
            for (JsonNode r : DemoServerExtension.JSON.readTree(demo.raw("GET", "/demo/traffic", Map.of(), null).body()).get("records")) {
                if ("notification".equals(r.get("kind").asText())
                        && r.get("notification").get("resource").asText().equals("Slot/ct1-1000/_history/3")) {
                    notification = r;
                }
            }
            assertThat(notification).as("期限切れの版の通知（ping）の記録").isNotNull();
            assertThat(notification.get("seq").asLong()).as("ping の記録は期限切れの記録より後の seq").isGreaterThan(records.get(0).get("seq").asLong());
            // 仮押さえの ping（1 回目）に続いて、期限切れの更新でも ping が届く（2 回目）
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            while (ws.received().stream().filter(m -> m.equals("ping ehr-ct-slots")).count() < 2 && System.nanoTime() < deadline) {
                ws.drain(50); // 届いたメッセージを取り込む（received() は取り込み済みの分だけ）
            }
            assertThat(ws.received().stream().filter(m -> m.equals("ping ehr-ct-slots")).count()).as("run %d: 期限切れでも ping が届く", run).isGreaterThanOrEqualTo(2);

            // 遅れた確定は Transaction 全体が 412。何も登録されない
            HttpResponse<String> late = flow.confirm("ehr-doctor", "dr-x", "demo-taro", back, SlotFlow.etag(held));
            assertThat(late.statusCode()).as("run %d", run).isEqualTo(412);
            assertThat(late.body()).contains("Bundle.entry[0]");
            assertThat(flow.bookedAppointments(SLOT)).isZero();
            assertThat(flow.count("/Task?owner=Organization/rad-dept")).isZero();
            assertThat(flow.count("/ServiceRequest?category=363679005")).isZero();
            assertThat(flow.slot(SLOT).getStatus()).isEqualTo(Slot.SlotStatus.FREE);
        }
    }

    @Test
    void s33ConfirmationRacingTheDeadlineLeavesNoInconsistency() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        int[] confirmed = {0};
        int[] rejected = {0};
        for (int run = 1; run <= repeat(20); run++) {
            prepare(true);
            shortHold(1);
            Slot selected = flow.slot(SLOT);
            HttpResponse<String> held = flow.hold("ehr-doctor", selected, "医師 X", "W/\"1\"");
            assertThat(held.statusCode()).isEqualTo(200);
            Slot heldSlot = flow.slot(SLOT);
            Thread.sleep(800 + (run % 5) * 100); // 期限の直前〜直後（800〜1200 ms）にずらす
            HttpResponse<String> res = flow.confirm("ehr-doctor", "dr-x", "demo-taro", heldSlot, SlotFlow.etag(held));
            Thread.sleep(400); // 期限切れの処理が走り終わるのを待つ（確定済みなら何も起きない）
            Slot after = flow.slot(SLOT);
            if (res.statusCode() == 200) {
                confirmed[0]++;
                assertThat(after.getStatus()).as("run %d", run).isEqualTo(Slot.SlotStatus.BUSY);
                assertThat(flow.bookedAppointments(SLOT)).isEqualTo(1);
                assertThat(serverRecords()).as("確定が先なら期限切れは何もしない").isEmpty();
            } else {
                rejected[0]++;
                assertThat(res.statusCode()).as("run %d", run).isEqualTo(412);
                assertThat(after.getStatus()).isEqualTo(Slot.SlotStatus.FREE);
                assertThat(flow.bookedAppointments(SLOT)).isZero();
                assertThat(flow.count("/Task?owner=Organization/rad-dept")).isZero();
            }
        }
        assertThat(confirmed[0] + rejected[0]).isEqualTo(repeat(20));
    }

    @Test
    void s33AResetDropsThePendingHoldSoNothingIsWrittenAfterwards() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        prepare(true);
        shortHold(1);
        assertThat(flow.hold("ehr-doctor", flow.slot(SLOT), "医師 X", "W/\"1\"").statusCode()).isEqualTo(200);
        demo.reset();
        Thread.sleep(1700);
        assertThat(serverRecords()).isEmpty();
        Slot slot = flow.slot(SLOT);
        assertThat(slot.getStatus()).isEqualTo(Slot.SlotStatus.FREE);
        assertThat(versionOf(slot)).isEqualTo(1);
    }

    @Test
    void s33AnotherDoctorHoldingJustAfterTheExpiryMakesTheFirstDoctorsConfirmationFail() throws Exception {
        SlotFlow flow = new SlotFlow(demo);
        for (int run = 1; run <= repeat(20); run++) {
            prepare(true);
            shortHold(1);
            HttpResponse<String> heldX = flow.hold("ehr-doctor", flow.slot(SLOT), "医師 X", "W/\"1\"");
            assertThat(heldX.statusCode()).isEqualTo(200);
            Slot x = flow.slot(SLOT);
            Slot back = flow.slot(SLOT);
            long start = System.nanoTime();
            while (back.getStatus() != Slot.SlotStatus.FREE && (System.nanoTime() - start) < TimeUnit.SECONDS.toNanos(3)) {
                Thread.sleep(50);
                back = flow.slot(SLOT);
            }
            assertThat(versionOf(back)).isEqualTo(3);

            // 医師 Y が戻った後の版で仮押さえする
            assertThat(flow.hold("ehr-doctor-y", back, "医師 Y", SlotFlow.etag(select(flow))).statusCode()).isEqualTo(200);
            HttpResponse<String> confirm = flow.confirm("ehr-doctor", "dr-x", "demo-taro", x, SlotFlow.etag(heldX));
            assertThat(confirm.statusCode()).as("run %d", run).isEqualTo(412);
            assertThat(flow.bookedAppointments(SLOT)).isZero();
            Slot now = flow.slot(SLOT);
            assertThat(now.getStatus()).isEqualTo(Slot.SlotStatus.BUSYTENTATIVE);
            assertThat(now.getComment()).isEqualTo("仮押さえ：医師 Y");
        }
    }

    private static HttpResponse<String> select(SlotFlow flow) throws Exception {
        return flow.select(SLOT);
    }
}
