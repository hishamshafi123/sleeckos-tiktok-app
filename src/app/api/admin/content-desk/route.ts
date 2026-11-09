import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { stateAccess } from "@/lib/services/state-accounts/data";
import { deskData, mutateDesk } from "@/lib/services/content-desk/data";
import { DeskError } from "@/lib/services/content-desk/rules";
export const dynamic = "force-dynamic";
function json(value: unknown, status = 200) {
  return NextResponse.json(
    JSON.parse(
      JSON.stringify(value, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ),
    { status },
  );
}
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Sign in to use the Content Desk." }, 401);
  if (!(await stateAccess(session.userId, session.role)))
    return json(
      {
        error: "You need membership in a state team or State Accounts access.",
      },
      403,
    );
  try {
    return json(await deskData(new URL(request.url).searchParams, session));
  } catch (error) {
    console.error("[Content Desk] Read failed", error);
    return json(
      {
        error:
          "The Content Desk could not load. Retry; if this continues, ask an admin to check the database and deployment.",
      },
      500,
    );
  }
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Sign in to use the Content Desk." }, 401);
  if (!(await stateAccess(session.userId, session.role)))
    return json({ error: "You do not have access to the Content Desk." }, 403);
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    new URL(origin).host !== request.headers.get("host")
  )
    return json({ error: "Cross-site changes are not allowed." }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 30000)
      return json({ error: "This request is too large." }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new DeskError("INVALID", "Send a valid JSON request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new DeskError("INVALID", "Invalid request.");
    return json(await mutateDesk(body, session));
  } catch (error) {
    if (error instanceof DeskError)
      return json({ error: error.message, code: error.code }, error.status);
    const code = (error as { code?: string }).code;
    if (code === "P2002")
      return json(
        {
          error:
            "This source is already tracked for this state. Open Sources to find it.",
        },
        409,
      );
    if (code === "P2025")
      return json(
        { error: "This item no longer exists. Refresh the page." },
        404,
      );
    console.error("[Content Desk] Save failed", error);
    return json(
      {
        error:
          "Changes could not be saved. Refresh and retry; your previous data is preserved.",
      },
      500,
    );
  }
}
