import Link from "next/link";
import type { ReactNode } from "react";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";
import { HeaderClock } from "@/components/HeaderClock";
import { SectionNav } from "@/components/SectionNav";

// TDD §10.3: production setup wizard. Single-page sectioned form,
// hardcoded values pre-filled so it reads as "ACME Commercial is set up
// and ready". Real version writes to productions / contacts / locations.

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 24,
        padding: "14px 0",
        borderBottom: "0.5px solid #21242A",
        alignItems: "baseline",
      }}
    >
      <div className="caption" style={{ color: "#6E7178" }}>
        {label}
      </div>
      <div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 15,
            color: "var(--color-chalk-white)",
          }}
        >
          {value}
        </div>
        {hint && (
          <div
            className="mt-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "#6E7178",
              letterSpacing: "0.04em",
            }}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  done = true,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="px-8 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="caption"
            style={{
              padding: "3px 7px",
              border: "0.5px solid #21242A",
              color: "#6E7178",
            }}
          >
            {String(index).padStart(2, "0")}
          </span>
          <Caption>{title}</Caption>
        </div>
        <span
          className="caption"
          style={{ color: done ? "#6B8E5A" : "#E8C547" }}
        >
          {done ? "✓ READY" : "· PENDING"}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function IntakeView() {
  return (
    <main className="mx-auto" style={{ maxWidth: 960 }}>
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

        <div className="caption flex items-center gap-4">
          <span>ACME Commercial</span>
          <span aria-hidden>·</span>
          <span>Day 02 / 03</span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#4A90C2",
                display: "inline-block",
              }}
            />
            <HeaderClock />
          </span>
        </div>
      </header>

      <HairlineRule />
      <SectionNav current="intake" />
      <HairlineRule />

      <section className="px-8 py-8">
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          Production intake
        </h1>
        <p
          className="mt-2"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            color: "#9A9CA1",
            maxWidth: 640,
            lineHeight: 1.55,
          }}
        >
          One A.D. needs five things to start running a production: who's
          shooting it, who's in front of the lens, where, when, and how much
          authority the agent has to spend. All five are required before the
          first tick.
        </p>
      </section>

      <HairlineRule />

      <Section index={1} title="Production">
        <Field label="Name" value="ACME Commercial" />
        <Field label="Type" value="Commercial · 30s national spot" />
        <Field
          label="Shoot dates"
          value="May 18 – May 20, 2026"
          hint="3 SHOOT DAYS · TIMEZONE AMERICA/LOS_ANGELES"
        />
        <Field
          label="Base of operations"
          value="Marina Studios — 1100 Bridgeway, Sausalito, CA"
        />
      </Section>

      <HairlineRule />

      <Section index={2} title="Key crew">
        <Field
          label="Line producer"
          value="Lena Ortiz · lena@acmeproductions.test"
          hint="RECEIVES ESCALATION EMAILS · APPROVES NOTIFY-TIER SPEND"
        />
        <Field
          label="Coordinator"
          value="Sam Reyes · +1 (513) 739-4757"
          hint="PRIMARY HUMAN IN THE LOOP · GETS SMS FOR LIVE CALLS"
        />
        <Field label="DP" value="David Park · prefers SMS before 7 AM, calls after" />
      </Section>

      <HairlineRule />

      <Section index={3} title="Cast">
        <Field
          label="Leads"
          value="Maya Chen · Jordan Reyes"
          hint="SAG · 12 HR TURNAROUND · MAYA HARD OUT 4PM MON (FLIGHT)"
        />
        <Field
          label="Supporting"
          value="Priya Shah · Marcus Hill · Elena Volkov"
          hint="ELENA: WHEELCHAIR USER · CONFIRM ACCESSIBILITY EACH LOCATION"
        />
        <Field
          label="Day players"
          value="Theo Kim · Ana Beltran · Wesley Park · Riley Foster"
        />
        <Field label="Stand-in" value="Sam Iverson · stand-in for Maya" />
      </Section>

      <HairlineRule />

      <Section index={4} title="Spend authority">
        <Field
          label="Daily cap"
          value="$5,000.00"
          hint="ENFORCED SERVER-SIDE BY SPONGE · APPLICATION TIER ENGINE GATES BEFORE WALL"
        />
        <Field
          label="Weekly cap"
          value="$20,000.00"
          hint="ROLLING 7-DAY WINDOW"
        />
        <Field
          label="Tier ceilings"
          value="AUTO ≤ $500 · NOTIFY ≤ $2,000 · ESCALATE > $2,000"
        />
        <Field
          label="Sponge card"
          value="Visa · ending 4421 · linked"
          hint="ISSUED VIA RAIN · DAILY/WEEKLY LIMITS MIRRORED INTO SPONGE"
        />
      </Section>

      <HairlineRule />

      <Section index={5} title="Channels">
        <Field
          label="Agent inbox"
          value="1ad-acme@agentmail.to"
          hint="ESCALATION SUMMARIES + DAILY DIGEST + CALL SHEETS"
        />
        <Field
          label="Agent phone"
          value="+1 (415) 555-0117"
          hint="OUTBOUND CALLER ID · OPT-IN FOR ALL RECORDED CONTACTS"
        />
        <Field
          label="SMS undo window"
          value="24 hours"
          hint="NOTIFY-TIER CHARGES REVERSIBLE FOR 24H FROM AUTH"
        />
      </Section>

      <HairlineRule />

      <section className="px-8 py-8 flex items-center justify-between gap-6">
        <div
          className="caption"
          style={{
            color: "#6B8E5A",
            letterSpacing: "0.16em",
          }}
        >
          ✓ All sections ready · production tick loop running
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="caption"
            style={{
              padding: "10px 16px",
              border: "0.5px solid #21242A",
              background: "transparent",
              color: "#6E7178",
              cursor: "pointer",
              letterSpacing: "0.12em",
            }}
          >
            Edit
          </button>
          <Link
            href="/"
            className="caption"
            style={{
              padding: "10px 16px",
              border: "0.5px solid var(--color-chalk-white)",
              background: "var(--color-chalk-white)",
              color: "var(--color-stage-black)",
              textDecoration: "none",
              letterSpacing: "0.12em",
            }}
          >
            Open today
          </Link>
        </div>
      </section>
    </main>
  );
}
