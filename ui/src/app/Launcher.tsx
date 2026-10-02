import { Link } from "react-router";
import { ResetButton } from "./ResetButton";

const card: React.CSSProperties = { display: "block", textDecoration: "none", color: "inherit" };

/** 入口：講演モード・自習モード・個別ウィンドウ（contracts/ui-screens.md「ルート」）。 */
export function Launcher() {
  return (
    <main className="screen" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <header className="screen-header">
        <h1>医療システム連携デモ</h1>
        <span className="spacer" />
        <ResetButton />
      </header>
      <p className="muted">電子カルテと部門システムが、FHIR サーバーを介して連携する様子を見せるデモです（すべて架空のデータです）。</p>
      <div className="row" style={{ alignItems: "stretch" }}>
        <Link to="/stage?mode=presentation" className="panel" style={{ ...card, flex: 1 }}>
          <h2>講演モード</h2>
          <p>電子カルテ・検体検査システム・通信モニタを 1 画面に並べ、ステップごとに解説しながら進めます。</p>
        </Link>
        <Link to="/stage?mode=self-study" className="panel" style={{ ...card, flex: 1 }}>
          <h2>自習モード</h2>
          <p>画面上の案内に従って、自分で操作しながら流れを学びます。</p>
        </Link>
      </div>
      <section className="panel">
        <h2>個別のウィンドウで開く</h2>
        <p className="muted">別のウィンドウや外部モニタに分けて表示するときに使います。</p>
        <ul>
          <li><Link to="/ehr?role=doctor">電子カルテ（医師 X）</Link></li>
          <li><Link to="/ehr?role=nurse">電子カルテ（看護師 D）</Link></li>
          <li><Link to="/ehr/ct?doctor=dr-x">電子カルテ CT 予約（医師 X）</Link></li>
          <li><Link to="/ehr/ct?doctor=dr-y">電子カルテ CT 予約（医師 Y）</Link></li>
          <li><Link to="/ris">放射線部門システム</Link></li>
          <li><Link to="/lis?tech=tech-a">検体検査システム（技師 A）</Link></li>
          <li><Link to="/lis?tech=tech-b">検体検査システム（技師 B）</Link></li>
          <li><Link to="/monitor">通信モニタ</Link></li>
          <li><Link to="/control">デモ制御パネル</Link></li>
        </ul>
      </section>
      <section className="panel" aria-label="S2 同時受付で開くウィンドウ">
        <h2>S2 同時受付で開くウィンドウ</h2>
        <ul>
          <li><Link to="/control">デモ制御パネル</Link></li>
          <li><Link to="/lis?tech=tech-a">検体検査システム（技師 A）</Link></li>
          <li><Link to="/lis?tech=tech-b">検体検査システム（技師 B）</Link></li>
          <li><Link to="/monitor">通信モニタ</Link></li>
        </ul>
        <p className="muted">操作の手順は docs/06-demo-procedures.md を参照してください。</p>
      </section>
      <section className="panel" aria-label="S3 予約枠の取り合いで開くウィンドウ">
        <h2>S3 予約枠の取り合いで開くウィンドウ</h2>
        <ul>
          <li><Link to="/control">デモ制御パネル</Link></li>
          <li><Link to="/ehr/ct?doctor=dr-x">電子カルテ CT 予約（医師 X）</Link></li>
          <li><Link to="/ehr/ct?doctor=dr-y">電子カルテ CT 予約（医師 Y）</Link></li>
          <li><Link to="/ris">放射線部門システム</Link></li>
          <li><Link to="/monitor">通信モニタ</Link></li>
        </ul>
        <p className="muted">操作の手順は docs/06-demo-procedures.md を参照してください。</p>
      </section>
    </main>
  );
}
