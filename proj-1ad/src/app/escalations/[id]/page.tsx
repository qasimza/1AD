import Link from "next/link";
import { notFound } from "next/navigation";
import { Caption } from "@/components/Caption";
import { Letterbox } from "@/components/Letterbox";

// TDD §10.2.4 + §10.3: full-frame letterbox escalation. One decision, two
// to four options, a deadline, no second screen. Each story below is
// hardcoded for Day 4–5 demo — the real version is rendered from the
// playbook's `escalate({ kind, options, deadline })` payload.

type Tone = "tally" | "tungsten" | "sunlight" | "soundstage" | "bone";

interface Option {
  label: string;
  caption: string;
  recommended?: boolean;
}

interface Escalation {
  id: string;
  story: string;
  signal: string;
  prompt: string;
  context: string[];
  options: Option[];
  deadline: string;
  deadlineCaption: string;
  tone: Tone;
}

const TONE_HEX: Record<Tone, string> = {
  tally: "#D94A3D",
  tungsten: "#4A90C2",
  sunlight: "#E8C547",
  soundstage: "#6B8E5A",
  bone: "#D4D2C8",
};

const ESCALATIONS: Record<string, Escalation> = {
  "weather-cover-set": {
    id: "weather-cover-set",
    story: "Story 1 · weatherCoverSet",
    signal: "Rain probability 60% during Day 02 beach window",
    prompt: "Cover set for tomorrow's beach scenes?",
    context: [
      "Day 02 · Stinson Beach, 06:00–16:00",
      "No cover set on file. Maya Chen hard out 4:00 PM (flight).",
      "Weather: 60% rain 09:00–13:00, clears after 14:00.",
    ],
    options: [
      {
        label: "Stinson community hall",
        caption: "12 min from base · $850 / day · day-int matches lighting plan",
        recommended: true,
      },
      {
        label: "Sausalito interior studio",
        caption: "28 min from base · $1,200 / day · larger floor, more reset time",
      },
      {
        label: "Push by one day",
        caption: "Cascades into Day 03 turnaround · Maya can't push",
      },
    ],
    deadline: "5:30 AM",
    deadlineCaption: "Crew call is 6:00 AM. We need to ship the updated call sheet by 5:45.",
    tone: "tungsten",
  },
  "sick-cast-triage": {
    id: "sick-cast-triage",
    story: "Story 2 · sickCastTriage",
    signal: "Maya Chen reported sick at 7:08 AM",
    prompt: "Reshuffle Day 02 without the lead?",
    context: [
      "8 scenes scheduled today, 6 require Maya, 2 do not (14C reverse, 22A insert).",
      "Jordan Reyes + Priya Shah already on set for 14C. Marcus Hill confirms 22A coverage at 11:30.",
      "No turnaround impact on Day 03 if we wrap by 7:30 PM.",
    ],
    options: [
      {
        label: "Shoot 14C and 22A today, hold rest",
        caption: "Saves the day · ~30 min loss vs ~8 hr · DP needs different lens kit",
        recommended: true,
      },
      {
        label: "Full hold + claim weather day",
        caption: "Clean record but burns the contingency day for Day 03 cover",
      },
      {
        label: "Bring in stand-in for over-shoulder coverage",
        caption: "Sam Iverson available · only works for 3 of the 6 Maya scenes",
      },
    ],
    deadline: "8:00 AM",
    deadlineCaption: "Crew is mustering. Decision needed before first setup at 8:15.",
    tone: "tally",
  },
  "turnaround-violation": {
    id: "turnaround-violation",
    story: "Story 3 · turnaroundViolation",
    signal: "SAG turnaround breach detected at 11:14 PM",
    prompt: "Push tomorrow's call to 9:45 AM?",
    context: [
      "Day 01 wrapped at 9:45 PM. Day 02 call was set for 5:30 AM (7h 45m turnaround).",
      "SAG minimum: 12 hours. Affected: Maya Chen, Jordan Reyes.",
      "Penalty if breached: ~$3,200 across both actors. Stage rental can absorb the slip.",
    ],
    options: [
      {
        label: "Push call to 9:45 AM for both leads",
        caption: "Compliant · loses ~4 hours of shoot · makeup pushed to 9:00 AM",
        recommended: true,
      },
      {
        label: "Pay the penalty, keep 5:30 AM call",
        caption: "Stays on plan · $3,200 hit · sets precedent for the rest of shoot",
      },
      {
        label: "Move Maya/Jordan to 9:45 AM, keep others at 5:30",
        caption: "Split call · DP/crew start B-roll early · cleanest schedule cost",
      },
    ],
    deadline: "11:45 PM",
    deadlineCaption: "Call sheet locks at midnight. Notifying cast after that costs trust.",
    tone: "sunlight",
  },
  "multi-day-reshuffle": {
    id: "multi-day-reshuffle",
    story: "Story 5 · multiDayReshuffle",
    signal: "Day 08 location (Pier 24 warehouse) fell through at 2:14 PM",
    prompt: "Approve the rebuilt 9-day shoot order?",
    context: [
      "Day 08 was 6 warehouse scenes. Lost: owner sold to developer, walk-through cancelled.",
      "Gemini optimization considered 47 constraint configurations across remaining 9 days.",
      "Best plan: swap warehouse → Day 12, slot Day 08 with the Pacific Ave exterior block (weather-cleared).",
    ],
    options: [
      {
        label: "Approve rebuilt schedule",
        caption: "22 confirmation calls queued · est. $4,800 savings vs hold day · all cast cleared",
        recommended: true,
      },
      {
        label: "Approve, but I'll make the cast calls myself",
        caption: "Agent handles vendors/locations only · ~6 calls instead of 22",
      },
      {
        label: "Hold Day 08, give me an hour",
        caption: "Costs ~$11k in idle crew · weather window on Pacific Ave closes 4:00 PM",
      },
    ],
    deadline: "3:00 PM",
    deadlineCaption: "Cast managers expect a call by end of business. We have 46 minutes.",
    tone: "soundstage",
  },
};

