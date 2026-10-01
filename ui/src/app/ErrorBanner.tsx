import type { DisplayError } from "../fhir/errors";

/** エラーの帯。業務上の意味を主に、HTTP の表記を併記する（FR-032）。 */
export function ErrorBanner({ error, onDismiss }: { error: DisplayError | null; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" data-testid="error-banner" style={styles.banner}>
      <div style={{ flex: 1 }}>
        <strong>{error.message}</strong>
        {error.httpLabel && <code style={styles.code}>{error.httpLabel}</code>}
        {error.detail && <div style={styles.detail}>{error.detail}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} style={styles.close}>
          閉じる
        </button>
      )}
    </div>
  );
}

const styles = {
  banner: {
    display: "flex",
    gap: "var(--sp-3)",
    alignItems: "flex-start",
    padding: "var(--sp-3)",
    margin: "var(--sp-2) 0",
    border: "1px solid var(--c-error)",
    borderRadius: "var(--radius)",
    background: "#ffebe9",
    color: "var(--c-text)",
  },
  code: { marginLeft: "var(--sp-2)", fontSize: "var(--fs-small)", color: "var(--c-muted)" },
  detail: { marginTop: "var(--sp-1)", fontSize: "var(--fs-small)", color: "var(--c-muted)" },
  close: { font: "inherit", cursor: "pointer" },
} as const;
