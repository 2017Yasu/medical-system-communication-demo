package jp.example.demo.store;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Function;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Resource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * インメモリのリソースリポジトリ（research.md R-06）。
 *
 * <ul>
 *   <li>状態は不変のスナップショットで、書き込みのコミットと初期化は参照の差し替え 1 回で行う。
 *       読み取りはロック不要で、途中の状態は見えない。</li>
 *   <li>書き込みは 1 つの公平なロックで直列化する。ロック内で「版の確認 → 新しい版の作成」を行うため、
 *       同じ版を前提にした同時更新は必ず片方だけが成功する。</li>
 * </ul>
 */
public final class InMemoryRepository {
    private static final Logger LOG = LoggerFactory.getLogger(InMemoryRepository.class);

    /** コミット後に呼ばれる（書き込みロック内）。 */
    public interface CommitListener {
        void committed(List<StoredVersion> changes);
    }

    private record Snapshot(Map<String, List<StoredVersion>> versions, Map<String, Long> counters) {
        static final Snapshot EMPTY = new Snapshot(Map.of(), Map.of());
    }

    private final ReentrantLock lock = new ReentrantLock(true);
    private volatile Snapshot snapshot = Snapshot.EMPTY;
    private final List<CommitListener> listeners = new CopyOnWriteArrayList<>();

    public void addListener(CommitListener listener) {
        listeners.add(listener);
    }

    // ---- 読み取り（ロック不要） ----

    public Optional<StoredVersion> latest(String type, String id) {
        List<StoredVersion> list = snapshot.versions().get(key(type, id));
        return list == null ? Optional.empty() : Optional.of(list.get(list.size() - 1));
    }

    public Optional<StoredVersion> version(String type, String id, long versionId) {
        List<StoredVersion> list = snapshot.versions().get(key(type, id));
        if (list == null) {
            return Optional.empty();
        }
        return list.stream().filter(v -> v.versionId() == versionId).findFirst();
    }

    /** 新しい版が先頭。 */
    public List<StoredVersion> history(String type, String id) {
        List<StoredVersion> list = snapshot.versions().get(key(type, id));
        if (list == null) {
            return List.of();
        }
        List<StoredVersion> copy = new ArrayList<>(list);
        Collections.reverse(copy);
        return copy;
    }

    /** 種別ごとの最新版の一覧（更新日時の新しい順）。 */
    public List<StoredVersion> latestOfType(String type) {
        return latestOfType(snapshot.versions(), type);
    }

    private static List<StoredVersion> latestOfType(Map<String, List<StoredVersion>> versions, String type) {
        List<StoredVersion> out = new ArrayList<>();
        String prefix = type + "/";
        for (Map.Entry<String, List<StoredVersion>> e : versions.entrySet()) {
            if (e.getKey().startsWith(prefix)) {
                out.add(e.getValue().get(e.getValue().size() - 1));
            }
        }
        out.sort((a, b) -> {
            int c = b.lastUpdated().compareTo(a.lastUpdated());
            return c != 0 ? c : Long.compare(numeric(b.id()), numeric(a.id()));
        });
        return out;
    }

    private static long numeric(String id) {
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public int count() {
        return snapshot.versions().size();
    }

    // ---- 書き込み ----

    /** 書き込みセッション内で action を実行し、正常終了ならコミット、例外なら破棄する。 */
    public <T> T write(Function<WriteSession, T> action) {
        lock.lock();
        try {
            WriteSession session = new WriteSession(snapshot);
            T result = action.apply(session);
            if (!session.staged.isEmpty()) {
                snapshot = session.toSnapshot();
                List<StoredVersion> changes = List.copyOf(session.changes);
                for (CommitListener l : listeners) {
                    try {
                        l.committed(changes);
                    } catch (RuntimeException e) {
                        LOG.warn("commit listener failed", e);
                    }
                }
            }
            return result;
        } finally {
            lock.unlock();
        }
    }

    /** 初期データだけの新しい状態に一括で差し替える。読み取りは差し替え前か後のどちらかの完全な状態だけを見る。 */
    public void replaceAll(List<? extends Resource> seed) {
        lock.lock();
        try {
            Map<String, List<StoredVersion>> versions = new HashMap<>();
            for (Resource r : seed) {
                String type = r.fhirType();
                String id = r.getIdElement().getIdPart();
                StoredVersion v = build(r, type, id, 1, Instant.now());
                versions.put(key(type, id), List.of(v));
            }
            snapshot = new Snapshot(Map.copyOf(versions), Map.of());
        } finally {
            lock.unlock();
        }
    }

    private static String key(String type, String id) {
        return type + "/" + id;
    }

    static StoredVersion build(Resource source, String type, String id, long versionId, Instant now) {
        Resource copy = source.copy();
        copy.setId(new IdType(type, id, Long.toString(versionId)));
        copy.getMeta().setVersionId(Long.toString(versionId));
        copy.getMeta().setLastUpdated(Date.from(now));
        return new StoredVersion(type, id, versionId, now, Fhir.json().encodeResourceToString(copy));
    }

    /** 1 回の書き込み（単一操作または Transaction 全体）。コミットまで他からは見えない。 */
    public static final class WriteSession {
        private final Snapshot base;
        private final Map<String, List<StoredVersion>> staged = new LinkedHashMap<>();
        private final Map<String, Long> counters;
        private final List<StoredVersion> changes = new ArrayList<>();

        private WriteSession(Snapshot base) {
            this.base = base;
            this.counters = new HashMap<>(base.counters());
        }

        public Optional<StoredVersion> latest(String type, String id) {
            List<StoredVersion> list = staged.get(key(type, id));
            if (list == null) {
                list = base.versions().get(key(type, id));
            }
            return list == null ? Optional.empty() : Optional.of(list.get(list.size() - 1));
        }

        public List<StoredVersion> latestOfType(String type) {
            Map<String, List<StoredVersion>> merged = new HashMap<>(base.versions());
            merged.putAll(staged);
            return InMemoryRepository.latestOfType(merged, type);
        }

        /** 種別ごとの連番 ID（"1", "2", ...）を払い出す。 */
        public String newId(String type) {
            long next = counters.merge(type, 1L, Long::sum);
            return Long.toString(next);
        }

        /** リソースの新しい版を作る（存在しなければ版 1）。ID と meta は上書きされる。 */
        public StoredVersion put(Resource resource, String type, String id) {
            List<StoredVersion> existing = staged.get(key(type, id));
            if (existing == null) {
                existing = base.versions().get(key(type, id));
            }
            long next = existing == null ? 1 : existing.get(existing.size() - 1).versionId() + 1;
            StoredVersion v = build(resource, type, id, next, Instant.now());
            List<StoredVersion> list = existing == null ? new ArrayList<>() : new ArrayList<>(existing);
            list.add(v);
            staged.put(key(type, id), list);
            changes.add(v);
            return v;
        }

        private Snapshot toSnapshot() {
            Map<String, List<StoredVersion>> merged = new HashMap<>(base.versions());
            merged.putAll(staged);
            return new Snapshot(Map.copyOf(merged), Map.copyOf(counters));
        }
    }
}
