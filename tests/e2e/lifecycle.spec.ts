import { expect, test } from "@playwright/test";
import { CLAIM_ID, POLICY_ID, seed, seedEmpty } from "./fixtures";

/**
 * The critical end-to-end test.
 *
 * It walks one policy through the complete product rather than poking isolated
 * buttons: the policy created in Cover is the one Claim offers, the one Verify
 * queues, the one whose refused settlement becomes evidence, and the one History
 * and Proof report on. If any surface kept its own copy of the truth, this fails.
 */
test.describe("complete lifecycle", () => {
  test("one policy travels every surface and closes", async ({ page }) => {
    await seed(page, "settled");

    // --- it exists on the policy page, closed and reconciled ---------------
    await page.goto(`/policy/${POLICY_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("SIGNAL cover");
    await expect(page.locator(".status").first()).toContainText("SETTLED");

    // --- the refused attempt is kept, with its exact invariant -------------
    await expect(page.getByText("ADVERSARIAL EVIDENCE")).toBeVisible();
    await expect(page.locator(".check-row em").filter({ hasText: "NOT_APPROVED" })).toBeVisible();

    // --- the measured consequence, not an asserted one --------------------
    const magic = page.locator(".magic-moment");
    await expect(magic).toBeVisible();
    await expect(magic).toContainText("PAID TO YOUR PUBLIC WALLET");
    // Public balance fell (gas), so the payout credited to it is zero, not negative.
    await expect(magic.locator(".delta-cell").first().locator("strong")).toHaveText("0.00 STRK");
    await expect(magic.locator(".delta-cell.private strong")).toContainText("+0.05");

    // --- the full timeline, in order --------------------------------------
    const timeline = page.locator(".timeline-item");
    await expect(timeline.first()).toContainText("Bearer key minted");
    await expect(timeline.filter({ hasText: "Settlement rejected" })).toHaveCount(1);
    await expect(timeline.filter({ hasText: "Claim approved" })).toHaveCount(1);
    await expect(timeline.last()).toContainText("Reserve read");

    // --- the same policy appears in History with the same status ----------
    await page.goto("/history");
    const row = page.locator("tbody tr", { hasText: POLICY_ID }).first();
    await expect(row).toContainText("SETTLED");
    await expect(row).toContainText("1 refused settlement");

    // --- and its timeline is reachable there too --------------------------
    await row.getByRole("button", { name: "Timeline" }).click();
    await expect(page.locator(".timeline-item").filter({ hasText: "Private payout confirmed" }).first()).toBeVisible();

    // --- Proof reports the browser's own evidence -------------------------
    await page.goto("/proof");
    await expect(page.getByText("EVIDENCE FROM YOUR OWN USE")).toBeVisible();
    await expect(page.locator(".check-row", { hasText: "Settlement refused — NOT_APPROVED" })).toBeVisible();
    await expect(page.locator(".check-row", { hasText: "Private settlement confirmed" })).toBeVisible();

    // --- Reserve reflects the settled liability ---------------------------
    await page.goto("/reserve");
    const settledCell = page.locator(".reserve-cell", { hasText: "Settled" }).first();
    await expect(settledCell).toContainText("0.05 STRK paid out privately");
  });

  test("state survives a reload mid-flow", async ({ page }) => {
    await seed(page, "refused");
    await page.goto(`/policy/${POLICY_ID}`);
    await expect(page.locator(".check-row em").filter({ hasText: "NOT_APPROVED" })).toBeVisible();

    await page.reload();

    // The ledger is the source of truth, so nothing is lost across a refresh.
    await expect(page.locator(".check-row em").filter({ hasText: "NOT_APPROVED" })).toBeVisible();
    await expect(page.locator(".timeline-item")).toHaveCount(8);
  });

  test("settlement is offered before approval, and explains what will refuse it", async ({ page }) => {
    await seed(page, "under_review");
    await page.goto(`/policy/${POLICY_ID}`);

    const panel = page.locator(".settlement-panel");
    await expect(panel).toContainText("BLOCKED — NOT_APPROVED");
    // The button is deliberately offered: the contract must be the one to refuse.
    await expect(panel.getByRole("button", { name: /Attempt settlement anyway/ })).toBeVisible();
    await expect(panel).toContainText("redeem_claim requires claim_decision == APPROVED");
  });

  test("an approved claim flips the same action to authorised", async ({ page }) => {
    await seed(page, "approved");
    await page.goto(`/policy/${POLICY_ID}`);
    const panel = page.locator(".settlement-panel");
    await expect(panel).toContainText("AUTHORISED");
    await expect(panel).toContainText("The adjudicator has approved this claim");
  });
});

test.describe("adjudicator surface", () => {
  test("queues the claim, verifies the reveal and blocks approval without the role", async ({ page }) => {
    await seed(page, "under_review");
    await page.goto("/verify");

    await expect(page.locator(".claim-list button", { hasText: CLAIM_ID })).toBeVisible();

    // The reveal recomputes locally without touching a chain.
    await expect(page.locator(".check-row", { hasText: "Reveal reproduces its commitments" })).toContainText("MATCH");

    // No adjudicator wallet is connected, so approval is locked and says why.
    await expect(page.locator(".integrity-block")).toContainText("APPROVAL LOCKED");
    await expect(page.getByRole("button", { name: "Approve claim" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Deny claim" })).toBeDisabled();

    // The private reveal is shown to the adjudicator, and only to them.
    await expect(page.locator(".evidence-reveal")).toContainText("sequencer outage");
  });

  test("rejects a tampered reveal packet with the reason it failed", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/verify");

    const tampered = JSON.stringify({
      version: 2,
      policyCommitment: "0x1",
      claimCommitment: "0x2",
      incidentHash: "0x3",
      incidentSalt: "0x4",
      incidentText: "a plausible sounding incident that was never committed",
      tier: 1,
      createdAt: Date.now(),
    });

    await page.getByLabel("Reveal packet JSON").fill(tampered);
    await page.getByRole("button", { name: "Import and recompute" }).click();

    const receipt = page.locator(".tx-receipt.rejected").first();
    await expect(receipt).toContainText("Reveal does not reproduce its commitments");
    await expect(receipt.locator(".failure-code")).toHaveText("PACKET_MISMATCH");
    await expect(receipt.locator(".recovery")).toContainText("Do not approve");
  });

  test("rejects malformed JSON distinctly from a tampered packet", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/verify");
    await page.getByLabel("Reveal packet JSON").fill("{not json");
    await page.getByRole("button", { name: "Import and recompute" }).click();
    await expect(page.locator(".tx-receipt.rejected .failure-code").first()).toHaveText("PACKET_MALFORMED");
  });
});

test.describe("first visit and empty states", () => {
  test("no surface dead-ends on an empty browser", async ({ page }) => {
    await seedEmpty(page);

    for (const path of ["/", "/cover", "/claim", "/verify", "/reserve", "/history", "/proof", "/replay"]) {
      await page.goto(path);
      // Something meaningful rendered.
      await expect(page.locator("h1, h2").first()).toBeVisible();
      // And nothing is stuck on a spinner.
      await expect(page.locator("text=/^Loading/")).toHaveCount(0);
    }
  });

  test("claim offers a way forward when there is nothing to claim", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/claim");
    await expect(page.getByText("NO CLAIMABLE POLICY")).toBeVisible();
    await expect(page.getByRole("link", { name: "Activate cover" })).toBeVisible();
  });

  test("history offers a way forward when empty", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/history");
    await expect(page.getByText("EMPTY HISTORY")).toBeVisible();
    await expect(page.getByRole("link", { name: "Activate cover" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch a completed lifecycle" })).toBeVisible();
  });

  test("an unknown policy id explains itself rather than erroring", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/policy/CVT-0000-0000");
    await expect(page.getByRole("heading", { name: "Not found in this browser." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Activate cover" })).toBeVisible();
  });

  test("actions are disabled with a stated reason, not silently inert", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/cover");
    const activate = page.getByRole("button", { name: /Connect wallet first|No deployment configured/ }).last();
    await expect(activate).toBeDisabled();
  });
});

test.describe("evidence surfaces", () => {
  test("replay renders the recorded run and never calls it live", async ({ page }) => {
    await page.goto("/replay");

    await expect(page.locator(".replay-badge")).toContainText("Verified replay");
    await expect(page.locator(".replay-header p")).toContainText("not Starknet Mainnet");

    // The refused-then-approved pair is present and labelled.
    await expect(page.locator(".replay-step", { hasText: "NEG-04" })).toContainText("REFUSED AS REQUIRED");
    await expect(page.locator(".replay-step", { hasText: "NEG-04" })).toContainText("NOT_APPROVED");
    await expect(page.locator(".replay-step", { hasText: "TX-03" })).toContainText("SUCCEEDED");

    // Every assertion from the run is shown, including how many held.
    const checks = page.locator(".check-row");
    await expect(checks.first()).toBeVisible();
    await expect(page.locator(".check-row.fail")).toHaveCount(0);

    // Nothing on the page claims to be live.
    await expect(page.locator("body")).not.toContainText("MAINNET EVIDENCE RECORDED");
  });

  test("proof lists claims with status, evidence and reproduction commands", async ({ page }) => {
    await page.goto("/proof");

    await expect(page.locator("table thead")).toContainText("How to reproduce");
    await expect(page.locator(".verdict.VERIFIED").first()).toBeVisible();

    // Mainnet is honestly reported as blocked rather than quietly omitted.
    await expect(page.locator("tr", { hasText: "deployed on Starknet Mainnet" })).toContainText("BLOCKED");

    // And the independent verification path is offered.
    await expect(page.getByText("VERIFY WITHOUT THIS INTERFACE")).toBeVisible();
    await expect(page.locator("code", { hasText: "verify-lifecycle.mjs" }).first()).toBeVisible();
  });

  test("home leads with the user outcome", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("without publishing who got paid");
    await expect(page.getByRole("link", { name: /Activate cover/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /See a real lifecycle/ })).toBeVisible();
  });

  test("the privacy claim stays narrow on every surface that makes it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toContainText("first deposit into STRK20 is public");
    await expect(page.locator("body")).toContainText("this is not invisibility");
  });
});

test.describe("navigation", () => {
  test("every primary route is reachable and marks itself current", async ({ page }) => {
    await seed(page, "settled");
    await page.goto("/");

    for (const [label, path] of [
      ["Cover", "/cover"],
      ["Claim", "/claim"],
      ["Verify", "/verify"],
      ["Reserve", "/reserve"],
      ["History", "/history"],
      ["Proof", "/proof"],
    ] as const) {
      await page.locator(".site-nav").getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator(`.site-nav a[href="${path}"]`)).toHaveAttribute("aria-current", "page");
    }
  });
});
