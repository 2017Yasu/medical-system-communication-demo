package jp.example.demo.traffic;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * 初期化からの通信記録。seq は要求の受信時に {@link #reserveSeq()} で採番し、応答の完了後にその seq で記録する。
 * そのため記録（配信）の順序は seq の順とは限らない（要求の処理中に発生した通知は、要求より後の seq を持つが先に記録される）。
 */
public final class TrafficLog {
    private final AtomicLong seq = new AtomicLong();
    private final List<TrafficRecord> records = new CopyOnWriteArrayList<>();
    private final List<Consumer<TrafficRecord>> listeners = new CopyOnWriteArrayList<>();

    public long reserveSeq() {
        return seq.incrementAndGet();
    }

    public void addListener(Consumer<TrafficRecord> listener) {
        listeners.add(listener);
    }

    public void add(TrafficRecord record) {
        records.add(record);
        for (Consumer<TrafficRecord> l : listeners) {
            l.accept(record);
        }
    }

    /** seq の昇順。after より大きいものだけ。 */
    public List<TrafficRecord> after(long after) {
        List<TrafficRecord> out = new ArrayList<>();
        for (TrafficRecord r : records) {
            if (r.seq() > after) {
                out.add(r);
            }
        }
        out.sort(Comparator.comparingLong(TrafficRecord::seq));
        return out;
    }

    public void clear() {
        records.clear();
        seq.set(0);
    }

    public static String now() {
        return OffsetDateTime.now().toString();
    }

    public TrafficRecord notification(String subscriptionId, String targetClient, String resource) {
        return new TrafficRecord(
                reserveSeq(),
                now(),
                "notification",
                "server",
                null,
                null,
                new TrafficRecord.Notification(subscriptionId, targetClient, resource),
                null);
    }

    public TrafficRecord demoEvent(String event, Object detail) {
        return new TrafficRecord(
                reserveSeq(), now(), "demo", "demo", null, null, null, new TrafficRecord.DemoEvent(event, detail));
    }
}
