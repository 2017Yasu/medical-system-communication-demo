package jp.example.demo.traffic;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** `/fhir/*` の全要求・応答を記録する（research.md R-11）。HAPI の処理より外側に置くので、エラー応答も漏れなく記録できる。 */
public final class TrafficCaptureFilter implements Filter {
    public static final int MAX_BODY_BYTES = 256 * 1024;
    private static final List<String> REQUEST_HEADERS =
            List.of("If-Match", "If-None-Exist", "Content-Type", "Accept", "Prefer");
    private static final List<String> RESPONSE_HEADERS =
            List.of("ETag", "Location", "Content-Location", "Last-Modified", "Content-Type");

    private final TrafficLog log;

    public TrafficCaptureFilter(TrafficLog log) {
        this.log = log;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        if (!(req instanceof HttpServletRequest request) || !(res instanceof HttpServletResponse response)) {
            chain.doFilter(req, res);
            return;
        }
        long seq = log.reserveSeq();
        long start = System.nanoTime();
        byte[] body = request.getInputStream().readAllBytes();
        CachedRequest cached = new CachedRequest(request, body);
        CapturingResponse capturing = new CapturingResponse(response);
        try {
            chain.doFilter(cached, capturing);
        } finally {
            capturing.flushBuffer();
            long ms = (System.nanoTime() - start) / 1_000_000;
            String url = request.getRequestURI() + (request.getQueryString() == null ? "" : "?" + request.getQueryString());
            String client = request.getHeader("X-Demo-Client");
            Truncated reqBody = truncate(body);
            Truncated resBody = truncate(decodeIfCompressed(capturing.captured.toByteArray(), response.getHeader("Content-Encoding")));
            log.add(new TrafficRecord(
                    seq,
                    TrafficLog.now(),
                    "http",
                    client == null || client.isBlank() ? "unknown" : client,
                    new TrafficRecord.Request(
                            request.getMethod(), url, requestHeaders(request), reqBody.text, reqBody.truncated),
                    new TrafficRecord.Response(
                            response.getStatus(), responseHeaders(response), resBody.text, ms, resBody.truncated),
                    null,
                    null,
                    null));
        }
    }

    private static Map<String, String> requestHeaders(HttpServletRequest request) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String h : REQUEST_HEADERS) {
            String v = request.getHeader(h);
            if (v != null) {
                out.put(h, v);
            }
        }
        return out;
    }

    private static Map<String, String> responseHeaders(HttpServletResponse response) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String h : RESPONSE_HEADERS) {
            String v = response.getHeader(h);
            if (v != null) {
                out.put(h, v);
            }
        }
        return out;
    }

    /** HAPI はクライアントが gzip を受け付けると圧縮して書き出すため、記録には展開した本文を使う。 */
    private static byte[] decodeIfCompressed(byte[] bytes, String contentEncoding) {
        if (contentEncoding == null || !contentEncoding.toLowerCase().contains("gzip") || bytes.length == 0) {
            return bytes;
        }
        try (java.util.zip.GZIPInputStream in = new java.util.zip.GZIPInputStream(new ByteArrayInputStream(bytes))) {
            return in.readAllBytes();
        } catch (IOException e) {
            return bytes;
        }
    }

    private record Truncated(String text, boolean truncated) {}

    private static Truncated truncate(byte[] bytes) {
        if (bytes.length <= MAX_BODY_BYTES) {
            return new Truncated(new String(bytes, StandardCharsets.UTF_8), false);
        }
        return new Truncated(new String(bytes, 0, MAX_BODY_BYTES, StandardCharsets.UTF_8), true);
    }

    private static final class CachedRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public boolean isFinished() {
                    return in.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener readListener) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public int read() {
                    return in.read();
                }

                @Override
                public int read(byte[] b, int off, int len) {
                    return in.read(b, off, len);
                }
            };
        }

        @Override
        public java.io.BufferedReader getReader() {
            String enc = getCharacterEncoding();
            java.nio.charset.Charset cs = enc == null ? StandardCharsets.UTF_8 : java.nio.charset.Charset.forName(enc);
            return new java.io.BufferedReader(new java.io.InputStreamReader(new ByteArrayInputStream(body), cs));
        }
    }

    private static final class CapturingResponse extends HttpServletResponseWrapper {
        final ByteArrayOutputStream captured = new ByteArrayOutputStream();
        private ServletOutputStream out;
        private PrintWriter writer;

        CapturingResponse(HttpServletResponse response) {
            super(response);
        }

        @Override
        public ServletOutputStream getOutputStream() throws IOException {
            if (out == null) {
                ServletOutputStream target = super.getOutputStream();
                out = new ServletOutputStream() {
                    @Override
                    public boolean isReady() {
                        return target.isReady();
                    }

                    @Override
                    public void setWriteListener(WriteListener writeListener) {
                        target.setWriteListener(writeListener);
                    }

                    @Override
                    public void write(int b) throws IOException {
                        captured.write(b);
                        target.write(b);
                    }

                    @Override
                    public void write(byte[] b, int off, int len) throws IOException {
                        captured.write(b, off, len);
                        target.write(b, off, len);
                    }

                    @Override
                    public void flush() throws IOException {
                        target.flush();
                    }

                    @Override
                    public void close() throws IOException {
                        target.close();
                    }
                };
            }
            return out;
        }

        @Override
        public PrintWriter getWriter() throws IOException {
            if (writer == null) {
                super.setCharacterEncoding("UTF-8");
                writer = new PrintWriter(new OutputStreamWriter(getOutputStream(), StandardCharsets.UTF_8));
            }
            return writer;
        }

        @Override
        public void flushBuffer() throws IOException {
            if (writer != null) {
                writer.flush();
            }
            super.flushBuffer();
        }
    }
}
