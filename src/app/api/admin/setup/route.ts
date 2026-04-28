export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function GET() {
  const email = "admin@sleeckos.com";
  const password = "admin123";
  
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    
    if (existing) {
      // If user exists, update password to admin123 just in case
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { email },
        data: { passwordHash, role: "ADMIN", status: "APPROVED" }
      });
      return NextResponse.json({ message: "Admin user already existed, password has been reset to admin123" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "ADMIN",
        status: "APPROVED"
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
