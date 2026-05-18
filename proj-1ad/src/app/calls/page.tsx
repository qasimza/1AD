import Link from "next/link";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";
import { HeaderClock } from "@/components/HeaderClock";
import { HeroMetric } from "@/components/HeroMetric";
import { SectionNav } from "@/components/SectionNav";
import { StripboardRow, type EdgeColor } from "@/components/StripboardRow";
import { Waveform } from "@/components/Waveform";

// TDD §10.3: call log + live calls. Hardcoded for demo. Live call drives
// the breathing waveform; recent calls list shows outcome glyphs.

type CallOutcome =
  | "confirmed"
  | "conflict"
  | "voicemail"
  | "no_answer"
  | "live";

interface CallRow {
  id: string;
  contact: string;
  role: string;
  purpose: string;
  startedAt: string;
  duration: string;
  outcome: CallOutcome;
  detail?: string;
}

const LIVE: CallRow = {
  id: "live_dp_lens",
  contact: "Maya Chen",
  role: "Lead Actor",
  purpose: "Re: Confirming Availability",
  startedAt: "2:23 PM",
  duration: "0:42",
  outcome: "live",
  detail: "Confirming availability for Monday 5:30 AM call.",
};

const RECENT: CallRow[] = [
  {
    id: "c_maya_callsheet",
    contact: "Daniel Wu",
    role: "Talent manager · Maya",
    purpose: "Confirm Day 02 5:30 AM call",
    startedAt: "9:14 PM yesterday",
    duration: "3:18",
    outcome: "conflict",
    detail: "Maya has a 5 AM PT manager call. Suggested 7 AM call, awaiting line producer.",
  },
  {
    id: "c_jordan",
    contact: "Jordan Reyes",
    role: "Lead cast",
    purpose: "Confirm Day 02 call time + scene 14B",
    startedAt: "8:58 PM yesterday",
    duration: "1:47",
    outcome: "confirmed",
    detail: "Locked 5:30 AM. SMS recap sent.",
  },
  {
    id: "c_apex",
    contact: "Apex Camera Rental",
    role: "Backup vendor",
    purpose: "Quote on camera package + delivery",
    startedAt: "2:11 PM",
    duration: "5:02",
    outcome: "confirmed",
    detail: "$1,800 package, $400 deposit · auto-tier · delivered 4:42 PM.",
  },
  {
    id: "c_cinema_pro",
    contact: "Cinema Pro",
    role: "Primary vendor",
    purpose: "Driver no-show follow-up",
    startedAt: "1:48 PM",
    duration: "—",
    outcome: "no_answer",
    detail: "3 calls over 27 min, no pickup. Switched to Apex.",
  },
  {
    id: "c_sf_film",
    contact: "SF Film Office",
    role: "Permit desk",
    purpose: "Rush permit for Pacific Ave (14B reverse)",
    startedAt: "11:02 AM",
    duration: "6:31",
    outcome: "confirmed",
    detail: "Permit issued at 11:08 AM. $320 charged · notify tier.",
  },
  {
    id: "c_priya",
    contact: "Priya Shah",
    role: "Supporting cast",
    purpose: "Day 03 call time + accessibility check",
    startedAt: "10:41 AM",
    duration: "2:08",
    outcome: "confirmed",
    detail: "Locked 6:30 AM Day 03. Confirmed wheelchair ramp at location.",
  },
  {
    id: "c_lena_vm",
    contact: "Lena Ortiz",
    role: "Line producer",
    purpose: "Heads-up on Apex switch",
    startedAt: "1:52 PM",
    duration: "0:24",
    outcome: "voicemail",
    detail: "Left a 20-sec message. Followed with SMS + email.",
  },
];

const OUTCOME_EDGE: Record<CallOutcome, EdgeColor> = {
  confirmed: "soundstage",
  conflict: "sunlight",
  voicemail: "bone",
  no_answer: "tally",
  live: "tungsten",
};

const OUTCOME_GLYPH: Record<CallOutcome, string> = {
  confirmed: "✓",
  conflict: "⚠",
  voicemail: "✉",
  no_answer: "✗",
  live: "●",
};

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  confirmed: "CONFIRMED",
  conflict: "CONFLICT",
  voicemail: "VOICEMAIL",
  no_answer: "NO ANSWER",
  live: "LIVE",
};

const OUTCOME_COLOR: Record<CallOutcome, string> = {
  confirmed: "#6B8E5A",
  conflict: "#E8C547",
  voicemail: "#6E7178",
  no_answer: "#D94A3D",
  live: "#4A90C2",
};

function CallRowItem({ c }: { c: CallRow }) {
  return (
    <StripboardRow
      edge={OUTCOME_EDGE[c.outcome]}
      title={
        <span style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span>
            {c.contact}
            <span style={{ color: "#6E7178" }}> · {c.role}</span>
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
              color: "#9A9CA1",
            }}
          >
            {c.duration}
          </span>
        </span>
      }
      caption={
        <>
          {c.purpose}
          {c.detail ? ` · ${c.detail}` : ""}
        </>
      }
      right={
        <span style={{ display: "inline-flex", gap: 12 }}>
          <span style={{ color: OUTCOME_COLOR[c.outcome] }}>
            {OUTCOME_LABEL[c.outcome]}
          </span>
          <span>{c.startedAt}</span>
          <span>{OUTCOME_GLYPH[c.outcome]}</span>
        </span>
      }
    />
  );
}

export default function CallsView() {
  const totalToday = RECENT.length + 1;
  const outstanding = RECENT.filter((c) => c.outcome === "conflict").length;

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
      <SectionNav current="calls" />
      <HairlineRule />

      <section className="grid grid-cols-2 gap-8 px-8 py-8">
        <HeroMetric
          label="Calls today"
          value={`${RECENT.filter((c) => c.outcome === "confirmed").length} / ${totalToday}`}
          delta={`${outstanding} outstanding`}
          deltaTone={outstanding ? "tally" : "neutral"}
        />
        <HeroMetric
          label="Average duration"
          value="2:43"
          delta="−18s vs avg"
        />
      </section>

      <HairlineRule />

      <section className="px-8 py-6">
        <Caption>Live</Caption>
        <div
          className="mt-4"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 20,
          }}
        >
          <Waveform active bars={32} width={220} height={36} />
          <div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 17 }}>
              Calling {LIVE.contact} ({LIVE.role})
            </div>
            <div className="caption mt-1" style={{ color: "#9A9CA1" }}>
              {LIVE.purpose} · {LIVE.detail}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: 22,
              color: "#4A90C2",
            }}
          >
            {LIVE.duration}
          </div>
        </div>
      </section>

      <HairlineRule />

      <section className="px-8 pt-6 pb-2">
        <Caption>Recent</Caption>
      </section>

      <section>
        {RECENT.map((c) => (
          <CallRowItem key={c.id} c={c} />
        ))}
      </section>

      <HairlineRule />

      <section className="px-8 py-8 caption" style={{ color: "#6E7178" }}>
        Tap any row for the full transcript, audio, and tool-call trace.
        Conflicts open the relevant escalation if the agent flagged one.
      </section>
    </main>
  );
}
