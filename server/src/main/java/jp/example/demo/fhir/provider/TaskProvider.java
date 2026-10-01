package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Task;

public class TaskProvider extends AbstractRepositoryProvider<Task> {

    public TaskProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Task.class);
    }

    @Read(version = true)
    public Task read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Task> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Task> search(RequestDetails request) {
        return doSearch(request);
    }

    @Create
    public MethodOutcome create(@ResourceParam Task resource, RequestDetails request) {
        return doCreate(resource, request);
    }

    @Update
    public MethodOutcome update(@IdParam IdType id, @ResourceParam Task resource) {
        return doUpdate(id, resource);
    }

    @Patch
    public MethodOutcome patch(
            @IdParam IdType id, PatchTypeEnum patchType, @ResourceParam String body, RequestDetails request) {
        if (patchType != PatchTypeEnum.JSON_PATCH) {
            throw new ca.uhn.fhir.rest.server.exceptions.InvalidRequestException(
                    "PATCH は application/json-patch+json のみ対応しています");
        }
        String ifMatch = ifMatchOf(request); // HAPI は PATCH では If-Match を ID に設定しない（research.md R-07）
        ResourceWriter.Result r = repo.write(tx -> writer.patch(tx, "Task", id.getIdPart(), body, ifMatch));
        // HAPI は PATCH の応答に ETag / Location を付けないため、契約（contracts/fhir-api.md）どおりに付ける
        var v = r.version();
        request.getResponse().addHeader("ETag", v.etag());
        request.getResponse().addHeader("Content-Location", request.getFhirServerBase() + "/" + v.versionRef());
        request.getResponse().addHeader("Location", request.getFhirServerBase() + "/" + v.versionRef());
        return outcome(r);
    }
}
