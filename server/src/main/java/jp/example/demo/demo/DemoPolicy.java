package jp.example.demo.demo;

/**
 * デモのポリシー（data-model.md §6）。既定値は安全側（原則 IV）。
 *
 * <p>{@code labSendsIfMatch} はサーバーの判定には使わない。検体検査システムの画面が、更新時に If-Match を付けるかを
 * 決めるために読むデモ専用の設定で、別々のウィンドウ間で共有する唯一の経路が {@code /demo/policy} のため、ここに置く
 * （specs/002 research R-01）。
 */
public final class DemoPolicy {
    public static final boolean DEFAULT_IF_MATCH_REQUIRED = true;
    public static final boolean DEFAULT_TASK_TRANSITION_CHECK = true;
    public static final boolean DEFAULT_LAB_SENDS_IF_MATCH = true;

    private volatile boolean ifMatchRequired = DEFAULT_IF_MATCH_REQUIRED;
    private volatile boolean taskTransitionCheck = DEFAULT_TASK_TRANSITION_CHECK;
    private volatile boolean labSendsIfMatch = DEFAULT_LAB_SENDS_IF_MATCH;

    public boolean ifMatchRequired() {
        return ifMatchRequired;
    }

    public boolean taskTransitionCheck() {
        return taskTransitionCheck;
    }

    public boolean labSendsIfMatch() {
        return labSendsIfMatch;
    }

    public void setLabSendsIfMatch(boolean value) {
        this.labSendsIfMatch = value;
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
        this.labSendsIfMatch = DEFAULT_LAB_SENDS_IF_MATCH;
    }
}
