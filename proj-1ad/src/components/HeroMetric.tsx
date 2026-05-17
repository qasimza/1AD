// TDD §10.2.2: 36px JetBrains Mono, tracked tight, with a 10px caption above.
// No card, no border. Just the number occupying the room it deserves.

export type DeltaTone = "neutral" | "tally";

export function HeroMetric({
  label,
  value,
  delta,
  deltaTone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: DeltaTone;
}) {
  const deltaColor = deltaTone === "tally" ? "var(--color-tally)" : "#6E7178";

  return (
    <div>
      <div className="caption">{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 36,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          marginTop: 8,
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            color: deltaColor,
            marginTop: 6,
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
