import { db } from "@/db/client";
import { scenes, locations, sceneCast } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

export type SceneTypeName = "day_ext" | "night_ext" | "day_int" | "night_int";
export type SceneStatusName =
  | "planned"
  | "confirmed"
  | "rolling"
  | "wrapped"
  | "cancelled"
  | "rescheduled";

export type TodayScene = {
  id: string;
  sceneNumber: string;
  description: string;
  type: SceneTypeName;
  status: SceneStatusName;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  locationName: string | null;
  castCount: number;
  orderWithinDay: number;
};

export async function getTodayScenes(
  productionId: string,
  shootDay: number,
): Promise<TodayScene[]> {
  const rows = await db
    .select({
      id: scenes.id,
      sceneNumber: scenes.sceneNumber,
      description: scenes.description,
      type: scenes.type,
      status: scenes.status,
      plannedStart: scenes.plannedStart,
      plannedEnd: scenes.plannedEnd,
      orderWithinDay: scenes.orderWithinDay,
      locationName: locations.name,
      // Subquery keeps the row 1:1 with scenes (no GROUP BY needed).
      castCount: sql<number>`(
        select count(*)::int
        from ${sceneCast}
        where ${sceneCast.sceneId} = ${scenes.id}
      )`,
    })
    .from(scenes)
    .leftJoin(locations, eq(scenes.locationId, locations.id))
    .where(and(eq(scenes.productionId, productionId), eq(scenes.shootDay, shootDay)))
    .orderBy(asc(scenes.orderWithinDay));

  return rows;
}
