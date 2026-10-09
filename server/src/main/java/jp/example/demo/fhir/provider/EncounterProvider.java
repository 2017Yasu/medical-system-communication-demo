package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Encounter;

public class EncounterProvider extends AbstractRepositoryProvider<Encounter> {

    public EncounterProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Encounter.class);
    }

    @Read(version = true)
    public Encounter read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Encounter> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Encounter> search(RequestDetails request) {
        return doSearch(request);
    }
}
