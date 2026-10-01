package jp.example.demo.fhir.patch;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.fge.jsonpatch.JsonPatch;
import com.github.fge.jsonpatch.JsonPatchException;
import java.io.IOException;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Resource;

/** RFC 6902 JSON Patch の適用（research.md R-02）。 */
public final class JsonPatchApplier {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonPatchApplier() {}

    public static Resource apply(Resource current, String patchBody) {
        JsonNode patchNode;
        try {
            patchNode = MAPPER.readTree(patchBody);
        } catch (IOException | RuntimeException e) {
            throw new InvalidRequestException("JSON Patch の本文を解析できません: " + e.getMessage());
        }
        JsonPatch patch;
        try {
            patch = JsonPatch.fromJson(patchNode);
        } catch (IOException | RuntimeException e) {
            throw new UnprocessableEntityException("JSON Patch の形式が不正です: " + e.getMessage());
        }
        try {
            JsonNode document = MAPPER.readTree(Fhir.json().encodeResourceToString(current));
            JsonNode patched = patch.apply(document);
            if (!current.fhirType().equals(patched.path("resourceType").asText())
                    || !current.getIdElement().getIdPart().equals(patched.path("id").asText())) {
                throw new UnprocessableEntityException("PATCH で resourceType と id は変更できません");
            }
            return (Resource) Fhir.json().parseResource(patched.toString());
        } catch (JsonPatchException e) {
            throw new UnprocessableEntityException("パッチを適用できません: " + e.getMessage());
        } catch (IOException e) {
            throw new UnprocessableEntityException("パッチ適用後のリソースを解析できません: " + e.getMessage());
        } catch (ca.uhn.fhir.parser.DataFormatException e) {
            throw new UnprocessableEntityException("パッチ適用後のリソースが不正です: " + e.getMessage());
        }
    }
}
