package jp.example.demo.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import jp.example.demo.integration.LabFlow.Ids;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Specimen;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** US5：取消・受付不可・再検・一部先行報告（docs/02 S1 バリエーション、data-model.md §3）。 */
class S1VariationsIT {
    @RegisterExtension
    static DemoServerExtension demo = new DemoServerExtension();

    private static int repeat() {
        return Integer.getInteger("s1.repeat", 1);
    }

    @Test
    void cancelRevokesTheRequestAndCancelsTheTaskInOneTransaction() throws Exception {
        for (int run = 0; run < repeat(); run++) {
            demo.reset();
            LabFlow flow = new LabFlow(demo);
            Ids ids = flow.order("demo-taro", "CBC");
            flow.collect(ids);
            assertThat(flow.accept(ids, "tech-a").statusCode()).isEqualTo(200);

            flow.cancel(ids);

            assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.REVOKED);
            Task t = flow.task(ids.task());
            assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.CANCELLED);
            // 取消は 1 つの Transaction：両方が同じ時点で更新されている
            assertThat(flow.serviceRequest(ids.sr()).getMeta().getVersionId()).isEqualTo("2");
            assertThat(t.getMeta().getVersionId()).isEqualTo("4"); // 依頼・採血・受付・取消
            // 取消後は、測定開始も、採血の記録も、結果の報告もできない（終了状態の作業は一切更新できない）
            assertThat(flow.start(ids, "tech-a").statusCode()).isEqualTo(422);
            assertThat(flow.reject(ids, "tech-a", "x").statusCode()).isEqualTo(422);
            org.junit.jupiter.api.Assertions.assertThrows(ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException.class, () -> flow.collect(ids));
            org.junit.jupiter.api.Assertions.assertThrows(ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException.class, () -> flow.reportAll(ids, "tech-a"));
            assertThat(flow.reports(ids.sr())).isEmpty();
        }
    }

    @Test
    void cancelBeforeCollectionAlsoWorks() throws Exception {
        LabFlow flow = new LabFlow(demo);
        Ids ids = flow.order("demo-taro", "BIO");
        flow.cancel(ids);
        assertThat(flow.task(ids.task()).getStatus()).isEqualTo(Task.TaskStatus.CANCELLED);
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.REVOKED);
    }

    @Test
    void cancelWithAStaleVersionIsRejectedAndNothingChanges() throws Exception {
        LabFlow flow = new LabFlow(demo);
        Ids ids = flow.order("demo-taro", "CBC");
        ServiceRequest sr = flow.serviceRequest(ids.sr());
        Task stale = flow.task(ids.task());
        flow.collect(ids); // Task が先に更新される
        sr.setStatus(ServiceRequest.ServiceRequestStatus.REVOKED);
        stale.setStatus(Task.TaskStatus.CANCELLED);
        org.hl7.fhir.r4.model.Bundle b = new org.hl7.fhir.r4.model.Bundle().setType(org.hl7.fhir.r4.model.Bundle.BundleType.TRANSACTION);
        b.addEntry().setResource(sr).getRequest().setMethod(org.hl7.fhir.r4.model.Bundle.HTTPVerb.PUT).setUrl("ServiceRequest/" + ids.sr()).setIfMatch(LabFlow.etag(sr));
        b.addEntry().setResource(stale).getRequest().setMethod(org.hl7.fhir.r4.model.Bundle.HTTPVerb.PUT).setUrl("Task/" + ids.task()).setIfMatch(LabFlow.etag(stale));
        var res = demo.fhirRaw("POST", "", java.util.Map.of(), jp.example.demo.Fhir.json().encodeResourceToString(b));
        assertThat(res.statusCode()).isEqualTo(412);
        assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
        assertThat(flow.task(ids.task()).getStatus()).isEqualTo(Task.TaskStatus.REQUESTED);
    }

    @Test
    void rejectKeepsTheRequestActiveAndRecordsTheReason() throws Exception {
        for (int run = 0; run < repeat(); run++) {
            demo.reset();
            LabFlow flow = new LabFlow(demo);
            Ids ids = flow.order("demo-taro", "CBC");
            flow.collect(ids);

            assertThat(flow.reject(ids, "tech-a", "溶血のため再採血が必要").statusCode()).isEqualTo(200);

            Task t = flow.task(ids.task());
            assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.REJECTED);
            assertThat(t.getStatusReason().getText()).isEqualTo("溶血のため再採血が必要");
            assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
            // 受付不可は終了状態
            assertThat(flow.accept(ids, "tech-a").statusCode()).isEqualTo(422);
        }
    }

    @Test
    void rerunGoesThroughOnHoldAndBackToInProgressThenCompletes() throws Exception {
        for (int run = 0; run < repeat(); run++) {
            demo.reset();
            LabFlow flow = new LabFlow(demo);
            Ids ids = flow.order("demo-taro", "CBC");
            flow.collect(ids);
            flow.accept(ids, "tech-a");
            flow.start(ids, "tech-a");

            List<java.net.http.HttpResponse<String>> r = flow.rerun(ids, "tech-a");
            assertThat(r).extracting(java.net.http.HttpResponse::statusCode).containsExactly(200, 200);
            // 履歴：requested → … → in-progress → on-hold(再検中) → in-progress(測定中)
            var history = flow.client("monitor").history().onInstance(new org.hl7.fhir.r4.model.IdType("Task", ids.task()))
                    .andReturnBundle(org.hl7.fhir.r4.model.Bundle.class).execute();
            List<String> trail = history.getEntry().stream().map(e -> {
                Task v = (Task) e.getResource();
                return v.getStatus().toCode() + "/" + LabFlow.businessStatusCode(v);
            }).toList();
            assertThat(trail).startsWith("in-progress/measuring", "on-hold/rerun", "in-progress/measuring");

            flow.reportAll(ids, "tech-a");
            assertThat(flow.task(ids.task()).getStatus()).isEqualTo(Task.TaskStatus.COMPLETED);
            assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.COMPLETED);
        }
    }

    @Test
    void partialReportLeavesTaskAndRequestOpenAndFinalReportCompletesThem() throws Exception {
        for (int run = 0; run < repeat(); run++) {
            demo.reset();
            LabFlow flow = new LabFlow(demo);
            Ids ids = flow.order("demo-taro", "CBC", "BIO");
            flow.collect(ids);
            flow.accept(ids, "tech-a");
            flow.start(ids, "tech-a");

            // 血算だけ先に報告
            flow.reportPartial(ids, "tech-a", List.of("WBC", "RBC", "Hb", "Ht", "PLT"));
            List<DiagnosticReport> reports = flow.reports(ids.sr());
            assertThat(reports).hasSize(1);
            assertThat(reports.get(0).getStatus()).isEqualTo(DiagnosticReport.DiagnosticReportStatus.PARTIAL);
            assertThat(reports.get(0).getResult()).hasSize(5);
            Task t = flow.task(ids.task());
            assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.INPROGRESS);
            assertThat(LabFlow.businessStatusCode(t)).isEqualTo("partial-reported");
            assertThat(t.getOutputFirstRep().hasValue()).isTrue();
            assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
            assertThat(flow.observations(ids.sr())).hasSize(5);

            // 残り（生化学）を報告 → 同じ DiagnosticReport が final になり、作業と依頼が完了
            flow.reportAll(ids, "tech-a");
            reports = flow.reports(ids.sr());
            assertThat(reports).hasSize(1);
            assertThat(reports.get(0).getStatus()).isEqualTo(DiagnosticReport.DiagnosticReportStatus.FINAL);
            assertThat(reports.get(0).getResult()).hasSize(8);
            assertThat(reports.get(0).getMeta().getVersionId()).isEqualTo("2");
            t = flow.task(ids.task());
            assertThat(t.getStatus()).isEqualTo(Task.TaskStatus.COMPLETED);
            assertThat(LabFlow.businessStatusCode(t)).isEqualTo("reported");
            assertThat(flow.serviceRequest(ids.sr()).getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.COMPLETED);
            assertThat(flow.observations(ids.sr())).hasSize(8);
            Specimen sp = flow.specimen(ids.specimen());
            assertThat(sp.getStatus()).isEqualTo(Specimen.SpecimenStatus.AVAILABLE);
        }
    }
}
