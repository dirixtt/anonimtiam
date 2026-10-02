const DISCLOSURE = "Отправьте сюда текст, фото, видео, голосовое сообщение или файл все будет анонимно";

function keyboard(id) {
  return {
    inline_keyboard: [[
      { text: "✅ Опубликовать", callback_data: `approve:${id}` },
      { text: "❌ Отклонить", callback_data: `reject:${id}` },
    ]],
  };
}

function decisionFrom(data) {
  const match = /^(approve|reject):(\d+)$/.exec(data || "");
  return match ? { action: match[1], id: Number(match[2]) } : null;
}

function authorFrom(message) {
  const from = message.from || {};
  return {
    id: Number(from.id),
    username: from.username || null,
    name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Без имени",
  };
}

function moderationText(submission, status = null) {
  const username = submission.author_username ? `@${submission.author_username}` : "нет";
  const lines = [
    `Заявка #${submission.id}`,
    `Автор: ${submission.author_name || "Без имени"}`,
    `Username: ${username}`,
    `Telegram ID: ${submission.author_id ?? "удалён после модерации"}`,
  ];
  if (status) lines.push("", status);
  return lines.join("\n");
}

export class ModerationBot {
  constructor({ telegram, store, adminId, channelId }) {
    this.telegram = telegram;
    this.store = store;
    this.adminId = Number(adminId);
    this.channelId = /^-?\d+$/.test(String(channelId)) ? Number(channelId) : channelId;
  }

  async handle(update) {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    if (update.message) return this.handleMessage(update.update_id, update.message);
  }

  async handleMessage(updateId, message) {
    if (message.chat?.type !== "private") return;

    if (message.text === "/start" || message.text === "/help") {
      await this.telegram.sendMessage(message.chat.id, DISCLOSURE);
      return;
    }

    if (message.text?.startsWith("/admin_" ) || message.text === "/admins") {
      await this.handleAdminCommand(message);
      return;
    }
    if (message.text?.startsWith("/")) {
      await this.telegram.sendMessage(
        message.chat.id,
        "Неизвестная команда. Просто отправьте материал одним сообщением.",
      );
      return;
    }

    const author = authorFrom(message);
    let submission = await this.store.createOrGet(updateId, author);
    if (submission.status !== "pending") return;

    const subAdmins = await this.store.listAdminIds();
    const adminIds = [...new Set([this.adminId, ...subAdmins])];
    for (const adminId of adminIds) {
      try {
        await this.deliverSubmission(submission, adminId, message);
      } catch (error) {
        if (adminId === this.adminId) throw error;
        console.error("Could not deliver submission to a sub-admin:", error.message);
      }
    }

    await this.telegram.sendMessage(
      message.chat.id,
      "✅ Заявка отправлена владельцу канала на модерацию.",
    );
  }

  async deliverSubmission(submission, adminId, sourceMessage) {
    let delivery = await this.store.createOrGetDelivery(submission.id, adminId);
    if (!delivery.preview_message_id) {
      const preview = await this.telegram.copyMessage(
        adminId,
        sourceMessage.chat.id,
        sourceMessage.message_id,
      );
      await this.store.setDeliveryPreview(submission.id, adminId, preview.message_id);
      delivery = await this.store.getDelivery(submission.id, adminId);
    }
    if (!delivery.control_message_id) {
      const control = await this.telegram.sendMessage(
        adminId,
        moderationText(submission),
        {
          reply_to_message_id: delivery.preview_message_id,
          reply_markup: keyboard(submission.id),
        },
      );
      await this.store.setDeliveryControl(submission.id, adminId, control.message_id);
    }
  }

