import type { Slot } from "fhir/r4";
import { describe, expect, it } from "vitest";
import type { Versioned } from "../../src/fhir/client";
import { reduceBookingDraft, remainingSeconds, type BookingDraft } from "../../src/systems/ehr/bookingDraft";

const slot = (version: number, status: Slot["status"] = "free", lastUpdated?: string): Versioned<Slot> => ({
  resource: {
    resourceType: "Slot",
    id: "ct1-1000",
    meta: { versionId: String(version), ...(lastUpdated ? { lastUpdated } : {}) },
    schedule: { reference: "Schedule/ct-1" },
    status,
    start: "2026-10-03T10:00:00+09:00",
    end: "2026-10-03T10:30:00+09:00",
  },
  etag: `W/"${version}"`,
});

const select = (mode: "hold" | "direct" = "hold") => ({
  type: "select" as const,
  slot: slot(1),
  mode,
  patientId: "demo-taro",
  procedureCode: "CT-CHEST",
});

const opened = (mode: "hold" | "direct" = "hold"): BookingDraft => reduceBookingDraft(null, select(mode))!;

describe("reduceBookingDraft (data-model.md §7)", () => {
  it("opens when a slot is selected, keeping the selected version and the mode of that moment", () => {
    const draft = opened();
    expect(draft.slot.etag).toBe('W/"1"');
    expect(draft.held).toBeNull();
    expect(draft.mode).toBe("hold");
    expect(draft.patientId).toBe("demo-taro");
    expect(draft.procedureCode).toBe("CT-CHEST");
    expect(opened("direct").mode).toBe("direct");
  });

  it("moves to holding when the hold succeeded, keeping the held version, time and seconds", () => {
    const draft = reduceBookingDraft(opened(), { type: "held", held: slot(2, "busy-tentative", "2026-10-02T10:00:00.000+09:00"), holdSeconds: 30 })!;
    expect(draft.held?.etag).toBe('W/"2"');
    expect(draft.heldAt).toBe("2026-10-02T10:00:00.000+09:00");
    expect(draft.holdSeconds).toBe(30);
    expect(draft.slot.etag).toBe('W/"1"');
  });

  it("closes on every end of the flow", () => {
    const holding = reduceBookingDraft(opened(), { type: "held", held: slot(2, "busy-tentative"), holdSeconds: 30 });
    for (const reason of ["hold-conflict", "booked", "expired", "released", "cancelled", "error"] as const) {
      expect(reduceBookingDraft(opened(), { type: "close", reason })).toBeNull();
      expect(reduceBookingDraft(holding, { type: "close", reason })).toBeNull();
    }
  });

  it("closes on demo.reset", () => {
    expect(reduceBookingDraft(opened(), { type: "reset" })).toBeNull();
  });

  it("does not change when the list is refreshed by a notification", () => {
    const holding = reduceBookingDraft(opened(), { type: "held", held: slot(2, "busy-tentative"), holdSeconds: 30 });
    expect(reduceBookingDraft(holding, { type: "refresh" })).toBe(holding);
    const selected = opened();
    expect(reduceBookingDraft(selected, { type: "refresh" })).toBe(selected);
  });

  it("keeps the mode of the moment the slot was selected even if the policy changes afterwards", () => {
    const draft = opened("hold");
    const edited = reduceBookingDraft(draft, { type: "edit", patientId: "demo-hanako" })!;
    expect(edited.mode).toBe("hold");
    expect(edited.patientId).toBe("demo-hanako");
    expect(reduceBookingDraft(edited, { type: "edit", procedureCode: "CT-HEAD" })!.procedureCode).toBe("CT-HEAD");
  });

  it("ignores events when there is no draft", () => {
    expect(reduceBookingDraft(null, { type: "refresh" })).toBeNull();
    expect(reduceBookingDraft(null, { type: "held", held: slot(2), holdSeconds: 30 })).toBeNull();
    expect(reduceBookingDraft(null, { type: "edit", patientId: "x" })).toBeNull();
    expect(reduceBookingDraft(null, { type: "close", reason: "cancelled" })).toBeNull();
  });

  it("does not open a second draft while one is open", () => {
    const draft = opened();
    expect(reduceBookingDraft(draft, { ...select(), slot: { ...slot(1), resource: { ...slot(1).resource, id: "ct1-1030" } } })).toBe(draft);
  });
});

describe("remainingSeconds", () => {
  const holding = reduceBookingDraft(opened(), {
    type: "held",
    held: slot(2, "busy-tentative", "2026-10-02T10:00:00.000+09:00"),
    holdSeconds: 30,
  })!;
  const at = (iso: string) => new Date(iso).getTime();

  it("counts down from the time of the hold", () => {
    expect(remainingSeconds(holding, at("2026-10-02T10:00:00.000+09:00"))).toBe(30);
    expect(remainingSeconds(holding, at("2026-10-02T10:00:07.200+09:00"))).toBe(23);
    expect(remainingSeconds(holding, at("2026-10-02T10:00:29.900+09:00"))).toBe(1);
  });

  it("never goes below zero", () => {
    expect(remainingSeconds(holding, at("2026-10-02T10:00:30.000+09:00"))).toBe(0);
    expect(remainingSeconds(holding, at("2026-10-02T10:05:00.000+09:00"))).toBe(0);
  });

  it("is null before the slot is held", () => {
    expect(remainingSeconds(opened(), Date.now())).toBeNull();
  });
});
