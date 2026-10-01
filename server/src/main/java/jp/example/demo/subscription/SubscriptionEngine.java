package jp.example.demo.subscription;

import jakarta.websocket.Session;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import jp.example.demo.fhir.search.Criteria;
import jp.example.demo.fhir.search.CriteriaParser;
import jp.example.demo.fhir.search.SearchMatcher;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.store.StoredVersion;
import jp.example.demo.traffic.TrafficLog;
import org.hl7.fhir.r4.model.Subscription;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Subscription の criteria 評価と ping の送信（R4 websocket チャネル。research.md R-10）。
 * コミットごとに、変更されたリソースを active な Subscription の criteria で評価し、
 * 該当する Subscription ごとに 1 回だけ、bind 中の接続へ `ping {id}` を送る。
 */
public final class SubscriptionEngine implements InMemoryRepository.CommitListener {
    private static final Logger LOG = LoggerFactory.getLogger(SubscriptionEngine.class);

    private record Binding(Session session, String client) {}

    private final InMemoryRepository repo;
    private final TrafficLog traffic;
    private final Map<String, List<Binding>> bindings = new ConcurrentHashMap<>();

    public SubscriptionEngine(InMemoryRepository repo, TrafficLog traffic) {
        this.repo = repo;
        this.traffic = traffic;
        repo.addListener(this);
    }

    /** `bind {id}` の処理。返信メッセージ（`bound {id}` または `error {id} {理由}`）を返す。 */
    public String bind(Session session, String client, String subscriptionId) {
        StoredVersion sub = repo.latest("Subscription", subscriptionId).orElse(null);
        if (sub == null) {
            return "error " + subscriptionId + " Subscription が存在しません";
        }
        if (((Subscription) sub.toResource()).getStatus() != Subscription.SubscriptionStatus.ACTIVE) {
            return "error " + subscriptionId + " Subscription が active ではありません";
        }
        bindings.computeIfAbsent(subscriptionId, k -> new CopyOnWriteArrayList<>()).add(new Binding(session, client));
        return "bound " + subscriptionId;
    }

    public void unbindSession(Session session) {
        for (List<Binding> list : bindings.values()) {
            list.removeIf(b -> b.session().equals(session));
        }
    }

    public void unbindAll() {
        bindings.clear();
    }

    @Override
    public void committed(List<StoredVersion> changes) {
        if (bindings.isEmpty()) {
            return;
        }
        // 該当した Subscription id → きっかけになった最初の変更
        Map<String, StoredVersion> matched = new LinkedHashMap<>();
        for (StoredVersion subVersion : repo.latestOfType("Subscription")) {
            Subscription sub = (Subscription) subVersion.toResource();
            if (sub.getStatus() != Subscription.SubscriptionStatus.ACTIVE || !bindings.containsKey(subVersion.id())) {
                continue;
            }
            Criteria criteria;
            try {
                criteria = CriteriaParser.parse(sub.getCriteria());
            } catch (IllegalArgumentException e) {
                continue;
            }
            for (StoredVersion change : changes) {
                if (change.type().equals(criteria.type())
                        && SearchMatcher.matches(change.toResource(), criteria.params())) {
                    matched.putIfAbsent(subVersion.id(), change);
                    break;
                }
            }
        }
        for (Map.Entry<String, StoredVersion> e : matched.entrySet()) {
            ping(e.getKey(), e.getValue());
        }
    }

    private void ping(String subscriptionId, StoredVersion cause) {
        List<Binding> list = bindings.get(subscriptionId);
        if (list == null) {
            return;
        }
        Set<Session> done = new LinkedHashSet<>();
        for (Binding b : new ArrayList<>(list)) {
            if (!done.add(b.session()) || !b.session().isOpen()) {
                continue;
            }
            traffic.add(traffic.notification(subscriptionId, b.client(), cause.versionRef()));
            synchronized (b.session()) {
                try {
                    b.session().getBasicRemote().sendText("ping " + subscriptionId);
                } catch (IOException | RuntimeException ex) {
                    LOG.debug("ping failed", ex);
                }
            }
        }
    }
}
