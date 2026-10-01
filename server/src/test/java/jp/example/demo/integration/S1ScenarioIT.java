package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import jp.example.demo.integration.LabFlow.Ids;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Specimen;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** US1：docs/02 S1 の 8 ステップを再現し、各ステップ後の状態が data-model.md §3.5 と一致することを確認する（SC-004）。 */
class S1ScenarioIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    @Test
    void mainFlowFollowsTheStateTable() throws Exception {
        int repeat = Integer.getInteger("s1.repeat", 1);
        for (int run = 1; run <= repeat; run++) {
            demo.reset();
            runOnce(run);
        }
    }

    private void runOnce(int run) throws Exception {
        LabFlow flow = new LabFlow(demo);

        // 1. 医師が血算・生化学を依頼
        Ids ids = flow.order("demo-taro", "CBC", "BIO");
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).as("run %d: step1 SR", run).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
        Task t = flow.task(ids.task());
        assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
        assertThat(LabFlow.businessStatusCode(t)).isEqualTo("not-collected");
        assertThat(t.getOwner().getReference()).isEqualTo("Organization/lab-dept");
        assertThat(t.getFocus().getReference()).isEqualTo("ServiceRequest/" + ids.sr());
        Specimen sp = flow.specimen(ids.specimen());
        assertThat(sp.hasStatus()).isFalse();
        assertThat(sp.getCollection().hasCollector()).isFalse();
        assertThat(flow.serviceRequest(ids.sr()).getOrderDetail()).hasSize(2);

        // 3. 看護師 D が採血を記録（Task の status は変わらない）
        flow.collect(ids);
        t = flow.task(ids.task());
        assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
        assertThat(LabFlow.businessStatusCode(t)).isEqualTo("collected");
        sp = flow.specimen(ids.specimen());
        assertThat(sp.getStatus()).isEqualTo(Specimen.SpecimenStatus.AVAILABLE);
        assertThat(sp.getCollection().getCollector().getReference()).isEqualTo("Practitioner/ns-d");
        assertThat(sp.getCollection().hasCollected()).isTrue();
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);

        // 4. 技師 A が受付（status・owner・businessStatus を 1 回の PATCH で）
        HttpResponse<String> accept = flow.accept(ids, "tech-a");
        assertThat(accept.statusCode()).isEqualTo(200);
        t = flow.task(ids.task());
        assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.ACCEPTED);
        assertThat(LabFlow.businessStatusCode(t)).isEqualTo("received");
        assertThat(t.getOwner().getReference()).isEqualTo("PractitionerRole/tech-a");
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);

        // 6. 測定開始
        assertThat(flow.start(ids, "tech-a").statusCode()).isEqualTo(200);
        t = flow.task(ids.task());
        assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.INPROGRESS);
        assertThat(LabFlow.businessStatusCode(t)).isEqualTo("measuring");
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).as("結果報告前は依頼は有効のまま").isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
        assertThat(flow.reports(ids.sr())).isEmpty();

        // 7. 全項目の結果を承認・報告（結果・報告・作業・依頼を 1 つの Transaction で）
        flow.reportAll(ids, "tech-a");
        t = flow.task(ids.task());
        assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.COMPLETED);
        assertThat(LabFlow.businessStatusCode(t)).isEqualTo("reported");
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.COMPLETED);
        DiagnosticReport dr = flow.reports(ids.sr()).get(0);
        assertThat(dr.getStatus()).isEqualTo(DiagnosticReport.DiagnosticReportStatus.FINAL);
        assertThat(dr.getResult()).hasSize(8);
        assertThat(t.getOutputFirstRep().hasValue()).isTrue();
        assertThat(((org.hl7.fhir.r4.model.Reference) flow.task(ids.task()).getOutputFirstRep().getValue()).getReference()).isEqualTo("DiagnosticReport/" + dr.getIdElement().getIdPart());

        // 8. 医師が結果を確認：値・単位・基準値・H/L
        var observations = flow.observations(ids.sr());
        assertThat(observations).hasSize(8);
        Observation wbc = observations.stream().filter(o -> "白血球数".equals(o.getCode().getText())).findFirst().orElseThrow();
        assertThat(wbc.getValueQuantity().getValue().doubleValue()).isEqualTo(9.8);
        assertThat(wbc.getValueQuantity().getCode()).isEqualTo("10*3/uL");
        assertThat(wbc.getReferenceRangeFirstRep().getHigh().getValue().doubleValue()).isEqualTo(8.6);
        assertThat(wbc.getInterpretationFirstRep().getCodingFirstRep().getCode()).isEqualTo("H");
        Observation alt = observations.stream().filter(o -> "ALT".equals(o.getCode().getText())).findFirst().orElseThrow();
        assertThat(alt.getInterpretationFirstRep().getCodingFirstRep().getCode()).isEqualTo("H");
        Observation hb = observations.stream().filter(o -> "ヘモグロビン".equals(o.getCode().getText())).findFirst().orElseThrow();
        assertThat(hb.getInterpretationFirstRep().getCodingFirstRep().getCode()).isEqualTo("N");
        assertThat(observations).allSatisfy(o -> assertThat(o.getStatus()).isEqualTo(Observation.ObservationStatus.FINAL));

        // 完了後の Task は変更できない（終了状態）
        assertThat(flow.start(ids, "tech-a").statusCode()).isEqualTo(422);
    }
}
