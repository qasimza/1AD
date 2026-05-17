import type { ReactNode } from "react";

export type EdgeColor = "sunlight" | "tungsten" | "bone" | "soundstage" | "tally";

// Mirror the brand tokens in globals.css. Inlined so the colored edge does
// not depend on Tailwind v4 actually exposing `--color-*` as :root variables.
const EDGE_HEX: Record<EdgeColor, string> = {
  sunlight: "#E8C547",
  tungsten: "#4A90C2",
  bone: "#D4D2C8",
  soundstage: "#6B8E5A",
  tally: "#D94A3D",
};

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
      className="transition-colors hover:bg-console-graphite/40"
      style={{
        display: "grid",
        gridTemplateColumns: "4px 1fr auto",
        alignItems: "stretch",
        columnGap: 16,
        padding: "16px 24px",
        borderBottom: "0.5px solid var(--color-slate-gray)",
      }}
    >
      <div
        aria-hidden
        style={{
          background: EDGE_HEX[edge],
          alignSelf: "stretch",
          minHeight: 36,
        }}
      />
      <div className="flex flex-col justify-center">
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>{title}</div>
        {caption && <div className="caption mt-1">{caption}</div>}
      </div>
      {right && (
        <div
          style={{
            alignSelf: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}
