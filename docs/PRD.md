# Product Requirements Document

**1ad — The Virtual First AD**

*An autonomous voice and payment scheduling agent for film productions*

Built on AgentPhone and Sponge

Hackathon submission · v1.1

---

## Changelog

**v1.1** — Adds autonomous payment authority via Sponge. Tiered spend model replaces single-threshold autonomy. Story 4 (silent vendor) extended to close the loop end-to-end: the agent now negotiates, books, *and pays* the backup vendor within its authority. New "payment required" signal added to the catalogue. New autonomous-spend success metric.

**v1.0** — Initial submission.

---

## 1. Executive summary

Film schedules are in constant motion. Cast availability shifts, weather changes, locations fall through, equipment delivery slips, and a single disruption can cascade across dozens of people and a budget that bleeds thousands of dollars per idle hour. Today this coordination is handled manually by assistant directors and production coordinators who spend hours on the phone, in group texts, and chasing confirmations across spreadsheets — and when a replacement vendor needs a deposit at 7pm on a Sunday, the coordinator becomes a bottleneck for money as well as for time.

1ad is an autonomous voice agent that acts as a digital assistant director. It maintains a continuously updated model of a production's schedule, proactively monitors signals that predict disruption, places real outbound phone calls to cast, crew, vendors, and locations to confirm or rebuild plans, *executes payments within its delegated authority*, and escalates only the decisions that genuinely require human judgment. The agent does not wait for problems to be reported. It runs ahead of them.

This document captures the product definition, target user, system architecture, signal model, and demonstration scenarios for the hackathon build.

---

## 2. Problem

### 2.1 The scheduling chaos

Every production day involves a tightly choreographed sequence of people, places, and equipment. When one variable shifts, every downstream variable is at risk. A real First AD spends most of their pre-production and on-set time absorbing these shifts, recalculating the plan in their head, and on the phone driving the cascade of updates that keeps the production moving.

### 2.2 The payment friction

Coordination chaos is compounded by payment friction. When a replacement camera package, a backup catering order, or an emergency permit fee is needed outside business hours, the line producer's card sits in their wallet and the coordinator chases approvals. Vendors hold inventory for the production that pays the deposit fastest. A schedule rebuild that is *operationally* solved in twenty minutes can sit blocked for hours waiting on someone to read a text and tap an approval.

### 2.3 Why it is expensive

* Idle crew time on a mid-sized production runs $1,000 to $5,000 per hour.
* A single lost shoot day on a commercial can cost $50,000 to $500,000.
* Union violations such as SAG turnaround breaches trigger automatic penalties of roughly $2,500 per actor per occurrence.
* Smaller productions cannot afford full coordination staff, so the load falls on one or two overworked people who become a bottleneck.
* A backup vendor that *could* have been secured with a small deposit at 7pm is gone by 9am, because no one was awake to authorize the charge.

### 2.4 Why software has not solved it

Existing tools such as StudioBinder and Movie Magic are excellent at storing the schedule but treat the schedule as a static document. They do not place calls, do not detect emerging risks, do not rebuild the plan when something breaks, and they certainly do not move money. The work of coordination — and the work of paying for the consequences of coordination — is still human work.

---

## 3. Target audience

The agent serves three distinct stakeholders with different relationships to the product:

| Stakeholder | Role | Relationship to agent | What they need |
| :---- | :---- | :---- | :---- |
| **Line producer** | Budget holder | Buyer; sets spend authority; receives escalation summaries | Reduced overruns; risk visibility; real-time spend audit |
| **Production coordinator** | Daily operator | Primary user; sets up the production and feeds updates | Time back; fewer manual calls and texts |
| **First AD** | On-set authority | Trusts agent output as if it were their own coordination | Accurate updated call sheets; pre-empted problems |

### 3.1 Production scope

The agent is designed to handle any production size and any production type. Its value scales with crew count and disruption frequency. Initial launch targets are mid-size commercial productions and TV episodic, where scheduling chaos is highest per day and the buyer has clear budget authority. Narrative film, indie productions, and documentary teams are also supported, since the underlying coordination problem is the same.

### 3.2 The agent as First AD framing

Critically, the agent is not framed as a tool that helps a coordinator make calls. It is framed as a digital First AD. This shapes every design decision. The agent owns the schedule, drives coordination, exercises judgment within defined authority, *spends the production's money within delegated limits*, and treats the human coordinator as a partner rather than an operator.

---

## 4. Product philosophy

### 4.1 Proactive over reactive

