# 1AD

*Brand brief · v0.1*

---

## The one-line

1AD is the first assistant director that never sleeps.

---

## What it should feel like

A control room, not a dashboard. A title card, not a notification. The product should feel like it was designed by someone who has actually been on a set at 4am, and who respects the craft enough not to clutter it.

The closest references are A24's title sequences, Letterboxd's restraint, the Criterion Collection's spine design, and the quiet authority of a real production control surface — the kind of room where the lighting is low, the screens glow softly, and the people running the show speak in short, specific sentences.

The opposite — the thing to avoid — is the SaaS dashboard aesthetic: stacked cards, busy gradients, every metric demanding equal attention, "AI" badges everywhere. 1AD is the antithesis of that. It is software with the confidence to be quiet.

---

## Color system

The palette is built in three layers. Each color has a job. Nothing is decoration.

### Foundation · base neutrals

A warm-leaning dark base. Slightly green-graphite rather than blue-black, so it reads as a working room and not a cyberpunk interface.

| Token | Hex | Use |
|---|---|---|
| Stage black | `#0C0D0F` | App canvas |
| Console graphite | `#16181B` | Surfaces, panels |
| Slate gray | `#21242A` | Borders, dividers |
| Chalk white | `#E6E4DC` | Primary text |

Chalk white is intentionally off-white. Pure `#FFFFFF` hums against the dark; `#E6E4DC` settles into it.

### Stripboard accents · scene types and states

The four colors below are the traditional stripboard palette used on film schedules for nearly a century. In 1AD they do double duty: they classify scene types in the schedule, and they classify signal states in the agent's reasoning.

| Token | Hex | Scene type | Signal state |
|---|---|---|---|
| Sunlight yellow | `#E8C547` | Day exterior | Weather watch, risk emerging |
| Tungsten blue | `#4A90C2` | Night exterior | Agent active — calling, reasoning, working |
| Bone white | `#D4D2C8` | Day interior | Neutral data, resting confirmations |
| Sound-stage green | `#6B8E5A` | Night interior | Confirmed, locked-in |

Tungsten blue is the agent's voice color. When 1AD is doing something — placing a call, recalculating the day, drafting a response — the surface glows tungsten. It is the closest thing the product has to a "brand color."

### Signal · alert only

| Token | Hex | Use |
|---|---|---|
| Tally red | `#D94A3D` | Live call · union violation · escalation |

Named for the camera tally light — the small red lamp on top of a film camera that tells everyone on set the camera is rolling. Reserved for moments that genuinely need the line producer's eyes. The discipline is simple: if everything is red, nothing is.

---

## Typography

Two typefaces. The tension between them is the entire identity.

**Fraunces** (or a sibling serif with optical sizes) carries the product name, hero numbers when they need warmth, scene titles, and any moment that calls for human judgment. The numeral `1` and the letters `ad` are both set in italic lowercase. The wordmark is always `1ad`, never `1AD` in display contexts and never capitalized.

**JetBrains Mono** (or Berkeley Mono) handles all data: timecodes, call times, scene numbers, dollar figures, durations, status labels, anything the machine knows precisely. Monospace is the agent speaking in its own voice.

The serif is the human. The mono is the machine. Every screen should have both, in conversation with each other.

### Scale

- Display serif — 64–96px, used sparingly, for title-card moments
- Heading serif — 22–28px, for section openings
- Body serif — 14–16px, for human-readable copy and scene names
- Data mono — 11–14px for labels, 24–36px for hero metrics
- Caption mono — 10–11px, widely tracked (0.12–0.16em), uppercase, for system labels like `PROJECTED WRAP` or `DAY 02 / 03`

Sentence case everywhere except the tracked mono captions, which are uppercase by convention — the way credits and slate markings are.

---

## Layout

Letterbox the world. The 2.35:1 cinematic frame is a structural element, not a costume.

