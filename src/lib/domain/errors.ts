/**
 * Failure normalisation.
 *
 * Every failure in COVERT resolves to a named invariant, not a stack trace. This
 * matters for two reasons:
 *
 *  1. The product must tell the user which rule stopped them and what to do next,
 *     so no screen dead-ends on a raw revert string.
 *  2. The adversarial tests assert the *exact* code. "It failed" is not a pass;
 *     a premature settlement must fail with NOT_APPROVED and nothing else.
 *
 * Codes below are the literal `felt252` error constants from
 * cairo/src/covert_policy.cairo and cairo/src/covert_anonymizer.cairo, plus the
 * STRK20 Wallet API rejection codes and local/RPC conditions.
 */

export type FailureClass =
  | "authorization"   // caller is not allowed to do this
  | "state"           // the entity is in the wrong lifecycle state
  | "authentication"  // signature / commitment did not verify
  | "economics"       // reserve, premium or payout rule violated
  | "configuration"   // the deployment is not wired up
  | "wallet"          // the wallet or user refused / cannot proceed
  | "network"         // RPC or confirmation problem
  | "input";          // malformed local input

export type NormalizedFailure = {
  /** Stable machine code. Tests assert on this. */
  code: string;
  class: FailureClass;
  /** Short headline for a receipt. */
  title: string;
  /** What actually happened and which rule enforced it. */
  detail: string;
  /** What the user can do. Never empty — no dead ends. */
  recovery: string;
  /** True when repeating the identical action could succeed later. */
  retryable: boolean;
  /** True when this failure is a correct, expected protocol outcome (not a bug). */
  expected: boolean;
  /** Original message, preserved for the evidence ledger. */
  raw: string;
};

type Spec = Omit<NormalizedFailure, "code" | "raw">;

