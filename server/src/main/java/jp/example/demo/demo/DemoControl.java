package jp.example.demo.demo;

import java.time.OffsetDateTime;
import jp.example.demo.slot.SlotHoldExpiry;
import jp.example.demo.slot.SlotSeedGenerator;
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
    private final SlotSeedGenerator slotSeeds;
    private final SlotHoldExpiry slotHoldExpiry;

    public DemoControl(
            InMemoryRepository repo,
            TrafficLog traffic,
            SubscriptionEngine subscriptions,
            MonitorBroadcaster monitor,
            DemoPolicy policy,
            SeedLoader seedLoader,
            SlotSeedGenerator slotSeeds,
            SlotHoldExpiry slotHoldExpiry) {
        this.repo = repo;
        this.traffic = traffic;
        this.subscriptions = subscriptions;
        this.monitor = monitor;
        this.policy = policy;
        this.seedLoader = seedLoader;
        this.slotSeeds = slotSeeds;
        this.slotHoldExpiry = slotHoldExpiry;
    }

    /** 全リソース・通信記録を消去して初期データだけの状態にする。 */
    public synchronized int reset() {
        List<Resource> seed = new java.util.ArrayList<>(seedLoader.load());
        seed.addAll(slotSeeds.generate()); // 日付に依存する予約枠は初期化のたびに作る（specs/003 R-02）
        repo.replaceAll(seed); // 書き込みロックを取り、状態を一括で差し替える
        slotHoldExpiry.clear(); // 初期化前の仮押さえの期限切れが、初期化後のデータを書き換えない
        subscriptions.unbindAll();
        policy.resetToDefaults();
        traffic.clear();
        String now = OffsetDateTime.now().toString();
        traffic.add(traffic.demoEvent("reset", java.util.Map.of("seedResources", seed.size())));
        monitor.reset(now, policy);
        return seed.size();
    }

    public synchronized void updatePolicy(
            Boolean ifMatchRequired,
            Boolean taskTransitionCheck,
            Boolean labSendsIfMatch,
            Boolean ehrUsesSlotHold,
            Integer slotHoldSeconds) {
        if (ifMatchRequired != null) {
            policy.setIfMatchRequired(ifMatchRequired);
        }
        if (taskTransitionCheck != null) {
            policy.setTaskTransitionCheck(taskTransitionCheck);
        }
        if (labSendsIfMatch != null) {
            policy.setLabSendsIfMatch(labSendsIfMatch);
        }
        if (ehrUsesSlotHold != null) {
            policy.setEhrUsesSlotHold(ehrUsesSlotHold);
        }
        if (slotHoldSeconds != null) {
            policy.setSlotHoldSeconds(slotHoldSeconds);
        }
        traffic.add(traffic.demoEvent("policy", policyMap()));
        monitor.policy(policy);
    }

    private java.util.Map<String, Object> policyMap() {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("ifMatchRequired", policy.ifMatchRequired());
        m.put("taskTransitionCheck", policy.taskTransitionCheck());
        m.put("labSendsIfMatch", policy.labSendsIfMatch());
        m.put("ehrUsesSlotHold", policy.ehrUsesSlotHold());
        m.put("slotHoldSeconds", policy.slotHoldSeconds());
        return m;
    }

    public DemoPolicy policy() {
        return policy;
    }
}