  async handleAdminCommand(message) {
    if (message.from?.id !== this.adminId) {
      await this.telegram.sendMessage(message.chat.id, "Управлять администраторами может только владелец бота.");
      return;
    }

    if (message.text === "/admins") {
      const ids = await this.store.listAdminIds();
      const lines = [`Владелец: ${this.adminId}`, "", "Субадмины:"];
      lines.push(...(ids.length ? ids.map((id) => `• ${id}`) : ["нет"]));
      await this.telegram.sendMessage(message.chat.id, lines.join("\n"));
      return;
    }

    const match = /^\/(admin_add|admin_remove)\s+(\d+)$/.exec(message.text || "");
    if (!match) {
      await this.telegram.sendMessage(
        message.chat.id,
        "Использование:\n/admin_add 123456789\n/admin_remove 123456789\n/admins",
      );
      return;
    }

    const targetId = Number(match[2]);
    if (!Number.isSafeInteger(targetId)) {
      await this.telegram.sendMessage(message.chat.id, "Некорректный Telegram ID.");
      return;
    }
    if (targetId === this.adminId) {
      await this.telegram.sendMessage(message.chat.id, "Этот ID принадлежит владельцу и не изменяется.");
      return;
    }

    if (match[1] === "admin_add") {
      await this.store.addAdmin(targetId, this.adminId);
      await this.telegram.sendMessage(message.chat.id, `✅ Субадмин ${targetId} добавлен.`);
      try {
        await this.telegram.sendMessage(
          targetId,
          "Вас добавили модератором. Теперь вы будете получать заявки и сможете одобрять или отклонять их.",
        );
      } catch {
        await this.telegram.sendMessage(
          message.chat.id,
          "⚠️ Бот пока не может написать этому пользователю. Попросите его открыть бота и нажать /start.",
        );
      }
      return;
    }

    const removed = await this.store.removeAdmin(targetId);
    await this.telegram.sendMessage(
      message.chat.id,
      removed ? `✅ Субадмин ${targetId} удалён.` : "Такого субадмина нет.",
    );
  }

  async handleCallback(query) {
    const moderatorId = Number(query.from?.id);
    const isModerator = moderatorId === this.adminId || await this.store.isAdmin(moderatorId);
    if (!isModerator) {
      await this.telegram.answerCallbackQuery(
        query.id,
        "У вас нет прав модератора.",
        true,
      );
      return;
    }

    const decision = decisionFrom(query.data);
    if (!decision) {
      await this.telegram.answerCallbackQuery(query.id, "Неизвестное действие.", true);
      return;
    }

    const submission = await this.store.get(decision.id);
    if (!submission) {
      await this.telegram.answerCallbackQuery(query.id, "Заявка не найдена.", true);
      return;
    }
    if (submission.status !== "pending") {
      const message = submission.status === "publishing"
        ? "Заявка уже публикуется."
        : "Заявка уже обработана.";
      await this.telegram.answerCallbackQuery(query.id, message);
      return;
    }

    if (decision.action === "reject") {
      const rejected = await this.store.reject(submission.id);
      if (!rejected) {
        await this.telegram.answerCallbackQuery(query.id, "Заявка уже обрабатывается.");
        return;
      }
      await this.updateAllControls(submission, "❌ Отклонена");
      await this.telegram.answerCallbackQuery(query.id, "Отклонено.");
      return;
    }

    const claimed = await this.store.claimForPublishing(submission.id);
    if (!claimed) {
      await this.telegram.answerCallbackQuery(query.id, "Заявка уже обрабатывается.");
      return;
    }

    try {
      const delivery = await this.store.getDelivery(submission.id, moderatorId);
      if (!delivery?.preview_message_id) throw new Error("Копия заявки для модератора не найдена");
      const published = await this.telegram.copyMessage(
        this.channelId,
        moderatorId,
        delivery.preview_message_id,
      );
      await this.store.approve(submission.id, published.message_id);
      await this.updateAllControls(submission, "✅ Опубликована");
      await this.telegram.answerCallbackQuery(query.id, "Опубликовано.");
    } catch (error) {
      await this.store.release(submission.id).catch(() => {});
      await this.telegram.answerCallbackQuery(
        query.id,
        "Не удалось опубликовать. Проверьте права бота и попробуйте ещё раз.",
        true,
      ).catch(() => {});
      throw error;
    }
  }

  async updateAllControls(submission, status) {
    const deliveries = await this.store.listDeliveries(submission.id);
    await Promise.allSettled(deliveries
      .filter((delivery) => delivery.control_message_id)
      .map((delivery) => this.telegram.editMessageText(
        Number(delivery.admin_id),
        delivery.control_message_id,
        moderationText(submission, status),
      )));
  }
}

export { DISCLOSURE, authorFrom, decisionFrom, moderationText };

