import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { unipileAttachment } from "@/lib/unipile";

/**
 * A photo/video/voice note/file from one of your chats. Only the signed-in owner of the message can load it, and only
 * attachments recorded on that message: the browser never sees the provider key or ids it doesn't own.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });
  const m = req.nextUrl.searchParams.get("m") ?? "", a = req.nextUrl.searchParams.get("a") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(m) || !a) return new NextResponse("bad request", { status: 400 });
  const db = supabaseAdmin();
  const { data: msg } = await db.from("messages").select("external_id, attachments, account_id, user_id").eq("id", m).eq("user_id", user.id).maybeSingle();
  const att = ((msg?.attachments ?? []) as { id: string; mime?: string; name?: string }[]).find((x) => x.id === a);
  if (!msg || !att) return new NextResponse("not found", { status: 404 });
  const { data: acct } = await db.from("accounts").select("remote_id").eq("id", msg.account_id).maybeSingle();
  if (!acct?.remote_id) return new NextResponse("not found", { status: 404 });
  const ext = String(msg.external_id);
  const cut = ext.lastIndexOf(":");
  const r = await unipileAttachment(acct.remote_id as string, ext.slice(0, cut), ext.slice(cut + 1), a);
  if (!r.ok || !r.body) return new NextResponse("This file is no longer available.", { status: 404 });
  const type = r.headers.get("content-type") || att.mime || "application/octet-stream";
  // Only media types render inline; anything else downloads (so a file can't run as a web page here).
  const inline = /^(image|video|audio)\//.test(type) && !/svg/.test(type);
  return new NextResponse(r.body, {
    headers: {
      "content-type": inline ? type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${(att.name ?? "file").replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
