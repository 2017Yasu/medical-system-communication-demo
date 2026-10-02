package jp.example.demo.traffic;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.websocket.Session;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import jp.example.demo.demo.DemoPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** `/ws/monitor` に接続中の全画面へ、通信記録とデモの合図を JSON で配信する（contracts/websocket.md）。 */
public final class MonitorBroadcaster {
    private static final Logger LOG = LoggerFactory.getLogger(MonitorBroadcaster.class);
    public static final ObjectMapper JSON = new ObjectMapper();

    private final Set<Session> sessions = new CopyOnWriteArraySet<>();

    public void add(Session session) {
        sessions.add(session);
    }

    public void remove(Session session) {
        sessions.remove(session);
    }

    public int connections() {
        return sessions.size();
    }

    public void traffic(TrafficRecord record) {
        send(Map.of("type", "traffic", "record", record));
    }

    /** 初期化の合図。初期化後のポリシー（既定値）を載せる：画面が取り直す必要を無くし、直後の demo.policy との前後が入れ替わらないようにする。 */
    public void reset(String timestamp, DemoPolicy policy) {
        send(Map.of("type", "demo.reset", "timestamp", timestamp, "policy", policyMap(policy)));
    }

    public void policy(DemoPolicy policy) {
        send(Map.of("type", "demo.policy", "policy", policyMap(policy)));
    }

    private static Map<String, Object> policyMap(DemoPolicy policy) {
        return Map.of(
                "ifMatchRequired", policy.ifMatchRequired(),
                "taskTransitionCheck", policy.taskTransitionCheck(),
                "labSendsIfMatch", policy.labSendsIfMatch(),
                "ehrUsesSlotHold", policy.ehrUsesSlotHold(),
                "slotHoldSeconds", policy.slotHoldSeconds());
    }

    private void send(Object message) {
        String text;
        try {
            text = JSON.writeValueAsString(message);
        } catch (JsonProcessingException e) {
            LOG.warn("failed to serialize monitor message", e);
            return;
        }
        for (Session s : sessions) {
            synchronized (s) {
                try {
                    if (s.isOpen()) {
                        s.getBasicRemote().sendText(text);
                    }
                } catch (IOException | RuntimeException e) {
                    LOG.debug("monitor send failed", e);
                }
            }
        }
    }
}
