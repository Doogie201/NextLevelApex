interface DetailsScreenProps {
  stdout: string;
  stderr: string;
}

async function copyToClipboard(content: string): Promise<void> {
  if (!content) {
    return;
  }
  await navigator.clipboard.writeText(content);
}

export function DetailsScreen({ stdout, stderr }: DetailsScreenProps) {
  const merged = [stdout, stderr].filter(Boolean).join("\n").trim();

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Details</h2>
        <p className="subtle">Redacted command output for diagnostics and troubleshooting.</p>
      </header>

      <button className="secondary" onClick={() => void copyToClipboard(merged)} disabled={!merged}>
        Copy Output
      </button>

      <details open>
        <summary>stdout</summary>
        <pre>{stdout || "(empty)"}</pre>
      </details>

      <details>
        <summary>stderr</summary>
        <pre>{stderr || "(empty)"}</pre>
      </details>
    </section>
  );
}
