import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { useFakeSupabase } from "@/lib/testing/fake-supabase";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Upload a profile photo (PNG/JPG/WebP/GIF, up to 2 MB). Stored under the user's own folder; URL saved on the profile. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use a PNG, JPG, WebP or GIF image" }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Image is too large (max 2 MB)" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  let url: string;
  if (useFakeSupabase()) url = `data:${file.type};base64,${bytes.toString("base64")}`; // demo/tests only
  else {
    const path = `${user.id}/${Date.now()}.${ext}`;
    const store = supabaseAdmin().storage.from("avatars");
    const { error } = await store.upload(path, bytes, { contentType: file.type, upsert: true, cacheControl: "31536000" });
    if (error) return NextResponse.json({ error: "Upload failed. Try a smaller image." }, { status: 500 });
    url = store.getPublicUrl(path).data.publicUrl;
  }
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ data: { avatar_url: url } });
  if (error) return NextResponse.json({ error: "Couldn't save your photo" }, { status: 500 });
  await sb.auth.refreshSession().catch(() => null);
  return NextResponse.json({ ok: true, url });
}

/** Remove the profile photo (initials are shown instead). */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = await supabaseServer();
  await sb.auth.updateUser({ data: { avatar_url: null, picture: null } });
  await sb.auth.refreshSession().catch(() => null);
  if (!useFakeSupabase()) {
    const store = supabaseAdmin().storage.from("avatars");
    const { data } = await store.list(user.id);
    if (data?.length) await store.remove(data.map((f) => `${user.id}/${f.name}`));
  }
  return NextResponse.json({ ok: true });
}
