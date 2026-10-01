// 画面ごとの「Subscription を登録 → 通知を受ける → 取り直す」の共通フック
// （FR-008、FR-012、FR-022、contracts/ui-screens.md「画面の更新の流れ」）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FhirClient, FhirError, type ClientId } from "../fhir/client";
import { toDisplayError, type DisplayError } from "../fhir/errors";
import { monitorSocket } from "./monitorSocket";
import { ensureSubscription, openSubscriptionSocket, type SubscriptionSocket, type SubscriptionSpec } from "./subscription";

export interface LiveDataOptions<T> {
  clientId: ClientId;
  subscription: SubscriptionSpec;
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

  const reload = useCallback(async () => {
    try {
      const value = await loadRef.current(client);
      setData(value);
      setErrorState(null);
    } catch (e) {
      setErrorState(toDisplay(e, "取得"));
    } finally {
      setLoading(false);
    }
  }, [client, toDisplay]);

  const depsKey = JSON.stringify(options.deps ?? []);
  useEffect(() => {
    let disposed = false;
    let socket: SubscriptionSocket | null = null;

    const setup = async () => {
      socket?.close();
      socket = null;
      try {
        await ensureSubscription(client, subRef.current);
      } catch (e) {
        if (!disposed) setErrorState(toDisplay(e, "通知の登録"));
        return;
      }
      if (disposed) return;
      socket = openSubscriptionSocket(client.clientId, subRef.current.id, {
        onBound: () => void reload(),
        onPing: () => void reload(),
        onBindError: () => void setup(),
      });
    };

    void reload();
    void setup();
    const unsubscribe = monitorSocket.subscribe((m) => {
      if (m.type === "demo.reset") {
        setData(null);
        void reload();
        void setup();
      }
    });
    return () => {
      disposed = true;
      socket?.close();
      unsubscribe();
    };
  }, [client, reload, toDisplay, depsKey]);

  const clearError = useCallback(() => setErrorState(null), []);
  const setError = useCallback((e: unknown, operationName: string) => setErrorState(toDisplay(e, operationName)), [toDisplay]);

  return { data, error, loading, client, reload, clearError, setError };
}
