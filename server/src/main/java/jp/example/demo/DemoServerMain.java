package jp.example.demo;

import ca.uhn.fhir.rest.server.IResourceProvider;
import jakarta.servlet.DispatcherType;
import jakarta.websocket.Endpoint;
import jakarta.websocket.server.ServerEndpointConfig;
import java.util.EnumSet;
import java.util.List;
import jp.example.demo.demo.DemoControl;
import jp.example.demo.demo.DemoControlServlet;
import jp.example.demo.demo.DemoPolicy;
import jp.example.demo.demo.SeedLoader;
import jp.example.demo.fhir.DemoRestfulServer;
import jp.example.demo.fhir.ResourceWriter;
import jp.example.demo.fhir.provider.AppointmentProvider;
import jp.example.demo.fhir.provider.DeviceProvider;
import jp.example.demo.fhir.provider.DiagnosticReportProvider;
import jp.example.demo.fhir.provider.EncounterProvider;
import jp.example.demo.fhir.provider.LocationProvider;
import jp.example.demo.fhir.provider.MedicationDispenseProvider;
import jp.example.demo.fhir.provider.MedicationRequestProvider;
import jp.example.demo.fhir.provider.ObservationProvider;
import jp.example.demo.fhir.provider.OrganizationProvider;
import jp.example.demo.fhir.provider.PatientProvider;
import jp.example.demo.fhir.provider.PractitionerProvider;
import jp.example.demo.fhir.provider.PractitionerRoleProvider;
import jp.example.demo.fhir.provider.ScheduleProvider;
import jp.example.demo.fhir.provider.ServiceRequestProvider;
import jp.example.demo.fhir.provider.SlotProvider;
import jp.example.demo.fhir.provider.SpecimenProvider;
import jp.example.demo.fhir.provider.SubscriptionProvider;
import jp.example.demo.fhir.provider.TaskProvider;
import jp.example.demo.fhir.rules.IfMatchRule;
import jp.example.demo.fhir.rules.TaskTransitionRule;
import jp.example.demo.fhir.system.TransactionProcessor;
import jp.example.demo.fhir.system.TransactionProvider;
import jp.example.demo.slot.SlotHoldExpiry;
import jp.example.demo.slot.SlotSeedGenerator;
import jp.example.demo.store.InMemoryRepository;
import jp.example.demo.subscription.SubscriptionEngine;
import jp.example.demo.subscription.SubscriptionWebSocketEndpoint;
import jp.example.demo.traffic.MonitorBroadcaster;
import jp.example.demo.traffic.MonitorWebSocketEndpoint;
import jp.example.demo.traffic.TrafficCaptureFilter;
import jp.example.demo.traffic.TrafficLog;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import org.eclipse.jetty.ee10.websocket.jakarta.server.config.JakartaWebSocketServletContainerInitializer;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 組み込み Jetty で FHIR サーバー・WebSocket・デモ制御・静的 UI を 1 プロセスで配信する（research.md R-03）。 */
public final class DemoServerMain {
    private static final Logger LOG = LoggerFactory.getLogger(DemoServerMain.class);

