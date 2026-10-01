package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Specimen;

public class SpecimenProvider extends AbstractRepositoryProvider<Specimen> {

    public SpecimenProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Specimen.class);
    }

    @Read(version = true)
    public Specimen read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Specimen> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Specimen> search(RequestDetails request) {
        return doSearch(request);
    }

    @Create
    public MethodOutcome create(@ResourceParam Specimen resource, RequestDetails request) {
        return doCreate(resource, request);
    }

    @Update
    public MethodOutcome update(@IdParam IdType id, @ResourceParam Specimen resource) {
        return doUpdate(id, resource);
    }
}
