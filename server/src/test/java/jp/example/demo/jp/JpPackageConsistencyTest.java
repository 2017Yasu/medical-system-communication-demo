package jp.example.demo.jp;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * 初期データと FHIR マスタ（検査項目・固定の coding）のプロファイル・コードが、JP Core 1.2.0 / JP Terminology 2.2609.0 に
 * 実在することを確認する（research.md R-21）。パッケージは scripts/fetch-jp-packages.sh で取得する。
 * 無ければスキップする。
 */
class JpPackageConsistencyTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String JLAC10 = "http://medis.or.jp/CodeSystem/master-JLAC10-17digits";

    private static Path seedDir;
    private static Path masterFile;
    private static Set<String> profileUrls;
    private static Map<String, Set<String>> completeCodeSystems;

    @BeforeAll
    static void load() throws IOException {
        String env = System.getenv("JP_FHIR_PACKAGE_DIR");
        Path root = Path.of(env != null && !env.isBlank() ? env : "../.cache/fhir-packages");
        Path core = root.resolve("jp-core.r4#1.2.0/package");
        Path terminology = root.resolve("jpfhir-terminology#2.2609.0/package");
        Assumptions.assumeTrue(
                Files.isDirectory(core) && Files.isDirectory(terminology),
                "JP パッケージがありません。scripts/fetch-jp-packages.sh を実行してください（保存先: " + root.toAbsolutePath() + "）");
        seedDir = Path.of("src/main/resources/seed");
        masterFile = Path.of("../ui/src/master/fhir-master.json");
        Assumptions.assumeTrue(Files.exists(masterFile), "FHIR マスタ（ui/src/master/fhir-master.json）がありません");

        profileUrls = new HashSet<>();
        for (Path f : list(core, "StructureDefinition-")) {
            profileUrls.add(JSON.readTree(f.toFile()).path("url").asText());
        }
        completeCodeSystems = new HashMap<>();
        for (Path dir : List.of(core, terminology)) {
            for (Path f : list(dir, "CodeSystem-")) {
                JsonNode cs = JSON.readTree(f.toFile());
                if ("complete".equals(cs.path("content").asText())) {
                    Set<String> codes = completeCodeSystems.computeIfAbsent(cs.path("url").asText(), k -> new HashSet<>());
                    collectCodes(cs.path("concept"), codes);
                }
            }
        }
    }

    private static List<Path> list(Path dir, String prefix) throws IOException {
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().startsWith(prefix) && p.toString().endsWith(".json")).toList();
        }
    }

    private static void collectCodes(JsonNode concepts, Set<String> into) {
        for (JsonNode c : concepts) {
            into.add(c.path("code").asText());
            collectCodes(c.path("concept"), into);
        }
    }

    private static List<JsonNode> seedResources() throws IOException {
        List<JsonNode> out = new ArrayList<>();
        for (Path f : list(seedDir, "")) {
            out.add(JSON.readTree(f.toFile()));
        }
        return out;
    }

    @Test
    void packagesContainWhatWeNeed() {
        assertThat(profileUrls).contains("http://jpfhir.jp/fhir/core/StructureDefinition/JP_Patient");
        assertThat(completeCodeSystems).containsKey(JLAC10);
        assertThat(completeCodeSystems.get(JLAC10).size()).isGreaterThan(1000);
    }

    @Test
    void seedResourcesUseExistingJpCoreProfiles() throws IOException {
        List<JsonNode> seeds = seedResources();
        assertThat(seeds).isNotEmpty();
        for (JsonNode r : seeds) {
            for (JsonNode p : r.path("meta").path("profile")) {
                assertThat(profileUrls).as("%s/%s の meta.profile", r.path("resourceType").asText(), r.path("id").asText())
                        .contains(p.asText());
            }
        }
    }

    @Test
    void masterProfilesExistInJpCore() throws IOException {
        JsonNode master = JSON.readTree(masterFile.toFile());
        assertThat(master.path("profiles").size()).isGreaterThanOrEqualTo(12);
        master.path("profiles").forEach(p -> assertThat(profileUrls).contains(p.asText()));
    }

    @Test
    void codingsInSeedAndMasterExistInTheirCodeSystemsWhenThePackagesDefineThem() throws IOException {
        List<String> problems = new ArrayList<>();
        Map<String, Integer> verifiedPerSystem = new HashMap<>();
        List<JsonNode> roots = new ArrayList<>(seedResources());
        roots.add(JSON.readTree(masterFile.toFile()));
        for (JsonNode root : roots) {
            verify(root, problems, verifiedPerSystem);
        }
        assertThat(problems).as("パッケージに存在しない code").isEmpty();
        // 検証が空振りしていないこと：JLAC10 は検査項目 8 件がすべて確認される
        assertThat(verifiedPerSystem.getOrDefault(JLAC10, 0)).isEqualTo(8);
        assertThat(verifiedPerSystem).containsKey("http://jpfhir.jp/fhir/core/CodeSystem/JP_DocumentCodes_CS");
        assertThat(verifiedPerSystem).containsKey("http://jpfhir.jp/fhir/core/CodeSystem/JP_SimpleObservationCategory_CS");
        // S4（処方調剤）：薬剤・用法・区分・単位のコードが空振りせずに確認される（SC-007）
        assertThat(verifiedPerSystem.getOrDefault("http://medis.or.jp/CodeSystem/master-HOT9", 0)).isEqualTo(4);
        for (String system : List.of(
                "http://jami.jp/CodeSystem/MedicationUsage",
                "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS",
                "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationUnitMERIT9Code",
                "http://jpfhir.jp/fhir/core/CodeSystem/route-codes",
                "http://jami.jp/CodeSystem/MedicationMethodDetailUsage")) {
            assertThat(verifiedPerSystem).containsKey(system);
        }
    }

    private static void verify(JsonNode node, List<String> problems, Map<String, Integer> verified) {
        if (node.isObject()) {
            JsonNode system = node.get("system");
            JsonNode code = node.get("code");
            if (system != null && code != null && system.isTextual() && code.isTextual()
                    && completeCodeSystems.containsKey(system.asText())) {
                if (completeCodeSystems.get(system.asText()).contains(code.asText())) {
                    verified.merge(system.asText(), 1, Integer::sum);
                } else {
                    problems.add(system.asText() + "#" + code.asText());
                }
            }
            node.forEach(child -> verify(child, problems, verified));
        } else if (node.isArray()) {
            node.forEach(child -> verify(child, problems, verified));
        }
    }

    @Test
    void ctModalityUsedByS3IsInTheRadiologyModalityValueSet() throws IOException {
        JsonNode master = JSON.readTree(masterFile.toFile());
        JsonNode ct = master.path("codings").path("modalityCT");
        Path core = Path.of(System.getenv("JP_FHIR_PACKAGE_DIR") != null && !System.getenv("JP_FHIR_PACKAGE_DIR").isBlank()
                ? System.getenv("JP_FHIR_PACKAGE_DIR")
                : "../.cache/fhir-packages");
        Path vs = core.resolve("jpfhir-terminology#2.2609.0/package/ValueSet-jp-radiologymodality-vs.json");
        Assumptions.assumeTrue(Files.exists(vs), "JP_RadiologyModality_VS がありません");
        boolean found = false;
        for (JsonNode include : JSON.readTree(vs.toFile()).path("compose").path("include")) {
            if (!ct.path("system").asText().equals(include.path("system").asText())) {
                continue;
            }
            for (JsonNode concept : include.path("concept")) {
                found |= ct.path("code").asText().equals(concept.path("code").asText());
            }
        }
        assertThat(found).as("DCM#CT が JP_RadiologyModality_VS に含まれること").isTrue();
    }
}
