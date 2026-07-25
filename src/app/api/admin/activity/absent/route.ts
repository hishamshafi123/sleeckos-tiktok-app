export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUsersWithoutLogin } from "@/lib/services/activity";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to are required as YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be on or before to" }, { status: 400 });
  }

  const result = await getUsersWithoutLogin({ from, to });
  return NextResponse.json(result);
}