A reactive agent waits for a human to report a problem and then helps solve it. A proactive agent monitors the production state continuously, simulates the day forward, identifies risks before they materialize, and acts on them early enough that they never become emergencies. 1ad is proactive. This is the defining characteristic of the product.

### 4.2 Continuous simulation

Between disruptions the agent is not idle. It is constantly running its internal simulation of the production forward in time, asking questions such as: if this scene runs over by twenty minutes, what breaks downstream; is the projected wrap time creating a turnaround violation; which confirmations are still outstanding and how long until they become a problem; what is the probability that the outdoor scene gets rained out and do we have a viable cover set; if we lose the vendor at 6pm, what backup options exist and which can be secured with a deposit under the agent's authority.

### 4.3 Tiered autonomy with clear escalation

The agent is granted explicit authority at production setup along three tiers. Each tier defines what the agent can do without checking, what it must notify a human about after the fact, and what it must escalate before doing.

| Tier | Spend ceiling | Behavior |
| :---- | :---- | :---- |
| **Auto** | $0 – $500 per transaction | Agent acts immediately. Logged to the dashboard and emailed to the line producer in the daily summary. No interruption. |
| **Notify-and-pay** | $500 – $2,500 per transaction | Agent pays and *simultaneously* sends an SMS to the line producer with the receipt and a one-tap "undo / dispute" option. Funds move; the human sees it land. |
| **Escalate** | > $2,500 per transaction, or anything outside vendor categories | Agent does the work of finding the option and getting the quote, then escalates the *decision* to the line producer with a one-tap approve. No money moves until approved. |

These ceilings are configurable per production. Daily and weekly cumulative caps are also enforced — exceeding a cumulative cap downgrades the next tier (an Auto-tier charge that would breach the daily Notify-and-pay limit gets bumped up to require notification). Caps are enforced server-side by Sponge so even a misbehaving agent cannot exceed them.

Within its authority the agent acts autonomously: it makes calls, sends texts, reorders scenes, reroutes vendors, *pays deposits*. Outside its authority it escalates with a concise summary and clear options. The human is never woken up unnecessarily and never left in the dark on a real decision — or a real charge.

### 4.4 Tool-agnostic source of truth

The agent does not require integration with any existing production software. The coordinator uploads a call sheet and contact roster at setup. The agent parses these into an internal model and from that point forward maintains the schedule itself. All updates flow through the agent, which can export an updated call sheet on demand. This makes the agent immediately usable by any production regardless of their existing tooling.

---

## 5. System overview

The agent operates in two phases across a production lifecycle:

### 5.1 Phase 1: Production setup

Hours or days before the shoot, the coordinator uploads the call sheet and contact roster. The agent parses these and identifies the gaps in its knowledge. It then conducts an intake conversation with the coordinator, either by call or by text, to fill in the missing information: actor riders, location restrictions, permit windows, *spend authority tiers*, escalation rules, and known backup options. The line producer separately funds the agent's Sponge wallet and confirms the tier ceilings. The agent also begins making early confirmation calls to high-risk parties such as lead cast, key crew, and locations. By the time the shoot day begins, almost all of the agent's data model is in the known state, and a funded card is ready for the moments it will be needed.

### 5.2 Phase 2: Live monitoring and response

Once the shoot is active, the agent runs its simulation loop continuously. It pulls weather data on an hourly cadence, recalculates projected wrap time on every progress update, monitors confirmation status against deadlines, watches for union compliance issues, and tracks its cumulative spend against the configured caps. When a signal crosses a risk threshold, the agent immediately initiates its response playbook. It places calls in parallel, sends targeted SMS updates to affected parties, rebuilds the schedule, executes payments where authorized, and either resolves the situation autonomously or escalates with options.

### 5.3 The First AD framing in practice

To the coordinator and the line producer, the experience feels like having an experienced First AD on staff at all times — one who also carries a corporate card with sensible limits. The agent is not asking permission to do its job. It is doing the job and reporting in. The human role is to onboard the agent at setup, fund the wallet, respond to escalations, and receive summaries.

---

## 6. Data model

Every piece of information the agent uses can be classified by its state. The state determines how the agent treats it.

| State | Definition | Agent behavior |
| :---- | :---- | :---- |
| **Known** | Agent has the data and trusts it as current. | Reason from it directly. |
| **Stale** | Agent has the data but the underlying reality may have shifted. | Verify proactively before acting on it. |
| **Missing** | Agent knows it needs this data but does not have it. | Actively acquire via call, text, or coordinator query. |
| **Inferred** | Data the agent derives from other known data. | Recalculate continuously as inputs change. |

