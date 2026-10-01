package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.uhn.fhir.rest.server.exceptions.PreconditionFailedException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.store.StoredVersion;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;

class InMemoryRepositoryTest {

    private static Task task() {
        Task t = new Task();
        t.setStatus(Task.TaskStatus.REQUESTED);
        return t;
    }

    @Test
    void versionIdStartsAtOneAndIncrements() {
        InMemoryRepository repo = new InMemoryRepository();
        String id = repo.write(tx -> {
            String newId = tx.newId("Task");
            tx.put(task(), "Task", newId);
            return newId;
        });
        assertThat(id).isEqualTo("1");
        StoredVersion v1 = repo.latest("Task", id).orElseThrow();
        assertThat(v1.versionId()).isEqualTo(1);
        assertThat(v1.lastUpdated()).isNotNull();
        assertThat(v1.toResource().getMeta().getVersionId()).isEqualTo("1");

        repo.write(tx -> tx.put(task(), "Task", id));
        assertThat(repo.latest("Task", id).orElseThrow().versionId()).isEqualTo(2);
        assertThat(repo.version("Task", id, 1)).isPresent();
        assertThat(repo.history("Task", id)).extracting(StoredVersion::versionId).containsExactly(2L, 1L);
    }

    @Test
    void idsAreIssuedPerTypeSequentially() {
        InMemoryRepository repo = new InMemoryRepository();
        String first = repo.write(tx -> tx.newId("Task"));
        assertThat(first).isEqualTo("1");
        // newId のみでは何も保存されないため、カウンターは保存されない（put を伴うコミットでのみ進む）
        repo.write(tx -> {
            tx.put(task(), "Task", tx.newId("Task"));
            tx.put(task(), "Task", tx.newId("Task"));
            return null;
        });
        assertThat(repo.latestOfType("Task")).hasSize(2);
        String specimenId = repo.write(tx -> tx.newId("Specimen"));
        assertThat(specimenId).isEqualTo("1");
    }

    @Test
    void exceptionDiscardsEverythingStagedInTheSession() {
        InMemoryRepository repo = new InMemoryRepository();
        assertThatThrownBy(() -> repo.write(tx -> {
                    tx.put(task(), "Task", "a");
                    tx.put(task(), "Task", "b");
                    throw new IllegalStateException("boom");
                }))
                .isInstanceOf(IllegalStateException.class);
        assertThat(repo.latestOfType("Task")).isEmpty();
        assertThat(repo.count()).isZero();
    }

    @Test
    void stagedChangesAreVisibleInsideTheSessionButNotOutsideUntilCommit() {
        InMemoryRepository repo = new InMemoryRepository();
        repo.write(tx -> {
            tx.put(task(), "Task", "a");
            assertThat(tx.latest("Task", "a")).isPresent();
            assertThat(tx.latestOfType("Task")).hasSize(1);
            assertThat(repo.latest("Task", "a")).isEmpty();
            return null;
        });
        assertThat(repo.latest("Task", "a")).isPresent();
    }

    @Test
    void listenersReceiveCommittedChangesOnce() {
        InMemoryRepository repo = new InMemoryRepository();
        List<List<StoredVersion>> received = new ArrayList<>();
        repo.addListener(received::add);
        repo.write(tx -> {
            tx.put(task(), "Task", "a");
            tx.put(task(), "Task", "b");
            return null;
        });
        assertThat(received).hasSize(1);
        assertThat(received.get(0)).extracting(StoredVersion::ref).containsExactly("Task/a", "Task/b");
    }

    @Test
    void replaceAllSwapsToSeedOnly() {
        InMemoryRepository repo = new InMemoryRepository();
        repo.write(tx -> tx.put(task(), "Task", "a"));
        Patient p = new Patient();
        p.setId("demo-taro");
        repo.replaceAll(List.of(p));
        assertThat(repo.latest("Task", "a")).isEmpty();
        assertThat(repo.latest("Patient", "demo-taro")).isPresent();
        assertThat(repo.latest("Patient", "demo-taro").orElseThrow().versionId()).isEqualTo(1);
        // 初期化後は連番が 1 から振り直される
        String afterReset = repo.write(tx -> tx.newId("Task"));
        assertThat(afterReset).isEqualTo("1");
    }

    @Test
    void readsDuringReplaceAllSeeEitherTheOldOrNewCompleteState() throws Exception {
        InMemoryRepository repo = new InMemoryRepository();
        repo.write(tx -> {
            for (int i = 0; i < 200; i++) {
                tx.put(task(), "Task", "old" + i);
            }
            return null;
        });
        List<Patient> seed = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Patient p = new Patient();
            p.setId("seed" + i);
            seed.add(p);
        }
        AtomicBoolean stop = new AtomicBoolean();
        AtomicBoolean torn = new AtomicBoolean();
        Thread reader = new Thread(() -> {
            while (!stop.get()) {
                // 1 回の読み取りごとに、差し替え前（Task 200 件）か後（Patient 12 件）の完全な状態であること
                int tasks = repo.latestOfType("Task").size();
                int patients = repo.latestOfType("Patient").size();
                int total = repo.count();
                if ((tasks != 200 && tasks != 0) || (patients != 0 && patients != 12) || (total != 200 && total != 12)) {
                    torn.set(true);
                }
            }
        });
        reader.start();
        repo.replaceAll(seed);
        Thread.sleep(50);
        stop.set(true);
        reader.join();
        assertThat(torn).isFalse();
    }

    @Test
    void concurrentUpdatesOnTheSameVersionLetExactlyOneSucceed() throws Exception {
        IfMatchRule rule = new IfMatchRule(new DemoPolicy());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 100; round++) {
                InMemoryRepository repo = new InMemoryRepository();
                repo.write(tx -> tx.put(task(), "Task", "t"));
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Boolean>> results = new ArrayList<>();
                for (int i = 0; i < 2; i++) {
                    results.add(pool.submit(() -> {
                        start.await();
                        try {
                            repo.write(tx -> {
                                StoredVersion current = tx.latest("Task", "t").orElseThrow();
                                rule.check("1", current); // 2 人とも版 1 を読んで更新する
                                return tx.put(task(), "Task", "t");
                            });
                            return true;
                        } catch (PreconditionFailedException e) {
                            return false;
                        }
                    }));
                }
                start.countDown();
                int ok = 0;
                for (Future<Boolean> f : results) {
                    if (f.get(5, TimeUnit.SECONDS)) {
                        ok++;
                    }
                }
                assertThat(ok).as("round %d", round).isEqualTo(1);
                assertThat(repo.latest("Task", "t").orElseThrow().versionId()).isEqualTo(2);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
