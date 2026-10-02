import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../api/webhook.js";

const env = { TELEGRAM_WEBHOOK_SECRET: "correct-secret" };

test("health endpoint works without exposing configuration", async () => {
  const response = await handleRequest(new Request("https://example.test/api/webhook"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "anonymous-telegram-bot" });
});

test("webhook rejects requests without Telegram secret", async () => {
  const request = new Request("https://example.test/api/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const response = await handleRequest(request, env);
  assert.equal(response.status, 401);
});

