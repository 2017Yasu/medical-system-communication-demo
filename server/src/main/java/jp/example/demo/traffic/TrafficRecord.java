package jp.example.demo.traffic;

import java.util.Map;

/** 通信記録の 1 件（contracts/websocket.md「TrafficRecord の JSON 形式」、data-model.md §6）。 */
public record TrafficRecord(
        long seq,
        String timestamp,
        String kind, // "http" | "notification" | "demo"
        String client,
        Request request,
        Response response,
        Notification notification,
        DemoEvent demoEvent) {

    public record Request(String method, String url, Map<String, String> headers, String body, boolean truncated) {}

    public record Response(int status, Map<String, String> headers, String body, long durationMs, boolean truncated) {}

    public record Notification(String subscriptionId, String targetClient, String resource) {}

    public record DemoEvent(String event, Object detail) {}
}
