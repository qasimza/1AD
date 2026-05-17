"use client";

import { useEffect, useState } from "react";

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function HeaderClock() {
  // Start with a placeholder so server and client render the same HTML.
  // The real time is filled in on mount, then ticks every second.
  const [time, setTime] = useState("--:--:--");

  useEffect(() => {
    setTime(formatTime(new Date()));
    const id = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
      {time}
    </span>
  );
}
