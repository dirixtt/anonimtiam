import fs from "node:fs";

function loadEnv(file = ".env.local") {
  if (!fs.existsSync(file)) throw new Error(`Создайте ${file} из .env.example`);
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] ??= value;
  }
}

loadEnv();
for (const key of ["BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "WEBHOOK_URL"]) {
  if (!process.env[key]) throw new Error(`Не задано ${key}`);
}

const response = await fetch(
  `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: process.env.WEBHOOK_URL,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }),
  },
);
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.description || "setWebhook failed");
console.log("Webhook установлен:", process.env.WEBHOOK_URL);

