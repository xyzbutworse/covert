"use client";
import { VOYAGER } from "@/lib/config";
import { short } from "@/lib/domain/ids";
import type { LifecycleEvent, LifecycleEventKind } from "@/lib/domain/types";

/** Headline per event kind. The event's own `note` carries the specifics. */
const TITLES: Record<LifecycleEventKind, string> = {
  "funding.shield_submitted": "Shield submitted",
  "funding.shield_confirmed": "Shield confirmed",
  "funding.shield_failed": "Shield failed",
  "funding.note_matured": "Private note ready to spend",
  "policy.key_created": "Bearer key minted",
  "policy.purchase_submitted": "Cover purchase submitted",
  "policy.activated": "Policy activated",
  "policy.purchase_failed": "Cover purchase failed",
  "policy.expired": "Policy expired",
  "claim.drafted": "Incident committed",
  "claim.submitted": "Claim submitted",
  "claim.submit_failed": "Claim submission failed",
  "claim.confirmed": "Claim filed onchain",
  "claim.packet_exported": "Reveal packet exported",
  "claim.packet_imported": "Reveal packet imported",
  "claim.reveal_verified": "Reveal verified",
  "claim.reveal_rejected": "Reveal rejected",
  "claim.approved": "Claim approved",
  "claim.denied": "Claim denied",
  "settlement.attempted": "Settlement attempted",
  "settlement.rejected": "Settlement rejected",
  "settlement.submitted": "Settlement submitted",
  "settlement.confirmed": "Private payout confirmed",
  "settlement.failed": "Settlement did not complete",
  "reserve.observed": "Reserve read",
  "balance.observed": "Balance read",
};

type Tone = "neutral" | "good" | "bad" | "warn";

function toneFor(kind: LifecycleEventKind): Tone {
  if (kind.endsWith("_failed") || kind === "claim.reveal_rejected") return "bad";
  if (kind === "settlement.rejected" || kind === "claim.denied") return "warn";
  if (
    kind === "policy.activated" ||
    kind === "claim.confirmed" ||
    kind === "claim.approved" ||
    kind === "settlement.confirmed" ||
    kind === "funding.shield_confirmed" ||
    kind === "claim.reveal_verified"
  ) {
    return "good";
  }
  return "neutral";
}

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * The complete, ordered history of one policy.
 *
 * Every entry is a stored event with its own timestamp — nothing here is
 * reconstructed for display. `source` is shown because "the chain told us" and
 * "this browser recorded it" are different kinds of claim.
 */
export default function Timeline({
  events,
  emptyLabel = "Nothing has happened yet.",
}: {
  events: LifecycleEvent[];
  emptyLabel?: string;
}) {
  if (!events.length) return <div className="empty">{emptyLabel}</div>;

  return (
    <ol className="timeline">
      {events.map((ev) => {
        const tone = toneFor(ev.kind);
        return (
          <li key={ev.id} className={`timeline-item ${tone}`}>
            <div className="timeline-marker" aria-hidden="true" />
            <div className="timeline-body">
              <div className="timeline-head">
                <b>{TITLES[ev.kind] ?? ev.kind}</b>
                <time dateTime={new Date(ev.ts).toISOString()}>{when(ev.ts)}</time>
              </div>
              {ev.note && <p>{ev.note}</p>}
              <div className="timeline-meta">
                <span className={`src src-${ev.source}`}>
                  {ev.source === "chain" ? "CHAIN" : ev.source === "replay" ? "REPLAY" : "LOCAL"}
                </span>
                {ev.reason && <code className="failure-code">{ev.reason}</code>}
                {ev.txHash && (
                  <a href={`${VOYAGER}/${ev.txHash}`} target="_blank" rel="noreferrer">
                    {short(ev.txHash)} ↗
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
