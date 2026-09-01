"use client";
import { VOYAGER } from "@/lib/config";
import type { NormalizedFailure } from "@/lib/domain/errors";

export type ReceiptState = "idle" | "pending" | "success" | "rejected" | "error";

export type Receipt = {
  state: ReceiptState;
  title?: string;
  detail?: string;
  hash?: string;
  failure?: NormalizedFailure;
};

export const idleReceipt: Receipt = { state: "idle" };

/**
 * The single place a transaction outcome is shown.
 *
 * Failures always render three things: what happened, which rule caused it, and
 * what to do next. `rejected` is visually distinct from `error` because a contract
 * refusing an unauthorised settlement is the product working correctly, not a bug —
 * and COVERT's central demonstration depends on the user seeing that difference.
 */
export default function ActionReceipt({ receipt }: { receipt: Receipt }) {
  if (receipt.state === "idle") return null;

  const failure = receipt.failure;
  const isRejection = receipt.state === "rejected";

  return (
    <div className={`tx-receipt ${receipt.state}`} role="status" aria-live="polite">
      <div className="tx-receipt-head">
        <span className="tx-dot" aria-hidden="true" />
        <b>{receipt.title ?? failure?.title ?? "Working…"}</b>
        {failure && (
          <code className="failure-code" title="Contract invariant">
            {failure.code}
          </code>
        )}
      </div>

      {(receipt.detail || failure?.detail) && <p>{receipt.detail ?? failure?.detail}</p>}

      {failure && (
        <p className="recovery">
          <span>NEXT</span>
          {failure.recovery}
        </p>
      )}

      {isRejection && failure?.expected && (
        <p className="expected-note">
          This is the contract enforcing a rule, not a malfunction. The attempt and its reason are
          recorded as evidence.
        </p>
      )}

      {receipt.hash && (
        <a href={`${VOYAGER}/${receipt.hash}`} target="_blank" rel="noreferrer">
          Inspect transaction ↗
        </a>
      )}

      {failure?.raw && failure.code === "UNKNOWN" && (
        <details className="raw-error">
          <summary>Raw message</summary>
          <code>{failure.raw}</code>
        </details>
      )}
    </div>
  );
}
