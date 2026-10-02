import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("all exposed tables enable RLS and revoke public API roles", () => {
  for (const table of ["submissions", "admins", "submission_deliveries"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /revoke all on table[\s\S]*from anon, authenticated/i);
});

test("schema stores author identity but never post content", () => {
  assert.match(sql, /author_id bigint/i);
  assert.match(sql, /author_username text/i);
  assert.doesNotMatch(sql, /\b(content|message_text|file_data)\b\s+(text|bytea)/i);
});

