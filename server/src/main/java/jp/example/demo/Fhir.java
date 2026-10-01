package jp.example.demo;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.parser.IParser;

/** 共有の FHIR コンテキスト（R4）。 */
public final class Fhir {
    public static final FhirContext CTX = FhirContext.forR4Cached();

    private Fhir() {}

    public static IParser json() {
        return CTX.newJsonParser();
    }
}
