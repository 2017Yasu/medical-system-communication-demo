/*
 * Based on ca.uhn.example.servlet.ExampleRestfulServlet from FirelyTeam/fhirstarters
 * (hapi-fhirstarters-rest-server-skeleton). Copyright (c) 2015, Furore. All rights reserved.
 * See THIRD_PARTY_NOTICES.md.
 */
package jp.example.demo.fhir;

import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Pointcut;
import ca.uhn.fhir.rest.api.EncodingEnum;
import ca.uhn.fhir.rest.api.PreferReturnEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.ETagSupportEnum;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.RestfulServer;
import java.util.List;
import jp.example.demo.Fhir;
import org.hl7.fhir.instance.model.api.IBaseConformance;
import org.hl7.fhir.r4.model.CapabilityStatement;

/** FHIR R4 サーバー本体（`/fhir/*`）。 */
public class DemoRestfulServer extends RestfulServer {
    private static final long serialVersionUID = 1L;
    private static final String WEBSOCKET_EXTENSION = "http://hl7.org/fhir/StructureDefinition/capabilitystatement-websocket";

    private final transient List<IResourceProvider> providers;
    private final transient List<Object> plainProviders;

    public DemoRestfulServer(List<IResourceProvider> providers, List<Object> plainProviders) {
        super(Fhir.CTX);
        this.providers = providers;
        this.plainProviders = plainProviders;
    }

    @Override
    protected void initialize() {
        setResourceProviders(providers);
        registerProviders(plainProviders);
        setETagSupport(ETagSupportEnum.ENABLED);
        setDefaultResponseEncoding(EncodingEnum.JSON);
        setDefaultPrettyPrint(false);
        setDefaultPreferReturn(PreferReturnEnum.REPRESENTATION);
        registerInterceptor(new CapabilityInterceptor());
    }

    /** CapabilityStatement に websocket の URL を示す（contracts/fhir-api.md capabilities）。 */
    public static class CapabilityInterceptor {
        @Hook(Pointcut.SERVER_CAPABILITY_STATEMENT_GENERATED)
        public IBaseConformance customize(IBaseConformance statement, RequestDetails request) {
            if (statement instanceof CapabilityStatement cs) {
                String host = request.getHeader("Host");
                if (host == null || host.isBlank()) {
                    host = "localhost:8080";
                }
                if (cs.getRest().isEmpty()) {
                    cs.addRest();
                }
                cs.getRest().get(0).addExtension(WEBSOCKET_EXTENSION, new org.hl7.fhir.r4.model.UriType("ws://" + host + "/ws/subscription"));
            }
            return statement;
        }
    }
}
