package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Schedule;

public class ScheduleProvider extends AbstractRepositoryProvider<Schedule> {

    public ScheduleProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Schedule.class);
    }

    @Read(version = true)
    public Schedule read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Schedule> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Schedule> search(RequestDetails request) {
        return doSearch(request);
    }
}
