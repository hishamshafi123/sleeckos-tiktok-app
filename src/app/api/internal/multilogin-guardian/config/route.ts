export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getGuardianConfig } from "@/lib/services/multilogin-guardian";
import { guardianAuthError } from "../auth";

export async function GET(req: NextRequest) {
  const authError = guardianAuthError(req);
  if (authError) return authError;

  try {
    return NextResponse.json(await getGuardianConfig());
  } catch (err) {
    console.error("[PhoneGuardian config] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
