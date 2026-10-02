package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.slot.SlotHoldExpiry;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.traffic.TrafficLog;
import jp.example.demo.traffic.TrafficRecord;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Slot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 仮押さえの期限切れ（specs/003 research R-05、data-model.md §5）。時刻は進められる Clock で、確認は checkNow() を手で呼ぶ。 */
class SlotHoldExpiryTest {
    /** 手で動かせる時計。StoredVersion.lastUpdated は実際の現在時刻なので、仮押さえの更新時刻を基準に動かす。 */
    private static final class TestClock extends Clock {
        private Instant now = Instant.now();

        void set(Instant instant) {
            now = instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private InMemoryRepository repo;
    private TrafficLog traffic;
    private DemoPolicy policy;
    private TestClock clock;
    private SlotHoldExpiry expiry;

    @BeforeEach
    void setUp() {
        repo = new InMemoryRepository();
        traffic = new TrafficLog();
        policy = new DemoPolicy();
        clock = new TestClock();
        expiry = new SlotHoldExpiry(repo, traffic, policy, clock);
        repo.addListener(expiry);
        repo.write(tx -> tx.put(slot(Slot.SlotStatus.FREE, null), "Slot", "ct1-1000")); // 版 1
    }

    private static Slot slot(Slot.SlotStatus status, String comment) {
        Slot s = new Slot();
        s.setSchedule(new Reference("Schedule/ct-1"));
        s.setStatus(status);
        s.setComment(comment);
        return s;
    }

    /** 仮押さえして、その版の更新時刻を返す。 */
    private Instant hold(String comment) {
        repo.write(tx -> tx.put(slot(Slot.SlotStatus.BUSYTENTATIVE, comment), "Slot", "ct1-1000"));
        return repo.latest("Slot", "ct1-1000").orElseThrow().lastUpdated();
    }

    /** 仮押さえの更新時刻から seconds 秒後に時計を合わせる。 */
    private void at(Instant held, double seconds) {
        clock.set(held.plusMillis((long) (seconds * 1000)));
    }

    private Slot current() {
        return (Slot) repo.latest("Slot", "ct1-1000").orElseThrow().toResource();
    }

    private long version() {
        return repo.latest("Slot", "ct1-1000").orElseThrow().versionId();
    }

    private List<TrafficRecord> serverRecords() {
        return traffic.after(0).stream().filter(r -> "server".equals(r.kind())).toList();
    }

    @Test
    void doesNothingBeforeTheDeadline() {
        Instant held = hold("仮押さえ：医師 X");
        at(held, 29.5);
        expiry.checkNow();
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.BUSYTENTATIVE);
        assertThat(version()).isEqualTo(2);
        assertThat(serverRecords()).isEmpty();
    }

    @Test
    void putsTheSlotBackToFreeAfterTheDeadlineAndRecordsTheServerAction() {
        Instant held = hold("仮押さえ：医師 X");
        at(held, 31);
        expiry.checkNow();

        Slot after = current();
        assertThat(after.getStatus()).isEqualTo(Slot.SlotStatus.FREE);
        assertThat(after.hasComment()).isFalse();
        assertThat(version()).isEqualTo(3);

        List<TrafficRecord> records = serverRecords();
        assertThat(records).hasSize(1);
        TrafficRecord r = records.get(0);
        assertThat(r.client()).isEqualTo("server-slot-expiry");
        assertThat(r.request()).isNull();
        assertThat(r.response()).isNull();
        assertThat(r.serverAction().action()).isEqualTo("slot-hold-expired");
        assertThat(r.serverAction().resource()).isEqualTo("Slot/ct1-1000/_history/3");
        assertThat(r.serverAction().before()).containsEntry("status", "busy-tentative").containsEntry("versionId", "2")
                .containsEntry("comment", "仮押さえ：医師 X");
        assertThat(r.serverAction().after()).containsEntry("status", "free").containsEntry("versionId", "3");
        assertThat(r.serverAction().holdSeconds()).isEqualTo(30);

        // 2 回目の確認では何も起きない（保持は消えている）
        expiry.checkNow();
        assertThat(version()).isEqualTo(3);
        assertThat(serverRecords()).hasSize(1);
    }

    @Test
    void usesTheSecondsInEffectWhenTheHoldWasAccepted() {
        policy.setSlotHoldSeconds(60);
        Instant held = hold("仮押さえ：医師 X");
        policy.setSlotHoldSeconds(5); // 受け付けた後に変えても、その仮押さえの期限は 60 秒のまま
        at(held, 10);
        expiry.checkNow();
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.BUSYTENTATIVE);
        at(held, 61);
        expiry.checkNow();
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.FREE);
        assertThat(serverRecords().get(0).serverAction().holdSeconds()).isEqualTo(60);
    }

    @Test
    void aConfirmedOrReleasedSlotIsLeftAlone() {
        Instant held = hold("仮押さえ：医師 X");
        repo.write(tx -> tx.put(slot(Slot.SlotStatus.BUSY, null), "Slot", "ct1-1000")); // 確定
        at(held, 100);
        expiry.checkNow();
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.BUSY);
        assertThat(version()).isEqualTo(3);

        repo.write(tx -> tx.put(slot(Slot.SlotStatus.FREE, null), "Slot", "ct1-1000"));
        Instant heldY = hold("仮押さえ：医師 Y");
        repo.write(tx -> tx.put(slot(Slot.SlotStatus.FREE, null), "Slot", "ct1-1000")); // 取りやめ
        at(heldY, 100);
        expiry.checkNow();
        assertThat(version()).isEqualTo(6);
        assertThat(serverRecords()).isEmpty();
    }

    @Test
    void aNewHoldReplacesTheOlderOneAndGetsItsOwnDeadline() {
        Instant heldX = hold("仮押さえ：医師 X");
        at(heldX, 20);
        repo.write(tx -> tx.put(slot(Slot.SlotStatus.FREE, null), "Slot", "ct1-1000")); // 取りやめ（版 3）
        Instant heldY = hold("仮押さえ：医師 Y"); // 版 4。期限は医師 Y が押さえてから 30 秒
        at(heldY, 20); // 医師 X の仮押さえの期限（30 秒）は過ぎている時刻でも、医師 Y の仮押さえの期限はまだ
        expiry.checkNow();
        assertThat(version()).isEqualTo(4);
        assertThat(current().getComment()).isEqualTo("仮押さえ：医師 Y");
        at(heldY, 31);
        expiry.checkNow();
        assertThat(version()).isEqualTo(5);
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.FREE);
    }

    @Test
    void clearDropsEveryHoldingSoNothingIsWrittenAfterAReset() {
        Instant held = hold("仮押さえ：医師 X");
        expiry.clear();
        at(held, 100);
        expiry.checkNow();
        assertThat(current().getStatus()).isEqualTo(Slot.SlotStatus.BUSYTENTATIVE);
        assertThat(version()).isEqualTo(2);
        assertThat(serverRecords()).isEmpty();
    }
}
