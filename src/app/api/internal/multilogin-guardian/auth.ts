import { NextRequest, NextResponse } from "next/server";
import { getGuardianAuthStatus } from "@/lib/services/multilogin-guardian-auth";

export function guardianAuthError(req: NextRequest): NextResponse | null {
  const status = getGuardianAuthStatus(req.headers.get("x-guardian-secret"));
  if (status === "missing") {
    return NextResponse.json({ error: "Guardian integration is not configured" }, { status: 503 });
  }
  if (status === "invalid") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
