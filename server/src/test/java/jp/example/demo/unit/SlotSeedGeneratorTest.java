package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import jp.example.demo.Fhir;
import jp.example.demo.slot.SlotSeedGenerator;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.Slot;
import org.junit.jupiter.api.Test;

class SlotSeedGeneratorTest {
    // 日本時間では 2026-10-03 00:30（UTC では 10-02 15:30）。基準日は日本時間の翌日の 10-04。
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-02T15:30:00Z"), ZoneOffset.UTC);

    private final List<Resource> generated = new SlotSeedGenerator(CLOCK).generate();

    private Map<String, Slot> slots() {
        return generated.stream()
                .filter(r -> r instanceof Slot)
                .map(r -> (Slot) r)
                .collect(Collectors.toMap(s -> s.getIdElement().getIdPart(), Function.identity()));
    }

    private static String json(Resource r) {
        return Fhir.json().encodeResourceToString(r);
    }

    @Test
    void generatesSixThirtyMinuteSlotsOnTheNextJapaneseDay() {
        Map<String, Slot> slots = slots();
        assertThat(slots.keySet())
                .containsExactlyInAnyOrder("ct1-0900", "ct1-0930", "ct1-1000", "ct1-1030", "ct1-1100", "ct1-1130");
        Slot s = slots.get("ct1-1000");
        assertThat(json(s)).contains("\"start\":\"2026-10-04T10:00:00+09:00\"").contains("\"end\":\"2026-10-04T10:30:00+09:00\"");
        assertThat(s.getSchedule().getReference()).isEqualTo("Schedule/ct-1");
        assertThat(json(slots.get("ct1-1130"))).contains("\"end\":\"2026-10-04T12:00:00+09:00\"");
    }

    @Test
    void nineAndElevenAreBookedAndTheRestAreFreeWithoutComment() {
        Map<String, Slot> slots = slots();
        assertThat(slots.get("ct1-0900").getStatus()).isEqualTo(Slot.SlotStatus.BUSY);
        assertThat(slots.get("ct1-1100").getStatus()).isEqualTo(Slot.SlotStatus.BUSY);
        for (String id : List.of("ct1-0930", "ct1-1000", "ct1-1030", "ct1-1130")) {
            assertThat(slots.get(id).getStatus()).as(id).isEqualTo(Slot.SlotStatus.FREE);
        }
        assertThat(slots.values()).allSatisfy(s -> assertThat(s.hasComment()).isFalse());
    }

    @Test
    void generatesTwoInitialAppointmentsForTheBookedSlots() {
        Map<String, Appointment> byId = generated.stream()
                .filter(r -> r instanceof Appointment)
                .map(r -> (Appointment) r)
                .collect(Collectors.toMap(a -> a.getIdElement().getIdPart(), Function.identity()));
        assertThat(byId.keySet()).containsExactlyInAnyOrder("seed-0900", "seed-1100");
        Appointment a = byId.get("seed-0900");
        assertThat(a.getStatus()).isEqualTo(Appointment.AppointmentStatus.BOOKED);
        assertThat(a.getSlotFirstRep().getReference()).isEqualTo("Slot/ct1-0900");
        assertThat(json(a)).contains("\"start\":\"2026-10-04T09:00:00+09:00\"").contains("\"end\":\"2026-10-04T09:30:00+09:00\"");
        assertThat(a.getParticipant()).extracting(p -> p.getActor().getReference())
                .containsExactlyInAnyOrder("Patient/demo-jiro", "Device/ct-1");
        assertThat(a.getParticipant()).allSatisfy(p -> assertThat(p.getStatus().toCode()).isEqualTo("accepted"));
        assertThat(byId.get("seed-1100").getSlotFirstRep().getReference()).isEqualTo("Slot/ct1-1100");
        assertThat(byId.get("seed-1100").getParticipant()).extracting(p -> p.getActor().getReference())
                .contains("Patient/demo-sakurako");
    }
}
