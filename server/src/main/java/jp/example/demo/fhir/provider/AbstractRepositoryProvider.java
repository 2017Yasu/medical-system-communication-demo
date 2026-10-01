/*
 * Resource provider structure based on ca.uhn.example.provider.PatientResourceProvider from
 * FirelyTeam/fhirstarters (hapi-fhirstarters-rest-server-skeleton).
 * Copyright (c) 2015, Furore. All rights reserved. See THIRD_PARTY_NOTICES.md.
 */
package jp.example.demo.fhir.provider;

import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.fhir.search.SearchMatcher;
import jp.example.demo.fhir.search.SearchParameters;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.store.StoredVersion;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Resource;

/** 全リソース種別で共通の read / vread / history / search / create / update の処理（アノテーションは各 Provider が付ける）。 */
public abstract class AbstractRepositoryProvider<T extends Resource> implements IResourceProvider {
    protected final InMemoryRepository repo;
    protected final ResourceWriter writer;
    private final Class<T> type;

    protected AbstractRepositoryProvider(InMemoryRepository repo, ResourceWriter writer, Class<T> type) {
        this.repo = repo;
        this.writer = writer;
        this.type = type;
    }

    @Override
    public Class<T> getResourceType() {
        return type;
    }

    protected String typeName() {
        return type.getSimpleName();
    }

    protected T doRead(IdType id) {
        String idPart = id.getIdPart();
        if (id.hasVersionIdPart()) {
            long vid;
            try {
                vid = Long.parseLong(id.getVersionIdPart());
            } catch (NumberFormatException e) {
                throw new ResourceNotFoundException(id);
            }
            return repo.version(typeName(), idPart, vid).map(this::cast).orElseThrow(() -> new ResourceNotFoundException(id));
        }
        return repo.latest(typeName(), idPart).map(this::cast).orElseThrow(() -> new ResourceNotFoundException(id));
    }

    protected List<T> doHistory(IdType id) {
        List<StoredVersion> history = repo.history(typeName(), id.getIdPart());
        if (history.isEmpty()) {
            throw new ResourceNotFoundException(id);
        }
        List<T> out = new ArrayList<>();
        for (StoredVersion v : history) {
            out.add(cast(v));
        }
        return out;
    }

    protected List<T> doSearch(RequestDetails request) {
        Map<String, List<String>> params = new LinkedHashMap<>();
        for (Map.Entry<String, String[]> e : request.getParameters().entrySet()) {
            String name = e.getKey();
            if (name.startsWith("_")) {
                continue; // _format, _pretty, _count などは無視する
            }
            if (!SearchParameters.supports(typeName(), name)) {
                throw new InvalidRequestException(
                        typeName() + " は検索パラメータ " + name + " に対応していません（対応: "
                                + SearchParameters.names(typeName()) + "）");
            }
            List<String> values = params.computeIfAbsent(name, k -> new ArrayList<>());
            for (String raw : e.getValue()) {
                for (String v : raw.split(",")) {
                    if (!v.isBlank()) {
                        values.add(v);
                    }
                }
            }
        }
        List<T> out = new ArrayList<>();
        for (StoredVersion v : repo.latestOfType(typeName())) {
            T resource = cast(v);
            if (SearchMatcher.matches(resource, params)) {
                out.add(resource);
            }
        }
        return out;
    }

    protected MethodOutcome doCreate(T resource, RequestDetails request) {
        ResourceWriter.Result r = repo.write(tx -> writer.create(tx, resource, request.getHeader("If-None-Exist")));
        return outcome(r);
    }

    protected MethodOutcome doUpdate(IdType id, T resource) {
        String ifMatch = id.hasVersionIdPart() ? id.getVersionIdPart() : null;
        ResourceWriter.Result r = repo.write(tx -> writer.update(tx, resource, id.getIdPart(), ifMatch));
        return outcome(r);
    }

    /** If-Match ヘッダ（HAPI は update のときだけ ID に版を設定するため、PATCH ではヘッダを自分で読む）。 */
    protected static String ifMatchOf(RequestDetails request) {
        return IfMatchRule.parseVersion(request.getHeader("If-Match"));
    }

    protected MethodOutcome outcome(ResourceWriter.Result r) {
        StoredVersion v = r.version();
        MethodOutcome outcome = new MethodOutcome(new IdType(v.type(), v.id(), Long.toString(v.versionId())), r.created());
        outcome.setResource(v.toResource());
        return outcome;
    }

    private T cast(StoredVersion v) {
        return type.cast(v.toResource());
    }
}
