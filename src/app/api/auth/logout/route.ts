export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(request: Request) {
  await clearSession();
  const url = new URL(request.url);
  return NextResponse.redirect(`${url.protocol}//${url.host}/login`);
}
