import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyAuthError, validatePassword, validEmail } from "./auth-logic.ts";

test("password rules", () => {
  assert.match(String(validatePassword("short1")), /8 characters/);
  assert.match(String(validatePassword("onlyletters")), /letter and one number/);
  assert.match(String(validatePassword("12345678")), /letter and one number/);
  assert.match(String(validatePassword("a1".repeat(40))), /72/);
  assert.equal(validatePassword("Greenbridge2026"), null);
});

test("email validation", () => {
  assert.equal(validEmail("a@b.co"), true);
  assert.equal(validEmail("a@b"), false);
  assert.equal(validEmail("a b@c.com"), false);
});

test("friendly errors never reveal internals", () => {
  assert.equal(friendlyAuthError("Invalid login credentials"), "Wrong email or password.");
  assert.match(friendlyAuthError("Email not confirmed"), /confirm your email/);
  assert.match(friendlyAuthError("email rate limit exceeded"), /Too many attempts/);
  assert.match(friendlyAuthError("For security purposes, you can only request this after 30 seconds"), /Too many attempts/);
  assert.match(friendlyAuthError("Token has expired or is invalid"), /expired/);
  assert.equal(friendlyAuthError("weird internal SQL error at line 4"), "Something went wrong. Please try again.");
});
