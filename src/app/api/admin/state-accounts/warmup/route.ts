import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { stateAccess } from "@/lib/services/state-accounts/data";
import { stateWarmup } from "@/lib/services/state-accounts/warmup";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Sign in to view warm-up activity." },
      { status: 401 },
    );
  if (!(await stateAccess(session.userId, session.role)))
    return NextResponse.json(
      { error: "State Accounts access is required." },
      { status: 403 },
    );
  try {
    const result = await stateWarmup(new URL(request.url).searchParams);
    return result
      ? NextResponse.json(result)
      : NextResponse.json(
          { error: "Choose an available reporting day." },
          { status: 404 },
        );
  } catch (error) {
    console.error("[State warm-up] History failed", error);
    return NextResponse.json(
      {
        error:
          "Warm-up activity could not load. Retry; existing records are preserved.",
      },
      { status: 500 },
    );
  }
}
