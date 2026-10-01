package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import jp.example.demo.fhir.search.Criteria;
import jp.example.demo.fhir.search.CriteriaParser;
import jp.example.demo.fhir.search.SearchMatcher;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;

class SearchMatcherTest {

    private static Task task(String owner, String requester, String status) {
        Task t = new Task();
        t.setStatus(Task.TaskStatus.fromCode(status));
        t.setOwner(new Reference(owner));
        t.setRequester(new Reference(requester));
        t.setFocus(new Reference("ServiceRequest/1"));
        t.setFor(new Reference("Patient/demo-taro"));
        return t;
    }

    private static boolean matches(Task t, String criteria) {
        Criteria c = CriteriaParser.parse(criteria);
        return SearchMatcher.matches(t, c.params());
    }

    @Test
    void ownerCriteriaWithOrValuesMatchesDepartmentOrEitherTechnician() {
        String criteria = "Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b";
        assertThat(matches(task("Organization/lab-dept", "Practitioner/dr-x", "requested"), criteria)).isTrue();
        assertThat(matches(task("PractitionerRole/tech-a", "Practitioner/dr-x", "accepted"), criteria)).isTrue();
        assertThat(matches(task("PractitionerRole/tech-b", "Practitioner/dr-x", "accepted"), criteria)).isTrue();
        assertThat(matches(task("Organization/other", "Practitioner/dr-x", "requested"), criteria)).isFalse();
    }

    @Test
    void requesterAndStatusAndFocusAndPatient() {
        Task t = task("Organization/lab-dept", "Practitioner/dr-x", "requested");
        assertThat(matches(t, "Task?requester=Practitioner/dr-x")).isTrue();
        assertThat(matches(t, "Task?requester=Practitioner/dr-y")).isFalse();
        assertThat(matches(t, "Task?status=requested")).isTrue();
        assertThat(matches(t, "Task?status=accepted,in-progress")).isFalse();
        assertThat(matches(t, "Task?focus=ServiceRequest/1")).isTrue();
        assertThat(matches(t, "Task?patient=Patient/demo-taro")).isTrue();
    }

    @Test
    void parametersAreAnded() {
        Task t = task("Organization/lab-dept", "Practitioner/dr-x", "requested");
        assertThat(matches(t, "Task?requester=Practitioner/dr-x&status=requested")).isTrue();
        assertThat(matches(t, "Task?requester=Practitioner/dr-x&status=accepted")).isFalse();
    }

    @Test
    void criteriaIsEvaluatedAgainstTheUpdatedResource() {
        // 状態が変わると外れる条件（status=requested）は、更新後のリソースでは一致しない
        String criteria = "Task?status=requested";
        assertThat(matches(task("Organization/lab-dept", "Practitioner/dr-x", "requested"), criteria)).isTrue();
        assertThat(matches(task("PractitionerRole/tech-a", "Practitioner/dr-x", "accepted"), criteria)).isFalse();
    }

    @Test
    void referencesWithBaseUrlAndVersionAreNormalized() {
        Task t = task("http://localhost:8080/fhir/Organization/lab-dept", "Practitioner/dr-x", "requested");
        assertThat(matches(t, "Task?owner=Organization/lab-dept")).isTrue();
    }

    @Test
    void serviceRequestAndBasedOnAndIdentifier() {
        ServiceRequest sr = new ServiceRequest();
        sr.setStatus(ServiceRequest.ServiceRequestStatus.ACTIVE);
        sr.setSubject(new Reference("Patient/demo-taro"));
        sr.setRequester(new Reference("Practitioner/dr-x"));
        assertThat(SearchMatcher.matches(sr, CriteriaParser.parse("ServiceRequest?subject=Patient/demo-taro&status=active").params())).isTrue();
        assertThat(SearchMatcher.matches(sr, CriteriaParser.parse("ServiceRequest?requester=Practitioner/dr-y").params())).isFalse();

        DiagnosticReport dr = new DiagnosticReport();
        dr.addBasedOn(new Reference("ServiceRequest/7"));
        assertThat(SearchMatcher.matches(dr, Map.of("based-on", List.of("ServiceRequest/7")))).isTrue();
        assertThat(SearchMatcher.matches(dr, Map.of("based-on", List.of("ServiceRequest/8")))).isFalse();

        Patient p = new Patient();
        p.addIdentifier().setSystem("https://demo.example.jp/fhir/sid/patient-number").setValue("00000001");
        assertThat(SearchMatcher.matches(p, Map.of("identifier", List.of("00000001")))).isTrue();
        assertThat(SearchMatcher.matches(p, Map.of("identifier", List.of("https://demo.example.jp/fhir/sid/patient-number|00000001")))).isTrue();
        assertThat(SearchMatcher.matches(p, Map.of("identifier", List.of("99")))).isFalse();
    }

    @Test
    void unsupportedTypeOrParameterIsRejected() {
        assertThatThrownBy(() -> CriteriaParser.parse("Encounter?status=x")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CriteriaParser.parse("Task?unknown=x")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CriteriaParser.parse("Task?status")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CriteriaParser.parse("")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parseExtractsTypeAndOrderedValues() {
        Criteria c = CriteriaParser.parse("Task?owner=Organization/lab-dept,PractitionerRole/tech-a");
        assertThat(c.type()).isEqualTo("Task");
        assertThat(c.params().get("owner")).containsExactly("Organization/lab-dept", "PractitionerRole/tech-a");
        assertThat(CriteriaParser.parse("Task").params()).isEmpty();
        assertThat(CriteriaParser.parseQuery("Task", "status=requested").params()).containsKey("status");
    }
}
