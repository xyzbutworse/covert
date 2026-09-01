import Link from "next/link";
import InspectionSpecimen from "@/components/InspectionSpecimen";
import { ArrowIcon, DocumentIcon, RosetteIcon, ScanIcon } from "@/components/SpecimenIcons";
import { DEVNET_LIFECYCLE, isUsable } from "@/lib/replay/artifact";
import { formatStrk } from "@/lib/config";
import manifest from "../../strk20.json";

export default function Home() {
  const mainnetRecorded =
    manifest.transactions.length >= 3 && manifest.contracts.length >= 2;
  const replay = isUsable(DEVNET_LIFECYCLE) ? DEVNET_LIFECYCLE : null;

  return (
    <>
      <section className="specimen-home">
        <div className="specimen-stage">
          <InspectionSpecimen />
        </div>
        <aside className="hero-rail">
          <div className={`evidence-state ${replay ? "recorded" : "pending"}`}>
            <ScanIcon />
            <span>
              {mainnetRecorded
                ? "MAINNET EVIDENCE RECORDED"
                : replay
                  ? "LIFECYCLE VERIFIED — MAINNET PENDING"
                  : "EVIDENCE PENDING"}
            </span>
          </div>

          {/* The outcome first. The mechanism that produces it comes later. */}
          <h1>
            Get paid for an incident
            <br />
            without publishing who got paid.
          </h1>
          <p>
            COVERT is fixed-payout incident cover for onchain teams. Activate a policy, file a claim when
            something breaks, and receive the approved payout into your private STRK20 balance instead of a
            public transfer that ties your treasury to the settlement.
          </p>

          <div className="hero-actions">
            <Link className="primary" href="/cover">
              <span>Activate cover</span>
              <ArrowIcon />
            </Link>
            <Link className="ghost" href="/replay">
              <span>See a real lifecycle</span>
              <ScanIcon />
            </Link>
          </div>

          <dl className="consequence-readings">
            <div>
              <dt>Payout to your public wallet</dt>
              <dd className="copper">
                {replay
                  ? `${formatStrk(BigInt(replay.balances.payoutCreditedToPublicWallet ?? "0"), 2)} STRK`
                  : "0.00 STRK"}
              </dd>
            </div>
            <div>
              <dt>Payout to your private balance</dt>
              <dd className="mint">
                {replay ? `+${formatStrk(BigInt(replay.balances.privateDelta ?? "0"), 2)} STRK` : "+ fixed payout"}
              </dd>
            </div>
            <div>
              <dt>Beneficiary in the payout path</dt>
              <dd className="violet">Absent</dd>
            </div>
          </dl>

          {replay && (
            <p className="hint">
              Those two figures were measured during a recorded execution, not written by hand.{" "}
              <Link href="/proof">Check the evidence →</Link>
            </p>
          )}
        </aside>
      </section>

      {/* ------------------------------------------- how it works -------- */}
      <section className="evidence-path" aria-labelledby="path-title">
        <header>
          <span>HOW IT WORKS</span>
          <h2 id="path-title">
            Three steps you take.
            <br />
            One consequence you can check.
          </h2>
        </header>
        <div className="evidence-strips">
          <article>
            <DocumentIcon />
            <div>
              <span>Step one</span>
              <h3>Activate cover</h3>
              <p>
                Pick a tier and pay its fixed premium from your shielded balance. The contract sets the term
                and the payout — this interface cannot.
              </p>
            </div>
            <b>01</b>
          </article>
          <article>
            <RosetteIcon />
            <div>
              <span>Step two</span>
              <h3>File a claim</h3>
              <p>
                Describe the incident. Only a salted commitment is published; the description itself goes to
                the adjudicator privately, and your policy key signs the claim.
              </p>
            </div>
            <b>02</b>
          </article>
          <article>
            <ScanIcon size={28} />
            <div>
              <span>Step three</span>
              <h3>Get paid privately</h3>
              <p>
                Once approved, the fixed payout returns to your STRK20 balance as a note. Before approval the
                contract refuses to pay at all.
              </p>
            </div>
            <b>03</b>
          </article>
        </div>
      </section>

      {/* ------------------------------------------- honest boundary ----- */}
      <section className="privacy-ledger">
        <header>
          <span>Where the privacy actually is</span>
          <h2>A narrow claim, stated plainly.</h2>
          <p>
            Your first deposit into STRK20 is public and COVERT never says otherwise. What it breaks is the
            link between the wallet holding a policy and the destination receiving its payout. Timing, amount
            and a small anonymity set can still correlate — this is not invisibility.
          </p>
        </header>
        <div className="ledger-columns">
          <div>
            <b>PUBLIC RECORD</b>
            <dl>
              <div>
                <dt>Policy terms and payout</dt>
                <dd>Visible</dd>
              </div>
              <div>
                <dt>Reserve and exposure</dt>
                <dd>Visible</dd>
              </div>
              <div>
                <dt>Your initial shield deposit</dt>
                <dd>Visible</dd>
              </div>
              <div>
                <dt>Claim commitment</dt>
                <dd>Visible, salted</dd>
              </div>
            </dl>
          </div>
          <div>
            <b>NOT PUBLISHED</b>
            <dl>
              <div>
                <dt>Which wallet holds which policy</dt>
                <dd>Not attached</dd>
              </div>
              <div>
                <dt>What the incident was</dt>
                <dd>Offchain reveal</dd>
              </div>
              <div>
                <dt>Beneficiary address</dt>
                <dd>Absent from the payout path</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="closing-docket">
        <span>COVERT / STRK20</span>
        <h2>
          Public rules.
          <br />
          Private beneficiary.
          <br />
          Real settlement.
        </h2>
        <Link href="/cover">
          <span>Activate cover</span>
          <ArrowIcon />
        </Link>
      </section>
    </>
  );
}
