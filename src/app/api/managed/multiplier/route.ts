export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createGroup } from "@/lib/services/multiplier";
import fs from "fs";
import path from "path";
import { deleteFromR2 } from "@/lib/services/storage";

// GET /api/managed/multiplier — List all multiplier groups (and transform/merge legacy batches)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    console.log("[Multiplier GET] Querying groups...");
    const groups = await prisma.multiplierGroup.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        campaign: {
          select: { id: true, title: true },
        },
        variations: {
          orderBy: { order: "asc" },
        },
        hooks: {
          orderBy: { order: "asc" },
        },
        outputs: {
          orderBy: { createdAt: "asc" },
          include: {
            variation: { select: { videoRef: true } },
            hook: { select: { text: true } },
          },
        },
      },
    });
    console.log(`[Multiplier GET] Found ${groups.length} groups.`);

    console.log("[Multiplier GET] Querying legacy batches...");
    const legacyBatches = await prisma.multiplierBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    console.log(`[Multiplier GET] Found ${legacyBatches.length} legacy batches.`);

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
        console.error(`[Multiplier GET] Error mapping legacy batch ${b.id}:`, mapErr);
        throw mapErr;
      }
    });

    const combined = [...groups, ...transformedLegacy].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    console.log(`[Multiplier GET] Successfully returning ${combined.length} total items.`);
    return NextResponse.json(combined);
  } catch (err: any) {
    console.error("[Multiplier Group GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch groups" }, { status: 500 });
  }
}

// POST /api/managed/multiplier — Create a new group
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, campaignId, styleId, mappingMode, settings } = body;

    if (!name || !campaignId || !styleId) {
      return NextResponse.json({ error: "Missing required parameters: name, campaignId, styleId" }, { status: 400 });
    }

    const group = await createGroup({
      name,
      campaignId,
      styleId,
      mappingMode,
      settings,
      createdBy: session.userId,
    });

    return NextResponse.json(group);
  } catch (err: any) {
    console.error("[Multiplier Group POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create group" }, { status: 500 });
  }
}

// DELETE /api/managed/multiplier?groupId=...&outputId=...&outputIds=... — Delete group/batch/output(s)
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  const outputId = searchParams.get("outputId");
  const outputIds = searchParams.get("outputIds");

  // ── Individual output(s) deletion ──────────────────────────────────────
  if (outputId || outputIds) {
    try {
      const ids = outputId ? [outputId] : (outputIds || "").split(",").filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ error: "No output IDs provided" }, { status: 400 });
      }

      const publicDir = path.join(process.cwd(), "public");
      const outputs = await prisma.multiplierOutput.findMany({
        where: { id: { in: ids } },
      });

      for (const out of outputs) {
        // Delete local file
        if (out.outputRef) {
          const localPath = path.join(publicDir, out.outputRef);
          if (fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch {}
          }
          // Delete from R2
          const r2Key = `uploads/multiplier/renders/multi_${out.id}.mp4`;
          await deleteFromR2(r2Key).catch(() => {});
        }
      }

      // Delete DB records
      await prisma.multiplierOutput.deleteMany({
        where: { id: { in: ids } },
      });

      return NextResponse.json({ success: true, deleted: ids.length });
    } catch (err: any) {
      console.error("[Multiplier Output DELETE] Error:", err);
      return NextResponse.json({ error: err.message || "Failed to delete output(s)" }, { status: 500 });
    }
  }

  // ── Group/batch deletion ───────────────────────────────────────────────
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId or outputId" }, { status: 400 });
  }

  try {
    const publicDir = path.join(process.cwd(), "public");

    if (groupId === "all") {
      // 1. Clean up new group files
      const groups = await prisma.multiplierGroup.findMany({
        include: { variations: true, outputs: true },
      });
      for (const g of groups) {
        for (const v of g.variations) {
          const vPath = path.join(publicDir, v.videoRef);
          try { fs.unlinkSync(vPath); } catch {}
        }
        for (const o of g.outputs) {
          if (o.outputRef) {
            const oPath = path.join(publicDir, o.outputRef);
            try { fs.unlinkSync(oPath); } catch {}
          }
        }
      }
      await prisma.multiplierGroup.deleteMany();

      // 2. Clean up legacy batch files
      const batches = await prisma.multiplierBatch.findMany({
        include: { items: true },
      });
      for (const b of batches) {
        const sourcePath = path.join(publicDir, b.sourceVideoUrl);
        try { fs.unlinkSync(sourcePath); } catch {}
        for (const item of b.items) {
          if (item.renderedVideoUrl) {
            const renderPath = path.join(publicDir, item.renderedVideoUrl);
            try { fs.unlinkSync(renderPath); } catch {}
          }
        }
      }
      await prisma.multiplierBatch.deleteMany();

      return NextResponse.json({ success: true, message: "All groups and batches deleted" });
    }

    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
      include: {
        variations: true,
        outputs: true,
      },
    });

    if (group) {
      // Clean up variations files
      for (const v of group.variations) {
        const vPath = path.join(publicDir, v.videoRef);
        if (fs.existsSync(vPath)) {
          try { fs.unlinkSync(vPath); } catch {}
        }
      }

      // Clean up output files
      for (const o of group.outputs) {
        if (o.outputRef) {
          const oPath = path.join(publicDir, o.outputRef);
          if (fs.existsSync(oPath)) {
            try { fs.unlinkSync(oPath); } catch {}
          }
        }
      }

      // Delete group (cascade deletes variations, hooks, outputs in DB)
      await prisma.multiplierGroup.delete({
        where: { id: groupId },
      });
    } else {
      // Try deleting legacy batch
      const batch = await prisma.multiplierBatch.findUnique({
        where: { id: groupId },
        include: { items: true },
      });

      if (!batch) {
        return NextResponse.json({ error: "Group or legacy Batch not found" }, { status: 404 });
      }

      // Delete legacy source video
      const sourcePath = path.join(publicDir, batch.sourceVideoUrl);
      if (fs.existsSync(sourcePath)) {
        try { fs.unlinkSync(sourcePath); } catch {}
      }

      // Delete legacy rendered videos
      for (const item of batch.items) {
        if (item.renderedVideoUrl) {
          const renderPath = path.join(publicDir, item.renderedVideoUrl);
          if (fs.existsSync(renderPath)) {
            try { fs.unlinkSync(renderPath); } catch {}
          }
        }
      }

      // Delete from DB (cascade deletes items)
      await prisma.multiplierBatch.delete({ where: { id: groupId } });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Multiplier Group DELETE API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete group" }, { status: 500 });
  }
}

