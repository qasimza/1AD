"use client";

import { useEffect, useState } from "react";

// TDD §10.2.3: thin tungsten waveform that breathes with the cadence of
// speech. Real version reads from an AgentPhone audio-level queue. Demo
// version drives the same SVG path off two summed sinusoids per bar so it
// has variety without looping visibly. When `active` is false, the bars
// settle flat — they do NOT pulse on idle (that's the brand discipline:
// "off means off").

export function Waveform({
  active = true,
  bars = 28,
  height = 36,
  width = 200,
  color = "#4A90C2",
}: {
  active?: boolean;
  bars?: number;
  height?: number;
  width?: number;
  color?: string;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 70) {
        setTick((prev) => (prev + 1) % 100_000);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const barWidth = 2;
  const gap = (width - bars * barWidth) / (bars - 1);
  const midY = height / 2;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={active ? "Agent speaking" : "Agent idle"}
      style={{ display: "block" }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        let h: number;
        if (!active) {
          h = 2;
        } else {
          const phase = tick * 0.22 + i * 0.55;
          const carrier = Math.sin(phase) * 0.45 + 0.55;
          const envelope = Math.sin(phase * 0.31 + i * 0.18) * 0.45 + 0.55;
          h = Math.max(2, carrier * envelope * (height - 4));
        }
        const x = i * (barWidth + gap);
        return (
          <rect
            key={i}
            x={x}
            y={midY - h / 2}
            width={barWidth}
            height={h}
            rx={1}
            fill={color}
            opacity={active ? 0.9 : 0.35}
          />
        );
      })}
    </svg>
  );
}
