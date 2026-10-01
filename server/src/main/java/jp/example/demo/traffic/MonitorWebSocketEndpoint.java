package jp.example.demo.traffic;

import jakarta.websocket.CloseReason;
import jakarta.websocket.Endpoint;
import jakarta.websocket.EndpointConfig;
import jakarta.websocket.Session;

/** `/ws/monitor`：サーバーからの一方向の配信（通信記録とデモの合図）。 */
public final class MonitorWebSocketEndpoint extends Endpoint {
    private final MonitorBroadcaster broadcaster;

    public MonitorWebSocketEndpoint(MonitorBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @Override
    public void onOpen(Session session, EndpointConfig config) {
        broadcaster.add(session);
    }

    @Override
    public void onClose(Session session, CloseReason closeReason) {
        broadcaster.remove(session);
    }

    @Override
    public void onError(Session session, Throwable thr) {
        broadcaster.remove(session);
    }
}
