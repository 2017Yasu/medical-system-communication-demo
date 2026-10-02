import type { Bundle, Slot } from "fhir/r4";
import { describe, expect, it, vi } from "vitest";
import { FhirClient } from "../../src/fhir/client";
import { bookDirect, confirmBooking, holdSlot, releaseSlot, selectSlot } from "../../src/fhir/ctActions";

const NOW = new Date("2026-10-02T10:00:00+09:00");
const slotJson = (version: number, status = "free", comment?: string): Slot => ({
  resourceType: "Slot",
  id: "ct1-1000",
  meta: { versionId: String(version) },
  schedule: { reference: "Schedule/ct-1" },
  status: status as Slot["status"],
  start: "2026-10-03T10:00:00+09:00",
  end: "2026-10-03T10:30:00+09:00",
  ...(comment ? { comment } : {}),
});

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 要求ごとに応答を返す fetch。検索は existingOrders 件の依頼を返す。 */
function server(existingOrders = 0) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    if (method === "GET" && url.includes("/ServiceRequest?")) {
      const bundle: Bundle = {
        resourceType: "Bundle",
        type: "searchset",
        entry: Array.from({ length: existingOrders }, (_, i) => ({ resource: { resourceType: "ServiceRequest", id: String(i + 1), status: "active", intent: "order", subject: {} } })),
      };
      return new Response(JSON.stringify(bundle), { status: 200 });
    }
    if (method === "GET") return new Response(JSON.stringify(slotJson(1)), { status: 200, headers: { ETag: 'W/"1"' } });
    if (method === "PUT") return new Response(JSON.stringify({ ...body, meta: { versionId: "2" } }), { status: 200, headers: { ETag: 'W/"2"' } });
    return new Response(JSON.stringify({ resourceType: "Bundle", type: "transaction-response", entry: [] }), { status: 200 });
  });
  return { calls, client: new FhirClient("ehr-doctor", "/fhir", fetchFn as unknown as typeof fetch) };
}

describe("CT booking actions", () => {
  it("selectSlot reads the slot and keeps its version", async () => {
    const s = server();
    const selected = await selectSlot(s.client, "ct1-1000");
    expect(s.calls[0]).toMatchObject({ method: "GET", url: "/fhir/Slot/ct1-1000" });
    expect(s.calls[0].headers["X-Demo-Client"]).toBe("ehr-doctor");
    expect(selected.etag).toBe('W/"1"');
  });

  it("holdSlot uses the version captured when the slot was selected, even if the server moved on", async () => {
    const s = server();
    const selected = await selectSlot(s.client, "ct1-1000");
    const held = await holdSlot(s.client, selected, "dr-x");
    const put = s.calls[1];
    expect(put.method).toBe("PUT");
    expect(put.url).toBe("/fhir/Slot/ct1-1000");
    expect(put.headers["If-Match"]).toBe('W/"1"');
    expect(put.body).toMatchObject({ status: "busy-tentative", comment: "仮押さえ：医師 X" });
    expect(held.etag).toBe('W/"2"');
  });

  it("confirmBooking sends a transaction whose slot entry checks the held version", async () => {
    const s = server(1);
    const held = { resource: slotJson(2, "busy-tentative", "仮押さえ：医師 X"), etag: 'W/"2"' };
    const result = await confirmBooking(s.client, { slot: held, doctor: "dr-x", patientId: "demo-taro", procedureCode: "CT-CHEST" }, NOW);
    const search = s.calls[0];
    expect(search.url).toContain("/ServiceRequest?");
    expect(search.url).toContain("category=363679005");
    expect(search.url).toContain("requester=Practitioner%2Fdr-x");
    const tx = s.calls[1];
    expect(tx).toMatchObject({ method: "POST", url: "/fhir" });
    const bundle = tx.body as Bundle;
    expect(bundle.entry![0].request).toMatchObject({ method: "PUT", url: "Slot/ct1-1000", ifMatch: 'W/"2"' });
    expect(result.orderNumber).toBe("R-20261002-X002");
  });

  it("bookDirect sends a transaction without the slot entry", async () => {
    const s = server();
    const selected = { resource: slotJson(1), etag: 'W/"1"' };
    await bookDirect(s.client, { slot: selected, doctor: "dr-x", patientId: "demo-taro", procedureCode: "CT-HEAD" }, NOW);
    const bundle = s.calls[1].body as Bundle;
    expect(bundle.entry!.map((e) => e.request?.url)).toEqual(["Appointment", "ServiceRequest", "Task"]);
    expect(bundle.entry!.every((e) => e.request?.ifMatch === undefined)).toBe(true);
  });

  it("releaseSlot puts the slot back to free with the held version and no comment", async () => {
    const s = server();
    const held = { resource: slotJson(2, "busy-tentative", "仮押さえ：医師 X"), etag: 'W/"2"' };
    await releaseSlot(s.client, held);
    const put = s.calls[0];
    expect(put.method).toBe("PUT");
    expect(put.headers["If-Match"]).toBe('W/"2"');
    expect(put.body).toMatchObject({ status: "free" });
    expect((put.body as Slot).comment).toBeUndefined();
  });
});
