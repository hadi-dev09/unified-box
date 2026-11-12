import { json, preflight } from "@/lib/oauth";
import { authServerMetadata } from "@/lib/oauth-metadata";

export const OPTIONS = preflight;
export async function GET() {
  return json(authServerMetadata());
}
