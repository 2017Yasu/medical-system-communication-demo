package jp.example.demo.unit;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import jp.example.demo.traffic.TrafficCaptureFilter;
import jp.example.demo.traffic.TrafficLog;
import jp.example.demo.traffic.TrafficRecord;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TrafficCaptureFilterTest {
    private static Server server;
    private static int port;
    private static final TrafficLog LOG = new TrafficLog();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    /** /fhir/echo：本文をそのまま返す。/fhir/big：300KB を返す。/fhir/error：412。/fhir/notify：処理中に通知を記録する。 */
    static class TestServlet extends HttpServlet {
        @Override
        protected void service(HttpServletRequest req, HttpServletResponse resp) throws IOException {
            String path = req.getPathInfo();
            switch (path) {
                case "/error" -> {
                    resp.setStatus(412);
                    resp.setContentType("application/fhir+json");
                    resp.getWriter().write("{\"resourceType\":\"OperationOutcome\",\"issue\":[{\"diagnostics\":\"他の利用者が先に更新しました\"}]}");
                }
                case "/big" -> {
                    resp.setContentType("text/plain");
                    byte[] chunk = new byte[1024];
                    Arrays.fill(chunk, (byte) 'a');
                    for (int i = 0; i < 300; i++) {
                        resp.getOutputStream().write(chunk);
                    }
                }
                case "/notify" -> {
                    LOG.add(LOG.notification("lis-lab-dept", "lis-tech-a", "Task/1/_history/2"));
                    resp.setHeader("ETag", "W/\"2\"");
                    resp.setHeader("Location", "http://x/fhir/Task/1/_history/2");
                    resp.getWriter().write("ok");
                }
                default -> {
                    resp.setContentType("application/fhir+json");
                    resp.setCharacterEncoding("UTF-8");
                    resp.getWriter().write(new String(req.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                }
            }
        }
    }

    @BeforeAll
    static void start() throws Exception {
        server = new Server(0);
        ServletContextHandler ctx = new ServletContextHandler("/");
        ctx.addFilter(new FilterHolder(new TrafficCaptureFilter(LOG)), "/fhir/*", EnumSet.of(DispatcherType.REQUEST));
        ctx.addServlet(new ServletHolder(new TestServlet()), "/fhir/*");
        server.setHandler(ctx);
        server.start();
        port = ((ServerConnector) server.getConnectors()[0]).getLocalPort();
    }

    @AfterAll
    static void stop() throws Exception {
        server.stop();
    }

    @BeforeEach
    void clear() {
        LOG.clear();
    }

    private HttpResponse<String> send(String method, String path, String body, String... headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
        for (int i = 0; i < headers.length; i += 2) {
            b.header(headers[i], headers[i + 1]);
        }
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void recordsRequestAndResponseDetails() throws Exception {
        String body = "{\"memo\":\"血算\"}";
        send("PUT", "/fhir/echo?x=1", body, "X-Demo-Client", "lis-tech-a", "If-Match", "W/\"3\"",
                "Content-Type", "application/fhir+json", "Prefer", "return=representation");

        List<TrafficRecord> records = LOG.after(0);
        assertThat(records).hasSize(1);
        TrafficRecord r = records.get(0);
        assertThat(r.kind()).isEqualTo("http");
        assertThat(r.client()).isEqualTo("lis-tech-a");
        assertThat(r.request().method()).isEqualTo("PUT");
        assertThat(r.request().url()).isEqualTo("/fhir/echo?x=1");
        assertThat(r.request().headers()).containsEntry("If-Match", "W/\"3\"").containsEntry("Prefer", "return=representation");
        assertThat(r.request().body()).isEqualTo(body);
        assertThat(r.response().status()).isEqualTo(200);
        assertThat(r.response().body()).isEqualTo(body);
        assertThat(r.response().headers()).containsKey("Content-Type");
        assertThat(r.response().durationMs()).isGreaterThanOrEqualTo(0);
        assertThat(r.timestamp()).isNotBlank();
    }

    @Test
    void clientDefaultsToUnknown() throws Exception {
        send("GET", "/fhir/echo", null);
        assertThat(LOG.after(0).get(0).client()).isEqualTo("unknown");
    }

    @Test
    void errorResponsesAreRecordedWithTheirBody() throws Exception {
        HttpResponse<String> res = send("PATCH", "/fhir/error", "[]", "X-Demo-Client", "lis-tech-b");
        assertThat(res.statusCode()).isEqualTo(412);
        TrafficRecord r = LOG.after(0).get(0);
        assertThat(r.response().status()).isEqualTo(412);
        assertThat(r.response().body()).contains("他の利用者が先に更新しました");
    }

    @Test
    void bodiesOver256KbAreTruncated() throws Exception {
        HttpResponse<String> res = send("GET", "/fhir/big", null);
        assertThat(res.body()).hasSize(300 * 1024); // クライアントには全量が届く
        TrafficRecord r = LOG.after(0).get(0);
        assertThat(r.response().truncated()).isTrue();
        assertThat(r.response().body()).hasSize(TrafficCaptureFilter.MAX_BODY_BYTES);

        String big = "x".repeat(300 * 1024);
        send("POST", "/fhir/echo", big);
        TrafficRecord post = LOG.after(0).get(1);
        assertThat(post.request().truncated()).isTrue();
        assertThat(post.response().truncated()).isTrue();
        assertThat(post.request().body()).hasSize(TrafficCaptureFilter.MAX_BODY_BYTES);
    }

    @Test
    void seqIsReservedWhenTheRequestArrivesSoNotificationsDuringProcessingComeLater() throws Exception {
        send("PATCH", "/fhir/notify", "[]");
        List<TrafficRecord> bySeq = LOG.after(0);
        assertThat(bySeq).hasSize(2);
        assertThat(bySeq.get(0).kind()).isEqualTo("http");
        assertThat(bySeq.get(1).kind()).isEqualTo("notification");
        assertThat(bySeq.get(0).seq()).isLessThan(bySeq.get(1).seq());
        assertThat(bySeq.get(1).notification().subscriptionId()).isEqualTo("lis-lab-dept");
        assertThat(bySeq.get(1).notification().targetClient()).isEqualTo("lis-tech-a");
        assertThat(bySeq.get(0).response().headers()).containsEntry("ETag", "W/\"2\"");
    }

    @Test
    void afterFiltersAndClearResetsTheSequence() throws Exception {
        send("GET", "/fhir/echo", null);
        send("GET", "/fhir/echo", null);
        long first = LOG.after(0).get(0).seq();
        assertThat(LOG.after(first)).hasSize(1);
        LOG.clear();
        assertThat(LOG.after(0)).isEmpty();
        send("GET", "/fhir/echo", null);
        assertThat(LOG.after(0).get(0).seq()).isEqualTo(1);
    }
}