const CONTRACT: Record<string, Spec> = {
  // ---- authorization -------------------------------------------------------
  NOT_OWNER: {
    class: "authorization",
    title: "Owner-only action",
    detail: "CovertPolicy restricts this entrypoint to the protocol owner recorded at deployment.",
    recovery: "Connect the owner account, or ask the operator to run this step.",
    retryable: true,
    expected: true,
  },
  NOT_ADJUDICATOR: {
    class: "authorization",
    title: "Adjudicator-only action",
    detail:
      "Only the adjudicator address configured at deployment can approve or deny a claim. The owner cannot, and neither can the policyholder.",
    recovery: "Connect the adjudicator wallet shown on the Verify screen, then retry the decision.",
    retryable: true,
    expected: true,
  },
  NOT_ANON: {
    class: "authorization",
    title: "Call did not arrive through the anonymizer",
    detail:
      "CovertPolicy accepts purchase, claim and settlement only from the configured COVERT anonymizer, which in turn accepts only the pinned STRK20 pool.",
    recovery: "Run this action from the COVERT interface so it routes through STRK20, not as a direct contract call.",
    retryable: false,
    expected: true,
  },
  NOT_CONFIGURED: {
    class: "configuration",
    title: "Anonymizer not configured",
    detail: "The policy contract has not yet been pointed at its anonymizer, so no private action can route.",
    recovery: "The operator must run the one-time configure step (cairo/scripts/03-configure.sh).",
    retryable: false,
    expected: true,
  },
  ALREADY_CONFIGURED: {
    class: "state",
    title: "Anonymizer already configured",
    detail: "The anonymizer can be set exactly once. This is deliberate: the privacy route cannot be repointed later.",
    recovery: "No action required. Re-deploy the policy contract if the wiring is genuinely wrong.",
    retryable: false,
    expected: true,
  },

  // ---- policy state --------------------------------------------------------
  POLICY_EXISTS: {
    class: "state",
    title: "Policy commitment already used",
    detail: "Each policy commitment can be purchased once. This one is already registered onchain.",
    recovery: "Activate a fresh policy; COVERT mints a new bearer key and commitment for each purchase.",
    retryable: false,
    expected: true,
  },
  POLICY_MISSING: {
    class: "state",
    title: "No active policy for this commitment",
    detail:
      "The policy does not exist onchain, or it is no longer active because it expired, was denied, or already settled.",
    recovery: "Check the policy on the History screen. If it closed, activate new cover.",
    retryable: false,
    expected: true,
  },
  EXPIRED: {
    class: "state",
    title: "Policy term has ended",
    detail: "The incident must be claimed inside the policy term. The contract compares block time to the onchain expiry.",
    recovery: "This policy can no longer be claimed. Release its exposure with Expire, then activate new cover.",
    retryable: false,
    expected: true,
  },
  NOT_EXPIRED: {
    class: "state",
    title: "Policy has not expired yet",
    detail: "Exposure can only be released after the onchain term ends.",
    recovery: "Wait until the expiry shown on the policy, then retry.",
    retryable: true,
    expected: true,
  },
  POLICY_HAS_CLAIM: {
    class: "state",
    title: "This policy already has a claim",
    detail: "A policy carries exactly one claim slot. It has been consumed.",
    recovery: "Follow the existing claim through adjudication. A second incident needs a second policy.",
    retryable: false,
    expected: true,
  },
  CLAIMED: {
    class: "state",
    title: "Already settled",
    detail: "The replay flag for this claim or policy is already set, so the payout cannot be drawn twice.",
    recovery: "Open the settlement receipt in History. No further action is possible or needed.",
    retryable: false,
    expected: true,
  },
  CLAIM_EXISTS: {
    class: "state",
    title: "Claim commitment already filed",
    detail: "This exact claim commitment is already recorded onchain.",
    recovery: "Refresh the claim status instead of re-filing.",
    retryable: false,
    expected: true,
  },
  CLAIM_MISSING: {
    class: "state",
    title: "Claim not found",
    detail: "No claim with this commitment exists onchain, or it does not belong to the supplied policy.",
    recovery: "Confirm the claim was submitted and confirmed before adjudicating or settling it.",
    retryable: false,
    expected: true,
  },
  DECIDED: {
    class: "state",
    title: "Claim already decided",
    detail: "A claim can be approved or denied exactly once. The decision is final onchain.",
    recovery: "Refresh the claim to see the recorded decision.",
    retryable: false,
    expected: true,
  },
  NOT_APPROVED: {
    class: "state",
    title: "Settlement refused — claim is not approved",
    detail:
      "CovertPolicy.redeem_claim requires claim_decision == APPROVED before it will move a single wei. Adjudication is a contract precondition, not a UI check.",
    recovery: "Have the adjudicator approve the claim on the Verify screen, then run the identical settlement again.",
    retryable: true,
    expected: true,
  },

  // ---- authentication ------------------------------------------------------
  BAD_SIGNATURE: {
    class: "authentication",
    title: "Bearer signature rejected",
    detail:
      "The Stark-curve signature did not verify against the policy's registered bearer key, or it was outside the canonical low-s range.",
    recovery:
      "Use the browser that holds this policy's bearer key. COVERT cannot reconstruct it, and no other wallet can authorise the policy.",
    retryable: false,
    expected: true,
  },
  BAD_COMMITMENT: {
    class: "authentication",
    title: "Commitment binding failed",
    detail:
      "The claim commitment must equal poseidon(policy_commitment, incident_hash). A handle that is not derived from this policy and this incident is rejected.",
    recovery: "Re-file the claim from the Claim screen so the commitment is recomputed correctly.",
    retryable: false,
    expected: true,
  },
  BAD_KEY: {
    class: "authentication",
    title: "Empty bearer key",
    detail: "A policy cannot be registered against a zero public key.",
    recovery: "Activate cover again so a fresh bearer key is generated.",
    retryable: false,
    expected: true,
  },

  // ---- economics -----------------------------------------------------------
  INSOLVENT: {
    class: "economics",
    title: "Reserve cannot back this payout",
    detail:
      "The contract refuses to issue cover or release a payout that would push outstanding exposure past the funded reserve.",
    recovery: "Wait for the operator to fund the reserve, or choose a smaller tier. Reserve state is public on the Reserve screen.",
    retryable: true,
    expected: true,
  },
  BAD_PREMIUM: {
    class: "economics",
    title: "Premium does not match the tier",
    detail: "The premium is fixed onchain per tier. The amount routed did not equal it exactly.",
    recovery: "Retry from the Cover screen so the exact tier premium is routed.",
    retryable: true,
    expected: true,
  },
  BAD_TIER: {
    class: "input",
    title: "Unknown coverage tier",
    detail: "Only tiers 1-3 exist onchain.",
    recovery: "Pick one of the listed tiers.",
    retryable: false,
    expected: true,
  },
  BAD_INPUT_AMOUNT: {
    class: "economics",
    title: "Routed amount did not match",
    detail:
      "The anonymizer holds the exact premium before purchase and the exact payout before returning a note. A different balance means the route was subsidised or short-funded.",
    recovery: "Retry the action from COVERT so the STRK20 pool moves the exact amount.",
    retryable: true,
    expected: true,
  },
  TRANSFER_FAILED: {
    class: "economics",
    title: "Token transfer failed",
    detail: "The STRK transfer underlying this step returned false or reverted.",
    recovery: "Check the STRK balance of the paying account, then retry.",
    retryable: true,
    expected: true,
  },
  AMOUNT_OVERFLOW: {
    class: "economics",
    title: "Amount out of range",
    detail: "A balance exceeded the u128 range the anonymizer accounts in.",
    recovery: "This should not occur at proof-tier sizes. Report it with the transaction hash.",
    retryable: false,
    expected: false,
  },
  APPROVE_FAILED: {
    class: "economics",
    title: "Token approval failed",
    detail: "The anonymizer could not approve the policy or pool to move STRK.",
    recovery: "Retry the action. If it persists, the token address is misconfigured.",
    retryable: true,
    expected: false,
  },

  // ---- anonymizer pinning --------------------------------------------------
  BAD_POOL: {
    class: "authorization",
    title: "Caller is not the pinned STRK20 pool",
    detail:
      "The anonymizer pins the pool address at deployment and checks both the caller and the pool argument. Nothing else can drive it.",
    recovery: "Route the action through STRK20 from the COVERT interface.",
    retryable: false,
    expected: true,
  },
  BAD_TOKEN: {
    class: "authorization",
    title: "Token is not the pinned STRK",
    detail: "The anonymizer only handles the STRK address pinned at deployment.",
    recovery: "No action. This guard blocks routing an unexpected token through COVERT.",
    retryable: false,
    expected: true,
  },
  BAD_POLICY: {
    class: "authorization",
    title: "Policy address is not the pinned policy",
    detail: "The anonymizer refuses to call any policy contract other than the one pinned at deployment.",
    recovery: "No action. This guard prevents the route being aimed at a substituted contract.",
    retryable: false,
    expected: true,
  },
  BAD_OP: {
    class: "input",
    title: "Malformed private operation",
    detail:
      "The operation code was unknown, or a slot that must be zero carried data. Unused arguments are forced to zero so nothing can be smuggled through the pinning layer.",
    recovery: "Retry from the COVERT interface, which composes these calldata slots.",
    retryable: false,
    expected: true,
  },
  BAD_ADDRESS: {
    class: "configuration",
    title: "Zero address rejected",
    detail: "Constructors refuse zero addresses for owner, adjudicator, token, pool or policy.",
    recovery: "Fix the deployment configuration and redeploy.",
    retryable: false,
    expected: true,
  },
  NO_INPUT: {
    class: "economics",
    title: "No funds routed",
    detail: "The anonymizer received nothing to work with.",
    recovery: "Retry so the pool funds the anonymizer in the same transaction.",
    retryable: true,
    expected: true,
  },
};

