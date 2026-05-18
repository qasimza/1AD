import Link from "next/link";

// Shared dashboard section nav. Sits directly under the header hairline
// on every primary surface (Today / Schedule / Calls / Spend / Intake) so
// the coordinator can pivot between views without losing the chrome.

export type Section = "today" | "schedule" | "calls" | "spend" | "intake";

const ITEMS: { id: Section; label: string; href: string }[] = [
  { id: "today", label: "Today", href: "/" },
  { id: "schedule", label: "Schedule", href: "/schedule" },
  { id: "calls", label: "Calls", href: "/calls" },
  { id: "spend", label: "Spend", href: "/spend" },
  { id: "intake", label: "Intake", href: "/intake" },
];

export function SectionNav({ current }: { current: Section }) {
  return (
    <nav
      className="flex items-center gap-6 px-8 py-3 caption"
      aria-label="Section"
    >
      {ITEMS.map((item) =>
        item.id === current ? (
          <span
            key={item.id}
            style={{ color: "var(--color-chalk-white)" }}
            aria-current="page"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.id}
            href={item.href}
            style={{ color: "#6E7178", textDecoration: "none" }}
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
