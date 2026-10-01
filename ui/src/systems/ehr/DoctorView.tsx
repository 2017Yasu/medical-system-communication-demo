import { useEffect, useState } from "react";
import { ErrorBanner } from "../../app/ErrorBanner";
import { useLiveData } from "../../realtime/useLiveData";
import { SHOW_RESULT_EVENT } from "../../scenario/events";
import { FhirError } from "../../fhir/client";
import { cancelOrder } from "../../fhir/labActions";
import { loadDoctorOrders, type OrderRow } from "../shared/orders";
import { OrderForm } from "./OrderForm";
import { OrderList } from "./OrderList";
import { ResultView } from "./ResultView";

/** 電子カルテ（医師 X）：依頼を出し、進捗と結果を見る。 */
export function DoctorView() {
  const live = useLiveData({
    clientId: "ehr-doctor",
    subscription: {
      id: "ehr-dr-x",
      criteria: "Task?requester=Practitioner/dr-x",
      reason: "医師 X が出した依頼の作業の通知",
    },
    load: loadDoctorOrders,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const rows = live.data?.rows ?? [];
  const selectedRow = rows.find((r) => r.sr.resource.id === selected) ?? null;

  // シナリオの自動実行（ステップ 8）から、最新の依頼の結果を開く
  const latestId = rows[0]?.sr.resource.id ?? null;
  useEffect(() => {
    const open = () => latestId && setSelected(latestId);
    window.addEventListener(SHOW_RESULT_EVENT, open);
    return () => window.removeEventListener(SHOW_RESULT_EVENT, open);
  }, [latestId]);

  /** 取消。競合（412）などは表示して最新を取り直し、自動ではやり直さない。 */
  const cancel = async (row: OrderRow) => {
    try {
      await cancelOrder(live.client, { sr: row.sr, task: row.task! });
      await live.reload();
    } catch (e) {
      if (e instanceof FhirError) {
        live.setError(e, "取消");
        await live.reload();
      } else throw e;
    }
  };

  return (
    <div className="screen">
      <ErrorBanner error={live.error} onDismiss={live.clearError} />
      <OrderForm
        client={live.client}
        patients={live.data?.patients ?? []}
        existingOrderCount={rows.length}
        onDone={() => void live.reload()}
        onError={(e, op) => live.setError(e, op)}
      />
      <OrderList rows={rows} selectedId={selected} onSelect={setSelected} onCancel={cancel} />
      <ResultView client={live.client} row={selectedRow} />
    </div>
  );
}
