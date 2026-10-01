package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.uhn.fhir.rest.server.exceptions.BaseServerResponseException;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.PreconditionFailedException;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.fhir.rules.TaskTransitionRule;
import jp.example.demo.fhir.system.TransactionProcessor;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.BundleType;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Specimen;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TransactionProcessorTest {
    private InMemoryRepository repo;
    private DemoPolicy policy;
    private TransactionProcessor processor;

    @BeforeEach
    void setUp() {
        repo = new InMemoryRepository();
        policy = new DemoPolicy();
        ResourceWriter writer = new ResourceWriter(new IfMatchRule(policy), new TaskTransitionRule(policy));
        processor = new TransactionProcessor(repo, writer);
    }

    private static Bundle bundle() {
        return new Bundle().setType(BundleType.TRANSACTION);
    }

    private static void post(Bundle b, String fullUrl, org.hl7.fhir.r4.model.Resource r) {
        Bundle.BundleEntryComponent e = b.addEntry();
        e.setFullUrl(fullUrl).setResource(r);
        e.getRequest().setMethod(HTTPVerb.POST).setUrl(r.fhirType());
    }

    private static Bundle.BundleEntryComponent put(Bundle b, org.hl7.fhir.r4.model.Resource r, String id, String ifMatch) {
        Bundle.BundleEntryComponent e = b.addEntry();
        e.setResource(r);
        e.getRequest().setMethod(HTTPVerb.PUT).setUrl(r.fhirType() + "/" + id);
        if (ifMatch != null) {
            e.getRequest().setIfMatch(ifMatch);
        }
        return e;
    }

    private static Task task(Task.TaskStatus status) {
        Task t = new Task();
        t.setStatus(status);
        return t;
    }

    /** 依頼 Transaction：ServiceRequest + Task + Specimen を urn:uuid で相互参照する。 */
    private Bundle orderBundle() {
        Bundle b = bundle();
        ServiceRequest sr = new ServiceRequest();
        sr.setStatus(ServiceRequest.ServiceRequestStatus.ACTIVE);
        sr.setIntent(ServiceRequest.ServiceRequestIntent.ORDER);
        sr.addSpecimen(new Reference("urn:uuid:spec-1"));
        Task t = task(Task.TaskStatus.REQUESTED);
        t.setFocus(new Reference("urn:uuid:sr-1"));
        Specimen sp = new Specimen();
        sp.addRequest(new Reference("urn:uuid:sr-1"));
        post(b, "urn:uuid:sr-1", sr);
        post(b, "urn:uuid:task-1", t);
        post(b, "urn:uuid:spec-1", sp);
        return b;
    }

    @Test
    void postsGetIdsAndUrnUuidReferencesAreRewritten() {
        Bundle response = processor.process(orderBundle());

        assertThat(response.getType()).isEqualTo(BundleType.TRANSACTIONRESPONSE);
        assertThat(response.getEntry()).hasSize(3);
        assertThat(response.getEntry()).allSatisfy(e -> {
            assertThat(e.getResponse().getStatus()).isEqualTo("201 Created");
            assertThat(e.getResponse().getLocation()).endsWith("/_history/1");
            assertThat(e.getResponse().getEtag()).isEqualTo("W/\"1\"");
            assertThat(e.getResponse().getLastModified()).isNotNull();
        });
        Task t = (Task) repo.latest("Task", "1").orElseThrow().toResource();
        assertThat(t.getFocus().getReference()).isEqualTo("ServiceRequest/1");
        ServiceRequest sr = (ServiceRequest) repo.latest("ServiceRequest", "1").orElseThrow().toResource();
        assertThat(sr.getSpecimenFirstRep().getReference()).isEqualTo("Specimen/1");
        Specimen sp = (Specimen) repo.latest("Specimen", "1").orElseThrow().toResource();
        assertThat(sp.getRequestFirstRep().getReference()).isEqualTo("ServiceRequest/1");
    }

    @Test
    void putCanReferenceResourcesPostedInTheSameBundle() {
        repo.write(tx -> tx.put(task(Task.TaskStatus.REQUESTED), "Task", "9"));
        Bundle b = bundle();
        ServiceRequest sr = new ServiceRequest();
        post(b, "urn:uuid:sr-new", sr);
        Task t = task(Task.TaskStatus.REQUESTED);
        t.setFocus(new Reference("urn:uuid:sr-new"));
        put(b, t, "9", "W/\"1\"");

        processor.process(b);

        Task updated = (Task) repo.latest("Task", "9").orElseThrow().toResource();
        assertThat(updated.getFocus().getReference()).isEqualTo("ServiceRequest/1");
        assertThat(repo.latest("Task", "9").orElseThrow().versionId()).isEqualTo(2);
    }

    @Test
    void ifMatchMismatchRollsBackEverythingWith412() {
        repo.write(tx -> tx.put(task(Task.TaskStatus.REQUESTED), "Task", "1"));
        repo.write(tx -> tx.put(task(Task.TaskStatus.REQUESTED), "Task", "1")); // 版は 2
        Bundle b = bundle();
        post(b, "urn:uuid:sp", new Specimen());
        put(b, task(Task.TaskStatus.ACCEPTED), "1", "W/\"1\""); // 古い版

        assertThatThrownBy(() -> processor.process(b))
                .isInstanceOf(PreconditionFailedException.class)
                .satisfies(e -> {
                    BaseServerResponseException ex = (BaseServerResponseException) e;
                    OperationOutcome oo = (OperationOutcome) ex.getOperationOutcome();
                    assertThat(oo.getIssueFirstRep().getExpression().get(0).getValue()).isEqualTo("Bundle.entry[1]");
                    assertThat(oo.getIssueFirstRep().getDiagnostics()).contains("他の利用者が先に更新しました");
                });
        assertThat(repo.latestOfType("Specimen")).isEmpty();
        assertThat(repo.latest("Task", "1").orElseThrow().versionId()).isEqualTo(2);
    }

    @Test
    void missingIfMatchOnUpdateIs400WhenRequired() {
        repo.write(tx -> tx.put(task(Task.TaskStatus.REQUESTED), "Task", "1"));
        Bundle b = bundle();
        put(b, task(Task.TaskStatus.ACCEPTED), "1", null);
        assertThatThrownBy(() -> processor.process(b)).isInstanceOf(InvalidRequestException.class);

        policy.setIfMatchRequired(false);
        processor.process(b); // 任意なら通る
        assertThat(repo.latest("Task", "1").orElseThrow().versionId()).isEqualTo(2);
    }

    @Test
    void invalidTaskTransitionIs422AndNothingIsApplied() {
        repo.write(tx -> tx.put(task(Task.TaskStatus.REQUESTED), "Task", "1"));
        Bundle b = bundle();
        post(b, "urn:uuid:sp", new Specimen());
        put(b, task(Task.TaskStatus.COMPLETED), "1", "W/\"1\"");
        assertThatThrownBy(() -> processor.process(b)).isInstanceOf(UnprocessableEntityException.class);
        assertThat(repo.latestOfType("Specimen")).isEmpty();
        assertThat(repo.latest("Task", "1").orElseThrow().versionId()).isEqualTo(1);
    }

    @Test
    void terminalTaskRejectsEveryUpdateInATransaction() {
        repo.write(tx -> tx.put(task(Task.TaskStatus.CANCELLED), "Task", "1"));
        repo.write(tx -> tx.put(new Specimen(), "Specimen", "1"));
        Bundle b = bundle();
        put(b, new Specimen(), "1", "W/\"1\"");
        put(b, task(Task.TaskStatus.CANCELLED), "1", "W/\"1\""); // 採血の記録（Task の businessStatus だけ変更）に相当
        assertThatThrownBy(() -> processor.process(b)).isInstanceOf(UnprocessableEntityException.class);
        assertThat(repo.latest("Specimen", "1").orElseThrow().versionId()).isEqualTo(1);
    }

    @Test
    void ifNoneExistReusesTheExistingResourceInsteadOfCreating() {
        Task existing = task(Task.TaskStatus.REQUESTED);
        existing.setOwner(new Reference("Organization/lab-dept"));
        repo.write(tx -> tx.put(existing, "Task", "5"));
        Bundle b = bundle();
        Task again = task(Task.TaskStatus.REQUESTED);
        again.setOwner(new Reference("Organization/lab-dept"));
        post(b, "urn:uuid:t", again);
        b.getEntry().get(0).getRequest().setIfNoneExist("owner=Organization/lab-dept&status=requested");
        ServiceRequest sr = new ServiceRequest();
        sr.addBasedOn(new Reference("urn:uuid:t"));
        post(b, "urn:uuid:sr", sr);

        Bundle response = processor.process(b);

        assertThat(response.getEntry().get(0).getResponse().getStatus()).isEqualTo("200 OK");
        assertThat(repo.latestOfType("Task")).hasSize(1);
        ServiceRequest saved = (ServiceRequest) repo.latest("ServiceRequest", "1").orElseThrow().toResource();
        assertThat(saved.getBasedOnFirstRep().getReference()).isEqualTo("Task/5");
    }

    @Test
    void ifNoneExistWithNoMatchCreates() {
        Bundle b = bundle();
        post(b, "urn:uuid:t", task(Task.TaskStatus.REQUESTED));
        b.getEntry().get(0).getRequest().setIfNoneExist("status=accepted");
        processor.process(b);
        assertThat(repo.latestOfType("Task")).hasSize(1);
    }

    @Test
    void deleteAndPatchEntriesAreRejectedWith400() {
        for (HTTPVerb verb : new HTTPVerb[] {HTTPVerb.DELETE, HTTPVerb.PATCH}) {
            Bundle b = bundle();
            b.addEntry().getRequest().setMethod(verb).setUrl("Task/1");
            assertThatThrownBy(() -> processor.process(b)).isInstanceOf(InvalidRequestException.class);
        }
    }

    @Test
    void nonTransactionBundleOrReadOnlyTypeIsRejected() {
        assertThatThrownBy(() -> processor.process(new Bundle().setType(BundleType.BATCH)))
                .isInstanceOf(InvalidRequestException.class);
        Bundle b = bundle();
        post(b, "urn:uuid:p", new Patient());
        assertThatThrownBy(() -> processor.process(b)).isInstanceOf(InvalidRequestException.class);
        Bundle b2 = bundle();
        post(b2, "urn:uuid:a", new Appointment());
        assertThatThrownBy(() -> processor.process(b2)).isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void getEntriesAreProcessedAfterWrites() {
        Bundle b = bundle();
        post(b, "urn:uuid:t", task(Task.TaskStatus.REQUESTED));
        b.addEntry().getRequest().setMethod(HTTPVerb.GET).setUrl("Task/1");
        Bundle response = processor.process(b);
        assertThat(response.getEntry().get(1).getResponse().getStatus()).isEqualTo("200 OK");
        assertThat(response.getEntry().get(1).getResource()).isInstanceOf(Task.class);
    }
}
