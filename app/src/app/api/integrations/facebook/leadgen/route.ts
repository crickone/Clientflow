// The original leadgen-only callback URL, kept so a Meta app already pointed
// here keeps working. Everything (lead ads + DMs) is handled by the one Meta
// webhook. Segment config must be declared in the file itself, not re-exported.
export { GET, POST } from "../../meta/webhook/route";
export const dynamic = "force-dynamic";
