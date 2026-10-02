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
    public static final boolean DEFAULT_EHR_USES_SLOT_HOLD = true;
    public static final int DEFAULT_SLOT_HOLD_SECONDS = 30;
    public static final int MIN_SLOT_HOLD_SECONDS = 1;
    public static final int MAX_SLOT_HOLD_SECONDS = 300;

    private volatile boolean ifMatchRequired = DEFAULT_IF_MATCH_REQUIRED;
    private volatile boolean taskTransitionCheck = DEFAULT_TASK_TRANSITION_CHECK;
    private volatile boolean labSendsIfMatch = DEFAULT_LAB_SENDS_IF_MATCH;
    private volatile boolean ehrUsesSlotHold = DEFAULT_EHR_USES_SLOT_HOLD;
    private volatile int slotHoldSeconds;
    private final int defaultSlotHoldSeconds;

    public DemoPolicy() {
        this(DEFAULT_SLOT_HOLD_SECONDS);
    }

    /** @param defaultSlotHoldSeconds 仮押さえの期限の既定値（環境変数 SLOT_HOLD_SECONDS。範囲外は 30 にする） */
    public DemoPolicy(int defaultSlotHoldSeconds) {
        this.defaultSlotHoldSeconds = isValidSlotHoldSeconds(defaultSlotHoldSeconds) ? defaultSlotHoldSeconds : DEFAULT_SLOT_HOLD_SECONDS;
        this.slotHoldSeconds = this.defaultSlotHoldSeconds;
    }

    public static boolean isValidSlotHoldSeconds(int seconds) {
        return seconds >= MIN_SLOT_HOLD_SECONDS && seconds <= MAX_SLOT_HOLD_SECONDS;
    }

    public boolean ifMatchRequired() {
        return ifMatchRequired;
    }

    public boolean taskTransitionCheck() {
        return taskTransitionCheck;
    }

    public boolean labSendsIfMatch() {
        return labSendsIfMatch;
    }

    /** 電子カルテの CT 予約画面が仮押さえを使うか。サーバーの判定には使わない（specs/003 research R-03、D-36）。 */
    public boolean ehrUsesSlotHold() {
        return ehrUsesSlotHold;
    }

    /** 仮押さえの期限（秒）。仮押さえを受け付けた時点の値で、その仮押さえの期限が決まる。 */
    public int slotHoldSeconds() {
        return slotHoldSeconds;
    }

    public void setEhrUsesSlotHold(boolean value) {
        this.ehrUsesSlotHold = value;
    }

    public void setSlotHoldSeconds(int value) {
        this.slotHoldSeconds = value;
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
        this.ehrUsesSlotHold = DEFAULT_EHR_USES_SLOT_HOLD;
        this.slotHoldSeconds = defaultSlotHoldSeconds;
    }
}
