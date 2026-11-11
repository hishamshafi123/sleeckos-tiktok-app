import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { stateAccess } from "../state-accounts/data";
import { DeskError } from "../content-desk/rules";
export async function clipSession(request: Request, write = false) {
  const session = await getSession();
  if (!session) throw new DeskError("AUTH", "Sign in to use Clip Studio.", 401);
  if (!(await stateAccess(session.userId, session.role)))
    throw new DeskError("FORBIDDEN", "Content Desk access is required.", 403);
  const origin = request.headers.get("origin");
  if (
    write &&
    origin &&
    new URL(origin).host !== request.headers.get("host") &&
    origin !== new URL(request.url).origin
  )
    throw new DeskError(
      "FORBIDDEN",
      "Cross-site changes are not allowed.",
      403,
    );
  return session;
}
export function clipError(error: unknown) {
  if (error instanceof DeskError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  // Validation and media errors contain actionable messages; do not expose ORM internals.
  const message =
    error instanceof Error && !("code" in error)
      ? error.message.slice(0, 500)
      : "Clip Studio could not complete this action. Retry; your saved work is preserved.";
  return NextResponse.json({ error: message }, { status: 400 });
}
