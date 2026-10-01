import { describe, expect, it, vi } from "vitest";
import { FhirClient } from "../../src/fhir/client";
import { ensureSubscription } from "../../src/realtime/subscription";

const spec = { id: "lis-lab-dept", criteria: "Task?owner=Organization/lab-dept", reason: "x" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const sub = { resourceType: "Subscription", id: spec.id, status: "active", meta: { versionId: "1" } };
const outcome = (d: string) => ({ resourceType: "OperationOutcome", issue: [{ diagnostics: d }] });

function client(responses: Response[]) {
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? json(500, outcome("unexpected")));
  return { fetchFn, client: new FhirClient("lis-tech-a", "/fhir", fetchFn as unknown as typeof fetch) };
}
const methods = (fetchFn: { mock: { calls: unknown[][] } }) => fetchFn.mock.calls.map((c) => (c[1] as RequestInit).method);

describe("ensureSubscription", () => {
  it("does nothing when it already exists", async () => {
    const { fetchFn, client: c } = client([json(200, sub)]);
    await ensureSubscription(c, spec);
    expect(methods(fetchFn)).toEqual(["GET"]);
  });

  it("creates it with PUT (no If-Match) when it does not exist", async () => {
    const { fetchFn, client: c } = client([json(404, outcome("none")), json(201, sub)]);
    await ensureSubscription(c, spec);
    expect(methods(fetchFn)).toEqual(["GET", "PUT"]);
    const put = fetchFn.mock.calls[1][1] as RequestInit;
    expect((put.headers as Record<string, string>)["If-Match"]).toBeUndefined();
    const body = JSON.parse(put.body as string);
    expect(body).toMatchObject({ id: spec.id, status: "requested", criteria: spec.criteria, channel: { type: "websocket" } });
  });

  it("copes with another window creating the same subscription at the same time", async () => {
    // GET 404 → PUT は 400（If-Match が必要。他の画面が先に作った）→ GET で存在を確認できる
    const { fetchFn, client: c } = client([json(404, outcome("none")), json(400, outcome("更新の前提となる版（If-Match）が指定されていません")), json(200, sub)]);
    await expect(ensureSubscription(c, spec)).resolves.toBeUndefined();
    expect(methods(fetchFn)).toEqual(["GET", "PUT", "GET"]);
  });

  it("still fails when the PUT fails and the subscription does not exist", async () => {
    const { client: c } = client([json(404, outcome("none")), json(422, outcome("bad")), json(404, outcome("none"))]);
    await expect(ensureSubscription(c, spec)).rejects.toMatchObject({ status: 422 });
  });
});
