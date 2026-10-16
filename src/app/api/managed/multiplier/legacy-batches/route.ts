export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/managed/multiplier/legacy-batches — Legacy MultiplierBatch records
// transformed into the MultiplierGroup shape. Split out of the main list
// endpoint so the primary payload stays small; the admin page merges these
// into its groups state client-side.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const legacyBatches = await prisma.multiplierBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const transformedLegacy = legacyBatches.map((b) => {
      try {
        return {
          id: b.id,
          name: b.name || "Legacy Batch",
          campaignId: "",
          campaign: { id: "", title: "Legacy Batch" },
          transcript: null,
          transcriptStatus: "PENDING",
          styleId: "news-lower-third",
          mappingMode: "each",
          settings: {
            fontSize: b.fontSize,
            fontColor: b.fontColor,
            bgStripColor: b.bgStripColor,
            bgStripOpacity: b.bgStripOpacity,
            positionYPercent: b.positionYPercent,
            hookDuration: b.hookDuration,
            accentColor: "#E11D48",
            driveFolderId: b.driveFolderId || null,
            driveFolderName: b.driveFolderName || null,
          },
          status: b.status === "COMPLETED" ? "COMPLETED" : b.status === "FAILED" ? "FAILED" : b.status === "RENDERING" ? "RENDERING" : "DRAFT",
          errorMessage: b.errorMessage,
          createdAt: b.createdAt.toISOString(),
          variations: [
            {
              id: b.id + "-var",
              groupId: b.id,
              videoRef: b.sourceVideoUrl,
              order: 0,
            }
          ],
          hooks: b.items.map((item, idx) => ({
            id: item.id,
            groupId: b.id,
            text: item.hookText,
            source: "manual",
            order: idx,
          })),
          outputs: b.items.map((item) => ({
            id: item.id,
            variationId: b.id + "-var",
            hookId: item.id,
            status: item.status === "RENDERED" ? "COMPLETED" : item.status === "FAILED" ? "FAILED" : item.status === "RENDERING" ? "RENDERING" : "PENDING",
            outputRef: item.renderedVideoUrl,
            driveFolderId: item.driveFolderId || b.driveFolderId,
            driveFolderName: item.driveFolderName || b.driveFolderName,
            googleEmail: item.googleEmail || b.googleEmail,
            errorMessage: item.errorMessage,
            variation: { videoRef: b.sourceVideoUrl },
            hook: { text: item.hookText },
          })),
        };
      } catch (mapErr: any) {
        console.error(`[Multiplier Legacy Batches GET] Error mapping legacy batch ${b.id}:`, mapErr);
        throw mapErr;
      }
    });

    return NextResponse.json(transformedLegacy);
  } catch (err: any) {
    console.error("[Multiplier Legacy Batches GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch legacy batches" }, { status: 500 });
  }
}
