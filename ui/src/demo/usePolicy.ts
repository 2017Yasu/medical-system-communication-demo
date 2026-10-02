// 最新のデモのポリシーを保持するフック：開いたとき・再接続のときに GET、以後は demo.policy / demo.reset で更新する。
import { useEffect, useReducer, useState } from "react";
import { getPolicy } from "../realtime/demoApi";
import { monitorSocket } from "../realtime/monitorSocket";
import type { DemoPolicy } from "../realtime/types";
import { INITIAL_POLICY_STATE, reducePolicy } from "./policyState";

export function usePolicy(): { policy: DemoPolicy | null; error: string | null } {
  const [state, dispatch] = useReducer(reducePolicy, INITIAL_POLICY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => monitorSocket.subscribe(dispatch), []);

  useEffect(() => {
    if (state.stale) setFetchKey((k) => k + 1);
  }, [state.stale]);

  useEffect(() => {
    let cancelled = false;
    getPolicy()
      .then((p) => {
        if (!cancelled) {
          dispatch({ type: "demo.policy", policy: p });
          setError(null);
        }
      })
      .catch(() => !cancelled && setError("設定を取得できません"));
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  return { policy: state.policy, error };
}
