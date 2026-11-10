import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { stateAccess } from "@/lib/services/state-accounts/data";
import { statePosts } from "@/lib/services/state-accounts/posts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Sign in to view posting history." },
      { status: 401 },
    );
  if (!(await stateAccess(session.userId, session.role)))
    return NextResponse.json(
      { error: "State Accounts access is required." },
      { status: 403 },
    );
  try {
    const result = await statePosts(new URL(request.url).searchParams);
    return result
      ? NextResponse.json(result)
      : NextResponse.json(
          { error: "Choose an available reporting day." },
          { status: 404 },
        );
  } catch (error) {
    console.error("[State posts] History failed", error);
    return NextResponse.json(
      {
        error:
          "Posting history could not load. Retry; existing records are preserved.",
      },
      { status: 500 },
    );
  }
}