export async function generateStaticParams() {
  return Object.keys(ESCALATIONS).map((id) => ({ id }));
}

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const e = ESCALATIONS[id];
  if (!e) notFound();

  const accent = TONE_HEX[e.tone];

  return (
    <Letterbox>
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          gap: 22,
          height: "100%",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: accent,
                display: "inline-block",
                marginTop: 2,
              }}
            />
            <Caption>{e.story}</Caption>
          </div>
          <Link
            href="/"
            className="caption"
            style={{ color: "#6E7178", textDecoration: "none" }}
          >
            Dismiss · back to today
          </Link>
        </div>

        <div>
          <div
            className="caption"
            style={{ color: accent, marginBottom: 10 }}
          >
            {e.signal}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: 44,
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            {e.prompt}
          </h1>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "18px 0 0 0",
              display: "grid",
              gap: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#9A9CA1",
              letterSpacing: "0.02em",
            }}
          >
            {e.context.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>

        <div
          style={{
            display: "grid",
            gap: 0,
            alignSelf: "center",
            borderTop: "0.5px solid #21242A",
            borderBottom: "0.5px solid #21242A",
          }}
        >
          {e.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              className="transition-colors hover:bg-console-graphite/60"
              style={{
                display: "grid",
                gridTemplateColumns: "4px 1fr auto",
                columnGap: 16,
                alignItems: "stretch",
                padding: "18px 0",
                background: "transparent",
                border: 0,
                borderBottom:
                  i < e.options.length - 1 ? "0.5px solid #21242A" : "none",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden
                style={{
                  background: opt.recommended ? accent : "#21242A",
                  minHeight: 36,
                }}
              />
              <span className="flex flex-col justify-center">
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 18,
                    lineHeight: 1.25,
                  }}
                >
                  {opt.label}
                </span>
                <span
                  className="caption mt-1"
                  style={{ color: "#9A9CA1" }}
                >
                  {opt.caption}
                </span>
              </span>
              {opt.recommended && (
                <span
                  className="caption self-center"
                  style={{ color: accent, letterSpacing: "0.18em" }}
                >
                  Recommended
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between gap-8">
          <div>
            <div className="caption" style={{ color: "#6E7178" }}>
              Deadline
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 32,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
                color: accent,
                marginTop: 4,
              }}
            >
              {e.deadline}
            </div>
            <div
              className="caption mt-2"
              style={{ color: "#9A9CA1", textTransform: "none", letterSpacing: 0 }}
            >
              {e.deadlineCaption}
            </div>
          </div>

          <div className="caption" style={{ color: "#6E7178", textAlign: "right" }}>
            One A.D. has drafted calls and emails for the recommended path.
            <br />
            Choose to ship — or override, and it will redraft.
          </div>
        </div>
      </div>
    </Letterbox>
  );
}
