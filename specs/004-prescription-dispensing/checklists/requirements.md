# Specification Quality Checklist: S4 処方調剤（外来・入院）

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-02
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- S1〜S3 と同じく、MedicationRequest・Task・MedicationDispense・If-Match・412 などの FHIR / HTTP の用語は、デモが利用者に見せる内容（ドメインの語彙）として記載している。
  言語・フレームワーク・ライブラリは記載していないため「実装の詳細なし」と判定した（Input 欄の利用者の記述を除く）。
- 決定事項 D-41〜D-50 を仕様作成の前に docs/05 に記録したため、[NEEDS CLARIFICATION] は 0 件。
- 計画で決める事項として残したもの：入院のステップ 1〜4 を短時間で送る方法（FR-027、SC-002 で 1 分以内と測れる形にした）、具体的な薬剤とコード（FR-004、Assumptions）。
- 画面側の制限として仮定したもの（D-46 の「操作者による制限は画面側で行う」から導いた）：調剤した薬剤師は監査を始められない、監査を始めた薬剤師だけがお渡し・払出できる（FR-015〜FR-017、Edge Cases）。
- 全項目合格。`/speckit-clarify` または `/speckit-plan` に進める。
