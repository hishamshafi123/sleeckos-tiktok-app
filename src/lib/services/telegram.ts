import prisma from "@/lib/db";

/**
 * Generates an 8-character verification token for the user and returns the Telegram bot deep-link URL.
 */
export async function generateVerificationLink(userId: string): Promise<string> {
  const verifyCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramVerifyCode: verifyCode,
    },
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "SleeckosBot";
  return `https://t.me/${botUsername}?start=${verifyCode}`;
}

/**
 * Links a user's Telegram chat ID using the verification code.
 * Used inside the Telegram webhook.
 */
export async function linkTelegramAccount(chatId: string, verifyCode: string): Promise<{ name: string | null; email: string } | null> {
  if (!verifyCode) return null;

  const user = await prisma.user.findUnique({
    where: { telegramVerifyCode: verifyCode },
  });

  if (!user) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      telegramChatId: chatId,
      telegramVerifyCode: null, // clear the verification code once linked
    },
  });

  return { name: user.name, email: user.email };
}

/**
 * Sends a notification message to the user's linked Telegram chat ID.
 * Returns true if sent, false otherwise (degrades gracefully).
 */
export async function notifyTelegram(userId: string, message: string, link?: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });

    if (!user || !user.telegramChatId) {
      console.log(`[Telegram Notifications] Skipped: User ${userId} has no linked Telegram account.`);
      return false;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("[Telegram Notifications] TELEGRAM_BOT_TOKEN is not configured in .env.");
      return false;
    }

    let fullText = message;
    if (link) {
      // Format markdown link
      fullText += `\n\n🔗 [Open SleeckOS Link](${link})`;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: user.telegramChatId,
        text: fullText,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      console.error(`[Telegram Notifications] API error:`, data);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[Telegram Notifications] Unexpected error:`, err);
    return false;
  }
}
