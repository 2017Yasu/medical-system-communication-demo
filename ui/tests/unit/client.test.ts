import { describe, expect, it, vi } from "vitest";
import { FhirClient, FhirError } from "../../src/fhir/client";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
}

describe("FhirClient", () => {
  it("sends X-Demo-Client on every request and keeps the ETag", async () => {
    const fetchFn = mockFetch(200, { resourceType: "Task", id: "1", meta: { versionId: "3" } }, { ETag: 'W/"3"' });
    const client = new FhirClient("lis-tech-a", "/fhir", fetchFn as unknown as typeof fetch);
    const v = await client.read("Task", "1");
    expect(v.etag).toBe('W/"3"');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/fhir/Task/1");
    expect((init.headers as Record<string, string>)["X-Demo-Client"]).toBe("lis-tech-a");
  });

  it("PATCH carries If-Match and the JSON Patch content type", async () => {
    const fetchFn = mockFetch(200, { resourceType: "Task", id: "1", meta: { versionId: "4" } }, { ETag: 'W/"4"' });
    const client = new FhirClient("lis-tech-a", "/fhir", fetchFn as unknown as typeof fetch);
    await client.patch("Task", "1", [{ op: "replace", path: "/status", value: "accepted" }], 'W/"3"', "受付");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(init.method).toBe("PATCH");
    expect(h["If-Match"]).toBe('W/"3"');
    expect(h["Content-Type"]).toBe("application/json-patch+json");
  });

  it("does not retry on 412 and surfaces a conflict error", async () => {
    const outcome = { resourceType: "OperationOutcome", issue: [{ diagnostics: "他の利用者が先に更新しました" }] };
    const fetchFn = mockFetch(412, outcome);
    const client = new FhirClient("lis-tech-b", "/fhir", fetchFn as unknown as typeof fetch);
    const error = await client.patch("Task", "1", [], 'W/"1"', "受付").catch((e) => e);
    expect(error).toBeInstanceOf(FhirError);
    expect((error as FhirError).isConflict).toBe(true);
    expect((error as FhirError).display.httpLabel).toBe("412 Precondition Failed");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps network failures", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = new FhirClient("monitor", "/fhir", fetchFn as unknown as typeof fetch);
    const error = (await client.read("Task", "1").catch((e) => e)) as FhirError;
    expect(error.display.kind).toBe("network");
    expect(error.status).toBeNull();
  });

  it("search returns resources with ETags from meta.versionId", async () => {
    const bundle = { resourceType: "Bundle", type: "searchset", entry: [{ resource: { resourceType: "Task", id: "1", meta: { versionId: "2" } } }] };
    const fetchFn = mockFetch(200, bundle);
    const client = new FhirClient("ehr-doctor", "/fhir", fetchFn as unknown as typeof fetch);
    const list = await client.search("Task", { requester: "Practitioner/dr-x" });
    expect(list).toHaveLength(1);
    expect(list[0].etag).toBe('W/"2"');
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/fhir/Task?requester=Practitioner%2Fdr-x");
  });
});

describe("FhirClient caching", () => {
  it("never uses the browser HTTP cache (a stale GET would break the version check)", async () => {
    const fetchFn = mockFetch(200, { resourceType: "Task", id: "1" });
    const client = new FhirClient("lis-tech-b", "/fhir", fetchFn as unknown as typeof fetch);
    await client.read("Task", "1");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.cache).toBe("no-store");
  });
});
