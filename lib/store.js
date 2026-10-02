export class SupabaseStore {
  constructor(url, secretKey, fetchImpl = fetch) {
    this.endpoint = `${url.replace(/\/$/, "")}/rest/v1`;
    this.secretKey = secretKey;
    this.fetch = fetchImpl;
  }

  async request(table, path = "", options = {}) {
    const response = await this.fetch(`${this.endpoint}/${table}${path}`, {
      ...options,
      headers: {
        apikey: this.secretKey,
        "content-type": "application/json",
        accept: "application/json",
        ...options.headers,
      },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`Supabase: ${data?.message || data?.hint || `HTTP ${response.status}`}`);
    }
    return data;
  }

  async createOrGet(updateId, author) {
    const inserted = await this.request("submissions", "?on_conflict=telegram_update_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        telegram_update_id: updateId,
        author_id: author.id,
        author_username: author.username || null,
        author_name: author.name,
      }),
    });
    if (inserted?.[0]) return inserted[0];

    const rows = await this.request("submissions",
      `?telegram_update_id=eq.${encodeURIComponent(updateId)}&select=*`,
    );
    if (!rows?.[0]) throw new Error("Supabase: не удалось получить заявку");
    return rows[0];
  }

  async get(id) {
    const rows = await this.request("submissions", `?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
  }

  async patch(id, values, extraFilter = "") {
    const rows = await this.request("submissions",
      `?id=eq.${encodeURIComponent(id)}${extraFilter}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(values),
      },
    );
    return rows?.[0] || null;
  }

  async listAdminIds() {
    const rows = await this.request("admins", "?select=telegram_id&order=created_at.asc");
    return rows.map((row) => Number(row.telegram_id));
  }

  async isAdmin(telegramId) {
    const rows = await this.request(
      "admins",
      `?telegram_id=eq.${encodeURIComponent(telegramId)}&select=telegram_id&limit=1`,
    );
    return Boolean(rows?.[0]);
  }

  async addAdmin(telegramId, addedBy) {
    const rows = await this.request("admins", "?on_conflict=telegram_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ telegram_id: telegramId, added_by: addedBy }),
    });
    return rows?.[0] || null;
  }

  async removeAdmin(telegramId) {
    const rows = await this.request(
      "admins",
      `?telegram_id=eq.${encodeURIComponent(telegramId)}&select=telegram_id`,
      { method: "DELETE", headers: { Prefer: "return=representation" } },
    );
    return Boolean(rows?.[0]);
  }

  async createOrGetDelivery(submissionId, adminId) {
    const body = { submission_id: submissionId, admin_id: adminId };
    const inserted = await this.request(
      "submission_deliveries",
      "?on_conflict=submission_id,admin_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(body),
      },
    );
    if (inserted?.[0]) return inserted[0];
    return this.getDelivery(submissionId, adminId);
  }

  async getDelivery(submissionId, adminId) {
    const rows = await this.request(
      "submission_deliveries",
      `?submission_id=eq.${encodeURIComponent(submissionId)}&admin_id=eq.${encodeURIComponent(adminId)}&select=*`,
    );
    return rows?.[0] || null;
  }

  async patchDelivery(submissionId, adminId, values, extraFilter = "") {
    const rows = await this.request(
      "submission_deliveries",
      `?submission_id=eq.${encodeURIComponent(submissionId)}&admin_id=eq.${encodeURIComponent(adminId)}${extraFilter}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(values),
      },
    );
    return rows?.[0] || null;
  }

  setDeliveryPreview(submissionId, adminId, messageId) {
    return this.patchDelivery(
      submissionId,
      adminId,
      { preview_message_id: messageId },
      "&preview_message_id=is.null",
    );
  }

  setDeliveryControl(submissionId, adminId, messageId) {
    return this.patchDelivery(
      submissionId,
      adminId,
      { control_message_id: messageId },
      "&control_message_id=is.null",
    );
  }

  listDeliveries(submissionId) {
    return this.request(
      "submission_deliveries",
      `?submission_id=eq.${encodeURIComponent(submissionId)}&select=*`,
    );
  }

  claimForPublishing(id) {
    return this.patch(id, { status: "publishing" }, "&status=eq.pending");
  }

  approve(id, channelMessageId) {
    return this.patch(id, {
      status: "approved",
      channel_message_id: channelMessageId,
      decided_at: new Date().toISOString(),
      author_id: null,
      author_username: null,
      author_name: null,
    }, "&status=eq.publishing");
  }

  release(id) {
    return this.patch(id, { status: "pending" }, "&status=eq.publishing");
  }

  reject(id) {
    return this.patch(id, {
      status: "rejected",
      decided_at: new Date().toISOString(),
      author_id: null,
      author_username: null,
      author_name: null,
    }, "&status=eq.pending");
  }
}

