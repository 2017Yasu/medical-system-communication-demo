package jp.example.demo.fhir.system;

import ca.uhn.fhir.rest.server.exceptions.BaseServerResponseException;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import ca.uhn.fhir.util.FhirTerser;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import jp.example.demo.Fhir;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.store.InMemoryRepository.WriteSession;
import jp.example.demo.store.StoredVersion;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Bundle.BundleEntryComponent;
import org.hl7.fhir.r4.model.Bundle.BundleType;
import org.hl7.fhir.r4.model.Bundle.HTTPVerb;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;

/**
 * Transaction Bundle の処理（research.md R-08）。
 * POST → PUT → GET の順に作業用セッションへ適用し、全件成功でコミット、1 件でも失敗すれば全体を破棄する。
 * DELETE と PATCH のエントリは本機能では受け付けない（400）。
 */
public final class TransactionProcessor {
    private final InMemoryRepository repo;
    private final ResourceWriter writer;

    public TransactionProcessor(InMemoryRepository repo, ResourceWriter writer) {
        this.repo = repo;
        this.writer = writer;
    }

    public Bundle process(Bundle input) {
        if (input == null || input.getType() != BundleType.TRANSACTION) {
            throw new InvalidRequestException("Bundle.type は transaction である必要があります");
        }
        return repo.write(tx -> run(tx, input));
    }

    private Bundle run(WriteSession tx, Bundle input) {
        List<BundleEntryComponent> entries = input.getEntry();
        int n = entries.size();
        String[] assignedId = new String[n]; // POST で新規作成するエントリの ID
        Map<String, String> idMap = new HashMap<>(); // fullUrl（urn:uuid:...）→ Type/id

        // 1. 事前処理：メソッド・URL の検証、POST への ID 割り当て、If-None-Exist の既存一致
        boolean[] reusedExisting = new boolean[n];
        StoredVersion[] existing = new StoredVersion[n];
        for (int i = 0; i < n; i++) {
            try {
                BundleEntryComponent e = entries.get(i);
                HTTPVerb method = e.getRequest().getMethod();
                if (method == null) {
                    throw new InvalidRequestException("entry.request.method がありません");
                }
                switch (method) {
                    case POST -> {
                        Resource r = requireResource(e);
                        String type = r.fhirType();
                        ResourceWriter.requireWritable(type);
                        Optional<StoredVersion> found = writer.findExisting(tx, type, e.getRequest().getIfNoneExist());
                        if (found.isPresent()) {
                            reusedExisting[i] = true;
                            existing[i] = found.get();
                            mapFullUrl(idMap, e, found.get().ref());
                        } else {
                            assignedId[i] = tx.newId(type);
                            mapFullUrl(idMap, e, type + "/" + assignedId[i]);
                        }
                    }
                    case PUT -> {
                        Resource r = requireResource(e);
                        ResourceWriter.requireWritable(r.fhirType());
                        UrlParts u = parseUrl(e.getRequest().getUrl());
                        if (u.id == null || !u.type.equals(r.fhirType())) {
                            throw new InvalidRequestException("PUT の url は {種別}/{id} である必要があります: " + e.getRequest().getUrl());
                        }
                        mapFullUrl(idMap, e, u.type + "/" + u.id);
                    }
                    case GET -> parseUrl(e.getRequest().getUrl());
                    default -> throw new InvalidRequestException(method.toCode() + " エントリは対応していません");
                }
            } catch (BaseServerResponseException ex) {
                throw wrap(ex, i, entries.get(i));
            }
        }

        // 2. 参照の書き換え（urn:uuid → Type/id）
        FhirTerser terser = Fhir.CTX.newTerser();
        for (BundleEntryComponent e : entries) {
            if (e.getResource() != null) {
                for (Reference ref : terser.getAllPopulatedChildElementsOfType(e.getResource(), Reference.class)) {
                    String mapped = idMap.get(ref.getReference());
                    if (mapped != null) {
                        ref.setReference(mapped);
                    }
                }
            }
        }

        // 3. POST → PUT → GET の順に適用
        BundleEntryComponent[] results = new BundleEntryComponent[n];
        for (HTTPVerb phase : new HTTPVerb[] {HTTPVerb.POST, HTTPVerb.PUT, HTTPVerb.GET}) {
            for (int i = 0; i < n; i++) {
                BundleEntryComponent e = entries.get(i);
                if (e.getRequest().getMethod() != phase) {
                    continue;
                }
                try {
                    results[i] = apply(tx, e, assignedId[i], reusedExisting[i], existing[i]);
                } catch (BaseServerResponseException ex) {
                    throw wrap(ex, i, e);
                }
            }
        }

        Bundle response = new Bundle();
        response.setType(BundleType.TRANSACTIONRESPONSE);
        for (BundleEntryComponent r : results) {
            response.addEntry(r);
        }
        return response;
    }

