import { json, preflight } from "@/lib/oauth";
import { authServerMetadata } from "@/lib/oauth-metadata";

// Some MCP clients only probe OpenID discovery; serve the same OAuth metadata there.
export const OPTIONS = preflight;
export async function GET() {
  return json({ ...authServerMetadata(), subject_types_supported: ["public"] });
}