const WALLET: Record<string, Spec> = {
  USER_REFUSED_OP: {
    class: "wallet",
    title: "Rejected in the wallet",
    detail: "You declined the signature. Nothing was submitted and no state changed.",
    recovery: "Run the action again and approve it in the wallet when you are ready.",
    retryable: true,
    expected: true,
  },
  INSUFFICIENT_PRIVATE_BALANCE: {
    class: "wallet",
    title: "Not enough shielded STRK",
    detail: "The STRK20 private balance cannot cover this action plus the pool fee.",
    recovery: "Shield more STRK on the Cover screen, wait for the new note to mature, then retry.",
    retryable: true,
    expected: true,
  },
  INSUFFICIENT_ACCOUNT_BALANCE: {
    class: "wallet",
    title: "Not enough STRK for fees",
    detail: "The public account cannot pay the transaction fee.",
    recovery: "Top up the public account with STRK, then retry.",
    retryable: true,
    expected: true,
  },
  NOT_REGISTERED: {
    class: "wallet",
    title: "Wallet is not registered with STRK20",
    detail: "This account has never deposited into the STRK20 pool, so it has no private balance to spend.",
    recovery: "Make a shield deposit on the Cover screen first. That first deposit is public.",
    retryable: true,
    expected: true,
  },
  API_VERSION_NOT_SUPPORTED: {
    class: "wallet",
    title: "Wallet STRK20 API is too old",
    detail: "COVERT needs the STRK20 Wallet API at 0.10.3 or newer.",
    recovery: "Update the wallet extension, then reconnect.",
    retryable: false,
    expected: true,
  },
  PRIVACY_LEAK: {
    class: "wallet",
    title: "Wallet blocked a leaky action",
    detail: "The wallet refused to compose these actions because doing so would expose private state.",
    recovery: "Review the action set and retry. Do not work around this guard.",
    retryable: false,
    expected: true,
  },
  WRONG_NETWORK: {
    class: "wallet",
    title: "Wrong network",
    detail: "COVERT operates on Starknet Mainnet only.",
    recovery: "Switch the wallet to Starknet Mainnet and reconnect.",
    retryable: true,
    expected: true,
  },
  NOT_CONNECTED: {
    class: "wallet",
    title: "No wallet connected",
    detail: "This action needs a connected, privacy-capable Starknet wallet.",
    recovery: "Connect a wallet from the header, then retry.",
    retryable: true,
    expected: true,
  },
};