// PATCH /api/managed/multiplier — Assign Drive folders to Groups, Outputs, Legacy Batches/Items
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { groupId, outputId, batchId, itemId, driveFolderId, driveFolderName, googleEmail, assignments } = body;

    // 0. Bulk assignments (Multi-folder round-robin distribution)
    if (assignments && Array.isArray(assignments)) {
      console.log(`[Multiplier PATCH] Performing bulk update for ${assignments.length} items...`);
      
      const txs: any[] = [];

      // Update parent group/batch default folder if provided
      if (groupId) {
        const group = await prisma.multiplierGroup.findUnique({ where: { id: groupId } });
        if (group) {
          const currentSettings = typeof group.settings === "string" 
            ? JSON.parse(group.settings) 
            : (group.settings || {});
          
          const newSettings = { 
            ...currentSettings, 
            driveFolderId: driveFolderId || null,
            driveFolderName: driveFolderName || null,
            googleEmail: googleEmail || null
          };

          txs.push(
            prisma.multiplierGroup.update({
              where: { id: groupId },
              data: { settings: newSettings },
            })
          );
        }
      } else if (batchId) {
        txs.push(
          prisma.multiplierBatch.update({
            where: { id: batchId },
            data: { 
              driveFolderId: driveFolderId || null,
              driveFolderName: driveFolderName || null,
              googleEmail: googleEmail || null
            },
          })
        );
      }

      for (const a of assignments) {
        if (a.outputId) {
          txs.push(
            prisma.multiplierOutput.update({
              where: { id: a.outputId },
              data: { 
                driveFolderId: a.driveFolderId || null,
                driveFolderName: a.driveFolderName || null,
                googleEmail: a.googleEmail || null
              },
            })
          );
        } else if (a.itemId) {
          txs.push(
            prisma.multiplierItem.update({
              where: { id: a.itemId },
              data: { 
                driveFolderId: a.driveFolderId || null,
                driveFolderName: a.driveFolderName || null,
                googleEmail: a.googleEmail || null
              },
            })
          );
        }
      }

      if (txs.length > 0) {
        await prisma.$transaction(txs);
      }
      return NextResponse.json({ success: true, message: "Distributed folders successfully" });
    }

    // 1. Group settings driveFolderId assignment
    if (groupId) {
      const group = await prisma.multiplierGroup.findUnique({ where: { id: groupId } });
      if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
      
      const currentSettings = typeof group.settings === "string" 
        ? JSON.parse(group.settings) 
        : (group.settings || {});
      
      const newSettings = { 
        ...currentSettings, 
        driveFolderId: driveFolderId || null,
        driveFolderName: driveFolderName || null,
        googleEmail: googleEmail || null
      };

      await prisma.multiplierGroup.update({
        where: { id: groupId },
        data: { settings: newSettings },
      });
      return NextResponse.json({ success: true, message: "Group default folder updated" });
    }

    // 2. Output driveFolderId assignment
    if (outputId) {
      const output = await prisma.multiplierOutput.update({
        where: { id: outputId },
        data: { 
          driveFolderId: driveFolderId || null,
          driveFolderName: driveFolderName || null,
          googleEmail: googleEmail || null
        },
      });
      return NextResponse.json({ success: true, output });
    }

    // 3. Legacy Item folder assignment
    if (itemId) {
      const item = await prisma.multiplierItem.update({
        where: { id: itemId },
        data: { 
          driveFolderId: driveFolderId || null,
          driveFolderName: driveFolderName || null,
          googleEmail: googleEmail || null
        },
      });
      return NextResponse.json({ success: true, item });
    }

    // 4. Legacy Batch folder assignment
    if (batchId) {
      const batch = await prisma.multiplierBatch.update({
        where: { id: batchId },
        data: { 
          driveFolderId: driveFolderId || null,
          driveFolderName: driveFolderName || null,
          googleEmail: googleEmail || null
        },
      });
      return NextResponse.json({ success: true, batch });
    }

    return NextResponse.json({ error: "Missing target ID" }, { status: 400 });
  } catch (err: any) {
    console.error("[Multiplier PATCH API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to assign folder" }, { status: 500 });
  }
}