    private BundleEntryComponent apply(
            WriteSession tx, BundleEntryComponent e, String newId, boolean reused, StoredVersion existing) {
        HTTPVerb method = e.getRequest().getMethod();
        switch (method) {
            case POST -> {
                if (reused) {
                    return entryFor(existing, "200 OK", e.hasFullUrl() ? e.getFullUrl() : null);
                }
                ResourceWriter.Result r = writer.createWithId(tx, e.getResource(), newId);
                return entryFor(r.version(), "201 Created", e.hasFullUrl() ? e.getFullUrl() : null);
            }
            case PUT -> {
                UrlParts u = parseUrl(e.getRequest().getUrl());
                ResourceWriter.Result r = writer.update(
                        tx, e.getResource(), u.id, IfMatchRule.parseVersion(e.getRequest().getIfMatch()));
                return entryFor(r.version(), r.created() ? "201 Created" : "200 OK", null);
            }
            default -> {
                UrlParts u = parseUrl(e.getRequest().getUrl());
                if (u.id == null) {
                    throw new InvalidRequestException("GET エントリは {種別}/{id} のみ対応しています");
                }
                StoredVersion v = tx.latest(u.type, u.id)
                        .orElseThrow(() -> new ResourceNotFoundException(u.type + "/" + u.id + " が見つかりません"));
                return entryFor(v, "200 OK", null);
            }
        }
    }

    private static BundleEntryComponent entryFor(StoredVersion v, String status, String fullUrl) {
        BundleEntryComponent out = new BundleEntryComponent();
        if (fullUrl != null) {
            out.setFullUrl(fullUrl);
        }
        out.setResource(v.toResource());
        out.getResponse()
                .setStatus(status)
                .setLocation(v.versionRef())
                .setEtag(v.etag())
                .setLastModified(Date.from(v.lastUpdated()));
        return out;
    }

    private static Resource requireResource(BundleEntryComponent e) {
        if (e.getResource() == null) { // 空のリソースも許容するため hasResource() は使わない
            throw new InvalidRequestException("entry.resource がありません");
        }
        return e.getResource();
    }

    private static void mapFullUrl(Map<String, String> idMap, BundleEntryComponent e, String ref) {
        if (e.hasFullUrl()) {
            idMap.put(e.getFullUrl(), ref);
        }
    }

    private record UrlParts(String type, String id) {}

    private static UrlParts parseUrl(String url) {
        if (url == null || url.isBlank()) {
            throw new InvalidRequestException("entry.request.url がありません");
        }
        if (url.contains("?")) {
            throw new InvalidRequestException("条件付きの url は対応していません: " + url);
        }
        String[] parts = url.split("/");
        if (parts.length == 1) {
            return new UrlParts(parts[0], null);
        }
        if (parts.length == 2) {
            return new UrlParts(parts[0], parts[1]);
        }
        throw new InvalidRequestException("url を解釈できません: " + url);
    }

    /** 失敗したエントリの位置を OperationOutcome に載せて、同じステータスで投げ直す。 */
    private static BaseServerResponseException wrap(BaseServerResponseException ex, int index, BundleEntryComponent e) {
        String what = e.getRequest().getMethod() == null
                ? ""
                : e.getRequest().getMethod().toCode() + " " + e.getRequest().getUrl();
        String message = "Bundle.entry[" + index + "]（" + what + "）: " + ex.getMessage();
        OperationOutcome oo = new OperationOutcome();
        oo.addIssue()
                .setSeverity(OperationOutcome.IssueSeverity.ERROR)
                .setCode(OperationOutcome.IssueType.PROCESSING)
                .setDiagnostics(message)
                .addExpression("Bundle.entry[" + index + "]");
        BaseServerResponseException out = BaseServerResponseException.newInstance(ex.getStatusCode(), message);
        out.setOperationOutcome(oo);
        return out;
    }
}
