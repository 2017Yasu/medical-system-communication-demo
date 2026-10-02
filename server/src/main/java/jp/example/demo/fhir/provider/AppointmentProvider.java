package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.PatchTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import java.util.List;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.store.InMemoryRepository;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Appointment;

public class AppointmentProvider extends AbstractRepositoryProvider<Appointment> {

    public AppointmentProvider(InMemoryRepository repo, ResourceWriter writer) {
        super(repo, writer, Appointment.class);
    }

    @Read(version = true)
    public Appointment read(@IdParam IdType id) {
        return doRead(id);
    }

    @History
    public List<Appointment> history(@IdParam IdType id) {
        return doHistory(id);
    }

    @Search(allowUnknownParams = true)
    public List<Appointment> search(RequestDetails request) {
        return doSearch(request);
    }

    @Create
    public MethodOutcome create(@ResourceParam Appointment resource, RequestDetails request) {
        return doCreate(resource, request);
    }

    @Update
    public MethodOutcome update(@IdParam IdType id, @ResourceParam Appointment resource) {
        return doUpdate(id, resource);
    }
}
