import { pgTable, uuid, text, timestamp, integer, numeric, jsonb,
    boolean, pgEnum, bigserial, index } from "drizzle-orm/pg-core";

export const sceneType = pgEnum("scene_type", [
"day_ext", "night_ext", "day_int", "night_int",
]);

export const sceneStatus = pgEnum("scene_status", [
"planned", "confirmed", "rolling", "wrapped", "cancelled", "rescheduled",
]);

export const freshness = pgEnum("freshness", [
"known", "stale", "missing", "inferred",
]);

export const spendTier = pgEnum("spend_tier", [
"auto", "notify", "escalate",
]);

export const productions = pgTable("productions", {
id: uuid("id").primaryKey().defaultRandom(),
name: text("name").notNull(),
startDate: timestamp("start_date", { mode: "date" }).notNull(),
endDate: timestamp("end_date", { mode: "date" }).notNull(),
timezone: text("timezone").notNull(),
agentmailInbox: text("agentmail_inbox").notNull(),
agentphoneNumber: text("agentphone_number").notNull(),
spongeAgentId: text("sponge_agent_id").notNull(),
spongeApiKey: text("sponge_api_key").notNull(),  // ref to Secret Manager
// Tier ceilings, in cents
tierAutoCeiling: integer("tier_auto_ceiling").notNull().default(50000),       // $500
tierNotifyCeiling: integer("tier_notify_ceiling").notNull().default(250000),  // $2500
dailyCapCents: integer("daily_cap_cents").notNull().default(500000),          // $5000
weeklyCapCents: integer("weekly_cap_cents").notNull().default(2000000),       // $20000
escalationRules: jsonb("escalation_rules").notNull().default({}),
createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull().references(() => productions.id),
name: text("name").notNull(),
role: text("role").notNull(),                  // 'lead_cast' | 'dp' | 'vendor' | ...
phone: text("phone"),
email: text("email"),
unionAffiliation: text("union_affiliation"),   // 'SAG' | 'IATSE' | null
rider: jsonb("rider").notNull().default({}),
notes: text("notes"),
supermemoryUserId: text("supermemory_user_id").notNull(),
});

export const locations = pgTable("locations", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull().references(() => productions.id),
name: text("name").notNull(),
address: text("address").notNull(),
lat: numeric("lat", { precision: 9, scale: 6 }),
lon: numeric("lon", { precision: 9, scale: 6 }),
permitExpiresAt: timestamp("permit_expires_at"),
restrictions: jsonb("restrictions").notNull().default({}),
ownerContactId: uuid("owner_contact_id").references(() => contacts.id),
isCoverSet: boolean("is_cover_set").notNull().default(false),
});

export const scenes = pgTable("scenes", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull().references(() => productions.id),
sceneNumber: text("scene_number").notNull(),
description: text("description").notNull(),
type: sceneType("type").notNull(),
locationId: uuid("location_id").references(() => locations.id),
estimatedPages: numeric("estimated_pages", { precision: 4, scale: 2 }),
estimatedSetupMinutes: integer("estimated_setup_minutes"),
status: sceneStatus("status").notNull().default("planned"),
plannedStart: timestamp("planned_start"),
plannedEnd: timestamp("planned_end"),
actualStart: timestamp("actual_start"),
actualWrap: timestamp("actual_wrap"),
shootDay: integer("shoot_day").notNull(),
orderWithinDay: integer("order_within_day").notNull(),
});

export const sceneCast = pgTable("scene_cast", {
sceneId: uuid("scene_id").notNull().references(() => scenes.id),
contactId: uuid("contact_id").notNull().references(() => contacts.id),
}, (t) => ({ pk: index().on(t.sceneId, t.contactId) }));

export const callTimes = pgTable("call_times", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
contactId: uuid("contact_id").notNull().references(() => contacts.id),
shootDay: integer("shoot_day").notNull(),
callAt: timestamp("call_at").notNull(),
freshness: freshness("freshness").notNull().default("known"),
confirmedAt: timestamp("confirmed_at"),
confirmationCallId: uuid("confirmation_call_id"),
});

export const calls = pgTable("calls", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
contactId: uuid("contact_id").references(() => contacts.id),
direction: text("direction").notNull(),          // 'outbound' | 'inbound'
agentphoneCallId: text("agentphone_call_id").notNull(),
startedAt: timestamp("started_at"),
endedAt: timestamp("ended_at"),
outcome: text("outcome"),                        // 'confirmed' | 'voicemail' | ...
transcript: text("transcript"),
structuredResult: jsonb("structured_result"),
playbook: text("playbook"),
});

export const messages = pgTable("messages", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
contactId: uuid("contact_id").references(() => contacts.id),
direction: text("direction").notNull(),
body: text("body").notNull(),
sentAt: timestamp("sent_at").notNull(),
});

export const emails = pgTable("emails", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
agentmailMessageId: text("agentmail_message_id").notNull(),
direction: text("direction").notNull(),
subject: text("subject"),
body: text("body"),
toAddr: text("to_addr"),
fromAddr: text("from_addr"),
sentAt: timestamp("sent_at").notNull(),
});

export const transactions = pgTable("transactions", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
spongeTransactionId: text("sponge_transaction_id").notNull().unique(),
amountCents: integer("amount_cents").notNull(),
merchant: text("merchant"),
category: text("category"),
tierUsed: spendTier("tier_used").notNull(),
status: text("status").notNull(),                // 'authorized' | 'captured' | 'declined' | 'refunded'
playbookRunId: uuid("playbook_run_id"),
contactId: uuid("contact_id").references(() => contacts.id),
notifiedAt: timestamp("notified_at"),            // when line producer was SMS'd
approvedAt: timestamp("approved_at"),            // for escalate tier
createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const events = pgTable("events", {
id: bigserial("id", { mode: "number" }).primaryKey(),
productionId: uuid("production_id").notNull(),
kind: text("kind").notNull(),                    // 'risk.detected', 'call.completed', ...
severity: text("severity").notNull(),            // 'info' | 'watch' | 'live'
payload: jsonb("payload").notNull(),
createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
idxTime: index("idx_events_prod_time").on(t.productionId, t.createdAt),
}));

export const risks = pgTable("risks", {
id: uuid("id").primaryKey().defaultRandom(),
productionId: uuid("production_id").notNull(),
kind: text("kind").notNull(),                    // 'weather' | 'turnaround' | ...
severity: text("severity").notNull(),
detectedAt: timestamp("detected_at").notNull().defaultNow(),
resolvedAt: timestamp("resolved_at"),
context: jsonb("context").notNull(),
playbookRunId: uuid("playbook_run_id"),
});