const LOCAL: Record<string, Spec> = {
  NOT_DEPLOYED: {
    class: "configuration",
    title: "COVERT contracts are not configured",
    detail:
      "NEXT_PUBLIC_COVERT_POLICY_ADDRESS / NEXT_PUBLIC_COVERT_ANONYMIZER_ADDRESS are unset, so there is nothing live to call.",
    recovery:
      "Deploy with cairo/scripts and set both addresses, or open Replay to inspect a captured lifecycle instead.",
    retryable: false,
    expected: true,
  },
  RPC_UNAVAILABLE: {
    class: "network",
    title: "Cannot reach a Starknet node",
    detail: "Every configured RPC endpoint failed to answer.",
    recovery: "Check the connection or set NEXT_PUBLIC_PROVIDER_URL, then refresh. Local state is preserved.",
    retryable: true,
    expected: true,
  },
  CONFIRMATION_TIMEOUT: {
    class: "network",
    title: "Confirmation timed out",
    detail:
      "The transaction was submitted but did not appear at the RPC within the wait window. It may still confirm.",
    recovery: "Keep the hash. Check it on Voyager, then use Reconcile on the policy before retrying anything.",
    retryable: false,
    expected: true,
  },
  TX_REVERTED: {
    class: "state",
    title: "Transaction reverted onchain",
    detail: "The transaction was included but reverted. No state changed.",
    recovery: "Read the revert reason below, resolve it, then retry.",
    retryable: true,
    expected: true,
  },
  DUPLICATE_IN_FLIGHT: {
    class: "state",
    title: "Same action already running",
    detail: "COVERT blocks a second identical submission while the first is unconfirmed, so a policy cannot be double-paid.",
    recovery: "Wait for the pending transaction to settle. Its status is on the policy timeline.",
    retryable: true,
    expected: true,
  },
  NO_ELIGIBLE_POLICY: {
    class: "state",
    title: "No claimable policy",
    detail: "Filing a claim needs an active, unexpired policy with its claim slot unused.",
    recovery: "Activate cover first, or pick a different policy.",
    retryable: false,
    expected: true,
  },
  INCIDENT_TOO_SHORT: {
    class: "input",
    title: "Incident description too short",
    detail: "The incident text must be at least 8 characters before it can be committed.",
    recovery: "Describe what happened, then file the claim.",
    retryable: true,
    expected: true,
  },
  PACKET_MALFORMED: {
    class: "input",
    title: "Reveal packet is malformed",
    detail: "The pasted packet is not valid COVERT reveal JSON.",
    recovery: "Ask the claimant to re-export the packet from the Claim screen.",
    retryable: true,
    expected: true,
  },
  PACKET_MISMATCH: {
    class: "authentication",
    title: "Reveal does not reproduce its commitments",
    detail:
      "Recomputing poseidon over the revealed incident text and salt did not reproduce the committed incident hash or claim commitment. The packet has been altered.",
    recovery: "Do not approve. Request a fresh packet from the claimant and compare hashes.",
    retryable: false,
    expected: true,
  },
  PACKET_CHAIN_MISMATCH: {
    class: "authentication",
    title: "Reveal does not match onchain claim",
    detail: "The packet recomputes internally but its policy or incident hash differs from the claim recorded onchain.",
    recovery: "Do not approve. The packet does not describe the claim that was actually filed.",
    retryable: false,
    expected: true,
  },
  REPLAY_READ_ONLY: {
    class: "state",
    title: "Replay mode is read-only",
    detail: "You are inspecting captured evidence from a previous real execution. Replay never signs or submits anything.",
    recovery: "Leave replay mode and connect a wallet to act on live state.",
    retryable: false,
    expected: true,
  },
};

