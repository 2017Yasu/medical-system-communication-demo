package jp.example.demo.demo;

import java.time.OffsetDateTime;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.subscription.SubscriptionEngine;
import jp.example.demo.traffic.MonitorBroadcaster;
import jp.example.demo.traffic.TrafficLog;
import org.hl7.fhir.r4.model.Resource;

import java.util.List;

/** 初期化とポリシー変更（contracts/demo-control-api.md）。業務情報は扱わない。 */
public final class DemoControl {
    private final InMemoryRepository repo;
    private final TrafficLog traffic;
    private final SubscriptionEngine subscriptions;
    private final MonitorBroadcaster monitor;
    private final DemoPolicy policy;
    private final SeedLoader seedLoader;

    public DemoControl(
            InMemoryRepository repo,
            TrafficLog traffic,
            SubscriptionEngine subscriptions,
            MonitorBroadcaster monitor,
            DemoPolicy policy,
            SeedLoader seedLoader) {
        this.repo = repo;
        this.traffic = traffic;
        this.subscriptions = subscriptions;
        this.monitor = monitor;
        this.policy = policy;
        this.seedLoader = seedLoader;
    }

    /** 全リソース・通信記録を消去して初期データだけの状態にする。 */
    public synchronized int reset() {
        List<Resource> seed = seedLoader.load();
        repo.replaceAll(seed); // 書き込みロックを取り、状態を一括で差し替える
        subscriptions.unbindAll();
        policy.resetToDefaults();
        traffic.clear();
        String now = OffsetDateTime.now().toString();
        traffic.add(traffic.demoEvent("reset", java.util.Map.of("seedResources", seed.size())));
        monitor.reset(now);
        return seed.size();
    }

    public synchronized void updatePolicy(Boolean ifMatchRequired, Boolean taskTransitionCheck, Boolean labSendsIfMatch) {
        if (ifMatchRequired != null) {
            policy.setIfMatchRequired(ifMatchRequired);
        }
        if (taskTransitionCheck != null) {
            policy.setTaskTransitionCheck(taskTransitionCheck);
        }
        if (labSendsIfMatch != null) {
            policy.setLabSendsIfMatch(labSendsIfMatch);
        }
        traffic.add(traffic.demoEvent("policy", java.util.Map.of(
                "ifMatchRequired", policy.ifMatchRequired(),
                "taskTransitionCheck", policy.taskTransitionCheck(),
                "labSendsIfMatch", policy.labSendsIfMatch())));
        monitor.policy(policy);
    }

    public DemoPolicy policy() {
        return policy;
    }
}