- **Hairline rules, not borders.** 0.5px dividers in slate gray. Never 1px, never heavier.
- **No drop shadows.** No cards stacked on cards. Depth comes from the graphite-on-black surface relationship alone.
- **One thing per frame.** If a moment matters, give it the whole width. If it doesn't, let it be a footnote in the margin.
- **The colored edge bar is the primary visual unit.** A 4–6px vertical strip of stripboard color on the left edge of a row classifies it at a glance — the way a real stripboard does. This is the most-used pattern in the product.
- **Generous vertical rhythm.** Breathing room is non-negotiable. A cramped control room is a stressed control room.

---

## Motion

Borrow from film, not from web. Three modes, used deliberately.

**Cut.** Decisive moments change frame with no easing and no spring. A confirmation locking in, an escalation landing, a scene status flipping — these are edits, not transitions. 0ms.

**Dissolve.** Transitional moments cross-fade slowly, the way one scene becomes another in a finished film. Schedule rebuilds, view changes, the day's plan reshaping itself. 600–900ms.

**Roll.** Recalculating numbers — projected wrap, budget overrun, turnaround clock — tick the way a mechanical counter or a digital slate ticks down. Never spin, never fade. Roll.

The agent's voice presence is not a spinner. It is a thin waveform that breathes with the cadence of actual speech, tungsten blue, sitting where the agent is currently active. When the agent stops speaking, the waveform settles flat. It does not loop.

Nothing bounces. Nothing pops. Everything settles the way a slate settles after the clap.

---

## Voice

Short, declarative, set-literate. The agent talks the way an experienced first AD talks: calm, specific, no hedging, no apologies. It uses production vocabulary correctly — *turnaround*, *cover set*, *one-liner*, *stripboard*, *lockup*, *martini* — because the people it works with use those words, and getting them wrong would mark it as an outsider.

It does not say "I'm sorry to bother you." It says "Quick one — we need to move your call to 9:45 tomorrow to clear turnaround. Confirming?"

It does not say "I've completed your request." It says "Done. Vendor rerouted, crew notified, call sheet updated."

It does not apologize for waking someone at 4am. If it's calling at 4am, there's a reason, and the reason comes first.

### Taglines worth testing

- *1ad runs the day.*
- *The first assistant that never sleeps.*
- *Your 1st AD. On every call.*
- *The set runs on 1ad.*

---

## Application

A few examples of how the system shows up in practice.

**Dashboard header.** Wordmark on the left in 24–28px Fraunces italic. Day counter, current timecode, and live indicator on the right in tracked mono. A single hairline rule beneath. Nothing else.

**Signal row.** Colored stripboard edge (4–6px) on the left. Scene name in serif. Detail in tracked mono caption beneath. State label in mono on the right, color-matched to the edge.

**Hero metric.** Projected wrap or turnaround clock set in 36–48px mono, tracked tight. Label in 10px tracked uppercase mono above. No card, no border — just the number, sitting in space, occupying the room it deserves.

**Active call.** Tungsten waveform breathing on a graphite surface. Caller name in serif. Call duration ticking in mono. A single tally-red dot indicating the call is live. Transcript streaming below in serif body, the agent's voice in chalk white, the other party's voice in slate gray.

**Escalation to line producer.** Letterboxed full-frame moment. Black bars top and bottom. The decision stated in serif. The options stated in serif. The deadline stated in mono. One tap to choose. No second screen, no nested confirmation, no "are you sure." The line producer is busy; the agent has already done the thinking.

---

## What 1AD is not

- Not a chatbot. The agent has a presence, but conversation is not the primary surface — the schedule is.
- Not a CRM. There are no pipelines, no funnels, no "leads."
- Not a notification firehose. The default state is silence. Sound and motion only when something needs attention.
- Not a productivity tool. It is a digital member of the crew with authority, not a personal assistant for the coordinator.
- Not enterprise software pretending to be cinematic. It is cinematic, all the way down.

---

*1ad · v0.1 · production black*