"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Caption } from "@/components/Caption";
import { HairlineRule } from "@/components/HairlineRule";
import { HeaderClock } from "@/components/HeaderClock";
import { HeroMetric } from "@/components/HeroMetric";
import { SectionNav } from "@/components/SectionNav";
import { StripboardRow, type EdgeColor } from "@/components/StripboardRow";

// TDD §10.3.2: Spend view. Hardcoded for Day 3 demo so the surface is real
// even before the tier engine + Sponge plumbing are end-to-end. Numbers and
// rationale are tuned to match the canonical example in the TDD.

type Tier = "auto" | "notify" | "escalate";
type TxStatus = "authorized" | "captured" | "declined" | "refunded";

interface Tx {
  id: string;
  merchant: string;
  amountCents: number;
  tier: Tier;
  status: TxStatus;
  time: string;
  category: string;
  rationale: string;
  playbookDecision: string;
  tierReasoning: string;
  notifyMeta?: string;
  undoToken?: string;
}

const DAILY_CAP_CENTS = 500_000;
const WEEKLY_CAP_CENTS = 2_000_000;

const TX: Tx[] = [
  {
    id: "tx_apex_deposit",
    merchant: "APEX CAMERA RENTAL",
    amountCents: 40_000,
    tier: "auto",
    status: "authorized",
    time: "2:23 PM",
    category: "equipment",
    rationale: "Deposit · backup vendor (Cinema Pro unreachable)",
    playbookDecision:
      "silentVendor → Apex Camera selected as fallback. Cinema Pro: 3 missed calls over 27 min, last contact 11:48 AM.",
    tierReasoning:
      "$400 within auto ceiling ($500 equipment SOP §4.2). Apex on approved-vendor list, last used 2025-03-14, no incidents.",
  },
  {
    id: "tx_starbucks",
    merchant: "STARBUCKS — UNION SQ",
    amountCents: 8_740,
    tier: "auto",
    status: "captured",
    time: "8:11 AM",
    category: "catering",
    rationale: "Crew morning coffee · authorized by SOP",
    playbookDecision:
      "Standing SOP: crew coffee at first establishing location, ≤ $100 / day.",
    tierReasoning:
      "$87.40 under $100 catering ceiling. Crew of 14 → $6.24/head, within historical range ($5.80–$7.10).",
  },
  {
    id: "tx_enterprise",
    merchant: "ENTERPRISE CARGO VAN",
    amountCents: 24_500,
    tier: "auto",
    status: "captured",
    time: "7:02 AM",
    category: "transport",
    rationale: "Day rental · transport coordinator request",
    playbookDecision:
      "Direct request from transport coordinator (Jamie Park, verified 6:58 AM via known number).",
    tierReasoning:
      "$245 under $500 transport ceiling. Budget line §2 has $1,200/day cap, currently $0 spent.",
  },
  {
    id: "tx_petty_paper",
    merchant: "STAPLES — SOMA",
    amountCents: 4_212,
    tier: "auto",
    status: "captured",
    time: "9:47 AM",
    category: "office",
    rationale: "Sides reprint · 80 pages, color, rush",
    playbookDecision:
      "Petty cash equivalent. Script supervisor requested via SMS at 9:41 AM.",
    tierReasoning:
      "$42.12 under $100 office ceiling. No approval routing required.",
  },
  {
    id: "tx_apex_balance",
    merchant: "APEX CAMERA RENTAL",
    amountCents: 140_000,
    tier: "notify",
    status: "authorized",
    time: "5:30 PM",
    category: "equipment",
    rationale: "Balance due on delivery (companion to deposit above)",
    playbookDecision:
      "silentVendor → settle Apex balance on delivery confirmation (4:42 PM).",
    tierReasoning:
      "$1,400 over $500 silent ceiling → notify tier. Line producer SMS'd at 5:30 PM with undo link. Window closes 5:30 PM tomorrow.",
    notifyMeta: "Line producer SMS'd · undo expires 5:30 PM tomorrow",
    undoToken: "demo_apex_balance",
  },
  {
    id: "tx_locations_permit",
    merchant: "SF FILM OFFICE — PERMIT",
    amountCents: 32_000,
    tier: "notify",
    status: "captured",
    time: "11:08 AM",
    category: "locations",
    rationale: "Rush permit · added block on Pacific Ave",
    playbookDecision:
      "Coverage expansion: location manager added 14B reverse-angle setup at 10:52 AM.",
    tierReasoning:
      "$320 within auto ceiling, but locations category requires notify regardless (SOP §6.1). Line producer notified, no objection logged.",
    notifyMeta: "Line producer SMS'd · undo expires 11:08 AM tomorrow",
    undoToken: "demo_permit",
  },
];

const TIER_EDGE: Record<Tier, EdgeColor> = {
  auto: "bone",
  notify: "tungsten",
  escalate: "tally",
};

const TIER_LABEL: Record<Tier, string> = {
  auto: "AUTO",
  notify: "NOTIFY",
  escalate: "ESCALATE",
};

