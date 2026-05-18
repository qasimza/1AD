import Link from "next/link";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";
import { HeaderClock } from "@/components/HeaderClock";
import { SectionNav } from "@/components/SectionNav";
import { StripboardRow, type EdgeColor } from "@/components/StripboardRow";

// TDD §10.3: full stripboard, all days. Hardcoded mirror of the seed
// data so the page renders without DB plumbing.

type SceneType = "day_ext" | "day_int" | "night_ext" | "night_int";
type SceneStatus =
  | "wrapped"
  | "rolling"
  | "confirmed"
  | "planned"
  | "rescheduled"
  | "cancelled";

interface Scene {
  number: string;
  description: string;
  type: SceneType;
  location: string;
  cast: number;
  start: string;
  end: string;
  status: SceneStatus;
}

interface Day {
  index: 1 | 2 | 3;
  label: string;
  callTime: string;
  estWrap: string;
  scenes: Scene[];
  note?: string;
}

const EDGE_BY_TYPE: Record<SceneType, EdgeColor> = {
  day_ext: "sunlight",
  night_ext: "tungsten",
  day_int: "bone",
  night_int: "soundstage",
};

const STATUS_LABEL: Record<SceneStatus, string> = {
  wrapped: "WRAPPED",
  rolling: "ROLLING",
  confirmed: "CONFIRMED",
  planned: "PLANNED",
  rescheduled: "RESCHEDULED",
  cancelled: "CANCELLED",
};

const STATUS_COLOR: Record<SceneStatus, string> = {
  wrapped: "#6B8E5A",
  rolling: "#4A90C2",
  confirmed: "#D4D2C8",
  planned: "#6E7178",
  rescheduled: "#E8C547",
  cancelled: "#D94A3D",
};

const DAYS: Day[] = [
  {
    index: 1,
    label: "Day 01 · Mon May 18 · WRAPPED",
    callTime: "5:30 AM",
    estWrap: "9:45 PM",
    note: "Wrapped 1h 45m late · turnaround flag triggered Story 3 escalation at 11:14 PM.",
    scenes: [
      {
        number: "01A",
        description: "Beach walk-and-talk (Maya + Jordan)",
        type: "day_ext",
        location: "Stinson Beach — North",
        cast: 2,
        start: "6:30 AM",
        end: "10:00 AM",
        status: "wrapped",
      },
      {
        number: "01B",
        description: "Tighter reverse · couple on shoreline",
        type: "day_ext",
        location: "Stinson Beach — North",
        cast: 2,
        start: "10:15 AM",
        end: "12:30 PM",
        status: "wrapped",
      },
      {
        number: "07",
        description: "Establishing wide · base camp to cliffs",
        type: "day_ext",
        location: "Stinson Beach — South lot",
        cast: 0,
        start: "1:30 PM",
        end: "3:15 PM",
        status: "wrapped",
      },
      {
        number: "12",
        description: "Maya monologue · sunset",
        type: "day_ext",
        location: "Stinson Beach — Headlands",
        cast: 1,
        start: "6:15 PM",
        end: "9:45 PM",
        status: "wrapped",
      },
    ],
  },
  {
    index: 2,
    label: "Day 02 · Tue May 19 · TODAY",
    callTime: "9:45 AM (pushed from 5:30 AM)",
    estWrap: "7:30 PM (est)",
    note: "Call pushed 4h 15m to clear SAG turnaround. Story 3 resolved · 9:45 AM signed by both leads.",
    scenes: [
      {
        number: "14A",
        description: "Beach establishing (no cast)",
        type: "day_ext",
        location: "Pacific Ave — block 200",
        cast: 0,
        start: "10:30 AM",
        end: "12:00 PM",
        status: "wrapped",
      },
      {
        number: "14B",
        description: "Wide on couple · Pacific Ave",
        type: "day_ext",
        location: "Pacific Ave — block 200",
        cast: 2,
        start: "12:30 PM",
        end: "2:15 PM",
        status: "rolling",
      },
      {
        number: "14C",
        description: "Reverse on Jordan (Maya OS)",
        type: "day_ext",
        location: "Pacific Ave — block 200",
        cast: 2,
        start: "2:30 PM",
        end: "4:00 PM",
        status: "confirmed",
      },
      {
        number: "22",
        description: "Hotel lobby cover (rain backup)",
        type: "day_int",
        location: "Stinson Community Hall",
        cast: 4,
        start: "4:45 PM",
        end: "6:30 PM",
        status: "planned",
      },
      {
        number: "22A",
        description: "Lobby insert · key handoff",
        type: "day_int",
        location: "Stinson Community Hall",
        cast: 2,
        start: "6:45 PM",
        end: "7:30 PM",
        status: "planned",
      },
    ],
  },
  {
    index: 3,
    label: "Day 03 · Wed May 20 · PLANNED",
    callTime: "6:30 AM",
    estWrap: "5:00 PM",
    note: "Maya hard out 4:00 PM (flight). Priya day-player only. Permit pulled for Pacific Ave reshoot block.",
    scenes: [
      {
        number: "18",
        description: "Night exterior · rooftop",
        type: "night_ext",
        location: "Marina rooftop — 22nd floor",
        cast: 3,
        start: "6:30 AM",
        end: "9:00 AM",
        status: "confirmed",
      },
      {
        number: "19",
        description: "Stairwell descent (Priya day-player)",
        type: "night_int",
        location: "Marina rooftop — service stair",
        cast: 2,
        start: "9:30 AM",
        end: "11:30 AM",
        status: "confirmed",
      },
      {
        number: "24",
        description: "Lobby confrontation · principal cast",
        type: "day_int",
        location: "Marina ground floor",
        cast: 4,
        start: "12:30 PM",
        end: "3:30 PM",
        status: "confirmed",
      },
      {
        number: "26",
        description: "Tag · exterior reunion",
        type: "day_ext",
        location: "Marina entrance",
        cast: 2,
        start: "3:45 PM",
        end: "5:00 PM",
        status: "planned",
      },
    ],
  },
];

