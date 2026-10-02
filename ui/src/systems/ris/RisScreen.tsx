import { Link } from "react-router";
import { ErrorBanner } from "../../app/ErrorBanner";
import { formatSlotTime, formatStatus, radBusinessStatusLabel, statusLabel } from "../../fhir/labels";
import { useLiveData } from "../../realtime/useLiveData";
import { taskBusinessStatus } from "../shared/orders";
import { useRowChanges } from "../shared/rowChanges";
import { diffSlotRows, loadRisData, type BookingRow, type SlotRow } from "../shared/slots";

const FIELD_LABEL: Record<string, string> = { status: "状態", holder: "押さえた人", bookings: "予約" };

/** 放射線部門システム：予約枠のカレンダーと、通知で届く予約・作業の一覧。予約の受信と表示までで、受付・撮影の操作は無い（D-34）。 */
export function RisScreen() {
  const live = useLiveData({
    clientId: "ris",
    subscription: [
      { id: "ris-slots", criteria: "Slot?schedule=Schedule/ct-1", reason: "CT-1 号機の予約枠の通知" },
      { id: "ris-tasks", criteria: "Task?owner=Organization/rad-dept", reason: "放射線部宛ての作業（予約）の通知" },
    ],
    load: loadRisData,
  });
  const rows: SlotRow[] = live.data?.rows ?? [];
  const changes = useRowChanges(live.data ? live.data.rows : null, diffSlotRows);
  const bookings: { row: SlotRow; booking: BookingRow }[] = rows.flatMap((row) => row.bookings.map((booking) => ({ row, booking })));

  return (
    <div>
      <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
        <h1>放射線部門システム</h1>
        <span className="spacer" />
        <Link to="/">入口へ</Link>
      </header>
      <div className="screen">
        <ErrorBanner error={live.error} onDismiss={live.clearError} />
        <section className="panel" aria-label="予約枠のカレンダー">
          <h2>CT-1 号機の予約枠</h2>
          {rows.length === 0 ? (
            <p className="muted">予約枠はありません。</p>
          ) : (
            <table className="data" data-testid="ris-calendar">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>枠の状態</th>
                  <th>予約</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.slot.resource.id!;
                  const change = changes.find((c) => c.srId === id);
                  return (
                    <tr
                      key={id}
                      className={[change ? "row-changed" : "", row.doubleBooked ? "double-booked" : ""].join(" ").trim() || undefined}
                      data-testid={`ris-slot-${id}`}
                    >
                      <td>{formatSlotTime(row.slot.resource.start, row.slot.resource.end)}</td>
                      <td>
                        {formatStatus("slot", row.slot.resource.status)}
                        {row.holder && <span>（{row.holder}）</span>}
                        {row.bookedButFree && <div className="muted">枠は空きのまま</div>}
                        {change && (
                          <div className="row-change" data-testid={`row-change-${id}`}>
                            {change.fields.map((f) => (
                              <div key={f.field}>
                                {FIELD_LABEL[f.field] ?? f.field}：{f.before} → {f.after}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {row.bookings.length === 0 ? "—" : row.bookings.map((b) => b.patientName).join("・")}
                        {row.doubleBooked && (
                          <div className="double-booking-note" data-testid={`ris-double-booking-${id}`}>
                            同じ枠に予約が {row.bookings.length} 件あります
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel" aria-label="予約・作業の一覧">
          <h2>予約・作業の一覧</h2>
          {bookings.length === 0 ? (
            <p className="muted">予約はありません。</p>
          ) : (
            <table className="data" data-testid="ris-orders">
              <thead>
                <tr>
                  <th>予約日時</th>
                  <th>患者</th>
                  <th>検査内容</th>
                  <th>依頼医</th>
                  <th>オーダー番号</th>
                  <th>作業の状態</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(({ row, booking }) => {
                  const task = booking.task?.resource;
                  const business = taskBusinessStatus(task);
                  return (
                    <tr key={booking.appointment.resource.id} data-testid={`ris-order-${booking.appointment.resource.id}`}>
                      <td>{formatSlotTime(row.slot.resource.start, row.slot.resource.end)}</td>
                      <td>{booking.patientName}</td>
                      <td>{booking.procedure ?? "（初期データの予約）"}</td>
                      <td>{booking.doctor ?? "（初期データの予約）"}</td>
                      <td>{booking.orderNumber ?? "（初期データの予約）"}</td>
                      <td>
                        {task
                          ? `${statusLabel("task", task.status)} ${task.status}・${business ? radBusinessStatusLabel(business) : "—"}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
