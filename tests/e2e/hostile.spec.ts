import { expect, test } from "@playwright/test";
import {
  CLAIM_ID,
  LEDGER_KEY,
  MIGRATION_FLAG,
  POLICY_ID,
  REVEALS_KEY,
  SECRETS_KEY,
  ledgerFor,
  seed,
  seedEmpty,
} from "./fixtures";

/**
 * Attacks on the browser.
 *
 * The contract is the last line of defence, not the UI. But the UI must not be
 * trivially convinced either, must never *unlock* a privileged action on local
 * state alone, and must never break in a way that leaves a user stranded.
 */

test.describe("forged local state", () => {
  test("a fabricated settlement does not display as settled", async ({ page }) => {
    // Take the log up to "claim under review" and bolt a settlement onto the end,
    // skipping approval entirely — the forgery an attacker would actually attempt.
    const forged = [
      ...ledgerFor("under_review"),
      {
        id: "forged_1",
        seq: 99,
        ts: Date.now(),
        kind: "settlement.confirmed",
        source: "chain",
        policyId: POLICY_ID,
        claimId: CLAIM_ID,
        txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        note: "Fabricated settlement.",
        data: { payoutWei: "50000000000000000" },
      },
    ];

    await page.addInitScript(
      ({ events, keys }) => {
        window.localStorage.setItem(keys.ledger, JSON.stringify(events));
        window.localStorage.setItem(keys.migration, JSON.stringify(true));
      },
      { events: forged, keys: { ledger: LEDGER_KEY, migration: MIGRATION_FLAG } },
    );

    await page.goto(`/policy/${POLICY_ID}`);

    // The state machine refuses under_review -> settled, so it stays under review.
    await expect(page.locator(".status").first()).toContainText("CLAIM UNDER REVIEW");
    await expect(page.locator(".magic-moment")).toHaveCount(0);
    await expect(page.locator(".settlement-panel")).toContainText("BLOCKED — NOT_APPROVED");
  });

  test("a corrupt ledger degrades to empty rather than crashing", async ({ page }) => {
    await page.addInitScript(
      ({ keys }) => {
        window.localStorage.setItem(keys.ledger, "{{{not json at all");
        window.localStorage.setItem(keys.secrets, "[[[");
        window.localStorage.setItem(keys.reveals, "null");
        window.localStorage.setItem(keys.migration, JSON.stringify(true));
      },
      { keys: { ledger: LEDGER_KEY, secrets: SECRETS_KEY, reveals: REVEALS_KEY, migration: MIGRATION_FLAG } },
    );

    for (const path of ["/history", "/reserve", "/claim", "/verify", "/proof"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // Generous: the first navigation after a cold start pays for server warm-up.
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
    }
    await page.goto("/history");
    await expect(page.getByText("EMPTY HISTORY")).toBeVisible();
  });

  test("garbage events are dropped without breaking the surfaces that read them", async ({ page }) => {
    await page.addInitScript(
      ({ keys }) => {
        window.localStorage.setItem(
          keys.ledger,
          JSON.stringify([
            { id: "a", seq: 1, ts: 1, kind: "not.a.real.kind", source: "local" },
            { id: "b", seq: 2, ts: 2, kind: "claim.approved", source: "chain", claimId: "GHOST" },
            { nope: true },
            null,
            "string",
            { id: "c", seq: 3, ts: 3, kind: "reserve.observed", source: "chain", data: { reserveWei: "🙈" } },
          ]),
        );
        window.localStorage.setItem(keys.migration, JSON.stringify(true));
      },
      { keys: { ledger: LEDGER_KEY, migration: MIGRATION_FLAG } },
    );

    await page.goto("/history");
    await expect(page.getByText("EMPTY HISTORY")).toBeVisible();
    await page.goto("/reserve");
    // An unparseable reserve reading must read as unknown, never as zero.
    await expect(page.locator(".reserve-cell", { hasText: "Reserve" }).first()).toContainText("—");
  });

  test("incident text is escaped, not executed", async ({ page }) => {
    const xss = '<img src=x onerror="window.__pwned=1">';
    const events = ledgerFor("under_review");
    await page.addInitScript(
      ({ events, reveal, keys }) => {
        window.localStorage.setItem(keys.ledger, JSON.stringify(events));
        window.localStorage.setItem(keys.reveals, JSON.stringify([reveal]));
        window.localStorage.setItem(keys.migration, JSON.stringify(true));
      },
      {
        events,
        reveal: {
          version: 2,
          policyId: POLICY_ID,
          policyCommitment: "0x65b170e76ef2b8694d3e17bbc488fc359d7898cff2fe31eb73acefc79603a0c",
          claimCommitment: "0x50be95a7d77de260201bda9e682768e4812f5359648109a063c9ef880771dd9",
          incidentHash: "0x8",
          incidentSalt: "0x7",
          incidentText: xss,
          tier: 1,
          createdAt: Date.now(),
        },
        keys: { ledger: LEDGER_KEY, reveals: REVEALS_KEY, migration: MIGRATION_FLAG },
      },
    );

    await page.goto("/verify");
    await expect(page.locator(".evidence-reveal")).toContainText("<img src=x");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe("hostile input", () => {
  test("a reveal packet cannot be approved just because it parses", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/verify");

    // Internally consistent-looking, but the hashes do not recompute.
    await page.getByLabel("Reveal packet JSON").fill(
      JSON.stringify({
        version: 2,
        policyCommitment: "0xaaa",
        claimCommitment: "0xbbb",
        incidentHash: "0xccc",
        incidentSalt: "0xddd",
        incidentText: "a totally legitimate incident, honestly",
        tier: 1,
        createdAt: Date.now(),
      }),
    );
    await page.getByRole("button", { name: "Import and recompute" }).click();

    await expect(page.locator(".tx-receipt.rejected .failure-code").first()).toHaveText("PACKET_MISMATCH");
    // And it was not added to the queue, so it cannot be selected and approved.
    await expect(page.locator(".claim-list button")).toHaveCount(0);
  });

  test("oversized and unicode input does not break the packet importer", async ({ page }) => {
    await seedEmpty(page);
    await page.goto("/verify");

    for (const payload of ["[]", '"a string"', "null", "12345", `{"incidentText":"${"🙈".repeat(500)}"}`]) {
      await page.getByLabel("Reveal packet JSON").fill(payload);
      await page.getByRole("button", { name: "Import and recompute" }).click();
      const code = page.locator(".tx-receipt.rejected .failure-code").first();
      await expect(code).toBeVisible();
      await expect(code).toHaveText(/PACKET_MALFORMED|PACKET_MISMATCH/);
    }
  });

  test("an arbitrary policy id in the URL is handled, not rendered", async ({ page }) => {
    await seedEmpty(page);
    for (const id of ["../../etc/passwd", "%3Cscript%3E", "CVT-0000-0000", "0".repeat(300)]) {
      await page.goto(`/policy/${encodeURIComponent(id)}`);
      await expect(page.getByRole("heading", { name: "Not found in this browser." })).toBeVisible();
    }
  });
});

test.describe("hostile environment", () => {
  test("blocked storage warns instead of failing silently", async ({ page }) => {
    // Simulate a browser with site data blocked entirely.
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException("denied", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          return {
            getItem: boom,
            setItem: boom,
            removeItem: boom,
            clear: boom,
            key: boom,
            length: 0,
          };
        },
      });
    });

    await page.goto("/cover");
    // The page still works…
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // …and says plainly that bearer keys will not survive. Both notices are
    // expected here (no deployment, and no storage), so target the storage one.
    await expect(
      page.locator(".system-notice", { hasText: "not storing state" }),
    ).toBeVisible();
  });

  test("a settled policy never offers settlement again", async ({ page }) => {
    await seed(page, "settled");
    await page.goto(`/policy/${POLICY_ID}`);
    const button = page.locator(".settlement-panel button");
    await expect(button).toBeDisabled();
    await expect(button).toContainText("Already settled");
  });

  test("erasing custody material states the consequence before doing it", async ({ page }) => {
    await seed(page, "active");
    await page.goto("/history");
    await expect(page.locator(".danger-zone")).toContainText("permanently unclaimable");
    await page.getByRole("button", { name: "Erase bearer keys and reveals" }).click();
    // Confirmation is required; nothing is destroyed on the first click.
    await expect(page.getByRole("button", { name: "Yes, erase" })).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), SECRETS_KEY)).not.toBeNull();
  });
});
