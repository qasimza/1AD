import type { ReactNode } from "react";

// TDD §10.2.4: 2.35:1 black bars top and bottom, content centered. No
// second screen, no nested confirmation. The brief is explicit — the
// line producer is busy, the agent has already done the thinking.
//
// We render a fixed-position full-screen black canvas with the content
// strip vertically centered. The strip itself uses the brand stage
// black so it reads as one piece with the rest of the product.

export function Letterbox({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0"
      style={{
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "2.35 / 1",
          background: "var(--color-stage-black)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 64px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 960 }}>{children}</div>
      </div>
    </div>
  );
}
