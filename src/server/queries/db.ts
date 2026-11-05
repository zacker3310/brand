import { connection } from "next/server";
import { getDb } from "@/db/client";

/** All UI reads go through here: opts the route out of prerendering (DB is request-time data). */
export async function readDb() {
  await connection();
  return getDb();
}
