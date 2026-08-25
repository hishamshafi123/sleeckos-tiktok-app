export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { LabelValidationError, setAccountLabels } from "@/lib/services/account-labels";

// PUT /api/admin/account-labels/assign — replace an account's label set.
// Body: { accountId: string, labelIds: string[] }
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const labels = await setAccountLabels(session.userId, body?.accountId, body?.labelIds);
    if (labels === null) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ labels });
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof LabelValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[AccountLabels assign] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
