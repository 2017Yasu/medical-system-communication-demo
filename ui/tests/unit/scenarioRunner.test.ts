import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateProgress } from "../../src/scenario/progress";
import { ScenarioRunner, type RunnerDeps } from "../../src/scenario/runner";
import type { Scenario, ScenarioState } from "../../src/scenario/types";
import { TrafficStore } from "../../src/realtime/trafficStore";
import type { TrafficRecord } from "../../src/realtime/types";

let seq = 0;
function http(client: string, method: string, url: string, status = 200): TrafficRecord {
  return {
    seq: ++seq, timestamp: "t", kind: "http", client,
    request: { method, url, headers: {}, body: "", truncated: false },
    response: { status, headers: {}, body: "", durationMs: 1, truncated: false },
    notification: null, demoEvent: null,
  };
}
function ping(target: string): TrafficRecord {
  return { seq: ++seq, timestamp: "t", kind: "notification", client: "server", request: null, response: null,
    notification: { subscriptionId: "x", targetClient: target, resource: "Task/1/_history/1" }, demoEvent: null };
}

const S1: ScenarioState = { serviceRequest: "active", task: { status: "requested", businessStatus: "not-collected" } };
const S3: ScenarioState = { serviceRequest: "active", task: { status: "accepted", businessStatus: "received" } };

// 実際の S1 と同じ形の小さなシナリオ：依頼 → （通知で自動反映）→ 受付
function makeScenario(run: { order: () => Promise<void>; accept: () => Promise<void> }): Scenario {
  const noop = { business: "b", fhir: "f" };
  return {
    id: "s1-main",
    title: "テスト",
    steps: [
      { no: 1, title: "依頼", actor: "ehr-doctor", target: { screen: "ehr" }, run: run.order, explanation: noop,
        expected: { ...S1, traffic: [{ kind: "http", client: "ehr-doctor", method: "POST", resourceType: "Bundle" }] } },
      { no: 2, title: "新着", actor: "auto", target: { screen: "lis" }, explanation: noop,
        expected: { ...S1, traffic: [{ kind: "notification", targetClient: "lis-tech-a" }, { kind: "http", client: "lis-tech-a", method: "GET", resourceType: "Task" }] } },
      { no: 3, title: "受付", actor: "lis-tech-a", target: { screen: "lis" }, run: run.accept, explanation: noop,
        expected: { ...S3, traffic: [{ kind: "http", client: "lis-tech-a", method: "PATCH", resourceType: "Task" }] } },
    ],
  };
}

describe("evaluateProgress", () => {
  const scenario = makeScenario({ order: async () => {}, accept: async () => {} });

  beforeEach(() => { seq = 0; });

  it("distinguishes steps whose data is identical by their traffic", () => {
    const records = [http("ehr-doctor", "POST", "/fhir")];
    expect(evaluateProgress(scenario, S1, records, 0).completed).toBe(1);
    records.push(ping("lis-tech-a"));
    expect(evaluateProgress(scenario, S1, records, 0).completed).toBe(1); // GET がまだ
    records.push(http("lis-tech-a", "GET", "/fhir/Task?owner=x"));
    expect(evaluateProgress(scenario, S1, records, 0).completed).toBe(2);
  });

  it("ignores traffic at or before the baseline and traffic from the monitor", () => {
    const old = [http("ehr-doctor", "POST", "/fhir")];
    expect(evaluateProgress(scenario, S1, old, old[0].seq).completed).toBe(0);
    const monitorOnly = [http("monitor", "POST", "/fhir")];
    expect(evaluateProgress(scenario, S1, monitorOnly, 0).completed).toBe(0);
  });

  it("uses the first match as the baseline, so later repeats of the same traffic do not push the next step away", () => {
    // 受付（PATCH）の前に、採血などで検査部の画面が再び通知を受けて取得し直していても、ステップ 3 は完了できる
    const records = [
      http("ehr-doctor", "POST", "/fhir"), ping("lis-tech-a"), http("lis-tech-a", "GET", "/fhir/Task"),
      http("lis-tech-a", "PATCH", "/fhir/Task/1"),
      ping("lis-tech-a"), http("lis-tech-a", "GET", "/fhir/Task"), // PATCH の後の再取得
    ];
    expect(evaluateProgress(scenario, S3, records, 0).completed).toBe(3);
  });

  it("does not count failed requests", () => {
    expect(evaluateProgress(scenario, S1, [http("ehr-doctor", "POST", "/fhir", 412)], 0).completed).toBe(0);
  });

  it("requires the notification to come after the previous step (a ping delivered before its cause does not count)", () => {
    const records = [ping("lis-tech-a"), http("lis-tech-a", "GET", "/fhir/Task"), http("ehr-doctor", "POST", "/fhir")];
    expect(evaluateProgress(scenario, S1, records, 0).completed).toBe(1);
  });

  it("falls back to the last step whose data matches the current state", () => {
    const records = [
      http("ehr-doctor", "POST", "/fhir"), ping("lis-tech-a"), http("lis-tech-a", "GET", "/fhir/Task"),
      http("lis-tech-a", "PATCH", "/fhir/Task/1"),
    ];
    expect(evaluateProgress(scenario, S3, records, 0).completed).toBe(3);
    // データが期待と違えば、そのステップは完了とみなさない
    expect(evaluateProgress(scenario, S1, records, 0).completed).toBe(2);
  });
});

