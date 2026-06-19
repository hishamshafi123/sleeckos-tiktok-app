export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    message: "Token refreshing managed by external post provider.",
  });
}
