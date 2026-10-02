// 画面ごとの「Subscription を登録 → 通知を受ける → 取り直す」の共通フック
// （FR-008、FR-012、FR-022、contracts/ui-screens.md「画面の更新の流れ」）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FhirClient, FhirError, type ClientId } from "../fhir/client";
import { toDisplayError, type DisplayError } from "../fhir/errors";
import { monitorSocket } from "./monitorSocket";
import { ensureSubscription, openSubscriptionSocket, type SubscriptionSocket, type SubscriptionSpec } from "./subscription";

export interface LiveDataOptions<T> {
  clientId: ClientId;
  /** 通知を受ける Subscription。複数のときは、どれかの ping で取り直す（放射線部門システム。specs/003 R-07）。 */
  subscription: SubscriptionSpec | SubscriptionSpec[];
  /** 表示するデータの取得。通知のたびに呼ばれる。 */
  load: (client: FhirClient) => Promise<T>;
  /** 取得の依存（変わったら取り直す）。 */
  deps?: unknown[];
}

export interface LiveData<T> {
  data: T | null;
  error: DisplayError | null;
  loading: boolean;
  client: FhirClient;
  reload: () => Promise<void>;
  clearError: () => void;
  setError: (e: unknown, operationName: string) => void;
}

export function useLiveData<T>(options: LiveDataOptions<T>): LiveData<T> {
  const client = useMemo(() => new FhirClient(options.clientId), [options.clientId]);
  const [data, setData] = useState<T | null>(null);
  const [error, setErrorState] = useState<DisplayError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(options.load);
  loadRef.current = options.load;
  const subRef = useRef(options.subscription);
  subRef.current = options.subscription;

  const toDisplay = useCallback((e: unknown, operationName: string): DisplayError => {
    if (e instanceof FhirError) return e.display;
    return toDisplayError({ network: true }, operationName);
  }, []);

  /**
   * 表示データの取得。keepError が true（通知による取り直し）のときは、成功しても表示中のエラーを消さない：
   * 利用者の操作が失敗した直後に、相手の更新の通知で取り直しが走ると、読む前にエラーが消えてしまうため（specs/003 の同時の仮押さえで発見）。
   */
  const load = useCallback(
    async (keepError: boolean) => {
      try {
        const value = await loadRef.current(client);
        setData(value);
        if (!keepError) setErrorState(null);
      } catch (e) {
        setErrorState(toDisplay(e, "取得"));
      } finally {
        setLoading(false);
      }
    },
    [client, toDisplay],
  );
  /** 画面が自分の操作の後に呼ぶ取り直し（成功すると、前の操作のエラーを消す）。 */
  const reload = useCallback(() => load(false), [load]);

  const depsKey = JSON.stringify(options.deps ?? []);
  useEffect(() => {
    let disposed = false;
    const sockets = new Map<string, SubscriptionSocket>();
    const specs = () => [subRef.current].flat();

    /** Subscription 1 件ぶんの「登録 → bind」。bind が拒否されたら、その 1 件だけ登録し直す。 */
    const setup = async (spec: SubscriptionSpec) => {
      sockets.get(spec.id)?.close();
      sockets.delete(spec.id);
      try {
        await ensureSubscription(client, spec);
      } catch (e) {
        if (!disposed) setErrorState(toDisplay(e, "通知の登録"));
        return;
      }
      if (disposed) return;
      sockets.set(
        spec.id,
        openSubscriptionSocket(client.clientId, spec.id, {
          onBound: () => void load(true),
          onPing: () => void load(true),
          onBindError: () => void setup(spec),
        }),
      );
    };
    const setupAll = () => specs().forEach((spec) => void setup(spec));

    void load(false);
    setupAll();
    const unsubscribe = monitorSocket.subscribe((m) => {
      if (m.type === "demo.reset") {
        setData(null);
        void load(false);
        setupAll();
      }
    });
    return () => {
      disposed = true;
      sockets.forEach((socket) => socket.close());
      unsubscribe();
    };
  }, [client, load, toDisplay, depsKey]);

  const clearError = useCallback(() => setErrorState(null), []);
  const setError = useCallback((e: unknown, operationName: string) => setErrorState(toDisplay(e, operationName)), [toDisplay]);

  return { data, error, loading, client, reload, clearError, setError };
}
