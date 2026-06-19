export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can, createUser, setRole, grantTool, revokeTool } from "@/lib/services/permissions";
import bcrypt from "bcryptjs";

// GET /api/admin/team — List all team members and their access config
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAllowed = await can(session.userId, "users_access");
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      include: {
        role: {
          select: {
            id: true,
            key: true,
            label: true,
            defaults: true,
          },
        },
        entitlements: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(users);
  } catch (err) {
    console.error("[Team API GET] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/team — Handle creation and updates
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAllowed = await can(session.userId, "users_access");
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // --- Action: Create User ---
    if (action === "create") {
      const { name, email, password, roleKey } = body;

      if (!name || !email || !password || !roleKey) {
        return NextResponse.json({ error: "Missing required fields (name, email, password, roleKey)" }, { status: 400 });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const newUser = await createUser({
        name,
        email,
        passwordHash,
        roleKey,
      });

      return NextResponse.json(newUser);
    }

    // --- Action: Update User ---
    if (action === "update") {
      const { userId, roleKey, status, entitlements } = body;

      if (!userId) {
        return NextResponse.json({ error: "Missing userId" }, { status: 400 });
      }

      // Check if user exists
      const targetUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!targetUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // 1. Update role if provided
      if (roleKey) {
        await setRole(session.userId, userId, roleKey);
      }

      // 2. Update status if provided
      if (status) {
        if (!["ACTIVE", "TRIAL", "DISABLED"].includes(status)) {
          return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
        }
        await prisma.user.update({
          where: { id: userId },
          data: { status },
        });
      }

      // 3. Update entitlements if provided
      // entitlements format: Array of { toolKey: string, override: "grant" | "revoke" | "default" }
      if (entitlements && Array.isArray(entitlements)) {
        for (const item of entitlements) {
          const { toolKey, override } = item;
          if (override === "grant") {
            await grantTool(session.userId, userId, toolKey);
          } else if (override === "revoke") {
            await revokeTool(session.userId, userId, toolKey);
          } else if (override === "default") {
            // Delete user entitlement to restore to default
            await prisma.userEntitlement.deleteMany({
              where: {
                userId,
                toolKey,
              },
            });
          }
        }
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("[Team API POST] Error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/admin/team — Delete a team member
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAllowed = await can(session.userId, "users_access");
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  if (id === session.userId) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Team API DELETE] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
