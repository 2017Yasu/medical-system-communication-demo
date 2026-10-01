package jp.example.demo.fhir.rules;

import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import jp.example.demo.demo.DemoPolicy;
import org.hl7.fhir.r4.model.Task;
import org.hl7.fhir.r4.model.Task.TaskStatus;

/** Task.status の状態遷移マトリクス（docs/04-design-rules.md）。 */
public final class TaskTransitionRule {
    private static final Map<TaskStatus, Set<TaskStatus>> ALLOWED = new EnumMap<>(TaskStatus.class);
    private static final Set<TaskStatus> TERMINAL =
            EnumSet.of(TaskStatus.COMPLETED, TaskStatus.REJECTED, TaskStatus.FAILED, TaskStatus.CANCELLED);

    static {
        ALLOWED.put(TaskStatus.REQUESTED,
                EnumSet.of(TaskStatus.ACCEPTED, TaskStatus.REJECTED, TaskStatus.INPROGRESS, TaskStatus.CANCELLED));
        ALLOWED.put(TaskStatus.ACCEPTED,
                EnumSet.of(TaskStatus.INPROGRESS, TaskStatus.ONHOLD, TaskStatus.CANCELLED));
        ALLOWED.put(TaskStatus.INPROGRESS,
                EnumSet.of(TaskStatus.ONHOLD, TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED));
        ALLOWED.put(TaskStatus.ONHOLD,
                EnumSet.of(TaskStatus.INPROGRESS, TaskStatus.FAILED, TaskStatus.CANCELLED));
    }

    private final DemoPolicy policy;

    public TaskTransitionRule(DemoPolicy policy) {
        this.policy = policy;
    }

    public static boolean isTerminal(TaskStatus status) {
        return TERMINAL.contains(status);
    }

    public static String label(TaskStatus status) {
        if (status == null) {
            return "不明";
        }
        return switch (status) {
            case REQUESTED -> "依頼済み";
            case ACCEPTED -> "受付済み";
            case REJECTED -> "受付不可";
            case INPROGRESS -> "実施中";
            case ONHOLD -> "保留";
            case COMPLETED -> "完了";
            case FAILED -> "中断";
            case CANCELLED -> "取消";
            default -> status.toCode();
        };
    }

    /** 既存の Task を更新する前に呼ぶ。違反は 422。 */
    public void check(Task current, Task next) {
        if (!policy.taskTransitionCheck()) {
            return;
        }
        TaskStatus from = current.getStatus();
        TaskStatus to = next.getStatus();
        if (isTerminal(from)) {
            throw new UnprocessableEntityException(
                    "この作業は" + label(from) + "のため変更できません（" + from.toCode() + "）");
        }
        if (from == to) {
            return;
        }
        Set<TaskStatus> allowed = ALLOWED.getOrDefault(from, Set.of());
        if (!allowed.contains(to)) {
            throw new UnprocessableEntityException(
                    "この状態（" + label(from) + " " + from.toCode() + "）から " + label(to) + " "
                            + to.toCode() + " へは変更できません");
        }
    }
}
