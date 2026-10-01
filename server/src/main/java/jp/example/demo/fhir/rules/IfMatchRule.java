package jp.example.demo.fhir.rules;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.PreconditionFailedException;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.store.StoredVersion;

/** If-Match による楽観的ロック（FHIR R4 http.html「Managing Resource Contention」）。 */
public final class IfMatchRule {
    private final DemoPolicy policy;

    public IfMatchRule(DemoPolicy policy) {
        this.policy = policy;
    }

    /** `W/"3"` / `"3"` / `3` のいずれも版 "3" として解釈する。空なら null。 */
    public static String parseVersion(String ifMatchHeader) {
        if (ifMatchHeader == null) {
            return null;
        }
        String v = ifMatchHeader.trim();
        if (v.startsWith("W/")) {
            v = v.substring(2);
        }
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1);
        }
        return v.isEmpty() ? null : v;
    }

    /**
     * 既存のリソースを更新する前に呼ぶ。
     *
     * @param ifMatchVersion クライアントが指定した版（無ければ null）
     * @param current 現在の最新版
     */
    public void check(String ifMatchVersion, StoredVersion current) {
        if (ifMatchVersion == null) {
            if (policy.ifMatchRequired()) {
                throw new InvalidRequestException("更新の前提となる版（If-Match）が指定されていません");
            }
            return;
        }
        if (!ifMatchVersion.equals(Long.toString(current.versionId()))) {
            throw new PreconditionFailedException(
                    "他の利用者が先に更新しました（" + current.ref() + " の現在の版: " + current.versionId()
                            + "、指定された版: " + ifMatchVersion + "）");
        }
    }
}
