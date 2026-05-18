import Link from "next/link";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";

// Notify-tier SMS undo landing page. Day 3 hardcoded: the token is looked up
// in a small static map for the demo. Real implementation will resolve the
// token against `transactions.undo_token`, void via Sponge, and write an
// `undo.confirmed` event.

interface DemoUndo {
  merchant: string;
  amount: string;
  authorizedAt: string;
  expiresAt: string;
  rationale: string;
}

const DEMO_UNDO: Record<string, DemoUndo> = {
  demo_apex_balance: {
    merchant: "Apex Camera Rental",
    amount: "$1,400.00",
    authorizedAt: "Today, 5:30 PM",
    expiresAt: "Tomorrow, 5:30 PM",
    rationale: "Balance due on delivery (companion to today's $400 deposit).",
  },
  demo_permit: {
    merchant: "SF Film Office — Permit",
    amount: "$320.00",
    authorizedAt: "Today, 11:08 AM",
    expiresAt: "Tomorrow, 11:08 AM",
    rationale: "Rush permit for added block on Pacific Ave (14B reverse).",
  },
};

export default async function UndoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const entry = DEMO_UNDO[token];

  return (
    <main className="mx-auto" style={{ maxWidth: 720 }}>
      <header className="flex items-center justify-between gap-6 px-8 py-6">
        <Link
          href="/"
          aria-label="Back to today"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 26,
            lineHeight: 1,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          1ad
        </Link>
        <div className="caption">Undo · authorized charge</div>
      </header>

      <HairlineRule />

      {!entry ? (
        <section className="px-8 py-12">
          <Caption>Link expired or unknown</Caption>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 16,
              lineHeight: 1.55,
              marginTop: 14,
              color: "var(--color-chalk-white)",
            }}
          >
            This undo link is no longer valid. Either the 24-hour window has
            closed, the charge already captured, or the token doesn’t match a
            transaction on this production.
          </p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              lineHeight: 1.55,
              marginTop: 10,
              color: "#6E7178",
            }}
          >
            If you need to reverse a charge anyway, reply to the original SMS
            with “undo” and the line producer will be paged directly.
          </p>
          <div className="mt-8 caption">
            <Link
              href="/spend"
              style={{ color: "var(--color-chalk-white)", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Open spend ledger →
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="px-8 py-10">
            <Caption>Reverse this charge?</Caption>

            <div
              style={{
                marginTop: 18,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                fontSize: 36,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
              }}
            >
              {entry.amount}
            </div>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                marginTop: 6,
                color: "var(--color-chalk-white)",
              }}
            >
              {entry.merchant}
            </div>
            <div
              className="caption"
              style={{ marginTop: 14, color: "#6E7178" }}
            >
              Authorized {entry.authorizedAt} · Undo window closes{" "}
              {entry.expiresAt}
            </div>

            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 14,
                lineHeight: 1.6,
                marginTop: 18,
                color: "var(--color-chalk-white)",
              }}
            >
              {entry.rationale}
            </p>
          </section>

          <HairlineRule />

          <section className="flex items-center gap-3 px-8 py-6">
            <button
              type="button"
              className="caption"
              style={{
                padding: "10px 16px",
                border: "0.5px solid #D94A3D",
                background: "transparent",
                color: "#D94A3D",
                cursor: "pointer",
                letterSpacing: "0.12em",
              }}
            >
              Reverse charge
            </button>
            <Link
              href="/spend"
              className="caption"
              style={{
                padding: "10px 16px",
                border: "0.5px solid #21242A",
                color: "#6E7178",
                textDecoration: "none",
                letterSpacing: "0.12em",
              }}
            >
              Keep charge
            </Link>
          </section>

          <HairlineRule />

          <section className="px-8 py-6 caption" style={{ color: "#6E7178" }}>
            Reversing will void the Sponge authorization, write an
            <span style={{ color: "var(--color-chalk-white)" }}> undo.confirmed </span>
            event to the production timeline, and notify the agent so it can
            re-plan around the missing vendor.
          </section>
        </>
      )}
    </main>
  );
}
