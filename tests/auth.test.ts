import { db } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as actions from "../src/app/(auth)/actions";
import * as confirm from "../src/app/auth/confirm/route";
import * as callback from "../src/app/auth/callback/route";
import * as signout from "../src/app/auth/signout/route";

beforeEach(() => db.reset());

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
/** Runs a server action; returns { redirect } if it called redirect(), else { state }. */
async function run<T>(fn: (s: undefined, f: FormData) => Promise<T>, o: Record<string, string>) {
  try { return { state: await fn(undefined, form(o)) }; }
  catch (e) {
    const d = String((e as { digest?: string }).digest ?? "");
    if (d.startsWith("NEXT_REDIRECT")) return { redirect: d.split(";")[2] };
    throw e;
  }
}
const loc = (r: Response) => r.headers.get("location") ?? "";
const user = (email: string, password: string, confirmed = true) => db.authUsers.push({ id: crypto.randomUUID(), email, password, confirmed });

test("sign up: validates before calling Supabase", async () => {
  const base = { name: "Rafay", email: "me@x.com", password: "Greenbridge1", confirm: "Greenbridge1", terms: "on", next: "/" };
  assert.match((await run(actions.signUp, { ...base, email: "nope" })).state!.error!, /valid email/);
  assert.match((await run(actions.signUp, { ...base, password: "short", confirm: "short" })).state!.error!, /8 characters/);
  assert.match((await run(actions.signUp, { ...base, confirm: "Different1" })).state!.error!, /don't match/);
  assert.match((await run(actions.signUp, { ...base, terms: "" })).state!.error!, /terms/);
  assert.equal(db.authLog.length, 0);
});

test("sign up: success sends a confirmation and goes to the code screen, keeping next", async () => {
  const r = await run(actions.signUp, { name: "Rafay", email: "Me@X.com", password: "Greenbridge1", confirm: "Greenbridge1", terms: "on", next: "/connect-ai" });
  assert.equal(r.redirect, "/verify?type=signup&email=me%40x.com&next=%2Fconnect-ai");
  const call = db.authLog.find((l) => l.method === "signUp")!.args;
  assert.equal(call.email, "me@x.com");
  assert.equal(call.options.emailRedirectTo, "https://app.test/auth/callback?next=%2Fconnect-ai");
  assert.equal(call.options.data.full_name, "Rafay");
});

test("password sign in: wrong password, unconfirmed account, success, and open-redirect guard", async () => {
  user("ok@x.com", "Correct123");
  user("new@x.com", "Correct123", false);
  assert.equal((await run(actions.signInWithPassword, { email: "ok@x.com", password: "wrong", next: "/" })).state!.error, "Wrong email or password.");
  assert.equal((await run(actions.signInWithPassword, { email: "ghost@x.com", password: "x", next: "/" })).state!.error, "Wrong email or password.", "same message for unknown email");
  assert.match((await run(actions.signInWithPassword, { email: "new@x.com", password: "Correct123", next: "/" })).redirect!, /^\/verify\?type=signup/);
  assert.equal((await run(actions.signInWithPassword, { email: "ok@x.com", password: "Correct123", next: "/settings" })).redirect, "/settings");
  db.user = null;
  assert.equal((await run(actions.signInWithPassword, { email: "ok@x.com", password: "Correct123", next: "//evil.com" })).redirect, "/");
  assert.equal((await run(actions.signInWithPassword, { email: "ok@x.com", password: "Correct123", next: "https://evil.com" })).redirect, "/");
});

test("email code: unknown and known emails look identical (no account enumeration)", async () => {
  user("ok@x.com", "Correct123");
  const known = await run(actions.sendLoginCode, { email: "ok@x.com", next: "/" });
  const unknown = await run(actions.sendLoginCode, { email: "ghost@x.com", next: "/" });
  assert.match(known.redirect!, /^\/verify\?type=email&email=ok%40x.com/);
  assert.match(unknown.redirect!, /^\/verify\?type=email&email=ghost%40x.com/);
  assert.equal(db.authLog.filter((l) => l.method === "signInWithOtp").every((l) => l.args.options.shouldCreateUser === false), true, "code sign-in never creates accounts");
});

test("verify code: format check, bad code, good code, recovery goes to reset", async () => {
  user("ok@x.com", "Correct123", false);
  assert.match((await run(actions.verifyCode, { email: "ok@x.com", code: "12", type: "signup", next: "/" })).state!.error!, /code/);
  assert.match((await run(actions.verifyCode, { email: "ok@x.com", code: "999999", type: "signup", next: "/" })).state!.error!, /expired/);
  assert.equal((await run(actions.verifyCode, { email: "ok@x.com", code: "123 456", type: "signup", next: "/approvals" })).redirect, "/approvals");
  assert.equal(db.authUsers[0].confirmed, true);
  assert.equal((await run(actions.verifyCode, { email: "ok@x.com", code: "123456", type: "recovery", next: "/" })).redirect, "/reset-password");
  assert.equal(db.authLog.filter((l) => l.method === "verifyOtp").at(-1)!.args.type, "recovery");
});

test("forgot + reset password", async () => {
  assert.match((await run(actions.forgotPassword, { email: "ghost@x.com" })).redirect!, /^\/verify\?type=recovery/, "no enumeration");
  assert.equal(db.authLog.find((l) => l.method === "resetPasswordForEmail")!.args.opts.redirectTo, "https://app.test/auth/callback?next=%2Freset-password");

  db.user = null;
  assert.match((await run(actions.updatePassword, { password: "NewPass123", confirm: "NewPass123" })).state!.error!, /expired/);
  user("ok@x.com", "OldPass123");
  db.user = { id: db.authUsers[0].id, email: "ok@x.com" };
  assert.match((await run(actions.updatePassword, { password: "weak", confirm: "weak" })).state!.error!, /8 characters/);
  assert.equal((await run(actions.updatePassword, { password: "NewPass123", confirm: "NewPass123" })).redirect, "/?notice=password-updated");
  assert.equal(db.authUsers[0].password, "NewPass123");
});

test("resend code for each flow", async () => {
  for (const type of ["signup", "email", "recovery"]) {
    const r = await run(actions.resendCode, { email: "ok@x.com", type, next: "/" });
    assert.match(String(r.state?.ok), /new code/);
  }
  assert.deepEqual(db.authLog.map((l) => l.method), ["resend", "signInWithOtp", "resetPasswordForEmail"]);
});

test("Google / Slack sign-in go to the provider with our callback", async () => {
  const f = form({ provider: "google", next: "/connect-ai" });
  let to = "";
  try { await actions.socialSignIn(f); } catch (e) { to = String((e as { digest?: string }).digest).split(";")[2]; }
  assert.match(to, /provider=google/);
  assert.match(decodeURIComponent(to), /redirect_to=https:\/\/app\.test\/auth\/callback\?next=%2Fconnect-ai/);
  try { await actions.socialSignIn(form({ provider: "slack", next: "/" })); } catch { /* redirect */ }
  assert.equal(db.authLog.at(-1)!.args.provider, "slack_oidc");
  try { await actions.socialSignIn(form({ provider: "evil", next: "/" })); } catch { /* redirect */ }
  assert.equal(db.authLog.at(-1)!.args.provider, "google", "unknown providers fall back safely");
});

test("/auth/confirm: email links work cross-device and sanitize next", async () => {
  user("ok@x.com", "x", false);
  const get = (qs: string) => confirm.GET(new NextRequest(`https://app.test/auth/confirm?${qs}`));
  assert.match(decodeURIComponent(loc(await get("token_hash=good-hash&type=bogus"))), /\/login\?error=That link is invalid/);
  assert.match(decodeURIComponent(loc(await get("token_hash=bad&type=signup"))), /expired/);
  assert.equal(loc(await get("token_hash=good-hash&type=signup&next=/settings")), "https://app.test/settings");
  assert.equal(loc(await get("token_hash=good-hash&type=signup&next=//evil.com")), "https://app.test/");
  assert.equal(loc(await get("token_hash=good-hash&type=recovery")), "https://app.test/reset-password");
});

test("/auth/callback: provider errors and failed exchanges explain themselves", async () => {
  const get = (qs: string) => callback.GET(new NextRequest(`https://app.test/auth/callback?${qs}`));
  assert.match(decodeURIComponent(loc(await get("error=access_denied&error_description=User+cancelled"))), /cancelled or failed/);
  assert.match(decodeURIComponent(loc(await get("code=bad"))), /same browser/);
  assert.equal(loc(await get("code=good&next=/approvals")), "https://app.test/approvals");
});

test("sign out clears the session", async () => {
  db.user = { id: "u", email: "a@b.co" };
  const r = await signout.POST();
  assert.equal(r.status, 303);
  assert.equal(db.user, null);
});
