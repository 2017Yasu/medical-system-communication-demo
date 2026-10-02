# ドキュメント一覧

医療機関における FHIR Repository サーバーと部門システム間連携のデモンストレーションに関する設計ドキュメント。
現段階はドキュメント先行で、実装はこれらの内容をもとに後から行う。

| ファイル | 内容 |
|---|---|
| [01-overview.md](01-overview.md) | 目的・対象者・デモ形式・基本原則 |
| [02-demo-scenarios.md](02-demo-scenarios.md) | デモシナリオ（検体検査・排他制御・放射線予約枠・処方調剤・Message Bundle） |
| [03-architecture.md](03-architecture.md) | アーキテクチャと技術スタック（fhirstarters skeleton ベース） |
| [04-design-rules.md](04-design-rules.md) | FHIR が規定せず実装側で決めるルール（状態遷移・排他制御・コード体系・表示ラベル） |
| [05-decisions.md](05-decisions.md) | 決定事項・未決事項・技術検証項目 |
| [06-demo-procedures.md](06-demo-procedures.md) | デモ手順書（画面上の案内を出さないシナリオ。S2 同時受付・S3 予約枠の取り合いの操作手順） |

## 参考資料

- 「HL7 FHIR R4 による電子カルテ–部門システム間連携方式に関する検討」（JAHIS 次世代データ交換技術WG 勉強会資料、2026年4月版）
- 「FHIR ワークフローにおける排他制御とロックの規定」
- [HL7 FHIR R4](https://hl7.org/fhir/R4/) / [Workflow](https://hl7.org/fhir/R4/workflow.html) / [Task](https://hl7.org/fhir/R4/task.html) / [HTTP - Managing Resource Contention](https://hl7.org/fhir/R4/http.html#concurrency)
- [JP Core FHIR](https://jpfhir.jp/)
- [FirelyTeam/fhirstarters - hapi-fhirstarters-rest-server-skeleton](https://github.com/FirelyTeam/fhirstarters/tree/master/java/hapi-fhirstarters-rest-server-skeleton)
- [HAPI FHIR Plain Server - REST Operations](https://hapifhir.io/hapi-fhir/docs/server_plain/rest_operations.html)
