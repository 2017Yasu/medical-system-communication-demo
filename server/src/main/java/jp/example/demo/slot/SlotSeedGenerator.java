package jp.example.demo.slot;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.InstantType;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.Slot;

/**
 * 初期化のたびに作る CT-1 号機の予約枠と初期の予約（specs/003 research R-02、data-model.md §1.2）。
 * 固定の日付の JSON はいずれ過去になるため、基準日は初期化した時点の日本時間の翌日とする。
 * id は時刻から決め（日付を含めない）、テスト・手順書が日付に依存しないようにする。
 */
public final class SlotSeedGenerator {
    public static final ZoneId JAPAN = ZoneId.of("Asia/Tokyo");
    private static final LocalTime FIRST = LocalTime.of(9, 0);
    private static final int SLOT_COUNT = 6;
    private static final int MINUTES = 30;
    /** 予約済みにしておく枠の id → 予約の患者。 */
    private static final List<String[]> BOOKED = List.of(
            new String[] {"ct1-0900", "seed-0900", "Patient/demo-jiro"},
            new String[] {"ct1-1100", "seed-1100", "Patient/demo-sakurako"});

    private final Clock clock;

    public SlotSeedGenerator(Clock clock) {
        this.clock = clock;
    }

    public List<Resource> generate() {
        LocalDate day = LocalDate.now(clock.withZone(JAPAN)).plusDays(1);
        List<Resource> out = new ArrayList<>();
        Set<String> bookedSlots = Set.of(BOOKED.get(0)[0], BOOKED.get(1)[0]);
        for (int i = 0; i < SLOT_COUNT; i++) {
            ZonedDateTime start = day.atTime(FIRST).plusMinutes((long) i * MINUTES).atZone(JAPAN);
            ZonedDateTime end = start.plusMinutes(MINUTES);
            String id = "ct1-%02d%02d".formatted(start.getHour(), start.getMinute());
            Slot slot = new Slot();
            slot.setId(id);
            slot.setSchedule(new Reference("Schedule/ct-1"));
            slot.setStatus(bookedSlots.contains(id) ? Slot.SlotStatus.BUSY : Slot.SlotStatus.FREE);
            slot.setStartElement(instant(start));
            slot.setEndElement(instant(end));
            out.add(slot);
        }
        for (String[] b : BOOKED) {
            Slot slot = (Slot) out.stream().filter(r -> r.getIdElement().getIdPart().equals(b[0])).findFirst().orElseThrow();
            Appointment a = new Appointment();
            a.setId(b[1]);
            a.setStatus(Appointment.AppointmentStatus.BOOKED);
            a.addSlot(new Reference("Slot/" + b[0]));
            a.setStartElement(slot.getStartElement().copy());
            a.setEndElement(slot.getEndElement().copy());
            a.addParticipant().setActor(new Reference(b[2])).setStatus(Appointment.ParticipationStatus.ACCEPTED);
            a.addParticipant().setActor(new Reference("Device/ct-1")).setStatus(Appointment.ParticipationStatus.ACCEPTED);
            out.add(a);
        }
        return out;
    }

    /** `+09:00` 付きの instant（サーバーのタイムゾーンに依存しない）。 */
    private static InstantType instant(ZonedDateTime t) {
        return new InstantType(Date.from(t.toInstant()), ca.uhn.fhir.model.api.TemporalPrecisionEnum.SECOND, TimeZone.getTimeZone(JAPAN));
    }
}
