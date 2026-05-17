import { db } from "./client";

import {
  productions,
  contacts,
  locations,
  scenes,
  sceneCast,
  callTimes,
} from "./schema";

async function seed() {
  console.log("Clearing existing data...");
  await db.delete(callTimes);
  await db.delete(sceneCast);
  await db.delete(scenes);
  await db.delete(locations);
  await db.delete(contacts);
  await db.delete(productions);

  // ─────────────────────────────────────────────────────────
  // PRODUCTION
  // ─────────────────────────────────────────────────────────
  const [prod] = await db
    .insert(productions)
    .values({
      name: "ACME Commercial",
      startDate: new Date("2026-05-16"),
      endDate: new Date("2026-05-18"),
      timezone: "America/Los_Angeles",
      agentmailInbox: "1ad-acme@agentmail.to",
      agentphoneNumber: "+15555550100",
      spongeAgentId: "placeholder",
      spongeApiKey: "placeholder",
      // Tier ceilings (cents)
      tierAutoCeiling: 50000, // $500 — auto-pay deposits
      tierNotifyCeiling: 250000, // $2,500 — notify & pay
      dailyCapCents: 500000, // $5,000/day cumulative
      weeklyCapCents: 2000000, // $20,000/week cumulative
    })
    .returning();

  // ─────────────────────────────────────────────────────────
  // CONTACTS — 10 actors, 15 crew, 5 vendors, 3 location owners
  //                                                        ↓ TEST PHONE
  // Replace ONE phone below (e.g. Maya Chen) with your real number
  // so the agent's outbound calls reach you during testing.
  // ─────────────────────────────────────────────────────────

  const actors = await db
    .insert(contacts)
    .values([
      { productionId: prod.id, name: "Maya Chen",        role: "lead_cast",       phone: "+14155550101", unionAffiliation: "SAG", rider: { turnaround_hours: 12, travel: "first_class", meals: "vegetarian" },                supermemoryUserId: `prod-${prod.id}-maya`,    notes: "Lead. Manager is Daniel Wu — calls preferred over text." },
      { productionId: prod.id, name: "Jordan Reyes",     role: "lead_cast",       phone: "+14155550102", unionAffiliation: "SAG", rider: { turnaround_hours: 12, dietary: "gluten_free" },                                       supermemoryUserId: `prod-${prod.id}-jordan`,  notes: "Co-lead. Flying out Mon evening, hard out 4pm Mon." },
      { productionId: prod.id, name: "Priya Shah",       role: "supporting_cast", phone: "+14155550103", unionAffiliation: "SAG", rider: { turnaround_hours: 12 },                                                                supermemoryUserId: `prod-${prod.id}-priya`,   notes: "Day player days 1 and 3 only." },
      { productionId: prod.id, name: "Marcus Hill",      role: "supporting_cast", phone: "+14155550104", unionAffiliation: "SAG", rider: { turnaround_hours: 12 },                                                                supermemoryUserId: `prod-${prod.id}-marcus`,  notes: null },
      { productionId: prod.id, name: "Elena Volkov",     role: "supporting_cast", phone: "+14155550105", unionAffiliation: "SAG", rider: { turnaround_hours: 12, accessibility: "wheelchair_ramp_required" },                    supermemoryUserId: `prod-${prod.id}-elena`,   notes: "Wheelchair user — confirm location accessibility before booking." },
      { productionId: prod.id, name: "Theo Kim",         role: "day_player",      phone: "+14155550106", unionAffiliation: "SAG", rider: {},                                                                                       supermemoryUserId: `prod-${prod.id}-theo`,    notes: null },
      { productionId: prod.id, name: "Ana Beltran",      role: "day_player",      phone: "+14155550107", unionAffiliation: "SAG", rider: {},                                                                                       supermemoryUserId: `prod-${prod.id}-ana`,     notes: null },
      { productionId: prod.id, name: "Wesley Park",      role: "day_player",      phone: "+14155550108", unionAffiliation: null,  rider: {},                                                                                       supermemoryUserId: `prod-${prod.id}-wesley`,  notes: "Non-union." },
      { productionId: prod.id, name: "Riley Foster",     role: "day_player",      phone: "+14155550109", unionAffiliation: null,  rider: {},                                                                                       supermemoryUserId: `prod-${prod.id}-riley`,   notes: "Non-union." },
      { productionId: prod.id, name: "Sam Iverson",      role: "stand_in",        phone: "+14155550110", unionAffiliation: null,  rider: {},                                                                                       supermemoryUserId: `prod-${prod.id}-sam-iv`,  notes: "Stand-in for Maya. Same height & coloring." },
    ])
    .returning();

  const crew = await db
    .insert(contacts)
    .values([
      { productionId: prod.id, name: "David Park",       role: "dp",                  phone: "+14155550120", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-david`,    notes: "DP. Prefers text before 7am, calls after." },
      { productionId: prod.id, name: "Sam Reyes",        role: "coordinator",         phone: "+14155550121", unionAffiliation: null,    rider: {}, supermemoryUserId: `prod-${prod.id}-sam-r`,    notes: "Production coordinator. Primary human in the loop." },
      { productionId: prod.id, name: "Lena Ortiz",       role: "line_producer",       phone: "+14155550122", email: "lena@acmeproductions.test", unionAffiliation: null, rider: {}, supermemoryUserId: `prod-${prod.id}-lena`, notes: "Line producer. Receives escalations and daily spend summary." },
      { productionId: prod.id, name: "Daniel Wu",        role: "talent_manager",      phone: "+14155550123", unionAffiliation: null,    rider: {}, supermemoryUserId: `prod-${prod.id}-danwu`,    notes: "Maya Chen's manager. Approves all schedule changes for Maya." },
      { productionId: prod.id, name: "Khaled Mansour",   role: "first_ac",            phone: "+14155550124", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-khaled`,   notes: "First AC. Works closely with David." },
      { productionId: prod.id, name: "Joon Lee",         role: "gaffer",              phone: "+14155550125", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-joon`,     notes: null },
      { productionId: prod.id, name: "Tessa Nguyen",     role: "key_grip",            phone: "+14155550126", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-tessa`,    notes: null },
      { productionId: prod.id, name: "Marco Diaz",       role: "sound_mixer",         phone: "+14155550127", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-marco`,    notes: null },
      { productionId: prod.id, name: "Ivy Brooks",       role: "script_supervisor",   phone: "+14155550128", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-ivy`,      notes: null },
      { productionId: prod.id, name: "Naomi Singh",      role: "makeup_dept_head",    phone: "+14155550129", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-naomi`,    notes: "Makeup. Call usually 90 min before talent call." },
      { productionId: prod.id, name: "Cole Bennett",     role: "hair_dept_head",      phone: "+14155550130", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-cole`,     notes: null },
      { productionId: prod.id, name: "Pavan Reddy",      role: "wardrobe_supervisor", phone: "+14155550131", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-pavan`,    notes: null },
      { productionId: prod.id, name: "Hannah Murphy",    role: "props_master",        phone: "+14155550132", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-hannah`,   notes: null },
      { productionId: prod.id, name: "Bo Sato",          role: "transport_captain",   phone: "+14155550133", unionAffiliation: "IATSE", rider: {}, supermemoryUserId: `prod-${prod.id}-bo`,       notes: "Coordinates all vehicles." },
      { productionId: prod.id, name: "Renée Allard",     role: "second_ad",           phone: "+14155550134", unionAffiliation: null,    rider: {}, supermemoryUserId: `prod-${prod.id}-renee`,    notes: "Second AD. Manages background and call sheet distribution." },
    ])
    .returning();

  const vendors = await db
    .insert(contacts)
    .values([
      { productionId: prod.id, name: "Cinema Pro Rentals",       role: "vendor_camera",      phone: "+14155550140", email: "ops@cinemapro.test",       unionAffiliation: null, rider: { payment_terms: "deposit_50_due_on_delivery_50", accepts: ["visa", "mc", "ach"] }, supermemoryUserId: `prod-${prod.id}-cinemapro`, notes: "Primary camera package. Driver: Mike. Backup driver: Carlos." },
      { productionId: prod.id, name: "Apex Camera Rental",        role: "vendor_camera",      phone: "+14155550141", email: "rentals@apex.test",        unionAffiliation: null, rider: { payment_terms: "deposit_required", accepts: ["visa", "mc"] },                       supermemoryUserId: `prod-${prod.id}-apex`,      notes: "Backup camera house. Slightly pricier, faster turnaround." },
      { productionId: prod.id, name: "GoldStar Grip & Electric",  role: "vendor_grip",        phone: "+14155550142", email: "dispatch@goldstar.test",   unionAffiliation: null, rider: { payment_terms: "net_15", accepts: ["ach", "wire"] },                               supermemoryUserId: `prod-${prod.id}-goldstar`,  notes: "Grip & electric package. Net-15, no card needed up front." },
      { productionId: prod.id, name: "Bayside Catering",          role: "vendor_catering",    phone: "+14155550143", email: "orders@bayside.test",      unionAffiliation: null, rider: { payment_terms: "deposit_required", accepts: ["visa", "mc", "amex"] },              supermemoryUserId: `prod-${prod.id}-bayside`,   notes: "Catering. Confirms headcount day-before by 3pm." },
      { productionId: prod.id, name: "Stagecoach Transport",      role: "vendor_transport",   phone: "+14155550144", email: "fleet@stagecoach.test",    unionAffiliation: null, rider: { payment_terms: "deposit_required", accepts: ["visa", "mc"] },                       supermemoryUserId: `prod-${prod.id}-stagecoach`, notes: "Cargo vans and a 15-pax. On-call for last-minute swaps." },
    ])
    .returning();

  const locationOwners = await db
    .insert(contacts)
    .values([
      { productionId: prod.id, name: "Hank Olsen",       role: "location_owner",  phone: "+14155550150", email: "hank@stinsonparking.test",  unionAffiliation: null, rider: { restrictions: "no_filming_after_19_00", access_window: "05_00_to_20_00" },           supermemoryUserId: `prod-${prod.id}-hank`,    notes: "Owns the Stinson parking lot we shoot from. Wife answers most calls." },
      { productionId: prod.id, name: "Greta Lindqvist",   role: "location_owner",  phone: "+14155550151", email: "greta@palacehotel.test",    unionAffiliation: null, rider: { restrictions: "no_load_in_through_main_lobby", access_window: "06_00_to_23_00" },    supermemoryUserId: `prod-${prod.id}-greta`,   notes: "Manages the Palace Hotel cover-set deal. Strict about lobby." },
      { productionId: prod.id, name: "Ronnie Sato",       role: "location_owner",  phone: "+14155550152", email: "ronnie@stagewarehouse.test", unionAffiliation: null, rider: { restrictions: "no_open_flame", access_window: "24_7" },                              supermemoryUserId: `prod-${prod.id}-ronnie`,  notes: "Owns the warehouse soundstage. Cover-set option B." },
    ])
    .returning();

  // ─────────────────────────────────────────────────────────
  // LOCATIONS — 3 total, one outdoor + two interiors flagged as cover sets
  // ─────────────────────────────────────────────────────────
  const locs = await db
    .insert(locations)
    .values([
      {
        productionId: prod.id,
        name: "Stinson Beach",
        address: "Stinson Beach, CA",
        lat: "37.901100",
        lon: "-122.640900",
        permitExpiresAt: new Date("2026-05-19"),
        restrictions: { noise_after: "20:00", access_window: "05:00-20:00" },
        ownerContactId: locationOwners[0].id,
        isCoverSet: false,
      },
      {
        productionId: prod.id,
        name: "Palace Hotel — Lobby",
        address: "2 New Montgomery St, San Francisco, CA",
        lat: "37.788000",
        lon: "-122.401400",
        permitExpiresAt: new Date("2026-05-19"),
        restrictions: { no_load_in_main_lobby: true, access_window: "06:00-23:00" },
        ownerContactId: locationOwners[1].id,
        isCoverSet: true,
      },
      {
        productionId: prod.id,
        name: "Warehouse Soundstage — Oakland",
        address: "1500 8th Ave, Oakland, CA",
        lat: "37.795700",
        lon: "-122.245700",
        permitExpiresAt: new Date("2026-05-25"),
        restrictions: { no_open_flame: true },
        ownerContactId: locationOwners[2].id,
        isCoverSet: true,
      },
    ])
    .returning();

  // ─────────────────────────────────────────────────────────
  // SCENES — Day 2 of 3, mix of statuses for visual interest
  // ─────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const scenesData = [
    { num: "14A", desc: "Beach establishing",     type: "day_ext" as const,   locIdx: 0, start: 6,     end: 9.5,   status: "wrapped" as const, cast: [actors[0], actors[1]] },
    { num: "14B", desc: "Wide on couple",         type: "day_ext" as const,   locIdx: 0, start: 9.75,  end: 11.25, status: "rolling" as const, cast: [actors[0], actors[1]] },
    { num: "14C", desc: "Reverse — singles",      type: "day_ext" as const,   locIdx: 0, start: 11.5,  end: 13,    status: "planned" as const, cast: [actors[0], actors[1]] },
    { num: "22",  desc: "Hotel lobby — meeting",  type: "day_int" as const,   locIdx: 1, start: 14.5,  end: 18,    status: "planned" as const, cast: [actors[0], actors[2], actors[3]] },
    { num: "22A", desc: "Lobby insert — keys",    type: "day_int" as const,   locIdx: 1, start: 18.25, end: 19.5,  status: "planned" as const, cast: [actors[0]] },
  ];

  for (let i = 0; i < scenesData.length; i++) {
    const s = scenesData[i];
    const startDate = new Date(today);
    startDate.setHours(Math.floor(s.start), (s.start % 1) * 60);
    const endDate = new Date(today);
    endDate.setHours(Math.floor(s.end), (s.end % 1) * 60);

    const [scene] = await db
      .insert(scenes)
      .values({
        productionId: prod.id,
        sceneNumber: s.num,
        description: s.desc,
        type: s.type,
        locationId: locs[s.locIdx].id,
        shootDay: 2,
        orderWithinDay: i + 1,
        status: s.status,
        plannedStart: startDate,
        plannedEnd: endDate,
        actualStart: s.status !== "planned" ? startDate : null,
        actualWrap: s.status === "wrapped" ? endDate : null,
      })
      .returning();

    // Link cast to scene
    if (s.cast.length > 0) {
      await db.insert(sceneCast).values(
        s.cast.map((c) => ({ sceneId: scene.id, contactId: c.id })),
      );
    }
  }

  console.log("✓ Seed complete");
  console.log(`  Production: ${prod.name} (${prod.id})`);
  console.log(`  Actors:        ${actors.length}`);
  console.log(`  Crew:          ${crew.length}`);
  console.log(`  Vendors:       ${vendors.length}`);
  console.log(`  Loc. owners:   ${locationOwners.length}`);
  console.log(`  Locations:     ${locs.length}`);
  console.log(`  Scenes:        ${scenesData.length}`);
  process.exit(0);
}

seed().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});