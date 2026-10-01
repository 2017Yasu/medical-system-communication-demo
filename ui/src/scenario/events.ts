/** シナリオの自動実行から画面へ：医師の画面で最新の依頼の結果を開く（ステップ 8）。 */
export const SHOW_RESULT_EVENT = "demo:show-result";

export function requestShowResult(): void {
  window.dispatchEvent(new CustomEvent(SHOW_RESULT_EVENT));
}
