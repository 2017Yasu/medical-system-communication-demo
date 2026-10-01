package jp.example.demo.fhir.search;

import java.util.List;
import java.util.Map;
import org.hl7.fhir.r4.model.Resource;

/** 検索条件の照合。パラメータ同士は AND、1 つのパラメータの複数の値（カンマ区切り）は OR。 */
public final class SearchMatcher {
    private SearchMatcher() {}

    public static boolean matches(Resource resource, Map<String, List<String>> params) {
        for (Map.Entry<String, List<String>> p : params.entrySet()) {
            List<String> actual = SearchParameters.values(resource, p.getKey());
            boolean any = false;
            for (String wanted : p.getValue()) {
                String normalized = looksLikeReference(wanted) ? SearchParameters.normalizeRef(wanted) : wanted;
                if (actual.contains(normalized) || actual.contains(wanted)) {
                    any = true;
                    break;
                }
            }
            if (!any) {
                return false;
            }
        }
        return true;
    }

    private static boolean looksLikeReference(String value) {
        int slash = value.indexOf('/');
        return slash > 0 && Character.isUpperCase(value.charAt(0));
    }
}
