import { db } from "@/db/client";
import { productions } from "@/db/schema";
import { HeaderClock } from "@/components/HeaderClock";

const DAY_MS = 1000 * 60 * 60 * 24;
const pad2 = (n: number) => String(n).padStart(2, "0");

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function TodayView() {
  const [prod] = await db.select().from(productions).limit(1);
  if (!prod) {
    throw new Error("No production found. Run `npx tsx src/db/seed.ts`.");
  }

  const today = startOfDay(new Date());
  const start = startOfDay(prod.startDate);
  const end = startOfDay(prod.endDate);

  const currentShootDay = Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;

  return (
    <main>
      <header
        style={{ borderBottom: "0.5px solid var(--color-slate-gray)" }}
        className="flex items-center justify-between px-8 py-6 gap-6"
      >
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
                background: "var(--color-tungsten)",
                display: "inline-block",
              }}
            />
            <HeaderClock />
          </span>
        </div>
      </header>
    </main>
  );
}
