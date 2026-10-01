package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.PreconditionFailedException;
import java.time.Instant;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.store.StoredVersion;
import org.junit.jupiter.api.Test;

class IfMatchRuleTest {
    private static final StoredVersion V3 = new StoredVersion("Task", "1", 3, Instant.now(), "{}");

    @Test
    void parsesWeakAndStrongAndBareFormats() {
        assertThat(IfMatchRule.parseVersion("W/\"3\"")).isEqualTo("3");
        assertThat(IfMatchRule.parseVersion("\"3\"")).isEqualTo("3");
        assertThat(IfMatchRule.parseVersion("3")).isEqualTo("3");
        assertThat(IfMatchRule.parseVersion(" W/\"12\" ")).isEqualTo("12");
        assertThat(IfMatchRule.parseVersion("")).isNull();
        assertThat(IfMatchRule.parseVersion(null)).isNull();
    }

    @Test
    void missingHeaderIs400WhenRequired() {
        DemoPolicy policy = new DemoPolicy();
        assertThat(policy.ifMatchRequired()).isTrue(); // 既定は安全側（原則 IV）
        assertThatThrownBy(() -> new IfMatchRule(policy).check(null, V3))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("If-Match");
    }

    @Test
    void missingHeaderIsAllowedWhenPolicyIsOptional() {
        DemoPolicy policy = new DemoPolicy();
        policy.setIfMatchRequired(false);
        assertThatCode(() -> new IfMatchRule(policy).check(null, V3)).doesNotThrowAnyException();
    }

    @Test
    void mismatchedVersionIs412EvenWhenOptional() {
        DemoPolicy policy = new DemoPolicy();
        policy.setIfMatchRequired(false);
        assertThatThrownBy(() -> new IfMatchRule(policy).check("2", V3))
                .isInstanceOf(PreconditionFailedException.class)
                .hasMessageContaining("他の利用者が先に更新しました");
    }

    @Test
    void matchingVersionPasses() {
        assertThatCode(() -> new IfMatchRule(new DemoPolicy()).check("3", V3)).doesNotThrowAnyException();
    }
}
