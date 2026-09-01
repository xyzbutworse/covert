export type Tone = "neutral" | "good" | "warn" | "bad" | "live";

/**
 * Status is never conveyed by colour alone: the label always carries the meaning,
 * and the tone only reinforces it.
 */
export default function StatusPill({
  label,
  tone = "neutral",
  title,
}: {
  label: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span className={`status ${tone}`} title={title}>
      {tone === "live" && <i className="pulse" aria-hidden="true" />}
      {label}
    </span>
  );
}
