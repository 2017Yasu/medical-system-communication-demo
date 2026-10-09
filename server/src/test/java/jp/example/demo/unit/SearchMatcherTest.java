package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import jp.example.demo.fhir.search.Criteria;
import jp.example.demo.fhir.search.CriteriaParser;
import jp.example.demo.fhir.search.SearchMatcher;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Encounter;
import org.hl7.fhir.r4.model.MedicationDispense;
import org.hl7.fhir.r4.model.MedicationRequest;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Slot;
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
        assertThatThrownBy(() -> CriteriaParser.parse("Condition?status=x")).isInstanceOf(IllegalArgumentException.class);
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

    // ---- S3（specs/003 research R-01）----

    private static boolean matchesAny(org.hl7.fhir.r4.model.Resource r, String criteria) {
        return SearchMatcher.matches(r, CriteriaParser.parse(criteria).params());
    }

    @Test
    void slotScheduleAndStatus() {
        Slot slot = new Slot();
        slot.setSchedule(new Reference("Schedule/ct-1"));
        slot.setStatus(Slot.SlotStatus.BUSYTENTATIVE);
        assertThat(matchesAny(slot, "Slot?schedule=Schedule/ct-1")).isTrue();
        assertThat(matchesAny(slot, "Slot?schedule=Schedule/mri-1")).isFalse();
        assertThat(matchesAny(slot, "Slot?status=busy-tentative")).isTrue();
        assertThat(matchesAny(slot, "Slot?status=free,busy")).isFalse();
        assertThat(matchesAny(slot, "Slot?schedule=Schedule/ct-1&status=busy-tentative")).isTrue();
    }

    @Test
    void appointmentSlotStatusPatientAndPractitioner() {
        Appointment a = new Appointment();
        a.setStatus(Appointment.AppointmentStatus.BOOKED);
        a.addSlot(new Reference("Slot/ct1-1000"));
        a.addParticipant().setActor(new Reference("Patient/demo-taro"));
        a.addParticipant().setActor(new Reference("Practitioner/dr-x"));
        a.addParticipant().setActor(new Reference("Device/ct-1"));
        assertThat(matchesAny(a, "Appointment?slot=Slot/ct1-1000&status=booked")).isTrue();
        assertThat(matchesAny(a, "Appointment?slot=Slot/ct1-1030")).isFalse();
        assertThat(matchesAny(a, "Appointment?status=cancelled")).isFalse();
        assertThat(matchesAny(a, "Appointment?patient=Patient/demo-taro")).isTrue();
        assertThat(matchesAny(a, "Appointment?patient=Practitioner/dr-x")).isFalse();
        assertThat(matchesAny(a, "Appointment?practitioner=Practitioner/dr-x")).isTrue();
        assertThat(matchesAny(a, "Appointment?practitioner=Practitioner/dr-y")).isFalse();
        assertThat(matchesAny(a, "Appointment?practitioner=Patient/demo-taro")).isFalse();
    }

    @Test
    void serviceRequestCategoryMatchesCodeAndSystemCode() {
        ServiceRequest sr = new ServiceRequest();
        sr.addCategory(new CodeableConcept().addCoding(new org.hl7.fhir.r4.model.Coding("http://snomed.info/sct", "363679005", "Imaging")));
        assertThat(matchesAny(sr, "ServiceRequest?category=363679005")).isTrue();
        assertThat(matchesAny(sr, "ServiceRequest?category=108252007")).isFalse();
        assertThat(matchesAny(sr, "ServiceRequest?category=http://snomed.info/sct|363679005")).isTrue();
        assertThat(matchesAny(sr, "ServiceRequest?category=108252007,363679005")).isTrue();
    }

    @Test
    void scheduleAndDeviceSupportAllResourceSearch() {
        assertThat(jp.example.demo.fhir.search.SearchParameters.supportsType("Schedule")).isTrue();
        assertThat(jp.example.demo.fhir.search.SearchParameters.supportsType("Device")).isTrue();
        assertThat(jp.example.demo.fhir.search.SearchParameters.names("Schedule")).isEmpty();
    }

    // ---- S4 処方調剤（specs/004 research R-01） ----

    @Test
    void medicationRequestSearchParameters() {
        MedicationRequest mr = new MedicationRequest();
        mr.setStatus(MedicationRequest.MedicationRequestStatus.ACTIVE);
        mr.setRequester(new Reference("Practitioner/dr-x"));
        mr.setSubject(new Reference("Patient/demo-taro"));
        mr.setEncounter(new Reference("Encounter/adm-saburo"));
        assertThat(matchesAny(mr, "MedicationRequest?requester=Practitioner/dr-x")).isTrue();
        assertThat(matchesAny(mr, "MedicationRequest?requester=Practitioner/dr-y")).isFalse();
        assertThat(matchesAny(mr, "MedicationRequest?subject=Patient/demo-taro")).isTrue();
        assertThat(matchesAny(mr, "MedicationRequest?encounter=Encounter/adm-saburo")).isTrue();
        assertThat(matchesAny(mr, "MedicationRequest?encounter=Encounter/a,Encounter/adm-saburo")).isTrue();
        assertThat(matchesAny(mr, "MedicationRequest?status=active")).isTrue();
        assertThat(matchesAny(mr, "MedicationRequest?status=completed")).isFalse();
    }

    @Test
    void medicationDispenseSearchParameters() {
        MedicationDispense md = new MedicationDispense();
        md.addAuthorizingPrescription(new Reference("MedicationRequest/1"));
        md.setSubject(new Reference("Patient/demo-taro"));
        assertThat(matchesAny(md, "MedicationDispense?prescription=MedicationRequest/1")).isTrue();
        assertThat(matchesAny(md, "MedicationDispense?prescription=MedicationRequest/2")).isFalse();
        assertThat(matchesAny(md, "MedicationDispense?subject=Patient/demo-taro")).isTrue();
    }

    @Test
    void taskEncounterMatchesOnlyTasksThatHaveOne() {
        Task inpatient = task("Organization/pharmacy-dept", "Practitioner/dr-y", "requested");
        inpatient.setEncounter(new Reference("Encounter/adm-saburo"));
        Task outpatient = task("Organization/pharmacy-dept", "Practitioner/dr-x", "requested");
        assertThat(matches(inpatient, "Task?encounter=Encounter/adm-saburo")).isTrue();
        assertThat(matches(outpatient, "Task?encounter=Encounter/adm-saburo")).isFalse();
    }

    @Test
    void encounterSearchParameters() {
        Encounter e = new Encounter();
        e.setStatus(Encounter.EncounterStatus.INPROGRESS);
        e.setSubject(new Reference("Patient/demo-saburo"));
        e.addLocation().setLocation(new Reference("Location/ward-surgery"));
        assertThat(matchesAny(e, "Encounter?patient=Patient/demo-saburo")).isTrue();
        assertThat(matchesAny(e, "Encounter?location=Location/ward-surgery&status=in-progress")).isTrue();
        assertThat(matchesAny(e, "Encounter?location=Location/other")).isFalse();
        assertThat(jp.example.demo.fhir.search.SearchParameters.supportsType("Location")).isTrue();
    }
}
