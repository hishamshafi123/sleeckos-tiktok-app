export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

// Groups were removed — accounts now belong directly to Sections.
const GONE = { error: "Groups were removed; accounts now belong directly to Sections" };

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function PATCH() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 });
}
