import prisma from "@/lib/db";

export const ALL_TOOLS = [
  "overview",
  "accounts",
  "analytics",
  "post_queue",
  "history",
  "clip_mixer",
  "style_studio",
  "composer",
  "multiplier",
  "campaigns",
  "projects",
  "data_vault",
  "sourcing",
  "users_access",
  "lms",
  "agent",
];

export const DEFAULT_ROLES = [
  {
    key: "admin",
    label: "Administrator",
    tools: [...ALL_TOOLS],
  },
  {
    key: "team_lead",
    label: "Team Lead",
    tools: ["lms"],
  },
  {
    key: "editor",
    label: "Editor",
    tools: ["lms"],
  },
  {
    key: "curator",
    label: "Curator",
    tools: ["lms"],
  },
];

/**
 * Idempotently seeds default roles and default tool bindings.
 */
export async function ensureRolesSeeded() {
  for (const roleData of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: roleData.key },
      update: { label: roleData.label },
      create: { key: roleData.key, label: roleData.label },
    });

    // Delete defaults that are no longer in the list
    await prisma.roleDefault.deleteMany({
      where: {
        roleId: role.id,
        toolKey: { notIn: roleData.tools },
      },
    });

    // Create defaults that are missing
    for (const tool of roleData.tools) {
      await prisma.roleDefault.upsert({
        where: {
          roleId_toolKey: {
            roleId: role.id,
            toolKey: tool,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          toolKey: tool,
        },
      });
    }
  }
}

/**
 * Calculates effective access tools for a user based on status, role, defaults, and overrides.
 */
export async function getEffectiveAccess(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          defaults: true,
        },
      },
      entitlements: true,
    },
  });

  if (!user || user.status === "DISABLED") {
    return new Set<string>();
  }

  const allowed = new Set<string>();

  // Explicit admin bypass: Admin has full access by explicit logic
  if (user.role && user.role.key === "admin") {
    for (const tool of ALL_TOOLS) {
      allowed.add(tool);
    }
    return allowed;
  }

  // Base tools baseline:
  // If new hire (TRIAL), they ONLY start with 'lms' regardless of role defaults
  if (user.status === "TRIAL") {
    allowed.add("lms");
  } else if (user.status === "ACTIVE") {
    // ACTIVE status: inherit defaults for the role
    if (user.role && user.role.defaults) {
      for (const def of user.role.defaults) {
        allowed.add(def.toolKey);
      }
    }
  }

  // Apply user-level entitlement overrides
  if (user.entitlements) {
    for (const entitlement of user.entitlements) {
      if (entitlement.granted) {
        allowed.add(entitlement.toolKey);
      } else {
        allowed.delete(entitlement.toolKey);
      }
    }
  }

  return allowed;
}

/**
 * Helper to check if a user has access to a specific tool surface.
 */
export async function can(userId: string, toolKey: string): Promise<boolean> {
  const allowed = await getEffectiveAccess(userId);
  return allowed.has(toolKey);
}

/**
 * Helper to grant a specific tool to a user (creating/updating a positive override).
 */
export async function grantTool(adminId: string, userId: string, toolKey: string): Promise<boolean> {
  const adminCan = await can(adminId, "users_access");
  if (!adminCan) {
    throw new Error("Unauthorized: Only administrators with users_access can manage entitlements.");
  }

  await prisma.userEntitlement.upsert({
    where: {
      userId_toolKey: {
        userId,
        toolKey,
      },
    },
    update: { granted: true },
    create: {
      userId,
      toolKey,
      granted: true,
    },
  });

  return true;
}

/**
 * Helper to revoke a specific tool from a user (creating/updating a negative override).
 */
export async function revokeTool(adminId: string, userId: string, toolKey: string): Promise<boolean> {
  const adminCan = await can(adminId, "users_access");
  if (!adminCan) {
    throw new Error("Unauthorized: Only administrators with users_access can manage entitlements.");
  }

  await prisma.userEntitlement.upsert({
    where: {
      userId_toolKey: {
        userId,
        toolKey,
      },
    },
    update: { granted: false },
    create: {
      userId,
      toolKey,
      granted: false,
    },
  });

  return true;
}

/**
 * Updates a user's role.
 */
export async function setRole(adminId: string, userId: string, roleKey: string): Promise<boolean> {
  const adminCan = await can(adminId, "users_access");
  if (!adminCan) {
    throw new Error("Unauthorized: Only administrators with users_access can modify roles.");
  }

  const role = await prisma.role.findUnique({
    where: { key: roleKey },
  });

  if (!role) {
    throw new Error(`Role with key ${roleKey} does not exist.`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { roleId: role.id },
  });

  return true;
}

/**
 * LMS programmatically unlocks a tool for a user.
 */
export async function unlockToolForUser(userId: string, toolKey: string, reason?: string): Promise<boolean> {
  // Upsert a positive entitlement override
  await prisma.userEntitlement.upsert({
    where: {
      userId_toolKey: {
        userId,
        toolKey,
      },
    },
    update: { granted: true },
    create: {
      userId,
      toolKey,
      granted: true,
    },
  });

  console.log(`[LMS Unlock] Unlocked tool '${toolKey}' for user ${userId}. Reason: ${reason || "none"}`);
  return true;
}

/**
 * Creates a new user defaulting to TRIAL status (LMS-only by default).
 */
export async function createUser(data: {
  name: string;
  email: string;
  passwordHash: string;
  roleKey: string;
}) {
  // Ensure roles are seeded before mapping
  await ensureRolesSeeded();

  const role = await prisma.role.findUnique({
    where: { key: data.roleKey },
  });

  if (!role) {
    throw new Error(`Role ${data.roleKey} not found.`);
  }

  return await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: data.passwordHash,
      roleId: role.id,
      status: "TRIAL", // New hires default to TRIAL (LMS-only)
    },
  });
}