### 6.1 Schedule data

* **Scene list and order.** Source: call sheet upload. Known at setup. Goes stale on any on-set delay.
* **Planned call times.** Source: call sheet upload. Known at setup. Goes stale on any scene overrun.
* **Actual shoot progress.** Source: coordinator check-ins via SMS. Agent prompts periodically.
* **Projected wrap time.** Inferred from progress against remaining scene list. Recalculated continuously.

### 6.2 People data

* **Contact roster.** Source: coordinator upload. Stable across the production.
* **Individual confirmations.** Acquired via outbound voice calls.
* **Conditional availability.** Extracted from natural language during confirmation calls.
* **Union turnaround status.** Inferred from previous wrap time and next call time, checked against SAG and IATSE rules baked into the agent.

### 6.3 Environment data

* **Weather forecast.** Source: weather API, polled hourly. Always known.
* **Location address and type.** Source: call sheet upload.
* **Location restrictions.** Acquired during setup intake. Includes noise rules, access hours, permit windows.
* **Permit validity.** Coordinator provides at setup. Agent monitors expiry.

### 6.4 Constraints data

* **Union rules.** Hardcoded into the agent. SAG turnaround minimums, IATSE meal penalty windows, child labor laws.
* **Actor-specific riders.** Acquired during setup intake.
* **Tiered spend authority.** Set by line producer at setup. Three ceilings (Auto, Notify-and-pay, Escalate) plus daily and weekly cumulative caps. Defines what the agent can pay for without checking.
* **Scene dependencies.** Inferred from script breakdown and cast list. Identifies which scenes share cast, location, or equipment.

### 6.5 Financial data

* **Sponge wallet balance.** Source: Sponge SDK, polled on every transaction and every tick. Always known.
* **Card transaction history.** Source: Sponge webhook events for every authorization, capture, refund, decline. Always known.
* **Cumulative spend (daily and weekly).** Inferred from transaction history. Used to determine current effective tier for the next proposed charge.
* **Vendor payment terms.** Acquired during setup intake or during the first call with a vendor. Stored per-vendor (deposit required vs. net-30 invoice, accepted card types).

---

## 7. Signal catalogue

Signals are categorized by their capture method, which directly determines what must be built to support them.

### 7.1 Captured via API

* **Weather forecast change.** Weather API polled hourly. Triggers when precipitation probability crosses threshold for outdoor scenes.
* **Time-based signals.** Internal clock drives confirmation deadlines, permit expiry warnings, and turnaround window calculations.
* **Geographic risk.** Maps traffic API for crew commute estimates relative to call times.
* **Card transaction event.** Sponge webhook on every authorization, capture, decline, or refund. Triggers ledger update and tier-cap recalculation. A decline is a signal — it means a vendor charge failed and the playbook needs to retry or escalate.

### 7.2 Captured via voice call

* **Confirmation status.** Agent asks directly during outbound call and parses the response.
* **Conditional availability.** Extracted from natural language during the same call.
* **Reachability.** Voicemail or no-answer is itself a signal after configured retry attempts.
* **Vendor confirmations.** Equipment, catering, locations. Same pattern as cast and crew.
* **Vendor quote and deposit request.** During a vendor call, the agent extracts the price and any deposit requirement. This becomes the input to the tier check.
* **Sentiment cues.** Hesitation or uncertainty in a verbal yes is flagged for coordinator follow-up.

### 7.3 Captured via SMS

* **Coordinator updates.** Free-text messages such as actor X is sick. Agent parses intent and triggers the appropriate cascade.
* **On-set progress.** Coordinator texts scene wrap notifications or delay alerts.
* **Cast and crew self-reports.** Any party can text the agent directly with status updates.
* **Line producer notify-tier responses.** "Undo" or "dispute" tapped on a Notify-and-pay receipt SMS triggers a refund or dispute flow.

### 7.4 Inferred from existing data

* **Union turnaround risk.** Calculated from previous wrap and next call. No external data required.
* **Budget overrun projection.** Projected wrap multiplied by overtime rates, plus committed card spend.
* **Cast idle time.** Actor call time compared against their first scene of the day.
* **Schedule infeasibility.** Setups remaining versus hours remaining.
* **Dependency violations.** Detected when a scene is scheduled before a prerequisite scene.
* **Scene complexity creep.** Pattern detected when early scenes consistently run over by a margin.
* **Effective tier for next charge.** Computed from the proposed charge amount plus cumulative daily and weekly spend against caps. Determines whether the agent acts, notifies, or escalates.

### 7.5 Captured at setup intake

