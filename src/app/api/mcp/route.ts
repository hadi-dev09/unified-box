import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tools } from "@/lib/mcp-tools";
import { baseUrl, userFromBearer } from "@/lib/oauth";

// Minimal stateless MCP server (JSON-RPC over HTTP). Exposes read tools + draft-only writes.
// There is deliberately no send or delete tool: sending happens only via the signed-in UI.
const PROTOCOL = "2025-06-18";

const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function POST(req: NextRequest) {
  const userId = await userFromBearer(req.headers.get("authorization"));
  if (!userId) {
    // Tells the MCP client where to start the OAuth flow.
    return NextResponse.json({ error: "unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource"` },
    });
  }
  const msg = await req.json().catch(() => null);
  if (!msg || msg.jsonrpc !== "2.0") return NextResponse.json(rpcErr(null, -32600, "Invalid request"), { status: 400 });
  if (msg.id === undefined) return new NextResponse(null, { status: 202 }); // notification

  switch (msg.method) {
    case "initialize":
      return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "unified-box", version: "0.1.0" } } });
    case "ping":
      return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: {} });
    case "tools/list":
      return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) })) } });
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return NextResponse.json(rpcErr(msg.id, -32602, "Unknown tool"));
      const args = tool.schema.safeParse(msg.params?.arguments ?? {});
      if (!args.success) return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: `Invalid arguments: ${args.error.message}` }] } });
      try {
        const out = await tool.run(userId, args.data as never);
        return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out) }] } });
      } catch (e) {
        return NextResponse.json({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: (e as Error).message }] } });
      }
    }
    default:
      return NextResponse.json(rpcErr(msg.id, -32601, "Method not found"));
  }
}

// Stateless server: no SSE stream.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
