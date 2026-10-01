package jp.example.demo.fhir.search;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Subscription.criteria と If-None-Exist の検索条件の解析。解析できない場合は IllegalArgumentException。 */
public final class CriteriaParser {
    private CriteriaParser() {}

    /** `Task?owner=Organization/lab-dept,PractitionerRole/tech-a&status=requested` */
    public static Criteria parse(String criteria) {
        if (criteria == null || criteria.isBlank()) {
            throw new IllegalArgumentException("criteria が空です");
        }
        int q = criteria.indexOf('?');
        String type = (q < 0 ? criteria : criteria.substring(0, q)).trim();
        String query = q < 0 ? "" : criteria.substring(q + 1);
        return parseQuery(type, query);
    }

    /** `name=v1,v2&name2=v3`（先頭の `?` は不要）。 */
    public static Criteria parseQuery(String type, String query) {
        if (!SearchParameters.supportsType(type)) {
            throw new IllegalArgumentException("リソース種別 " + type + " は検索条件に対応していません");
        }
        Map<String, List<String>> params = new LinkedHashMap<>();
        if (query != null && !query.isBlank()) {
            for (String pair : query.split("&")) {
                if (pair.isBlank()) {
                    continue;
                }
                int eq = pair.indexOf('=');
                if (eq <= 0) {
                    throw new IllegalArgumentException("検索条件を解析できません: " + pair);
                }
                String name = decode(pair.substring(0, eq));
                if (!SearchParameters.supports(type, name)) {
                    throw new IllegalArgumentException(type + " は検索パラメータ " + name + " に対応していません");
                }
                List<String> values = new ArrayList<>();
                for (String v : pair.substring(eq + 1).split(",")) {
                    if (!v.isBlank()) {
                        values.add(decode(v));
                    }
                }
                if (values.isEmpty()) {
                    throw new IllegalArgumentException("検索パラメータ " + name + " の値が空です");
                }
                params.computeIfAbsent(name, k -> new ArrayList<>()).addAll(values);
            }
        }
        return new Criteria(type, params);
    }

    private static String decode(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }
}
