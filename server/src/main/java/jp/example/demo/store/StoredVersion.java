package jp.example.demo.store;

import java.time.Instant;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Resource;

/** リソースの 1 つの版（不変）。JSON 文字列として保持し、読み出しのたびにパースして独立したコピーを返す。 */
public record StoredVersion(String type, String id, long versionId, Instant lastUpdated, String json) {

    public Resource toResource() {
        Resource r = (Resource) Fhir.json().parseResource(json);
        r.setId(new IdType(type, id, Long.toString(versionId)));
        return r;
    }

    public String ref() {
        return type + "/" + id;
    }

    public String versionRef() {
        return type + "/" + id + "/_history/" + versionId;
    }

    public String etag() {
        return "W/\"" + versionId + "\"";
    }
}
