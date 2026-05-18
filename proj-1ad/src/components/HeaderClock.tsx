"use client";

import { useEffect, useState } from "react";

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h24 = d.getHours();
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${period}`;
}

export function HeaderClock() {
  // Start with a placeholder so server and client render the same HTML.
  // The real time is filled in on mount, then ticks every second.
  const [time, setTime] = useState("--:--:-- --");

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