Acquired once per production via conversation with the coordinator and the line producer. Includes actor riders, location restrictions, permit windows, *tiered spend authority and cumulative caps*, escalation rules, and known backup options.

### 7.6 Explicitly out of scope for v1

The following signals would require deep third-party integrations and are documented as future roadmap rather than v1 features: live production accounting integration, real-time GPS tracking of crew vehicles, camera log integration, and editorial system integration. *Direct ACH and wire payments are also out of scope for v1 — card-based payment via the Sponge card covers the vast majority of urgent vendor scenarios.*

---

## 8. Demonstration scenarios

The hackathon build supports five end-to-end scenarios. Each is designed to demonstrate a distinct capability while sharing the same underlying system.

### 8.1 Story 1: The 4am weather save

**Scenario.** Day 2 of a 3-day commercial shoot at an outdoor beach location. At 4am, the weather API reports a 60 percent chance of rain during the shoot window. Lead actor must finish by 4pm to catch a flight.

**Agent behavior.** Detects the weather threshold breach. Identifies that no cover set is on file. Calls the coordinator with three options. Once a backup location is named, immediately calls the location owner, the equipment vendor to reroute the truck, the lead actor's manager to confirm flex on the new call time, and sends an SMS to all twelve crew with the location change. Pushes an updated call sheet to everyone before 6am. Sends a summary email to the line producer.

**Capability showcased.** Proactive monitoring, cascading reasoning, parallel voice calls, escalation only for the one decision that requires human knowledge.

### 8.2 Story 2: The cascading sick day

**Scenario.** At 7am, the lead actor texts the coordinator that they are sick. The coordinator forwards to the agent.

**Agent behavior.** Reasons across the day's eight scenes to identify which two can shoot without the lead. Verifies other actors for those scenes are already on set. Confirms the reshuffle does not create a turnaround issue for tomorrow. Calls the DP to flag a different lens kit need, props to swap scene materials, catering to confirm headcount, and the stand-in to release them. The production loses thirty minutes instead of eight hours.

**Capability showcased.** Triage intelligence and multi-party coordination in a tight time window.

### 8.3 Story 3: The invisible union violation

**Scenario.** At 11pm the agent notices yesterday's wrap was 9:45pm and tomorrow's call is 5:30am, creating a turnaround window of 7.75 hours against a SAG minimum of 12 hours.

**Agent behavior.** Calculates the violation from raw schedule data with no external trigger. Calls both affected actors to confirm a delayed 9:45am call time. Calls the makeup team to shift their start time. Sends an email to the line producer with the rationale and the avoided penalty cost.

**Capability showcased.** Catching errors that a human would miss because the agent runs the math no one is paid to run at 11pm.

### 8.4 Story 4: The silent vendor *(extended in v1.1)*

**Scenario.** An equipment vendor was supposed to confirm by 6pm. At 7pm there is still silence.

**Agent behavior.**
1. Treats the silence itself as a signal. Calls the vendor and hits voicemail.
2. Calls the backup contact and discovers the driver called in sick.
3. Immediately calls three backup rental houses in priority order, gets quotes from each in natural language during the call. Best match: $1,800 package with a $400 deposit required to hold.
4. **Tier check.** $400 deposit falls within the Auto tier ($0–$500). Agent proceeds without waking the line producer.
5. **Pays.** Agent uses the Sponge card to charge the $400 deposit on the vendor's payment form (manual card-entry over the phone, or web form via the agent's checkout flow). Sponge enforces the daily and per-transaction caps server-side as a safety net.
6. Receives confirmation. Updates the schedule. SMS to the coordinator: *"Backup rental house secured. $400 deposit charged, $1,400 due on delivery. Truck arrives 7am."*
7. The $1,400 balance due on delivery exceeds the Auto tier and lands in Notify-and-pay. Agent sends the line producer an SMS with the full breakdown and the receipt.

**The line producer learns about the entire incident at the same moment they learn it is already resolved.**

**Capability showcased.** Silence as a signal; autonomous escalation through backup options; autonomous payment within delegated authority; tier-based escalation when the same transaction crosses thresholds; the agent finishing the job end-to-end instead of stopping at "what would you like to do?"

### 8.5 Story 5: The multi-day reshuffle

**Scenario.** On day 5 of a 14-day shoot, the location for day 8 falls through.

**Agent behavior.** Considers all remaining scenes, cast availability across the remaining days, weather forecasts, equipment rental periods, and union constraints. Proposes a new shooting order that minimizes cost and respects every constraint. Generates a new one-liner and offers to make the twenty-two calls required to confirm the rebuilt plan.