function StatusBadge({ s }: { s: SceneStatus }) {
  return (
    <span style={{ color: STATUS_COLOR[s] }}>{STATUS_LABEL[s]}</span>
  );
}

export default function ScheduleView() {
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
      <SectionNav current="schedule" />
      <HairlineRule />

      {DAYS.map((day, idx) => (
        <section key={day.index}>
          <div className="px-8 py-5">
            <Caption>{day.label}</Caption>
            <div
              className="mt-3 flex items-center gap-4"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "#9A9CA1",
                letterSpacing: "0.02em",
              }}
            >
              <span>Call {day.callTime}</span>
              <span aria-hidden>·</span>
              <span>Est wrap {day.estWrap}</span>
              <span aria-hidden>·</span>
              <span>{day.scenes.length} scenes</span>
            </div>
            {day.note && (
              <div
                className="mt-3"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 13,
                  color: "#6E7178",
                  lineHeight: 1.5,
                }}
              >
                {day.note}
              </div>
            )}
          </div>

          <div>
            {day.scenes.map((s) => (
              <StripboardRow
                key={`${day.index}-${s.number}`}
                edge={EDGE_BY_TYPE[s.type]}
                title={`${s.number} — ${s.description}`}
                caption={
                  <>
                    Loc: {s.location} · Cast: {s.cast}
                  </>
                }
                right={
                  <>
                    {s.start} → {s.end}
                    {"  "}
                    <StatusBadge s={s.status} />
                  </>
                }
              />
            ))}
          </div>

          {idx < DAYS.length - 1 && <HairlineRule />}
        </section>
      ))}

      <HairlineRule />

      <section className="px-8 py-8 caption" style={{ color: "#6E7178" }}>
        Edge color = scene type · sunlight (day ext) · tungsten (night ext) ·
        bone (day int) · soundstage (night int).
      </section>
    </main>
  );
}
