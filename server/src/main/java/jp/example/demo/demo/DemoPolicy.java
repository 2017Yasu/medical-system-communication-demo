package jp.example.demo.demo;

/** デモのポリシー（data-model.md §6）。既定値は安全側（原則 IV）。 */
public final class DemoPolicy {
    public static final boolean DEFAULT_IF_MATCH_REQUIRED = true;
    public static final boolean DEFAULT_TASK_TRANSITION_CHECK = true;

    private volatile boolean ifMatchRequired = DEFAULT_IF_MATCH_REQUIRED;
    private volatile boolean taskTransitionCheck = DEFAULT_TASK_TRANSITION_CHECK;

    public boolean ifMatchRequired() {
        return ifMatchRequired;
    }

    public boolean taskTransitionCheck() {
        return taskTransitionCheck;
    }

    public void setIfMatchRequired(boolean value) {
        this.ifMatchRequired = value;
    }

    public void setTaskTransitionCheck(boolean value) {
        this.taskTransitionCheck = value;
    }

    public void resetToDefaults() {
        this.ifMatchRequired = DEFAULT_IF_MATCH_REQUIRED;
        this.taskTransitionCheck = DEFAULT_TASK_TRANSITION_CHECK;
    }
}