    private DemoServerMain() {}

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        Server server = start(port);
        LOG.info("デモサーバーを起動しました: http://localhost:{}/", ((ServerConnector) server.getConnectors()[0]).getLocalPort());
        server.join();
    }

    /** サーバーを起動して返す（テストからはポート 0 でランダムポートを使う）。 */
    public static Server start(int port) throws Exception {
        DemoPolicy policy = new DemoPolicy(slotHoldSecondsFromEnv());
        InMemoryRepository repo = new InMemoryRepository();
        TrafficLog traffic = new TrafficLog();
        MonitorBroadcaster monitor = new MonitorBroadcaster();
        traffic.addListener(monitor::traffic);
        SubscriptionEngine subscriptions = new SubscriptionEngine(repo, traffic);
        SlotHoldExpiry slotHoldExpiry = new SlotHoldExpiry(repo, traffic, policy, java.time.Clock.systemUTC());
        repo.addListener(slotHoldExpiry);
        DemoControl control = new DemoControl(
                repo, traffic, subscriptions, monitor, policy, new SeedLoader(), new SlotSeedGenerator(java.time.Clock.systemUTC()), slotHoldExpiry);
        control.reset();

        ResourceWriter writer = new ResourceWriter(new IfMatchRule(policy), new TaskTransitionRule(policy));
        List<IResourceProvider> providers = List.of(
                new PatientProvider(repo, writer),
                new PractitionerProvider(repo, writer),
                new PractitionerRoleProvider(repo, writer),
                new OrganizationProvider(repo, writer),
                new ServiceRequestProvider(repo, writer),
                new TaskProvider(repo, writer),
                new SpecimenProvider(repo, writer),
                new ObservationProvider(repo, writer),
                new DiagnosticReportProvider(repo, writer),
                new SubscriptionProvider(repo, writer),
                new SlotProvider(repo, writer),
                new AppointmentProvider(repo, writer),
                new ScheduleProvider(repo, writer),
                new DeviceProvider(repo, writer),
                new MedicationRequestProvider(repo, writer),
                new MedicationDispenseProvider(repo, writer),
                new EncounterProvider(repo, writer),
                new LocationProvider(repo, writer));
        List<Object> plain = List.of(new TransactionProvider(new TransactionProcessor(repo, writer)));

        Server server = new Server(port);
        ServletContextHandler context = new ServletContextHandler("/");

        context.addFilter(new FilterHolder(new TrafficCaptureFilter(traffic)), "/fhir/*", EnumSet.of(DispatcherType.REQUEST));
        ServletHolder fhir = new ServletHolder("fhir", new DemoRestfulServer(providers, plain));
        fhir.setInitOrder(1);
        context.addServlet(fhir, "/fhir/*");
        context.addServlet(new ServletHolder("demo", new DemoControlServlet(control, traffic)), "/demo/*");
        context.addServlet(new ServletHolder("static", new StaticSpaServlet()), "/");

        JakartaWebSocketServletContainerInitializer.configure(context, (servletContext, container) -> {
            container.addEndpoint(endpoint("/ws/subscription", new SubscriptionWebSocketEndpoint(subscriptions)));
            container.addEndpoint(endpoint("/ws/monitor", new MonitorWebSocketEndpoint(monitor)));
        });

        server.setHandler(context);
        server.addEventListener(new org.eclipse.jetty.util.component.LifeCycle.Listener() {
            @Override
            public void lifeCycleStopping(org.eclipse.jetty.util.component.LifeCycle event) {
                slotHoldExpiry.stop();
            }
        });
        slotHoldExpiry.start();
        server.start();
        return server;
    }

    /** 環境変数 SLOT_HOLD_SECONDS（1〜300 の整数）。未設定・不正なら既定の 30 秒。 */
    private static int slotHoldSecondsFromEnv() {
        String v = System.getenv("SLOT_HOLD_SECONDS");
        if (v == null || v.isBlank()) {
            return DemoPolicy.DEFAULT_SLOT_HOLD_SECONDS;
        }
        try {
            int n = Integer.parseInt(v.trim());
            return DemoPolicy.isValidSlotHoldSeconds(n) ? n : DemoPolicy.DEFAULT_SLOT_HOLD_SECONDS;
        } catch (NumberFormatException e) {
            return DemoPolicy.DEFAULT_SLOT_HOLD_SECONDS;
        }
    }

    /** 接続ごとに同じ Endpoint インスタンス（共有の状態を持つ）を使う。 */
    private static ServerEndpointConfig endpoint(String path, Endpoint instance) {
        return ServerEndpointConfig.Builder.create(instance.getClass(), path)
                .configurator(new ServerEndpointConfig.Configurator() {
                    @Override
                    @SuppressWarnings("unchecked")
                    public <T> T getEndpointInstance(Class<T> endpointClass) {
                        return (T) instance;
                    }
                })
                .build();
    }
}
