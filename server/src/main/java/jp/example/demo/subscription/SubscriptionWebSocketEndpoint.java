package jp.example.demo.subscription;

import jakarta.websocket.Endpoint;
import jakarta.websocket.EndpointConfig;
import jakarta.websocket.MessageHandler;
import jakarta.websocket.Session;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/** `/ws/subscription?client=...`：`bind {id}` を受けて `bound {id}` / `error {id} {理由}` を返す。 */
public final class SubscriptionWebSocketEndpoint extends Endpoint {
    private final SubscriptionEngine engine;

    public SubscriptionWebSocketEndpoint(SubscriptionEngine engine) {
        this.engine = engine;
    }

    @Override
    public void onOpen(Session session, EndpointConfig config) {
        Map<String, List<String>> params = session.getRequestParameterMap();
        String client = params.containsKey("client") && !params.get("client").isEmpty() ? params.get("client").get(0) : "unknown";
        session.addMessageHandler(String.class, (MessageHandler.Whole<String>) message -> {
            String reply = handle(session, client, message);
            synchronized (session) {
                try {
                    session.getBasicRemote().sendText(reply);
                } catch (IOException e) {
                    // 切断済み
                }
            }
        });
    }

    private String handle(Session session, String client, String message) {
        String[] parts = message.trim().split("\\s+");
        if (parts.length == 2 && parts[0].equals("bind")) {
            return engine.bind(session, client, parts[1]);
        }
        return "error - 不明なメッセージです（bind {Subscription id} を送ってください）";
    }

    @Override
    public void onClose(Session session, jakarta.websocket.CloseReason closeReason) {
        engine.unbindSession(session);
    }

    @Override
    public void onError(Session session, Throwable thr) {
        engine.unbindSession(session);
    }
}
