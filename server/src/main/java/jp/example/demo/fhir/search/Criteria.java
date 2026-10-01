package jp.example.demo.fhir.search;

import java.util.List;
import java.util.Map;

/** 検索 URL（`Type?name=v1,v2&...`）を解析した結果。 */
public record Criteria(String type, Map<String, List<String>> params) {}
