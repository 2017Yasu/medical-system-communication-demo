import type { OrderRow } from "../shared/orders";
import { orderNumber, orderedSetNames } from "../shared/orders";
import { SrStatus, TaskStatus, ownerLabel } from "../shared/StatusBadges";

/** 自分が出した依頼の一覧：依頼の状態・作業の状態・業務上の状態・担当者を並べて見せる（FR-007）。 */
export function OrderList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: OrderRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel" aria-label="依頼の一覧">
      <h2>依頼の一覧</h2>
      {rows.length === 0 ? (
        <p className="muted">まだ依頼がありません。</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>オーダー番号</th>
              <th>患者</th>
              <th>検査</th>
              <th>依頼の状態</th>
              <th>作業の状態</th>
              <th>担当</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = row.sr.resource.id!;
              return (
                <tr key={id} className={id === selectedId ? "selected" : ""} data-testid={`order-${id}`}>
                  <td>{orderNumber(row.sr.resource)}</td>
                  <td>{row.patientName}</td>
                  <td>{orderedSetNames(row.sr.resource)}</td>
                  <td>
                    <SrStatus status={row.sr.resource.status} />
                  </td>
                  <td>
                    <TaskStatus task={row.task?.resource} />
                  </td>
                  <td>{ownerLabel(row)}</td>
                  <td>
                    <button type="button" onClick={() => onSelect(id)} data-guide={`view-result-${id}`}>
                      結果を見る
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