const STATUS_GLYPH: Record<TxStatus, string> = {
  authorized: "●",
  captured: "✓",
  declined: "✗",
  refunded: "↺",
};

type Filter = "all" | Tier;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "auto", label: "AUTO" },
  { id: "notify", label: "NOTIFY" },
  { id: "escalate", label: "ESCALATE" },
];

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function SpendView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const dailySpentCents = useMemo(
    () => TX.reduce((sum, t) => sum + t.amountCents, 0),
    [],
  );
  // Weekly spent: today plus a plausible four-day prefix so the bar reads as
  // mid-week, not Day 1. Hardcoded.
  const weeklySpentCents = dailySpentCents + 593_152;

  const visible = TX.filter((t) => filter === "all" || t.tier === filter);

  return (
    <main className="mx-auto" style={{ maxWidth: 960 }}>
      <header className="flex items-center justify-between gap-6 px-8 py-6">
        <Link
          href="/"
          aria-label="Back to today"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 26,
            lineHeight: 1,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          1ad
        </Link>

        <div className="caption flex items-center gap-4">
          <span>ACME Commercial</span>
          <span aria-hidden>·</span>
          <span>Day 02 / 03</span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#4A90C2",
                display: "inline-block",
              }}
            />
            <HeaderClock />
          </span>
        </div>
      </header>

      <HairlineRule />

      <SectionNav current="spend" />

      <HairlineRule />

      <section className="grid grid-cols-2 gap-8 px-8 py-8">
        <HeroMetric
          label="Daily spend"
          value={`${formatUSD(dailySpentCents)} / ${formatUSD(DAILY_CAP_CENTS)}`}
          delta={`${formatUSD(DAILY_CAP_CENTS - dailySpentCents)} remaining`}
        />
        <HeroMetric
          label="Weekly spend"
          value={`${formatUSD(weeklySpentCents)} / ${formatUSD(WEEKLY_CAP_CENTS)}`}
          delta={`${formatUSD(WEEKLY_CAP_CENTS - weeklySpentCents)} remaining`}
        />
      </section>

      <HairlineRule />

      <section className="flex items-center gap-2 px-8 py-4">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className="caption"
              style={{
                padding: "6px 10px",
                border: "0.5px solid #21242A",
                background: active ? "#16181B" : "transparent",
                color: active ? "var(--color-chalk-white)" : "#6E7178",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </section>

      <HairlineRule />

      <section>
        {visible.length === 0 && (
          <div
            className="px-8 py-8 caption"
            style={{ color: "#6E7178" }}
          >
            No transactions in this tier today.
          </div>
        )}

        {visible.map((t) => {
          const isOpen = expanded === t.id;
          return (
            <div key={t.id}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : t.id)}
                aria-expanded={isOpen}
                style={{
                  display: "block",
                  width: "100%",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  textAlign: "left",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <StripboardRow
                  edge={TIER_EDGE[t.tier]}
                  title={
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                      }}
                    >
                      <span style={{ letterSpacing: "0.02em" }}>{t.merchant}</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formatUSD(t.amountCents)}
                      </span>
                    </span>
                  }
                  caption={<>{t.rationale}</>}
                  right={
                    <span style={{ display: "inline-flex", gap: 12 }}>
                      <span
                        style={{
                          color:
                            t.tier === "auto"
                              ? "#6E7178"
                              : t.tier === "notify"
                                ? "#4A90C2"
                                : "#D94A3D",
                        }}
                      >
                        {TIER_LABEL[t.tier]}
                      </span>
                      <span>{t.time}</span>
                      <span>{STATUS_GLYPH[t.status]}</span>
                    </span>
                  }
                />
              </button>

              {isOpen && (
                <div
                  style={{
                    padding: "12px 32px 20px calc(32px + 4px + 16px)",
                    borderBottom: "0.5px solid #21242A",
                    background: "#0E1013",
                  }}
                >
                  <div className="caption" style={{ marginBottom: 6 }}>
                    Playbook decision
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: "var(--color-chalk-white)",
                      marginBottom: 14,
                    }}
                  >
                    {t.playbookDecision}
                  </div>

                  <div className="caption" style={{ marginBottom: 6 }}>
                    Tier reasoning
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: "var(--color-chalk-white)",
                    }}
                  >
                    {t.tierReasoning}
                  </div>

                  {t.notifyMeta && (
                    <div
                      className="mt-4 flex items-center gap-3"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        letterSpacing: "0.04em",
                        color: "#4A90C2",
                        marginTop: 14,
                      }}
                    >
                      <span>{t.notifyMeta}</span>
                      {t.undoToken && (
                        <Link
                          href={`/u/${t.undoToken}`}
                          style={{
                            color: "#D94A3D",
                            textDecoration: "underline",
                            textUnderlineOffset: 3,
                          }}
                        >
                          Undo →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <HairlineRule />

      <section className="px-8 py-8">
        <Caption>Audit</Caption>
        <div
          className="mt-4"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            color: "#6E7178",
          }}
        >
          {TX.length} transactions today · tap any row to see the playbook
          decision and tier reasoning behind it.
        </div>
      </section>
    </main>
  );
}
