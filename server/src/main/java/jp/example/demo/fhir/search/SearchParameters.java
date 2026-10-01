package jp.example.demo.fhir.search;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Task;

/**
 * 検索パラメータの抽出関数（research.md R-09）。S1 で使うものだけを、リソース種別ごとに明示的に実装する。
 * 参照は `Type/id` に正規化した文字列、トークンはコード、識別子は `system|value` と `value` の両方を返す。
 */
public final class SearchParameters {
    private static final Pattern REF = Pattern.compile("([A-Za-z]+/[^/]+?)(/_history/.*)?$");

    private static final Map<String, Map<String, Function<Resource, List<String>>>> DEFS = new LinkedHashMap<>();

    static {
        Map<String, Function<Resource, List<String>>> task = new LinkedHashMap<>();
        task.put("owner", r -> ref(((Task) r).getOwner()));
        task.put("requester", r -> ref(((Task) r).getRequester()));
        task.put("status", r -> code(((Task) r).getStatusElement().getValueAsString()));
        task.put("focus", r -> ref(((Task) r).getFocus()));
        task.put("patient", r -> ref(((Task) r).getFor()));
        DEFS.put("Task", task);

        Map<String, Function<Resource, List<String>>> sr = new LinkedHashMap<>();
        sr.put("subject", r -> ref(((ServiceRequest) r).getSubject()));
        sr.put("requester", r -> ref(((ServiceRequest) r).getRequester()));
        sr.put("status", r -> code(((ServiceRequest) r).getStatusElement().getValueAsString()));
        DEFS.put("ServiceRequest", sr);

        Map<String, Function<Resource, List<String>>> dr = new LinkedHashMap<>();
        dr.put("based-on", r -> refs(((DiagnosticReport) r).getBasedOn()));
        DEFS.put("DiagnosticReport", dr);

        Map<String, Function<Resource, List<String>>> obs = new LinkedHashMap<>();
        obs.put("based-on", r -> refs(((Observation) r).getBasedOn()));
        DEFS.put("Observation", obs);

        Map<String, Function<Resource, List<String>>> patient = new LinkedHashMap<>();
        patient.put("identifier", r -> identifiers(((Patient) r).getIdentifier()));
        DEFS.put("Patient", patient);

        for (String type : List.of("Practitioner", "PractitionerRole", "Organization", "Specimen", "Subscription")) {
            DEFS.put(type, new LinkedHashMap<>());
        }
    }

    private SearchParameters() {}

    public static boolean supportsType(String type) {
        return DEFS.containsKey(type);
    }

    public static Set<String> names(String type) {
        Map<String, Function<Resource, List<String>>> defs = DEFS.get(type);
        return defs == null ? Set.of() : defs.keySet();
    }

    public static boolean supports(String type, String name) {
        return names(type).contains(name);
    }

    public static List<String> values(Resource resource, String name) {
        Map<String, Function<Resource, List<String>>> defs = DEFS.get(resource.fhirType());
        if (defs == null || !defs.containsKey(name)) {
            throw new IllegalArgumentException(resource.fhirType() + " は検索パラメータ " + name + " に対応していません");
        }
        return defs.get(name).apply(resource);
    }

    /** `Type/id`（末尾の `/_history/n` と先頭のベース URL を除く）に正規化する。 */
    public static String normalizeRef(String reference) {
        if (reference == null) {
            return null;
        }
        Matcher m = REF.matcher(reference.trim());
        return m.find() ? m.group(1) : reference.trim();
    }

    private static List<String> ref(Reference r) {
        if (r == null || !r.hasReference()) {
            return List.of();
        }
        return List.of(normalizeRef(r.getReference()));
    }

    private static List<String> refs(List<Reference> list) {
        List<String> out = new ArrayList<>();
        for (Reference r : list) {
            out.addAll(ref(r));
        }
        return out;
    }

    private static List<String> code(String value) {
        return value == null ? List.of() : List.of(value);
    }

    private static List<String> identifiers(List<Identifier> list) {
        List<String> out = new ArrayList<>();
        for (Identifier id : list) {
            if (id.hasValue()) {
                out.add(id.getValue());
                if (id.hasSystem()) {
                    out.add(id.getSystem() + "|" + id.getValue());
                }
            }
        }
        return out;
    }
}
