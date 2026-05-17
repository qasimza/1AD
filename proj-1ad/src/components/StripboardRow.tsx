import type { ReactNode } from "react";

export type EdgeColor = "sunlight" | "tungsten" | "bone" | "soundstage" | "tally";

export function StripboardRow({
  edge,
  title,
  caption,
  right,
}: {
  edge: EdgeColor;
  title: ReactNode;
  caption?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-[4px_1fr_auto] items-stretch gap-4 py-4 px-6 transition-colors hover:bg-console-graphite/40"
      style={{ borderBottom: "0.5px solid var(--color-slate-gray)" }}
    >
      <div
        aria-hidden
        style={{ background: `var(--color-${edge})` }}
      />
      <div className="flex flex-col justify-center">
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>{title}</div>
        {caption && <div className="caption mt-1">{caption}</div>}
      </div>
      {right && (
        <div
          className="self-center"
          style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}
        >
          {right}
        </div>
      )}
    </div>
  );
}
