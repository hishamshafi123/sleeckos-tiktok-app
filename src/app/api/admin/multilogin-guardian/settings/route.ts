export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  GuardianValidationError,
  saveGuardianSettings,
} from "@/lib/services/multilogin-guardian";

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (!(await can(session.userId, "multilogin_guardian"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json(await saveGuardianSettings(body));
  } catch (err) {
    if (err instanceof GuardianValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[PhoneGuardian settings] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
