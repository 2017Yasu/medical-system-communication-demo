package jp.example.demo.traffic;

import java.util.Map;

/** 通信記録の 1 件（contracts/websocket.md「TrafficRecord の JSON 形式」、data-model.md §6）。 */
public record TrafficRecord(
        long seq,
        String timestamp,
        String kind, // "http" | "notification" | "demo" | "server"（サーバー内の処理。specs/003 R-06）
        String client,
        Request request,
        Response response,
        Notification notification,
        DemoEvent demoEvent,
        ServerAction serverAction) {

    public record Request(String method, String url, Map<String, String> headers, String body, boolean truncated) {}

    public record Response(int status, Map<String, String> headers, String body, long durationMs, boolean truncated) {}

    public record Notification(String subscriptionId, String targetClient, String resource) {}

    public record DemoEvent(String event, Object detail) {}

    /** サーバー内の処理（仮押さえの期限切れ）。HTTP の要求ではないので request・response は無い。 */
    public record ServerAction(
            String action, String resource, Map<String, Object> before, Map<String, Object> after, int holdSeconds) {}
}
