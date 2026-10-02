import { TelegramApi } from "../lib/telegram.js";
import { SupabaseStore } from "../lib/store.js";
import { ModerationBot } from "../lib/bot.js";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export async function handleRequest(request, env = process.env, fetchImpl = fetch) {
  if (request.method === "GET") {
    return Response.json({ ok: true, service: "anonymous-telegram-bot" });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = required(env, "TELEGRAM_WEBHOOK_SECRET");
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await request.json();
    const telegram = new TelegramApi(required(env, "BOT_TOKEN"), fetchImpl);
    const store = new SupabaseStore(
      required(env, "SUPABASE_URL"),
      required(env, "SUPABASE_SECRET_KEY"),
      fetchImpl,
    );
    const bot = new ModerationBot({
      telegram,
      store,
      adminId: required(env, "ADMIN_ID"),
      channelId: required(env, "CHANNEL_ID"),
    });
    await bot.handle(update);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
    return Response.json({ ok: false }, { status: 500 });
  }
}

export default {
  fetch(request) {
    return handleRequest(request);
  },
};

