export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  GuardianValidationError,
  getGuardianPhones,
} from "@/lib/services/multilogin-guardian";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (!(await can(session.userId, "multilogin_guardian"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const params = req.nextUrl.searchParams;
    const result = await getGuardianPhones({
      status: params.get("status"),
      q: params.get("q"),
      cursor: params.get("cursor"),
      limit: params.get("limit"),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GuardianValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[PhoneGuardian phones] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
