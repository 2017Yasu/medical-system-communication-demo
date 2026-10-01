package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Practitioner;

public class PractitionerProvider extends AbstractRepositoryProvider<Practitioner> {

    public PractitionerProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Practitioner.class);
    }

    @Read(version = true)
    public Practitioner read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Practitioner> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Practitioner> search(RequestDetails request) {
        return doSearch(request);
    }
}
