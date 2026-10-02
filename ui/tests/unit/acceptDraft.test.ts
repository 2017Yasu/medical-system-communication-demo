import { describe, expect, it, vi } from "vitest";
import { FhirClient } from "../../src/fhir/client";
import { acceptTask, beginAccept, confirmAccept, type CurrentOrder } from "../../src/fhir/labActions";

const task = (version: string) => ({ resourceType: "Task", id: "1", status: "requested", meta: { versionId: version } });

/** 要求ごとに応答を返す fetch。GET は取得時点の版、PATCH は版を 1 つ進める。 */
function server(initialVersion: number) {
  let version = initialVersion;
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: init.headers as Record<string, string> });
    if (method === "PATCH") version += 1;
    return new Response(JSON.stringify(task(String(version))), { status: 200, headers: { ETag: `W/"${version}"` } });
  });
  return {
    calls,
    bump: () => (version += 1),
    client: new FhirClient("lis-tech-b", "/fhir", fetchFn as unknown as typeof fetch),
  };
}

describe("two-step accept", () => {
  it("beginAccept reads the task and returns its version", async () => {
    const s = server(2);
    const draft = await beginAccept(s.client, "1");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].method).toBe("GET");
    expect(s.calls[0].url).toBe("/fhir/Task/1");
    expect(s.calls[0].headers["X-Demo-Client"]).toBe("lis-tech-b");
    expect(draft.etag).toBe('W/"2"');
  });

  it("confirmAccept uses the version captured at beginAccept even if the server moved on", async () => {
    const s = server(2);
    const draft = await beginAccept(s.client, "1");
    s.bump(); // 他の技師が先に更新した
    await confirmAccept(s.client, draft, "tech-b", true);
    const patch = s.calls[1];
    expect(patch.method).toBe("PATCH");
    expect(patch.headers["If-Match"]).toBe('W/"2"');
  });

  it("confirmAccept omits If-Match when the lab system does not send it", async () => {
    const s = server(2);
    const draft = await beginAccept(s.client, "1");
    await confirmAccept(s.client, draft, "tech-b", false);
    expect(s.calls[1].headers["If-Match"]).toBeUndefined();
  });

  it("acceptTask reads and then patches with the version it just read", async () => {
    const s = server(5);
    const order = { sr: { resource: { resourceType: "ServiceRequest", id: "9" }, etag: null }, task: { resource: task("2"), etag: 'W/"2"' } } as unknown as CurrentOrder;
    await acceptTask(s.client, order, "tech-a");
    expect(s.calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(s.calls[1].headers["If-Match"]).toBe('W/"5"');
  });
});
