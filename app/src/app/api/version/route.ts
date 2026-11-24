import { BUILD_ID } from "@/lib/buildId";

export const dynamic = "force-dynamic";

/** The live deployment's id (public, not sensitive): lets an open page notice an update. */
export function GET() {
  return Response.json({ build: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
