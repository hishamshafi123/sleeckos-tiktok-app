export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  GuardianValidationError,
  ingestGuardianCycle,
} from "@/lib/services/multilogin-guardian";
import { guardianAuthError } from "../auth";

export async function POST(req: NextRequest) {
  const authError = guardianAuthError(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return NextResponse.json(await ingestGuardianCycle(body));
  } catch (err) {
    if (err instanceof GuardianValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[PhoneGuardian events] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
