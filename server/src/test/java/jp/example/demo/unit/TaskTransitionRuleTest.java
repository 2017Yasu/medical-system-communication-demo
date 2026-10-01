package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.fhir.rules.TaskTransitionRule;
import org.hl7.fhir.r4.model.Task;
import org.hl7.fhir.r4.model.Task.TaskStatus;
import org.junit.jupiter.api.Test;

class TaskTransitionRuleTest {
    private static final Set<TaskStatus> TERMINAL =
            EnumSet.of(TaskStatus.COMPLETED, TaskStatus.REJECTED, TaskStatus.FAILED, TaskStatus.CANCELLED);

    // docs/04 の状態遷移マトリクス
    private static final Map<TaskStatus, Set<TaskStatus>> ALLOWED = Map.of(
            TaskStatus.REQUESTED, EnumSet.of(TaskStatus.ACCEPTED, TaskStatus.REJECTED, TaskStatus.INPROGRESS, TaskStatus.CANCELLED),
            TaskStatus.ACCEPTED, EnumSet.of(TaskStatus.INPROGRESS, TaskStatus.ONHOLD, TaskStatus.CANCELLED),
            TaskStatus.INPROGRESS, EnumSet.of(TaskStatus.ONHOLD, TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED),
            TaskStatus.ONHOLD, EnumSet.of(TaskStatus.INPROGRESS, TaskStatus.FAILED, TaskStatus.CANCELLED));

    private static final TaskStatus[] USED = {
        TaskStatus.REQUESTED, TaskStatus.ACCEPTED, TaskStatus.REJECTED, TaskStatus.INPROGRESS,
        TaskStatus.ONHOLD, TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED
    };

    private static Task task(TaskStatus s) {
        Task t = new Task();
        t.setStatus(s);
        return t;
    }

    @Test
    void everyPairFollowsTheMatrix() {
        TaskTransitionRule rule = new TaskTransitionRule(new DemoPolicy());
        for (TaskStatus from : USED) {
            for (TaskStatus to : USED) {
                boolean ok;
                if (TERMINAL.contains(from)) {
                    ok = false; // 終了状態からは同じ状態へも変更不可（status を変えない更新も拒否）
                } else if (from == to) {
                    ok = true; // businessStatus のみの変更は許可
                } else {
                    ok = ALLOWED.getOrDefault(from, Set.of()).contains(to);
                }
                if (ok) {
                    assertThatCode(() -> rule.check(task(from), task(to)))
                            .as("%s -> %s", from, to).doesNotThrowAnyException();
                } else {
                    assertThatThrownBy(() -> rule.check(task(from), task(to)))
                            .as("%s -> %s", from, to)
                            .isInstanceOf(UnprocessableEntityException.class);
                }
            }
        }
    }

    @Test
    void terminalTaskRejectsEvenUpdatesThatKeepTheStatus() {
        TaskTransitionRule rule = new TaskTransitionRule(new DemoPolicy());
        assertThatThrownBy(() -> rule.check(task(TaskStatus.CANCELLED), task(TaskStatus.CANCELLED)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("取消のため変更できません");
    }

    @Test
    void messageUsesBusinessLabelsAndCodes() {
        TaskTransitionRule rule = new TaskTransitionRule(new DemoPolicy());
        assertThatThrownBy(() -> rule.check(task(TaskStatus.REQUESTED), task(TaskStatus.COMPLETED)))
                .hasMessageContaining("依頼済み requested")
                .hasMessageContaining("完了 completed");
    }

    @Test
    void checkCanBeSwitchedOff() {
        DemoPolicy policy = new DemoPolicy();
        policy.setTaskTransitionCheck(false);
        TaskTransitionRule rule = new TaskTransitionRule(policy);
        assertThatCode(() -> rule.check(task(TaskStatus.COMPLETED), task(TaskStatus.REQUESTED)))
                .doesNotThrowAnyException();
    }
}
