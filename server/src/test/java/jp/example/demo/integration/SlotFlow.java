package jp.example.demo.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.BundleEntryComponent;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.hl7.fhir.r4.model.Slot;
import org.hl7.fhir.r4.model.Task;

/**
 * CT 予約の各操作を、UI と同じ要求（specs/003 data-model.md §2、contracts/fhir-api.md）で組み立てて実行するテスト用の補助。
 * コードは UI と共通の FHIR マスタ（ui/src/master/fhir-master.json）から読む。どの操作も生の HTTP 応答を返す。
 */
public final class SlotFlow {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode MASTER = readMaster();
    private static final AtomicInteger ORDER_SEQ = new AtomicInteger();

    private final DemoServerExtension demo;

    public SlotFlow(DemoServerExtension demo) {
        this.demo = demo;
    }

    private static JsonNode readMaster() {
        try {
            return JSON.readTree(new File("../ui/src/master/fhir-master.json"));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Map<String, String> headers(String client, String ifMatch) {
        Map<String, String> h = new java.util.LinkedHashMap<>();
        h.put("X-Demo-Client", client);
        h.put("Content-Type", "application/fhir+json");
        if (ifMatch != null) {
            h.put("If-Match", ifMatch);
        }
        return h;
    }

    private static String json(Resource r) {
        return Fhir.json().encodeResourceToString(r);
    }

    // ---- 取得 ----

    /** 枠を選ぶ（GET）。応答の ETag が「選んだ時点の版」。 */
    public HttpResponse<String> select(String slotId) throws Exception {
        return demo.fhirRaw("GET", "/Slot/" + slotId, Map.of("X-Demo-Client", "monitor"), null);
    }

    public Slot slot(String slotId) throws Exception {
        return Fhir.json().parseResource(Slot.class, select(slotId).body());
    }

    public static String etag(HttpResponse<String> response) {
        return response.headers().firstValue("ETag").orElse(null);
    }

    /** その枠を参照する有効（booked）な予約の件数。 */
    public int bookedAppointments(String slotId) throws Exception {
        return count("/Appointment?slot=Slot/" + slotId + "&status=booked");
    }

    public int count(String query) throws Exception {
        HttpResponse<String> res = demo.fhirRaw("GET", query, Map.of("X-Demo-Client", "monitor"), null);
        return Fhir.json().parseResource(Bundle.class, res.body()).getEntry().size();
    }

    // ---- 操作 ----

    /** 仮押さえ（PUT /Slot/{id}）。current は枠を選んだときのリソース。ifMatch が null なら版の確認を付けない。 */
    public HttpResponse<String> hold(String client, Slot current, String doctorName, String ifMatch) throws Exception {
        Slot next = current.copy();
        next.setStatus(Slot.SlotStatus.BUSYTENTATIVE);
        next.setComment("仮押さえ：" + doctorName);
        return demo.fhirRaw("PUT", "/Slot/" + current.getIdElement().getIdPart(), headers(client, ifMatch), json(next));
    }

    /** 取りやめ（PUT /Slot/{id}、空きに戻す）。 */
    public HttpResponse<String> release(String client, Slot current, String ifMatch) throws Exception {
        Slot next = current.copy();
        next.setStatus(Slot.SlotStatus.FREE);
        next.setComment(null);
        return demo.fhirRaw("PUT", "/Slot/" + current.getIdElement().getIdPart(), headers(client, ifMatch), json(next));
    }

    /** 仮押さえを使う方式の確定（Slot の PUT（busy、ifMatch）+ Appointment + ServiceRequest + Task の Transaction）。 */
    public HttpResponse<String> confirm(String client, String doctorId, String patientId, Slot slot, String heldEtag)
            throws Exception {
        return post(client, booking(doctorId, patientId, slot, heldEtag));
    }

    /** 直接予約（Slot の更新を含まない Transaction）。 */
    public HttpResponse<String> bookDirect(String client, String doctorId, String patientId, Slot slot) throws Exception {
        return post(client, booking(doctorId, patientId, slot, null));
    }

    private HttpResponse<String> post(String client, Bundle bundle) throws Exception {
        return demo.fhirRaw("POST", "", headers(client, null), json(bundle));
    }

    private Bundle booking(String doctorId, String patientId, Slot slot, String heldEtag) {
        Bundle b = new Bundle().setType(Bundle.BundleType.TRANSACTION);
        Date now = new Date();
        String slotRef = "Slot/" + slot.getIdElement().getIdPart();
        String doctor = "Practitioner/" + doctorId;

        if (heldEtag != null) {
            Slot busy = slot.copy();
            busy.setStatus(Slot.SlotStatus.BUSY);
            busy.setComment(null);
            BundleEntryComponent e = b.addEntry().setResource(busy);
            e.getRequest().setMethod(HTTPVerb.PUT).setUrl(slotRef).setIfMatch(heldEtag);
        }

        Appointment a = new Appointment();
        a.setStatus(Appointment.AppointmentStatus.BOOKED);
        a.addSlot(new Reference(slotRef));
        a.setStartElement(slot.getStartElement().copy());
        a.setEndElement(slot.getEndElement().copy());
        a.addBasedOn(new Reference("urn:uuid:sr"));
        a.addParticipant().setActor(new Reference("Patient/" + patientId)).setStatus(Appointment.ParticipationStatus.ACCEPTED);
        a.addParticipant().setActor(new Reference(doctor)).setStatus(Appointment.ParticipationStatus.ACCEPTED);
        a.addParticipant().setActor(new Reference("Device/ct-1")).setStatus(Appointment.ParticipationStatus.ACCEPTED);
        post(b, "urn:uuid:appointment", a);

        ServiceRequest sr = new ServiceRequest();
        sr.getMeta().addProfile(MASTER.at("/profiles/ServiceRequest").asText());
        String letter = doctorId.equals("dr-y") ? "Y" : "X";
        sr.addIdentifier(new Identifier().setSystem(MASTER.at("/systems/orderNumber").asText())
                .setValue(String.format("R-20261002-%s%03d", letter, ORDER_SEQ.incrementAndGet())));
        sr.setStatus(ServiceRequest.ServiceRequestStatus.ACTIVE);
        sr.setIntent(ServiceRequest.ServiceRequestIntent.ORDER);
        sr.addCategory(new CodeableConcept(coding("imagingCategory")).setText("画像検査"));
        sr.setCode(new CodeableConcept(new Coding(
                MASTER.at("/systems/radiologyProcedure").asText(), "CT-CHEST", "胸部 CT（単純）")));
        sr.addOrderDetail(new CodeableConcept(coding("modalityCT")));
        sr.setSubject(new Reference("Patient/" + patientId));
        sr.setRequester(new Reference(doctor));
        sr.addPerformer(new Reference("Organization/rad-dept"));
        sr.setAuthoredOn(now);
        post(b, "urn:uuid:sr", sr);

        Task t = new Task();
        t.setStatus(Task.TaskStatus.REQUESTED);
        t.setIntent(Task.TaskIntent.ORDER);
        t.setCode(new CodeableConcept(coding("taskCode")));
        t.setFocus(new Reference("urn:uuid:sr"));
        t.setFor(new Reference("Patient/" + patientId));
        t.setRequester(new Reference(doctor));
        t.setOwner(new Reference("Organization/rad-dept"));
        t.setBusinessStatus(new CodeableConcept(new Coding(
                MASTER.at("/systems/radBusinessStatus").asText(), "booked", "予約済み")).setText("予約済み"));
        t.setAuthoredOn(now);
        t.setLastModified(now);
        post(b, "urn:uuid:task", t);
        return b;
    }

    private static Coding coding(String key) {
        JsonNode c = MASTER.at("/codings/" + key);
        return new Coding(c.get("system").asText(), c.get("code").asText(), c.get("display").asText());
    }

    private static void post(Bundle b, String fullUrl, Resource r) {
        BundleEntryComponent e = b.addEntry().setFullUrl(fullUrl).setResource(r);
        e.getRequest().setMethod(HTTPVerb.POST).setUrl(r.fhirType());
    }
}
