package jp.example.demo.demo;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import jp.example.demo.traffic.MonitorBroadcaster;
import jp.example.demo.traffic.TrafficLog;
import jp.example.demo.traffic.TrafficRecord;

/** `/demo/*`：初期化・ポリシー・通信記録の取得（contracts/demo-control-api.md）。 */
public final class DemoControlServlet extends HttpServlet {
    private final DemoControl control;
    private final TrafficLog traffic;

    public DemoControlServlet(DemoControl control, TrafficLog traffic) {
        this.control = control;
        this.traffic = traffic;
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if ("/reset".equals(req.getPathInfo())) {
            int seeds = control.reset();
            json(resp, 200, Map.of("resetAt", OffsetDateTime.now().toString(), "seedResources", seeds));
        } else {
            error(resp, 404, "対応していない操作です: " + req.getPathInfo());
        }
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String path = req.getPathInfo();
        if ("/policy".equals(path)) {
            json(resp, 200, policyJson());
        } else if ("/traffic".equals(path)) {
            long after = 0;
            String a = req.getParameter("after");
            if (a != null) {
                try {
                    after = Long.parseLong(a);
                } catch (NumberFormatException e) {
                    error(resp, 400, "after は数値で指定してください");
                    return;
                }
            }
            List<TrafficRecord> records = traffic.after(after);
            json(resp, 200, Map.of("records", records));
        } else {
            error(resp, 404, "対応していない操作です: " + path);
        }
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!"/policy".equals(req.getPathInfo())) {
            error(resp, 404, "対応していない操作です: " + req.getPathInfo());
            return;
        }
        JsonNode body;
        try {
            body = MonitorBroadcaster.JSON.readTree(req.getInputStream());
        } catch (IOException e) {
            error(resp, 400, "本文を解析できません");
            return;
        }
        Boolean ifMatch = optionalBoolean(body, "ifMatchRequired");
        Boolean transition = optionalBoolean(body, "taskTransitionCheck");
        Boolean labSendsIfMatch = optionalBoolean(body, "labSendsIfMatch");
        Boolean ehrUsesSlotHold = optionalBoolean(body, "ehrUsesSlotHold");
        Integer slotHoldSeconds = null;
        if (body != null && body.has("slotHoldSeconds") && !body.get("slotHoldSeconds").isNull()) {
            JsonNode n = body.get("slotHoldSeconds");
            if (!n.isIntegralNumber() || !n.canConvertToInt() || !DemoPolicy.isValidSlotHoldSeconds(n.asInt())) {
                error(resp, 400, "slotHoldSeconds は 1〜300 の整数で指定してください"); // ほかの項目も変更しない
                return;
            }
            slotHoldSeconds = n.asInt();
        }
        control.updatePolicy(ifMatch, transition, labSendsIfMatch, ehrUsesSlotHold, slotHoldSeconds);
        json(resp, 200, policyJson());
    }

    private static Boolean optionalBoolean(JsonNode body, String name) {
        return body != null && body.has(name) && body.get(name).isBoolean() ? body.get(name).asBoolean() : null;
    }

    private Map<String, Object> policyJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ifMatchRequired", control.policy().ifMatchRequired());
        m.put("taskTransitionCheck", control.policy().taskTransitionCheck());
        m.put("labSendsIfMatch", control.policy().labSendsIfMatch());
        m.put("ehrUsesSlotHold", control.policy().ehrUsesSlotHold());
        m.put("slotHoldSeconds", control.policy().slotHoldSeconds());
        return m;
    }

    private static void error(HttpServletResponse resp, int status, String message) throws IOException {
        json(resp, status, Map.of("error", message));
    }

    private static void json(HttpServletResponse resp, int status, Object body) throws IOException {
        resp.setStatus(status);
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        resp.setHeader("Cache-Control", "no-store");
        MonitorBroadcaster.JSON.writeValue(resp.getOutputStream(), body);
    }
}
