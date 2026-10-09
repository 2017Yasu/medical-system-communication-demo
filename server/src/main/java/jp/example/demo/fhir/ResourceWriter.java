package jp.example.demo.fhir;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.PreconditionFailedException;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import jp.example.demo.fhir.patch.JsonPatchApplier;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.fhir.rules.TaskTransitionRule;
import jp.example.demo.fhir.search.Criteria;
import jp.example.demo.fhir.search.CriteriaParser;
import jp.example.demo.fhir.search.SearchMatcher;
import jp.example.demo.store.InMemoryRepository.WriteSession;
import jp.example.demo.store.StoredVersion;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.Subscription;
import org.hl7.fhir.r4.model.Task;

/**
 * リソースの書き込み規則をまとめたクラス。単一の create / update / patch と Transaction の各エントリが同じ規則
 * （If-Match、If-None-Exist、Task 状態遷移、Subscription の検証）を通る。
 */
public final class ResourceWriter {
    /** API から書き込める種別（data-model.md / contracts/fhir-api.md）。それ以外は読み取り専用。 */
    public static final Set<String> WRITABLE =
            Set.of("ServiceRequest", "Task", "Specimen", "Observation", "DiagnosticReport", "Subscription", "Slot", "Appointment",
                    "MedicationRequest", "MedicationDispense");

    public record Result(StoredVersion version, boolean created) {}

    private final IfMatchRule ifMatchRule;
    private final TaskTransitionRule transitionRule;

    public ResourceWriter(IfMatchRule ifMatchRule, TaskTransitionRule transitionRule) {
        this.ifMatchRule = ifMatchRule;
        this.transitionRule = transitionRule;
    }

    public static void requireWritable(String type) {
        if (!WRITABLE.contains(type)) {
            throw new InvalidRequestException("リソース種別 " + type + " は API から書き込めません");
        }
    }

    /** If-None-Exist の条件に一致する既存リソース。複数一致は 412。 */
    public Optional<StoredVersion> findExisting(WriteSession tx, String type, String ifNoneExist) {
        if (ifNoneExist == null || ifNoneExist.isBlank()) {
            return Optional.empty();
        }
        Criteria c;
        try {
            String q = ifNoneExist.startsWith("?") ? ifNoneExist.substring(1) : ifNoneExist;
            int idx = q.indexOf('?');
            if (idx >= 0) {
                q = q.substring(idx + 1);
            }
            c = CriteriaParser.parseQuery(type, q);
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("If-None-Exist を解釈できません: " + e.getMessage());
        }
        List<StoredVersion> matches = tx.latestOfType(type).stream()
                .filter(v -> SearchMatcher.matches(v.toResource(), c.params()))
                .toList();
        if (matches.size() > 1) {
            throw new PreconditionFailedException(
                    "If-None-Exist の条件に複数の " + type + " が一致しました（" + matches.size() + " 件）");
        }
        return matches.stream().findFirst();
    }

    /** 新規作成（ID はサーバーが採番）。If-None-Exist に一致する既存があれば作成せず既存を返す。 */
    public Result create(WriteSession tx, Resource resource, String ifNoneExist) {
        String type = resource.fhirType();
        requireWritable(type);
        Optional<StoredVersion> existing = findExisting(tx, type, ifNoneExist);
        if (existing.isPresent()) {
            return new Result(existing.get(), false);
        }
        return createWithId(tx, resource, tx.newId(type));
    }

    /** ID が決まっている新規作成（Transaction で事前に ID を割り当てた POST 用）。 */
    public Result createWithId(WriteSession tx, Resource resource, String id) {
        String type = resource.fhirType();
        requireWritable(type);
        prepare(null, resource);
        return new Result(tx.put(resource, type, id), true);
    }

    /** 更新。存在しない ID への PUT は新規作成（If-Match 不要）。 */
    public Result update(WriteSession tx, Resource resource, String id, String ifMatchVersion) {
        String type = resource.fhirType();
        requireWritable(type);
        Optional<StoredVersion> current = tx.latest(type, id);
        if (current.isEmpty()) {
            prepare(null, resource);
            return new Result(tx.put(resource, type, id), true);
        }
        ifMatchRule.check(ifMatchVersion, current.get());
        prepare(current.get().toResource(), resource);
        return new Result(tx.put(resource, type, id), false);
    }

    /** JSON Patch による更新（Task のみ）。 */
    public Result patch(WriteSession tx, String type, String id, String patchBody, String ifMatchVersion) {
        requireWritable(type);
        StoredVersion current = tx.latest(type, id)
                .orElseThrow(() -> new ResourceNotFoundException(type + "/" + id + " が見つかりません"));
        ifMatchRule.check(ifMatchVersion, current);
        Resource before = current.toResource();
        Resource after = JsonPatchApplier.apply(before, patchBody);
        prepare(before, after);
        return new Result(tx.put(after, type, id), false);
    }

    private void prepare(Resource previous, Resource next) {
        if (next instanceof Task nextTask && previous instanceof Task prevTask) {
            transitionRule.check(prevTask, nextTask);
        }
        if (next instanceof Subscription sub) {
            validateSubscription(sub);
            sub.setStatus(Subscription.SubscriptionStatus.ACTIVE);
        }
    }

    private static void validateSubscription(Subscription sub) {
        if (sub.getChannel().getType() != Subscription.SubscriptionChannelType.WEBSOCKET) {
            throw new UnprocessableEntityException("Subscription の channel.type は websocket のみ対応しています");
        }
        try {
            CriteriaParser.parse(sub.getCriteria());
        } catch (IllegalArgumentException e) {
            throw new UnprocessableEntityException("Subscription の criteria を解釈できません: " + e.getMessage());
        }
    }
}
