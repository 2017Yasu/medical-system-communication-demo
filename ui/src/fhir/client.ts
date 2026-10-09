// FHIR クライアント（薄い fetch ラッパー。research.md R-16）。
// 全要求に X-Demo-Client を付け、ETag を保持して更新に If-Match を付ける。
// 412 などの競合は自動でやり直さず、業務上の意味に変換した例外にする（FR-004）。
import type { Bundle, FhirResource, OperationOutcome } from "fhir/r4";
import { type DisplayError, toDisplayError } from "./errors";

export type ClientId = "ehr-doctor" | "ehr-doctor-y" | "ehr-nurse" | "ehr-nurse-f" | "pharmacy" | "pharmacy-ph-c" | "pharmacy-ph-e" | "lis-tech-a" | "lis-tech-b" | "ris" | "monitor";

/** リソースとその ETag（`W/"3"`）。更新時に If-Match として返す。 */
export interface Versioned<T> {
  resource: T;
  etag: string | null;
}

export interface JsonPatchOp {
  op: "add" | "replace" | "remove" | "test";
  path: string;
  value?: unknown;
}

export class FhirError extends Error {
  constructor(
    public readonly display: DisplayError,
    public readonly status: number | null,
    public readonly outcome: OperationOutcome | null,
  ) {
    super(display.text);
    this.name = "FhirError";
  }

  get isConflict(): boolean {
    return this.display.kind === "conflict";
  }
}

type FetchFn = typeof fetch;

export function etagOf(resource: { meta?: { versionId?: string } }): string | null {
  const v = resource.meta?.versionId;
  return v ? `W/"${v}"` : null;
}

export class FhirClient {
  constructor(
    public readonly clientId: ClientId,
    private readonly baseUrl: string = "/fhir",
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  async read<T extends FhirResource>(type: string, id: string): Promise<Versioned<T>> {
    const res = await this.send("GET", `/${type}/${id}`, undefined, "取得");
    return this.versioned<T>(res);
  }

  /** 検索。各結果の ETag は meta.versionId から作る。 */
  async search<T extends FhirResource>(type: string, params: Record<string, string> = {}): Promise<Versioned<T>[]> {
    const query = new URLSearchParams(params).toString();
    const bundle = await (await this.send("GET", `/${type}${query ? `?${query}` : ""}`, undefined, "検索")).json() as Bundle;
    return (bundle.entry ?? []).flatMap((e) => (e.resource ? [{ resource: e.resource as T, etag: etagOf(e.resource) }] : []));
  }

  /** 版の履歴（新しい版が先頭）。 */
  async history<T extends FhirResource>(type: string, id: string): Promise<Versioned<T>[]> {
    const bundle = await (await this.send("GET", `/${type}/${id}/_history`, undefined, "履歴の取得")).json() as Bundle;
    return (bundle.entry ?? []).flatMap((e) => (e.resource ? [{ resource: e.resource as T, etag: etagOf(e.resource) }] : []));
  }

  async create<T extends FhirResource>(resource: T, operationName = "作成"): Promise<Versioned<T>> {
    const res = await this.send("POST", `/${resource.resourceType}`, { body: resource }, operationName);
    return this.versioned<T>(res);
  }

  /** 更新。etag を渡すと If-Match を付ける（作成のための PUT では null）。 */
  async update<T extends FhirResource>(
    type: string,
    id: string,
    resource: T,
    etag: string | null,
    operationName = "更新",
  ): Promise<Versioned<T>> {
    const res = await this.send("PUT", `/${type}/${id}`, { body: resource, ifMatch: etag }, operationName);
    return this.versioned<T>(res);
  }

  async patch<T extends FhirResource>(
    type: string,
    id: string,
    ops: JsonPatchOp[],
    etag: string | null,
    operationName = "更新",
  ): Promise<Versioned<T>> {
    const res = await this.send("PATCH", `/${type}/${id}`, { body: ops, ifMatch: etag, patch: true }, operationName);
    return this.versioned<T>(res);
  }

  async transaction(bundle: Bundle, operationName = "更新"): Promise<Bundle> {
    const res = await this.send("POST", "", { body: bundle }, operationName);
    return (await res.json()) as Bundle;
  }

  private async versioned<T extends FhirResource>(res: Response): Promise<Versioned<T>> {
    const resource = (await res.json()) as T;
    return { resource, etag: res.headers.get("ETag") ?? etagOf(resource as { meta?: { versionId?: string } }) };
  }

  private async send(
    method: string,
    path: string,
    opts: { body?: unknown; ifMatch?: string | null; patch?: boolean } | undefined,
    operationName: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
      "X-Demo-Client": this.clientId,
    };
    if (opts?.body !== undefined) {
      headers["Content-Type"] = opts.patch ? "application/json-patch+json" : "application/fhir+json";
    }
    if (opts?.ifMatch) {
      headers["If-Match"] = opts.ifMatch;
    }
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        // ブラウザの HTTP キャッシュを使わない：受付を始めるときの GET や 412 の後の取り直しが古い応答を返すと、版の確認が成り立たない
        cache: "no-store",
        body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new FhirError(toDisplayError({ network: true }, operationName), null, null);
    }
    if (!res.ok) {
      let outcome: OperationOutcome | null = null;
      try {
        outcome = (await res.json()) as OperationOutcome;
      } catch {
        outcome = null;
      }
      throw new FhirError(toDisplayError({ status: res.status, outcome }, operationName), res.status, outcome);
    }
    return res;
  }
}
