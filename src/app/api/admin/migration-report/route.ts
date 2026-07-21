export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

/**
 * GET /api/admin/migration-report
 *
 * Reads the _MigrationBackup_* preservation tables created by the
 * Section→Group flattening migration. These are plain backup tables (no
 * Prisma models), so access is via $queryRaw. Powers the admin worksheet
 * for manually reassigning old Section/Group fixed text to Campaigns.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "users_access"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const sections = await prisma.$queryRaw<any[]>`
      SELECT "sectionId", "name", "slug", "descFixedText", "descFixedTextEnabled", "descTags", "descTagCount"
      FROM "_MigrationBackup_SectionFixedText"
      ORDER BY "name" ASC
    `;

    const groups = await prisma.$queryRaw<any[]>`
      SELECT "id", "sectionId", "name", "slug", "description", "defaultDescription"
      FROM "_MigrationBackup_Group"
      ORDER BY "sortOrder" ASC, "name" ASC
    `;

    const groupsBySection = new Map<string, any[]>();
    for (const g of groups) {
      const list = groupsBySection.get(g.sectionId) || [];
      list.push({
        id: g.id,
        name: g.name,
        slug: g.slug,
        description: g.description,
        defaultDescription: g.defaultDescription,
      });
      groupsBySection.set(g.sectionId, list);
    }

    return NextResponse.json({
      sections: sections.map((s) => ({
        sectionId: s.sectionId,
        name: s.name,
        slug: s.slug,
        descFixedText: s.descFixedText,
        descFixedTextEnabled: s.descFixedTextEnabled === "true",
        descTags: s.descTags,
        descTagCount: s.descTagCount ? parseInt(s.descTagCount, 10) : null,
        groups: groupsBySection.get(s.sectionId) || [],
      })),
    });
  } catch (err: any) {
    // Backup tables missing → migration 1 hasn't run on this database yet.
    console.error("[MigrationReport] Query failed:", err);
    return NextResponse.json(
      { error: `Migration backup tables unavailable: ${err?.message || String(err)}` },
      { status: 500 }
    );
  }
}
