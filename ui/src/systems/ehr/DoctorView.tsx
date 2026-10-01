import { useState } from "react";
import { ErrorBanner } from "../../app/ErrorBanner";
import { useLiveData } from "../../realtime/useLiveData";
import { loadDoctorOrders } from "../shared/orders";
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
      <OrderList rows={rows} selectedId={selected} onSelect={setSelected} />
      <ResultView client={live.client} row={selectedRow} />
    </div>
  );
}
