package jp.example.demo.integration;

import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.api.ServerValidationModeEnum;
import ca.uhn.fhir.rest.client.interceptor.AdditionalRequestHeadersInterceptor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import jp.example.demo.DemoServerMain;
import jp.example.demo.Fhir;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.junit.jupiter.api.extension.AfterAllCallback;
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;

/** 組み込み Jetty をランダムポートで起動し、各テストの前に初期化する（tasks.md T015）。 */
public class DemoServerExtension implements BeforeAllCallback, AfterAllCallback, BeforeEachCallback {
    public static final ObjectMapper JSON = new ObjectMapper();

    private Server server;
    private int port;
    private final HttpClient http = HttpClient.newHttpClient();
    private final List<WsClient> openSockets = new ArrayList<>();

    @Override
    public void beforeAll(ExtensionContext context) throws Exception {
        server = DemoServerMain.start(0);
        port = ((ServerConnector) server.getConnectors()[0]).getLocalPort();
    }

    @Override
    public void afterAll(ExtensionContext context) throws Exception {
        closeSockets();
        server.stop();
    }

    @Override
    public void beforeEach(ExtensionContext context) throws Exception {
        closeSockets();
        reset();
    }

    private void closeSockets() {
        for (WsClient c : openSockets) {
            c.close();
        }
        openSockets.clear();
    }

    public String baseUrl() {
        return "http://localhost:" + port;
    }

    public String fhirUrl() {
        return baseUrl() + "/fhir";
    }

    public JsonNode reset() throws Exception {
        return JSON.readTree(raw("POST", "/demo/reset", Map.of(), null).body());
    }

    /** `X-Demo-Client` を付ける HAPI Generic Client（R4）。 */
    public IGenericClient fhir(String client) {
        Fhir.CTX.getRestfulClientFactory().setServerValidationMode(ServerValidationModeEnum.NEVER);
        IGenericClient c = Fhir.CTX.newRestfulGenericClient(fhirUrl());
        AdditionalRequestHeadersInterceptor h = new AdditionalRequestHeadersInterceptor();
        h.addHeaderValue("X-Demo-Client", client);
        c.registerInterceptor(h);
        return c;
    }

    /** ヘッダを完全に制御できる生の HTTP 要求。path は `/fhir/...` や `/demo/...`。 */
    public HttpResponse<String> raw(String method, String path, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(baseUrl() + path)).timeout(Duration.ofSeconds(20));
        headers.forEach(b::header);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    public HttpResponse<String> fhirRaw(String method, String path, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        Map<String, String> h = new java.util.LinkedHashMap<>(headers);
        h.putIfAbsent("Accept", "application/fhir+json");
        if (body != null) {
            h.putIfAbsent("Content-Type", "application/fhir+json");
        }
        return raw(method, "/fhir" + path, h, body);
    }

    public WsClient connect(String path) {
        WsClient c = new WsClient("ws://localhost:" + port + path);
        openSockets.add(c);
        return c;
    }

    /** JDK の WebSocket クライアントで受信メッセージをキューに溜めるテスト用クライアント。 */
    public static final class WsClient {
        private final BlockingQueue<String> messages = new LinkedBlockingQueue<>();
        private final List<String> all = new ArrayList<>();
        private final WebSocket socket;

        WsClient(String url) {
            StringBuilder partial = new StringBuilder();
            this.socket = HttpClient.newHttpClient()
                    .newWebSocketBuilder()
                    .buildAsync(URI.create(url), new WebSocket.Listener() {
                        @Override
                        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                            partial.append(data);
                            if (last) {
                                messages.add(partial.toString());
                                partial.setLength(0);
                            }
                            ws.request(1);
                            return null;
                        }

                        @Override
                        public void onOpen(WebSocket ws) {
                            ws.request(1);
                        }
                    })
                    .join();
        }

        public void send(String text) {
            socket.sendText(text, true).join();
        }

        /** 条件に合うメッセージが届くまで待つ（合わないものは all に残る）。 */
        public String await(Predicate<String> condition, long timeoutMillis) throws InterruptedException {
            long end = System.currentTimeMillis() + timeoutMillis;
            while (System.currentTimeMillis() < end) {
                String m = messages.poll(Math.max(1, end - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                if (m == null) {
                    break;
                }
                all.add(m);
                if (condition.test(m)) {
                    return m;
                }
            }
            return null;
        }

        /** 指定時間内に届いたメッセージを全部集める。 */
        public List<String> drain(long quietMillis) throws InterruptedException {
            List<String> out = new ArrayList<>();
            String m;
            while ((m = messages.poll(quietMillis, TimeUnit.MILLISECONDS)) != null) {
                out.add(m);
                all.add(m);
            }
            return out;
        }

        public List<String> received() {
            return all;
        }

        public void close() {
            try {
                socket.sendClose(WebSocket.NORMAL_CLOSURE, "bye").orTimeout(2, TimeUnit.SECONDS).join();
            } catch (RuntimeException e) {
                // 既に閉じている
            }
        }
    }
}
