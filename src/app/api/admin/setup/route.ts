export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureRolesSeeded } from "@/lib/services/permissions";
import bcrypt from "bcryptjs";

export async function GET() {
  const email = "admin@sleeckos.com";
  const password = "admin123";
  
  try {
    // Seed default roles and permissions
    await ensureRolesSeeded();

    const adminRole = await prisma.role.findUnique({ where: { key: "admin" } });
    if (!adminRole) {
      return NextResponse.json({ error: "Admin role not found" }, { status: 500 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    const passwordHash = await bcrypt.hash(password, 12);
    
    if (existing) {
      await prisma.user.update({
        where: { email },
        data: {
          passwordHash,
          roleId: adminRole.id,
          status: "ACTIVE",
        }
      });
      return NextResponse.json({ message: "Admin user already existed, role linked, and password has been reset to admin123" });
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        roleId: adminRole.id,
        status: "ACTIVE",
      }
    });

    return NextResponse.json({ 
      message: "Admin user created successfully!",
      email: user.email,
      password: password
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
