import test from "node:test";
import assert from "node:assert/strict";
import { DISCLOSURE, ModerationBot } from "../lib/bot.js";

class Store {
  constructor() {
    this.row = null;
    this.admins = new Set();
    this.deliveries = new Map();
  }
  key(submissionId, adminId) { return `${submissionId}:${adminId}`; }
  async createOrGet(updateId, author) {
    this.row ??= { id: 1, telegram_update_id: updateId, author_id: author.id,
      author_username: author.username, author_name: author.name, status: "pending" };
    return { ...this.row };
  }
  async get() { return this.row ? { ...this.row } : null; }
  async listAdminIds() { return [...this.admins]; }
  async isAdmin(id) { return this.admins.has(id); }
  async addAdmin(id) { this.admins.add(id); return { telegram_id: id }; }
  async removeAdmin(id) { return this.admins.delete(id); }
  async createOrGetDelivery(submissionId, adminId) {
    const key = this.key(submissionId, adminId);
    if (!this.deliveries.has(key)) {
      this.deliveries.set(key, { submission_id: submissionId, admin_id: adminId,
        preview_message_id: null, control_message_id: null });
    }
    return { ...this.deliveries.get(key) };
  }
  async getDelivery(submissionId, adminId) {
    const value = this.deliveries.get(this.key(submissionId, adminId));
    return value ? { ...value } : null;
  }
  async setDeliveryPreview(submissionId, adminId, value) {
    this.deliveries.get(this.key(submissionId, adminId)).preview_message_id ??= value;
  }
  async setDeliveryControl(submissionId, adminId, value) {
    this.deliveries.get(this.key(submissionId, adminId)).control_message_id ??= value;
  }
  async listDeliveries(submissionId) {
    return [...this.deliveries.values()].filter((item) => item.submission_id === submissionId);
  }
  async claimForPublishing() {
    if (this.row.status !== "pending") return null;
    this.row.status = "publishing";
    return { ...this.row };
  }
  async approve(id, value) {
    Object.assign(this.row, { status: "approved", channel_message_id: value,
      author_id: null, author_username: null, author_name: null });
    return { ...this.row };
  }
  async release() { this.row.status = "pending"; return { ...this.row }; }
  async reject() {
    if (this.row.status !== "pending") return null;
    Object.assign(this.row, { status: "rejected", author_id: null,
      author_username: null, author_name: null });
    return { ...this.row };
  }
}

function telegram() {
  const calls = [];
  let id = 100;
  return {
    calls,
    async copyMessage(...args) { calls.push(["copy", ...args]); return { message_id: id++ }; },
    async sendMessage(...args) { calls.push(["send", ...args]); return { message_id: id++ }; },
    async editMessageText(...args) { calls.push(["edit", ...args]); },
    async answerCallbackQuery(...args) { calls.push(["answer", ...args]); },
  };
}

const userMessage = {
  message_id: 3,
  chat: { id: 77, type: "private" },
  from: { id: 77, first_name: "Ali", last_name: "Valiyev", username: "ali_user" },
  text: "hello",
};

test("disclosure clearly states that moderators see identity", () => {
  assert.match(DISCLOSURE, /модераторы увидят.*имя.*username.*Telegram ID/i);
  assert.match(DISCLOSURE, /данные автора удаляются из базы/i);
});

test("submission shows author identity to owner but does not store content", async () => {
  const tg = telegram();
  const store = new Store();
  const bot = new ModerationBot({ telegram: tg, store, adminId: 9, channelId: "@channel" });
  await bot.handle({ update_id: 55, message: userMessage });
  assert.deepEqual(tg.calls[0], ["copy", 9, 77, 3]);
  const control = tg.calls.find((call) => call[0] === "send" && call[1] === 9);
  assert.match(control[2], /Ali Valiyev/);
  assert.match(control[2], /@ali_user/);
  assert.match(control[2], /Telegram ID: 77/);
  assert.equal(store.row.author_id, 77);
  assert.equal("content" in store.row, false);
});

test("sub-admin receives a submission and can approve it once", async () => {
  const tg = telegram();
  const store = new Store();
  store.admins.add(10);
  const bot = new ModerationBot({ telegram: tg, store, adminId: 9, channelId: "@channel" });
  await bot.handle({ update_id: 55, message: userMessage });
  assert.ok(tg.calls.some((call) => call[0] === "copy" && call[1] === 10));
  await bot.handle({ callback_query: { id: "a", from: { id: 10 }, data: "approve:1" } });
  await bot.handle({ callback_query: { id: "b", from: { id: 10 }, data: "approve:1" } });
  const channelCopies = tg.calls.filter((call) => call[0] === "copy" && call[1] === "@channel");
  assert.equal(channelCopies.length, 1);
  assert.equal(channelCopies[0][2], 10);
  assert.equal(store.row.status, "approved");
  assert.equal(store.row.author_id, null);
});

test("only owner can add and remove sub-admins", async () => {
  const tg = telegram();
  const store = new Store();
  const bot = new ModerationBot({ telegram: tg, store, adminId: 9, channelId: "@channel" });
  await bot.handle({ update_id: 1, message: { chat: { id: 9, type: "private" }, from: { id: 9 }, text: "/admin_add 10" } });
  assert.equal(store.admins.has(10), true);
  await bot.handle({ update_id: 2, message: { chat: { id: 10, type: "private" }, from: { id: 10 }, text: "/admin_add 11" } });
  assert.equal(store.admins.has(11), false);
  await bot.handle({ update_id: 3, message: { chat: { id: 9, type: "private" }, from: { id: 9 }, text: "/admin_remove 10" } });
  assert.equal(store.admins.has(10), false);
});

test("non-admin moderation is refused", async () => {
  const tg = telegram();
  const bot = new ModerationBot({ telegram: tg, store: new Store(), adminId: 9, channelId: "@channel" });
  await bot.handle({ callback_query: { id: "x", from: { id: 8 }, data: "reject:1" } });
  assert.deepEqual(tg.calls[0], ["answer", "x", "У вас нет прав модератора.", true]);
});

