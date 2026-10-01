package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import jp.example.demo.fhir.patch.JsonPatchApplier;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;

class JsonPatchApplierTest {

    private static Task task() {
        Task t = new Task();
        t.setId("Task/1");
        t.setStatus(Task.TaskStatus.REQUESTED);
        t.setBusinessStatus(new CodeableConcept().setText("採取済"));
        t.setOwner(new Reference("Organization/lab-dept"));
        return t;
    }

    @Test
    void replaceAndAddAreApplied() {
        String patch = """
            [
              {"op":"replace","path":"/status","value":"accepted"},
              {"op":"replace","path":"/owner","value":{"reference":"PractitionerRole/tech-a"}},
              {"op":"add","path":"/statusReason","value":{"text":"理由"}}
            ]""";
        Task result = (Task) JsonPatchApplier.apply(task(), patch);
        assertThat(result.getStatus()).isEqualTo(Task.TaskStatus.ACCEPTED);
        assertThat(result.getOwner().getReference()).isEqualTo("PractitionerRole/tech-a");
        assertThat(result.getStatusReason().getText()).isEqualTo("理由");
        assertThat(result.getBusinessStatus().getText()).isEqualTo("採取済"); // 触れていない要素は残る
    }

    @Test
    void changingResourceTypeOrIdIsRejectedWith422() {
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "[{\"op\":\"replace\",\"path\":\"/id\",\"value\":\"2\"}]"))
                .isInstanceOf(UnprocessableEntityException.class);
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "[{\"op\":\"replace\",\"path\":\"/resourceType\",\"value\":\"Patient\"}]"))
                .isInstanceOf(UnprocessableEntityException.class);
    }

    @Test
    void unappliablePatchIsRejectedWith422() {
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "[{\"op\":\"replace\",\"path\":\"/doesNotExist\",\"value\":\"x\"}]"))
                .isInstanceOf(UnprocessableEntityException.class);
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "[{\"op\":\"test\",\"path\":\"/status\",\"value\":\"completed\"}]"))
                .isInstanceOf(UnprocessableEntityException.class);
    }

    @Test
    void malformedBodyIs400AndInvalidPatchShapeIs422() {
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "not json")).isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> JsonPatchApplier.apply(task(), "{\"op\":\"replace\"}")).isInstanceOf(UnprocessableEntityException.class);
    }
}
