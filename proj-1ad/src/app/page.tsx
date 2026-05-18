import Link from "next/link";
import { db } from "@/db/client";
import { productions } from "@/db/schema";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";
import { HeaderClock } from "@/components/HeaderClock";
import { HeroMetric } from "@/components/HeroMetric";
import { SectionNav } from "@/components/SectionNav";
import { StripboardRow, type EdgeColor } from "@/components/StripboardRow";
import { Waveform } from "@/components/Waveform";
import {
  getTodayScenes,
  type SceneStatusName,
  type SceneTypeName,
  type TodayScene,
} from "@/lib/queries/today";

const DAY_MS = 1000 * 60 * 60 * 24;
const pad2 = (n: number) => String(n).padStart(2, "0");

// Seed writes production dates as `new Date("YYYY-MM-DD")`, which is UTC
// midnight. We normalize "today" the same way so day math doesn't drift by
// a day across timezones (e.g. PDT vs UTC).
function startOfDayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function formatHM(d: Date | null): string {
  if (!d) return "—";
  const h24 = d.getHours();
  const m = pad2(d.getMinutes());
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${period}`;
}

function formatRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "—";
  if (start && end) return `${formatHM(start)} → ${formatHM(end)}`;
  return formatHM(start ?? end);
}

// day exterior = sunlit, day interior = neutral bone,
// night exterior = cool tungsten key, night interior = soft soundstage green.
const EDGE_BY_TYPE: Record<SceneTypeName, EdgeColor> = {
  day_ext: "sunlight",
  night_ext: "tungsten",
  day_int: "bone",
  night_int: "soundstage",
};

function statusLabel(s: SceneStatusName): string {
  if (s === "wrapped") return "WRAPPED";
  if (s === "rolling") return "ROLLING";
  if (s === "confirmed") return "CONFIRMED";
  if (s === "cancelled") return "CANCELLED";
  if (s === "rescheduled") return "RESCHEDULED";
  return "PLANNED";
}

export default async function TodayView() {
  const [prod] = await db.select().from(productions).limit(1);
  if (!prod) {
    throw new Error("No production found. Run `npx tsx src/db/seed.ts`.");
  }

  const today = startOfDayUTC(new Date());
  const start = startOfDayUTC(prod.startDate);
  const end = startOfDayUTC(prod.endDate);

  const currentShootDay = Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;

  const todayScenes: TodayScene[] = await getTodayScenes(prod.id, currentShootDay);

  // Day 1: projected wrap is the latest plannedEnd across today's scenes.
  // Day 2+ will swap this for a live tick-based estimate.
  const latestEnd = todayScenes.reduce<Date | null>((acc, s) => {
    if (!s.plannedEnd) return acc;
    if (!acc || s.plannedEnd > acc) return s.plannedEnd;
    return acc;
  }, null);
  const projectedWrap = formatHM(latestEnd);

  // Calls today: the `calls` table is empty until Day 2 wires AgentPhone.
  // Static placeholder for now; Day 2 swaps in a live count.
  const callsValue = "0 / 0";
  const callsDelta = "0 outstanding";

  return (
    <main className="mx-auto" style={{ maxWidth: 960 }}>
      <header className="flex items-center justify-between gap-6 px-8 py-6">
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 26,
            lineHeight: 1,
          }}
        >
          1ad
        </div>

        <div className="caption flex items-center gap-4">
          <span>{prod.name}</span>
          <span aria-hidden>·</span>
          <span>
            Day {pad2(currentShootDay)} / {pad2(totalDays)}
          </span>
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

      <SectionNav current="today" />

      <HairlineRule />

      <section className="grid grid-cols-2 gap-8 px-8 py-8">
        <HeroMetric label="Projected wrap" value={projectedWrap} />
        <HeroMetric label="Calls today" value={callsValue} delta={callsDelta} />
      </section>

      <HairlineRule />

      <section className="px-8 py-6">
        <Caption>Active escalations</Caption>
        <div className="mt-4" style={{ display: "grid", gap: 10 }}>
          {[
            {
              id: "weather-cover-set",
              tone: "#4A90C2",
              label: "Cover set for tomorrow's beach scenes?",
              meta: "Story 1 · deadline 5:30 AM",
            },
            {
              id: "sick-cast-triage",
              tone: "#D94A3D",
              label: "Reshuffle Day 02 without the lead?",
              meta: "Story 2 · deadline 8:00 AM",
            },
            {
              id: "turnaround-violation",
              tone: "#E8C547",
              label: "Push tomorrow's call to 9:45 AM?",
              meta: "Story 3 · deadline 11:45 PM",
            },
            {
              id: "multi-day-reshuffle",
              tone: "#6B8E5A",
              label: "Approve the rebuilt 9-day shoot order?",
              meta: "Story 5 · deadline 3:00 PM",
            },
          ].map((esc) => (
            <Link
              key={esc.id}
              href={`/escalations/${esc.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "4px 1fr auto",
                columnGap: 16,
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "0.5px solid #21242A",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  background: esc.tone,
                  alignSelf: "stretch",
                  minHeight: 28,
                }}
              />
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 14 }}>
                {esc.label}
              </span>
              <span
                className="caption"
                style={{ color: "#6E7178" }}
              >
                {esc.meta}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <HairlineRule />

      <section>
        {todayScenes.map((s) => (
          <StripboardRow
            key={s.id}
            edge={EDGE_BY_TYPE[s.type]}
            title={`${s.sceneNumber} — ${s.description}`}
            caption={
              <>
                {s.locationName ? `Loc: ${s.locationName}` : "Loc: —"}
                {" · "}
                {`Cast: ${s.castCount}`}
              </>
            }
            right={`${formatRange(s.plannedStart, s.plannedEnd)}  ${statusLabel(s.status)}`}
          />
        ))}
      </section>

      <HairlineRule />

      <section className="px-8 py-8">
        <Caption>Agent activity</Caption>
        <div
          className="mt-4"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 18,
          }}
        >
          <Waveform active bars={28} width={200} height={32} />
          <div>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 15,
                color: "var(--color-chalk-white)",
              }}
            >
              Calling Maya Chen (Lead Actor) · Re: Confirming Availability
            </div>
            <div className="caption mt-1" style={{ color: "#9A9CA1" }}>
              <Link href="/calls" style={{ color: "inherit", textDecoration: "none" }}>
                Open call log →
              </Link>
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: 18,
              color: "#4A90C2",
            }}
          >
            0:42
          </div>
        </div>
      </section>
    </main>
  );
}
