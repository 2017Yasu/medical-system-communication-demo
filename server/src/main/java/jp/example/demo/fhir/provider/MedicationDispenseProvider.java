package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.MedicationDispense;

public class MedicationDispenseProvider extends AbstractRepositoryProvider<MedicationDispense> {

    public MedicationDispenseProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, MedicationDispense.class);
    }

    @Read(version = true)
    public MedicationDispense read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<MedicationDispense> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<MedicationDispense> search(RequestDetails request) {
        return doSearch(request);
    }

    @Create
    public MethodOutcome create(@ResourceParam MedicationDispense resource, RequestDetails request) {
        return doCreate(resource, request);
    }

    @Update
    public MethodOutcome update(@IdParam IdType id, @ResourceParam MedicationDispense resource) {
        return doUpdate(id, resource);
    }
}