const ALL: Record<string, Spec> = { ...CONTRACT, ...WALLET, ...LOCAL };

const UNKNOWN: Spec = {
  class: "network",
  title: "Action did not complete",
  detail: "COVERT could not map this failure to a known protocol rule.",
  recovery: "Retry once. If it repeats, capture the raw message below with the transaction hash.",
  retryable: true,
  expected: false,
};

/** Longest-first so CLAIM_EXISTS is never shadowed by CLAIMED. */
const CODES = Object.keys(ALL).sort((a, b) => b.length - a.length);

export function makeFailure(code: string, raw?: string): NormalizedFailure {
  const spec = ALL[code] ?? UNKNOWN;
  return { code: ALL[code] ? code : "UNKNOWN", ...spec, raw: raw ?? code };
}

/**
 * Turn anything thrown anywhere in COVERT into a named invariant.
 *
 * Starknet reverts surface the felt error as text inside a longer message
 * ("Failure reason: 0x...('NOT_APPROVED')"), so we scan for known codes rather than
 * trying to parse a specific node's formatting.
 */
export function normalizeError(e: unknown): NormalizedFailure {
  if (isNormalized(e)) return e;

  const err = e as { code?: unknown; message?: string; covertCode?: string } | undefined;
  const raw = typeof err?.message === "string" && err.message ? err.message : String(e ?? "");

  // Explicitly tagged by COVERT's own code paths.
  if (typeof err?.covertCode === "string" && ALL[err.covertCode]) return makeFailure(err.covertCode, raw);

  const haystack = `${String(err?.code ?? "")} ${raw}`.toUpperCase();

  for (const code of CODES) {
    if (haystack.includes(code)) return makeFailure(code, raw);
  }

  // Shapes that do not carry a code word.
  if (/USER\s*(REFUSED|REJECTED|DENIED|ABORT)/.test(haystack) || /REJECTED BY (THE )?USER/.test(haystack)) {
    return makeFailure("USER_REFUSED_OP", raw);
  }
  if (/\bREVERT/.test(haystack)) return makeFailure("TX_REVERTED", raw);
  if (/FETCH FAILED|NETWORK ERROR|ECONNREFUSED|ENOTFOUND|FAILED TO FETCH|504|502|503/.test(haystack)) {
    return makeFailure("RPC_UNAVAILABLE", raw);
  }
  if (/TIMED? ?OUT|TIMEOUT/.test(haystack)) return makeFailure("CONFIRMATION_TIMEOUT", raw);

  return { code: "UNKNOWN", ...UNKNOWN, raw };
}

export function isNormalized(e: unknown): e is NormalizedFailure {
  return Boolean(
    e && typeof e === "object" && typeof (e as NormalizedFailure).code === "string" &&
    typeof (e as NormalizedFailure).recovery === "string" &&
    typeof (e as NormalizedFailure).class === "string",
  );
}

/** Throw a named COVERT failure from application code. */
export class CovertError extends Error {
  readonly covertCode: string;
  constructor(code: string, extra?: string) {
    const spec = ALL[code] ?? UNKNOWN;
    super(extra ? `${code}: ${extra}` : `${code}: ${spec.detail}`);
    this.name = "CovertError";
    this.covertCode = code;
  }
}

export function fail(code: string, extra?: string): never {
  throw new CovertError(code, extra);
}