describe("ScenarioRunner", () => {
  let state: ScenarioState;
  let store: TrafficStore;
  let calls: string[];
  let deps: RunnerDeps;

  const order = async () => {
    calls.push("order");
    state = S1;
    store.add(http("ehr-doctor", "POST", "/fhir"));
    // 検査部の画面が通知を受けて取り直す（作成時点のストアに書く：前のテストのタイマーが次のテストに漏れないように）
    const target = store;
    setTimeout(() => { target.add(ping("lis-tech-a")); target.add(http("lis-tech-a", "GET", "/fhir/Task")); }, 20);
  };
  const accept = async () => {
    calls.push("accept");
    state = S3;
    store.add(http("lis-tech-a", "PATCH", "/fhir/Task/1"));
  };

  beforeEach(() => {
    seq = 0;
    calls = [];
    state = {};
    store = new TrafficStore();
    deps = {
      store,
      clients: {} as RunnerDeps["clients"],
      loadState: async () => state,
      resetServer: vi.fn(async () => { calls.push("reset"); state = {}; store.clear(); seq = 0; }),
      settle: async () => {},
      completionTimeoutMs: 400,
      pollMs: 10,
    };
  });

  it("next() runs the step as its actor and completes it", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    await runner.next();
    expect(calls).toEqual(["order"]);
    expect(runner.getView().completed).toBe(1);
    expect(runner.getView().waiting).toBe(false);
  });

  it("next() on an automatic step runs nothing and waits for the notification", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    await runner.next(); // 1
    await runner.next(); // 2（自動）
    expect(calls).toEqual(["order"]);
    expect(runner.getView().completed).toBe(2);
  });

  it("shows 'waiting for the notification' and does not advance when the condition is never met", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order: async () => { calls.push("order"); state = S1; store.add(http("ehr-doctor", "POST", "/fhir")); }, accept }));
    await runner.next();
    await runner.next(); // 通知が来ない
    expect(runner.getView().completed).toBe(1);
    expect(runner.getView().waiting).toBe(true);
  });

  it("back() resets the server and replays the steps before the previous one", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    await runner.next();
    await runner.next();
    await runner.next();
    expect(runner.getView().completed).toBe(3);
    calls.length = 0;
    await runner.back();
    expect(calls).toEqual(["reset", "order"]); // 初期化 → ステップ 1、2（自動）を再現
    expect(runner.getView().completed).toBe(2);
    expect(state).toEqual(S1);
  });

  it("back() from step 1 resets to the beginning", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    await runner.next();
    calls.length = 0;
    await runner.back();
    expect(calls).toEqual(["reset"]);
    expect(runner.getView().completed).toBe(0);
  });

  it("follows manual operations (refresh) without running anything", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    state = S1;
    store.add(http("ehr-doctor", "POST", "/fhir"));
    store.add(ping("lis-tech-a"));
    store.add(http("lis-tech-a", "GET", "/fhir/Task"));
    await runner.refresh();
    expect(runner.getView().completed).toBe(2);
    expect(calls).toEqual([]);
    state = S3;
    store.add(http("lis-tech-a", "PATCH", "/fhir/Task/1"));
    await runner.refresh();
    expect(runner.getView().completed).toBe(3);
  });

  it("starts counting after the traffic that already exists", async () => {
    store.add(http("ehr-doctor", "POST", "/fhir"));
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    state = S1;
    await runner.refresh();
    expect(runner.getView().completed).toBe(0);
  });

  it("reset() clears the server and starts over", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    await runner.next();
    await runner.reset();
    expect(deps.resetServer).toHaveBeenCalled();
    expect(runner.getView().completed).toBe(0);
  });

  it("does nothing after the last step", async () => {
    const runner = new ScenarioRunner(deps);
    runner.start(makeScenario({ order, accept }));
    for (let i = 0; i < 4; i++) await runner.next();
    expect(runner.getView().completed).toBe(3);
    expect(calls.filter((c) => c === "accept")).toHaveLength(1);
  });
});
