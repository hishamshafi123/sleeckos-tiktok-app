export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { linkTelegramAccount } from "@/lib/services/telegram";

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const message = update?.message;

    if (!message || !message.text || !message.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id.toString();
    const text = message.text.trim();

    if (text.startsWith("/start ")) {
      const code = text.substring(7).trim();
      const token = process.env.TELEGRAM_BOT_TOKEN;

      if (!token) {
        console.error("[Telegram Webhook] TELEGRAM_BOT_TOKEN not configured.");
        return NextResponse.json({ ok: true });
      }

      const linkedUser = await linkTelegramAccount(chatId, code);

      let replyText = "";
      if (linkedUser) {
        replyText = `🎉 Success! Your Telegram account is now linked to SleeckOS for user: ${linkedUser.name || linkedUser.email}. You will now receive @mention notifications here.`;
      } else {
        replyText = `❌ Invalid or expired verification code. Please request a new link from the SleeckOS dashboard and try again.`;
      }

      // Send confirmation message to the user on Telegram
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook POST] Error:", err);
    // Return 200 to prevent Telegram from infinitely retrying bad payloads
    return NextResponse.json({ ok: true });
  }
}
