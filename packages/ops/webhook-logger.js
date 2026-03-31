async function sendWebhook(message, extra = {}) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;

  const payload = {
    text: message,
    ...extra,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = {
  sendWebhook,
};
