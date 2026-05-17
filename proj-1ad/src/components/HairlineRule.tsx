// 0.5px slate-gray rule — the brand's section separator.
// Hex is inlined (mirroring StripboardRow) because Tailwind v4's @theme
// tokens aren't exposed as :root CSS variables in this build.
export function HairlineRule() {
  return <div style={{ borderTop: "0.5px solid #21242A" }} aria-hidden />;
}
