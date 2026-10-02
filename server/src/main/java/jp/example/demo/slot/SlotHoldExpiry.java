package jp.example.demo.slot;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.store.StoredVersion;
import jp.example.demo.traffic.TrafficLog;
import jp.example.demo.traffic.TrafficRecord;
import org.hl7.fhir.r4.model.Slot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 仮押さえの期限切れ（specs/003 research R-05、D-17・D-37）。
 *
 * <p>コミットされた Slot の版が {@code busy-tentative} なら「その版・更新日時・期限（更新日時 + 仮押さえを受け付けた時点の秒数）」を保持し、
 * それ以外の状態になれば保持を消す。期限を過ぎた保持は、書き込みロックの中で「最新の版が保持と同じ」ことを確かめてから
 * {@code free}（押さえた人の記載なし）の新しい版に更新する。通常の書き込みと同じロック・版の採番・Subscription 通知を通るので、
 * 確定・取りやめとほぼ同時に起きても、どちらか一方だけが反映される（原則 IV）。
 * この更新は通信記録に {@code kind = "server"} として残す（原則 III の例外の条件）。
 */
public final class SlotHoldExpiry implements InMemoryRepository.CommitListener {
    private static final Logger LOG = LoggerFactory.getLogger(SlotHoldExpiry.class);
    public static final String CLIENT = "server-slot-expiry";
    public static final String ACTION = "slot-hold-expired";
    private static final long CHECK_INTERVAL_MILLIS = 250;

    private record Holding(String slotId, long versionId, Instant lastUpdated, Instant deadline, int holdSeconds) {}

    private final InMemoryRepository repo;
    private final TrafficLog traffic;
    private final DemoPolicy policy;
    private final Clock clock;
    private final Map<String, Holding> holdings = new ConcurrentHashMap<>();
    private ScheduledExecutorService executor;

    public SlotHoldExpiry(InMemoryRepository repo, TrafficLog traffic, DemoPolicy policy, Clock clock) {
        this.repo = repo;
        this.traffic = traffic;
        this.policy = policy;
        this.clock = clock;
    }

    /** コミット後に呼ばれる（書き込みロック内）。 */
    @Override
    public void committed(List<StoredVersion> changes) {
        for (StoredVersion v : changes) {
            if (!"Slot".equals(v.type())) {
                continue;
            }
            Slot slot = (Slot) v.toResource();
            if (slot.getStatus() == Slot.SlotStatus.BUSYTENTATIVE) {
                int seconds = policy.slotHoldSeconds(); // 仮押さえを受け付けた時点の秒数で期限が決まる
                holdings.put(v.id(), new Holding(v.id(), v.versionId(), v.lastUpdated(), v.lastUpdated().plusSeconds(seconds), seconds));
            } else {
                holdings.remove(v.id());
            }
        }
    }

    /** 期限を過ぎた仮押さえを空きに戻す。定期実行から呼ばれる（テストからは時刻を進めて直接呼ぶ）。 */
    public void checkNow() {
        Instant now = clock.instant();
        for (Holding h : List.copyOf(holdings.values())) {
            if (h.deadline().isAfter(now)) {
                continue;
            }
            holdings.remove(h.slotId(), h);
            expire(h);
        }
    }

    private void expire(Holding h) {
        TrafficRecord.ServerAction[] done = new TrafficRecord.ServerAction[1];
        long[] seq = new long[1];
        repo.write(tx -> {
            Optional<StoredVersion> current = tx.latest("Slot", h.slotId());
            // 確定・取りやめ・初期化で版が変わっていたら何もしない（初期化前の保持が、初期化後の枠を書き換えない）
            if (current.isEmpty()
                    || current.get().versionId() != h.versionId()
                    || !current.get().lastUpdated().equals(h.lastUpdated())) {
                return null;
            }
            Slot slot = (Slot) current.get().toResource();
            if (slot.getStatus() != Slot.SlotStatus.BUSYTENTATIVE) {
                return null;
            }
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("status", "busy-tentative");
            before.put("versionId", Long.toString(h.versionId()));
            if (slot.hasComment()) {
                before.put("comment", slot.getComment());
            }
            slot.setStatus(Slot.SlotStatus.FREE);
            slot.setComment(null);
            seq[0] = traffic.reserveSeq(); // コミットで送られる通知（ping）より前の seq にする
            StoredVersion written = tx.put(slot, "Slot", h.slotId());
            Map<String, Object> after = new LinkedHashMap<>();
            after.put("status", "free");
            after.put("versionId", Long.toString(written.versionId()));
            done[0] = new TrafficRecord.ServerAction(ACTION, written.versionRef(), before, after, h.holdSeconds());
            return null;
        });
        if (done[0] != null) {
            traffic.add(traffic.serverAction(seq[0], CLIENT, done[0]));
        }
    }

    /** 初期化：保持をすべて消す（初期化前の仮押さえの期限切れが、初期化後のデータを変更しない）。 */
    public void clear() {
        holdings.clear();
    }

    public synchronized void start() {
        if (executor != null) {
            return;
        }
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "slot-hold-expiry");
            t.setDaemon(true);
            return t;
        });
        executor.scheduleWithFixedDelay(this::safeCheck, CHECK_INTERVAL_MILLIS, CHECK_INTERVAL_MILLIS, TimeUnit.MILLISECONDS);
    }

    private void safeCheck() {
        try {
            checkNow();
        } catch (RuntimeException e) {
            LOG.warn("slot hold expiry check failed", e);
        }
    }

    public synchronized void stop() {
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }
}
