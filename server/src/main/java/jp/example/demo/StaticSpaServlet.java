package jp.example.demo;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** クラスパスの `static/` を配信する。存在しないパスは SPA の `index.html` にフォールバックする。 */
public final class StaticSpaServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String path = req.getPathInfo() == null ? req.getServletPath() : req.getServletPath() + req.getPathInfo();
        if (path == null || path.equals("/") || path.isEmpty()) {
            path = "/index.html";
        }
        if (path.contains("..")) {
            resp.sendError(400);
            return;
        }
        InputStream found = open("static" + path);
        if (found == null) {
            boolean looksLikeAsset = path.substring(path.lastIndexOf('/') + 1).contains(".");
            found = looksLikeAsset ? null : open("static/index.html");
            path = "/index.html";
        }
        InputStream in = found;
        if (in == null) {
            resp.setStatus(404);
            resp.setContentType("text/plain; charset=UTF-8");
            resp.getWriter().write("画面が見つかりません。UI をビルドして server/src/main/resources/static/ に配置してください。");
            return;
        }
        try (in) {
            String mime = getServletContext().getMimeType(path);
            if (mime == null) {
                mime = path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
            }
            resp.setContentType(mime);
            if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) {
                resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
            }
            resp.setHeader("Cache-Control", path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
            in.transferTo(resp.getOutputStream());
        }
    }

    private static InputStream open(String resource) {
        return StaticSpaServlet.class.getClassLoader().getResourceAsStream(resource);
    }
}