**Capability showcased.** Strategic-level operation, not just tactical. The agent demonstrates the kind of pre-production planning that an experienced AD does over hours, compressed into minutes.

---

## 9. Technical architecture

### 9.1 Voice and payment infrastructure

Outbound and inbound voice calling, SMS messaging, and phone number provisioning are all handled by AgentPhone. The agent issues voice calls through AgentPhone's API, configures the voice agent's system prompt and model tier per call, and receives full transcripts and structured outcomes once the call completes. Webhooks deliver real-time call and message events into the agent's state.

Autonomous payments are handled by Sponge. The line producer (or platform operator) creates a per-production agent via `SpongePlatform.createAgent` with the tier ceilings configured as `dailySpendingLimit`, `weeklySpendingLimit`, and `monthlySpendingLimit`. The returned agent API key authenticates the agent's `SpongeWallet` client for all payment actions. The agent uses the Sponge card (a Visa issued by Rain) for vendor payments, working anywhere Visa is accepted. Sponge enforces the configured limits server-side, providing a defense-in-depth guarantee on top of the application-layer tier logic — even if the agent's playbook were buggy, the wallet cannot exceed the human-configured ceiling.

### 9.2 Core agent loop

The agent runs a continuous loop that: ingests new events from voice calls, SMS, weather API, Sponge transaction webhooks, and internal timers; updates the internal production model; runs the simulation forward to identify emerging risks; ranks risks by urgency and proximity to threshold; executes the appropriate playbook for the highest-priority risk; logs everything (including every dollar spent) for transparency and audit.

### 9.3 Data persistence

The internal model includes the schedule, contact roster, constraints, *the financial ledger*, and a running event log. The model is the source of truth. The agent can export an updated call sheet — *and a full spend audit* — at any time.

### 9.4 External APIs

* **AgentPhone.** Voice calls, SMS, phone numbers, webhooks.
* **Sponge.** Agent wallet, Sponge card (Visa), spend limit enforcement, transaction webhooks.
* **Weather.** Forecast polling for outdoor scenes.
* **Maps.** Traffic and commute estimates.

### 9.5 Out of scope

Direct integration with StudioBinder, Movie Magic, production accounting systems, and editorial systems is deferred. The agent operates entirely from the uploaded call sheet and the conversational intake at setup. Direct ACH, wire, and invoice-based payments are also deferred to v2 — Sponge card payments cover the urgent-vendor case that matters for the demo.

---

## 10. Success metrics

Both demo-time and production metrics matter.

### 10.1 Demo-time metrics

* All five scenarios run end-to-end without manual intervention beyond the documented coordinator inputs.
* Each scenario completes its voice-call sequence inside a tight demo window.
* Story 4 results in a real Sponge card charge against a test merchant, visible in the dashboard and the Sponge console.
* The agent's reasoning is visible in the dashboard at every step — including the tier check and the spend decision.

### 10.2 Production metrics, post-hackathon

* Hours of coordinator time saved per shoot day.
* Number of disruptions resolved without human escalation.
* Reduction in idle crew minutes per shoot day.
* Avoided union violations measured in dollars of penalty avoided.
* **Autonomous spend volume per production**, broken down by tier (Auto vs. Notify-and-pay), with zero unauthorized charges as a hard requirement.
* **Median time from disruption detected to vendor secured and paid**, compared against the manual baseline.

---

## Appendix A: Glossary

* **First AD.** First Assistant Director. The person responsible for scheduling, managing the set, and driving the production forward day to day.
* **Call sheet.** The daily schedule document distributed to cast and crew specifying location, scenes, call times, and contact information.
* **Turnaround.** The minimum rest period between wrap one day and call time the next, defined by union agreements.
* **Cover set.** A backup interior location used when an outdoor shoot is rained out.
* **One-liner.** A condensed view of the full shoot schedule across all days, scene by scene.
* **Stripboard.** The visual representation of the shooting schedule, traditionally a board with colored strips for each scene.
* **Tier (Auto / Notify-and-pay / Escalate).** The three bands of the agent's spend authority. See §4.3.
* **Spend ceiling.** The per-transaction upper bound of a tier.
* **Cumulative cap.** The daily or weekly total spend limit, enforced by Sponge server-side independent of per-transaction tier.
* **Sponge card.** The Visa card issued by Rain through Sponge, used by the agent for vendor payments. Accepted anywhere Visa is accepted.
* **Sponge wallet.** The per-agent funding source behind the card. Funded by the line producer; balance enforced server-side.