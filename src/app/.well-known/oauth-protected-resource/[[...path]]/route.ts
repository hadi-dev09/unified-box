import { baseUrl, CORS, json, preflight } from "@/lib/oauth";

export const OPTIONS = preflight;
export async function GET() {
  return json({
    resource: `${baseUrl()}/api/mcp`,
    authorization_servers: [baseUrl()],
    bearer_methods_supported: ["header"],
    resource_name: "Unified Box",
  }, 200, CORS);
}
