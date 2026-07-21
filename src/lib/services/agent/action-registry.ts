/**
 * Action Registry — wraps existing service functions as typed tools
 * for the LLM agent layer. Each action declares its schema, permission
 * requirement, risk level, and execution handler.
 */

import * as campaigns from "@/lib/services/campaigns";
import * as clipMixer from "@/lib/services/clip-mixer";
import * as styleStudio from "@/lib/services/style-studio";
import * as projects from "@/lib/services/projects";
import * as lms from "@/lib/services/lms";
import * as permissions from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { postNowForAccount } from "@/lib/services/posting-pipeline";
import { bulkRenderGroups } from "@/lib/services/multiplier";
import { naturalCompare } from "@/lib/utils/sorting";

// ─── Types ─────────────────────────────────────────────

export interface ActionParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: ActionParameter;
}

export interface ActionDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ActionParameter>;
    required: string[];
  };
  requiredPermission: string;
  isRisky: boolean;
  execute: (userId: string, params: Record<string, any>) => Promise<any>;
}

// ─── Registry ──────────────────────────────────────────

const actions: ActionDefinition[] = [
  // ── Campaigns ──────────────────────────────────────────

  {
    name: "list_campaigns",
    description: "List all campaigns with their accounts and resources.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "campaigns",
    isRisky: false,
    execute: async () => campaigns.getCampaigns(),
  },
  {
    name: "get_campaign",
    description: "Get details for a specific campaign by its ID.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign UUID" },
      },
      required: ["campaignId"],
    },
    requiredPermission: "campaigns",
    isRisky: false,
    execute: async (_userId, p) => campaigns.getCampaignById(p.campaignId),
  },
  {
    name: "create_campaign",
    description: "Create a new campaign with a name/title and optional description.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Campaign title" },
        description: { type: "string", description: "Campaign description" },
      },
      required: ["title"],
    },
    requiredPermission: "campaigns",
    isRisky: false,
    execute: async (userId, p) =>
      campaigns.createCampaign(
        {
          title: p.title,
          description: p.description,
        },
        userId
      ),
  },
  {
    name: "delete_campaign",
    description: "Delete a campaign by its ID. This removes all associated resources.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign UUID to delete" },
      },
      required: ["campaignId"],
    },
    requiredPermission: "campaigns",
    isRisky: true,
    execute: async (_userId, p) => campaigns.deleteCampaign(p.campaignId),
  },

  // ── Clip Mixer ─────────────────────────────────────────

  {
    name: "generate_clip_mixer_batch",
    description: "Generate new clip mixer recipes. Requires a folderId, count, trackId, templateId, and mixer settings.",
    parameters: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "Clip folder UUID to source clips from" },
        count: { type: "number", description: "Number of mixes to generate (1-100)" },
        targetDuration: { type: "number", description: "Target duration in seconds (default 30)" },
        variationStrength: { type: "number", description: "Variation strength 1-5 (default 3)" },
        trackId: { type: "string", description: "Music track UUID" },
        templateId: { type: "string", description: "Lyrical template UUID" },
        trackStart: { type: "number", description: "Track start offset in seconds (default 0)" },
        muteAudio: { type: "boolean", description: "Whether to mute audio (default false)" },
      },
      required: ["folderId", "count", "trackId", "templateId"],
    },
    requiredPermission: "clip_mixer",
    isRisky: true,
    execute: async (_userId, p) =>
      clipMixer.generateRecipesForBatch({
        folderId: p.folderId,
        count: p.count,
        targetDuration: p.targetDuration || 30,
        variationStrength: p.variationStrength || 3,
        trackId: p.trackId,
        templateId: p.templateId,
        trackStart: p.trackStart || 0,
        muteAudio: p.muteAudio || false,
      }),
  },
  {
    name: "render_mix_item",
    description: "Render a single clip mixer item by its ID using FFmpeg.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The mix item UUID to render" },
      },
      required: ["itemId"],
    },
    requiredPermission: "clip_mixer",
    isRisky: true,
    execute: async (_userId, p) => clipMixer.renderMix(p.itemId),
  },
  {
    name: "export_batch_archive",
    description: "Export an entire clip mixer batch as a downloadable archive.",
    parameters: {
      type: "object",
      properties: {
        batchId: { type: "string", description: "The batch UUID to export" },
      },
      required: ["batchId"],
    },
    requiredPermission: "clip_mixer",
    isRisky: true,
    execute: async (_userId, p) => clipMixer.exportBatchArchive(p.batchId),
  },

  // ── Style Studio ───────────────────────────────────────

  {
    name: "list_style_templates",
    description: "List all available style templates for the style studio.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "style_studio",
    isRisky: false,
    execute: async () => styleStudio.getStyleTemplates(),
  },
  {
    name: "list_saved_styles",
    description: "List all saved styles created by users.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "style_studio",
    isRisky: false,
    execute: async () => styleStudio.getSavedStyles(),
  },
  {
    name: "create_saved_style",
    description: "Create a new saved style configuration for the style studio.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Style name" },
        templateKey: { type: "string", description: "Base template key (e.g. brat, spotify-lyrics, quote)" },
        params: { type: "string", description: "JSON string of style parameters" },
      },
      required: ["name", "templateKey", "params"],
    },
    requiredPermission: "style_studio",
    isRisky: false,
    execute: async (_userId, p) =>
      styleStudio.createSavedStyle({
        name: p.name,
        templateKey: p.templateKey,
        params: typeof p.params === "string" ? JSON.parse(p.params) : p.params,
      }),
  },
  {
    name: "queue_style_render",
    description: "Queue a style studio render job for a saved style.",
    parameters: {
      type: "object",
      properties: {
        savedStyleId: { type: "string", description: "Saved style UUID to render" },
        inputProps: { type: "string", description: "JSON string of render input properties" },
      },
      required: ["savedStyleId"],
    },
    requiredPermission: "style_studio",
    isRisky: true,
    execute: async (_userId, p) =>
      styleStudio.queueRenderJob(
        p.savedStyleId,
        p.inputProps ? (typeof p.inputProps === "string" ? JSON.parse(p.inputProps) : p.inputProps) : {}
      ),
  },

  // ── Projects ───────────────────────────────────────────

  {
    name: "create_project",
    description: "Create a new project linked to a campaign.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        campaignId: { type: "string", description: "Campaign UUID to link to" },
      },
      required: ["name", "campaignId"],
    },
    requiredPermission: "projects",
    isRisky: false,
    execute: async (userId, p) => projects.createProject(userId, p.name, p.campaignId),
  },
  {
    name: "add_project_member",
    description: "Add a team member to a project with a specific role (lead, editor, curator).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        memberUserId: { type: "string", description: "User UUID to add" },
        projectRole: {
          type: "string",
          description: "Role in the project",
          enum: ["lead", "editor", "curator"],
        },
      },
      required: ["projectId", "memberUserId", "projectRole"],
    },
    requiredPermission: "projects",
    isRisky: false,
    execute: async (userId, p) =>
      projects.addProjectMember(userId, p.projectId, p.memberUserId, p.projectRole),
  },
  {
    name: "remove_project_member",
    description: "Remove a team member from a project.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        memberUserId: { type: "string", description: "User UUID to remove" },
      },
      required: ["projectId", "memberUserId"],
    },
    requiredPermission: "projects",
    isRisky: true,
    execute: async (userId, p) =>
      projects.removeProjectMember(userId, p.projectId, p.memberUserId),
  },
  {
    name: "create_task",
    description: "Create a task within a project. Assign it to a user with an optional due date.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        assigneeId: { type: "string", description: "User UUID to assign to (optional)" },
        dueDate: { type: "string", description: "Due date ISO string (optional)" },
      },
      required: ["projectId", "title"],
    },
    requiredPermission: "projects",
    isRisky: false,
    execute: async (userId, p) =>
      projects.createTask(userId, p.projectId, {
        title: p.title,
        description: p.description,
        assigneeId: p.assigneeId,
        dueDate: p.dueDate,
      }),
  },
  {
    name: "update_task",
    description: "Update a task's status, priority, assignee, or other fields.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task UUID" },
        status: {
          type: "string",
          description: "New status",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
        },
        priority: {
          type: "string",
          description: "New priority",
          enum: ["low", "medium", "high", "urgent"],
        },
        assigneeId: { type: "string", description: "New assignee user UUID" },
        title: { type: "string", description: "New title" },
      },
      required: ["taskId"],
    },
    requiredPermission: "projects",
    isRisky: false,
    execute: async (userId, p) => {
      const updates: any = {};
      if (p.status) updates.status = p.status;
      if (p.priority) updates.priority = p.priority;
      if (p.assigneeId) updates.assigneeId = p.assigneeId;
      if (p.title) updates.title = p.title;
      return projects.updateTask(userId, p.taskId, updates);
    },
  },
  {
    name: "delete_task",
    description: "Delete a task from a project.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task UUID to delete" },
      },
      required: ["taskId"],
    },
    requiredPermission: "projects",
    isRisky: true,
    execute: async (userId, p) => projects.deleteTask(userId, p.taskId),
  },
  {
    name: "send_project_chat",
    description: "Send a message in a project's chat channel.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        content: { type: "string", description: "Message content" },
      },
      required: ["projectId", "content"],
    },
    requiredPermission: "projects",
    isRisky: false,
    execute: async (userId, p) =>
      projects.createChatMessage(userId, p.projectId, p.content),
  },

  // ── LMS ────────────────────────────────────────────────

  {
    name: "list_courses",
    description: "List all training courses with lesson and enrollment counts.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "lms",
    isRisky: false,
    execute: async () => lms.getCourses(),
  },
  {
    name: "create_course",
    description: "Create a new LMS training course assigned to specific roles, optionally gating a tool behind completion.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Course title" },
        description: { type: "string", description: "Course description" },
        assignedRoles: {
          type: "array",
          description: "Role keys this course is assigned to",
          items: { type: "string", description: "A role key" },
        },
        unlocksToolKey: { type: "string", description: "Tool key to unlock on completion (optional)" },
      },
      required: ["title", "assignedRoles"],
    },
    requiredPermission: "lms",
    isRisky: false,
    execute: async (_userId, p) =>
      lms.createCourse({
        title: p.title,
        description: p.description,
        assignedRoles: p.assignedRoles,
        unlocksToolKey: p.unlocksToolKey,
      }),
  },
  {
    name: "enroll_users_by_course",
    description: "Auto-enroll all users whose role matches the course's assigned roles.",
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID" },
      },
      required: ["courseId"],
    },
    requiredPermission: "lms",
    isRisky: false,
    execute: async (_userId, p) => lms.enrollUsersByCourse(p.courseId),
  },
  {
    name: "get_enrollment_dashboard",
    description: "Get per-user course completion stats for all enrollments.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "lms",
    isRisky: false,
    execute: async () => lms.getEnrollmentDashboard(),
  },

  // ── Permissions ────────────────────────────────────────

  {
    name: "get_user_access",
    description: "Get the effective access (set of tool keys) for a given user.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User UUID" },
      },
      required: ["userId"],
    },
    requiredPermission: "users_access",
    isRisky: false,
    execute: async (_userId, p) => {
      const access = await permissions.getEffectiveAccess(p.userId);
      return Array.from(access);
    },
  },
  {
    name: "grant_tool",
    description: "Grant a specific tool entitlement to a user.",
    parameters: {
      type: "object",
      properties: {
        targetUserId: { type: "string", description: "User UUID to grant access to" },
        toolKey: { type: "string", description: "Tool key to grant" },
      },
      required: ["targetUserId", "toolKey"],
    },
    requiredPermission: "users_access",
    isRisky: true,
    execute: async (userId, p) =>
      permissions.grantTool(userId, p.targetUserId, p.toolKey),
  },
  {
    name: "revoke_tool",
    description: "Revoke a specific tool entitlement from a user.",
    parameters: {
      type: "object",
      properties: {
        targetUserId: { type: "string", description: "User UUID to revoke access from" },
        toolKey: { type: "string", description: "Tool key to revoke" },
      },
      required: ["targetUserId", "toolKey"],
    },
    requiredPermission: "users_access",
    isRisky: true,
    execute: async (userId, p) =>
      permissions.revokeTool(userId, p.targetUserId, p.toolKey),
  },
  {
    name: "set_user_role",
    description: "Change a user's role (admin, team_lead, editor, curator).",
    parameters: {
      type: "object",
      properties: {
        targetUserId: { type: "string", description: "User UUID to update" },
        roleKey: {
          type: "string",
          description: "New role key",
          enum: ["admin", "team_lead", "editor", "curator"],
        },
      },
      required: ["targetUserId", "roleKey"],
    },
    requiredPermission: "users_access",
    isRisky: true,
    execute: async (userId, p) =>
      permissions.setRole(userId, p.targetUserId, p.roleKey),
  },

  // ── Managed Accounts ───────────────────────────────────

  {
    name: "search_accounts",
    description: "Search managed TikTok accounts by username. Returns up to 25 accounts with their color, section, posting schedule, and connection state.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Username substring to filter by (case-insensitive). Omit to list all accounts." },
      },
      required: [],
    },
    requiredPermission: "accounts",
    isRisky: false,
    execute: async (_userId, p) => {
      const accounts = await prisma.managedAccount.findMany({
        where: p.query
          ? { tiktokUsername: { contains: String(p.query).trim(), mode: "insensitive" } }
          : {},
        include: { section: true },
      });
      accounts.sort((a, b) => naturalCompare(a.tiktokUsername, b.tiktokUsername));
      return accounts.slice(0, 25).map((a) => ({
        username: a.tiktokUsername,
        displayName: a.tiktokDisplayName || undefined,
        color: a.color,
        section: a.section.name,
        postTimeSlots: a.postTimeSlots,
        postDays: a.postDays,
        connectionState: a.connectionState,
        driveFolderName: a.driveFolderName || undefined,
      }));
    },
  },
  {
    name: "post_now_accounts",
    description: "Immediately post the next available video for each given account username (the same as pressing 'Post Now' on the account). Reports per-account success or failure.",
    parameters: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          description: "Exact TikTok usernames to post for (case-insensitive, @ prefix optional)",
          items: { type: "string", description: "A TikTok username" },
        },
      },
      required: ["usernames"],
    },
    requiredPermission: "accounts",
    isRisky: true,
    execute: async (_userId, p) => {
      const results: { username: string; ok: boolean; fileName?: string; error?: string }[] = [];
      for (const raw of p.usernames as string[]) {
        const username = String(raw).trim().replace(/^@/, "");
        if (!username) continue;
        const account = await prisma.managedAccount.findFirst({
          where: { tiktokUsername: { equals: username, mode: "insensitive" } },
          select: { id: true, tiktokUsername: true },
        });
        if (!account) {
          results.push({ username, ok: false, error: "Account not found" });
          continue;
        }
        try {
          const { fileName } = await postNowForAccount(account.id);
          results.push({ username: account.tiktokUsername, ok: true, fileName });
        } catch (err: any) {
          results.push({ username: account.tiktokUsername, ok: false, error: err?.message || String(err) });
        }
      }
      return results;
    },
  },
  {
    name: "update_account_schedule",
    description: "Update an account's posting schedule: time slots (HH:MM, 24h), post days (1=Monday .. 7=Sunday), and/or timezone (IANA name). Only provided fields are changed.",
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", description: "Exact TikTok username (case-insensitive)" },
        slots: {
          type: "array",
          description: "Posting time slots in HH:MM 24h format, e.g. [\"09:00\", \"18:30\"]",
          items: { type: "string", description: "A HH:MM time slot" },
        },
        days: {
          type: "array",
          description: "Days of the week to post, 1=Monday through 7=Sunday",
          items: { type: "number", description: "Day number 1-7" },
        },
        timezone: { type: "string", description: "IANA timezone name, e.g. \"America/New_York\"" },
      },
      required: ["username"],
    },
    requiredPermission: "accounts",
    isRisky: true,
    execute: async (_userId, p) => {
      const account = await prisma.managedAccount.findFirst({
        where: { tiktokUsername: { equals: String(p.username).trim().replace(/^@/, ""), mode: "insensitive" } },
        select: { id: true, tiktokUsername: true },
      });
      if (!account) throw new Error(`Account not found: ${p.username}`);

      const data: { postTimeSlots?: string; postDays?: string; postTimezone?: string } = {};

      if (p.slots !== undefined) {
        if (!Array.isArray(p.slots) || p.slots.length === 0) {
          throw new Error("slots must be a non-empty array of HH:MM times");
        }
        for (const slot of p.slots) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot).trim())) {
            throw new Error(`Invalid time slot "${slot}". Use HH:MM 24h format, e.g. "09:00".`);
          }
        }
        data.postTimeSlots = p.slots.map((s: string) => String(s).trim()).join(",");
      }

      if (p.days !== undefined) {
        if (!Array.isArray(p.days) || p.days.length === 0) {
          throw new Error("days must be a non-empty array of day numbers (1=Monday .. 7=Sunday)");
        }
        const days = p.days.map((d: any) => Number(d));
        for (const d of days) {
          if (!Number.isInteger(d) || d < 1 || d > 7) {
            throw new Error(`Invalid day "${d}". Use 1=Monday through 7=Sunday.`);
          }
        }
        data.postDays = [...new Set(days)].sort((a, b) => a - b).join(",");
      }

      if (p.timezone !== undefined) {
        const tz = String(p.timezone).trim();
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
        } catch {
          throw new Error(`Invalid timezone "${tz}". Use an IANA name like "America/New_York".`);
        }
        data.postTimezone = tz;
      }

      if (Object.keys(data).length === 0) {
        throw new Error("Nothing to update. Provide slots, days, and/or timezone.");
      }

      const updated = await prisma.managedAccount.update({
        where: { id: account.id },
        data,
      });
      return {
        username: updated.tiktokUsername,
        postTimeSlots: updated.postTimeSlots,
        postDays: updated.postDays,
        postTimezone: updated.postTimezone,
      };
    },
  },
  {
    name: "set_account_color",
    description: "Set an account's color label. The color must exist in the account colors table (matched case-insensitively).",
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", description: "Exact TikTok username (case-insensitive)" },
        color: { type: "string", description: "Color name/key from the account colors table" },
      },
      required: ["username", "color"],
    },
    requiredPermission: "accounts",
    isRisky: false,
    execute: async (_userId, p) => {
      const account = await prisma.managedAccount.findFirst({
        where: { tiktokUsername: { equals: String(p.username).trim().replace(/^@/, ""), mode: "insensitive" } },
        select: { id: true, tiktokUsername: true },
      });
      if (!account) throw new Error(`Account not found: ${p.username}`);

      const colors = await prisma.accountColor.findMany({ orderBy: { order: "asc" } });
      const match = colors.find(
        (c) => c.color.toLowerCase() === String(p.color).trim().toLowerCase()
      );
      if (!match) {
        const available = colors.map((c) => c.color).join(", ");
        throw new Error(
          `Unknown color "${p.color}". Available colors: ${available || "none configured"}`
        );
      }

      const updated = await prisma.managedAccount.update({
        where: { id: account.id },
        data: { color: match.color, colorId: match.id },
      });
      return { username: updated.tiktokUsername, color: updated.color };
    },
  },
  {
    name: "set_posts_per_day",
    description: "Set how many times per day an account posts by generating evenly spaced time slots. The system enforces a 3-hour minimum gap, so slots are generated 3 hours apart starting at startHour (e.g. 3/day from 9 → 09:00,12:00,15:00).",
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", description: "Exact TikTok username (case-insensitive)" },
        postsPerDay: { type: "number", description: "Posts per day (1-6)" },
        startHour: { type: "number", description: "Hour of the first slot, 0-23 (default 9)" },
      },
      required: ["username", "postsPerDay"],
    },
    requiredPermission: "accounts",
    isRisky: true,
    execute: async (_userId, p) => {
      const postsPerDay = Number(p.postsPerDay);
      if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 6) {
        throw new Error("postsPerDay must be an integer between 1 and 6");
      }
      const startHour = p.startHour !== undefined ? Number(p.startHour) : 9;
      if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
        throw new Error("startHour must be an integer between 0 and 23");
      }

      const account = await prisma.managedAccount.findFirst({
        where: { tiktokUsername: { equals: String(p.username).trim().replace(/^@/, ""), mode: "insensitive" } },
        select: { id: true, tiktokUsername: true },
      });
      if (!account) throw new Error(`Account not found: ${p.username}`);

      // Slots must respect the 3-hour minimum gap the scheduler enforces
      const slots: string[] = [];
      for (let i = 0; i < postsPerDay; i++) {
        const hour = (startHour + i * 3) % 24;
        slots.push(`${String(hour).padStart(2, "0")}:00`);
      }

      const updated = await prisma.managedAccount.update({
        where: { id: account.id },
        data: { postTimeSlots: slots.join(",") },
      });
      return {
        username: updated.tiktokUsername,
        postsPerDay,
        postTimeSlots: updated.postTimeSlots,
      };
    },
  },

  // ── Multiplier ─────────────────────────────────────────

  {
    name: "get_render_queue_status",
    description: "Get the multiplier render queue status: output counts by status plus the names of groups currently queued or rendering.",
    parameters: { type: "object", properties: {}, required: [] },
    requiredPermission: "multiplier",
    isRisky: false,
    execute: async () => {
      const statusCounts = await prisma.multiplierOutput.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      const outputsByStatus: Record<string, number> = {};
      for (const row of statusCounts) {
        outputsByStatus[row.status] = row._count._all;
      }

      const activeGroups = await prisma.multiplierGroup.findMany({
        where: { status: { in: ["QUEUED", "RENDERING"] } },
        select: { name: true, status: true },
        orderBy: { createdAt: "asc" },
      });

      return {
        outputsByStatus,
        queuedGroups: activeGroups.filter((g) => g.status === "QUEUED").map((g) => g.name),
        renderingGroups: activeGroups.filter((g) => g.status === "RENDERING").map((g) => g.name),
      };
    },
  },
  {
    name: "render_groups",
    description: "Queue renders for multiplier groups by name (matched case-insensitively). Groups already queued/rendering or missing variations/hooks are skipped with a reason.",
    parameters: {
      type: "object",
      properties: {
        groupNames: {
          type: "array",
          description: "Multiplier group names to render",
          items: { type: "string", description: "A multiplier group name" },
        },
      },
      required: ["groupNames"],
    },
    requiredPermission: "multiplier",
    isRisky: true,
    execute: async (_userId, p) => {
      const ids: string[] = [];
      const nameById = new Map<string, string>();
      const skipped: { name: string; reason: string }[] = [];

      for (const raw of p.groupNames as string[]) {
        const name = String(raw).trim();
        if (!name) continue;
        const group = await prisma.multiplierGroup.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { id: true, name: true },
        });
        if (!group) {
          skipped.push({ name, reason: "Group not found" });
          continue;
        }
        ids.push(group.id);
        nameById.set(group.id, group.name);
      }

      const queued: string[] = [];
      if (ids.length > 0) {
        const result = await bulkRenderGroups(ids);
        for (const id of result.queued) {
          queued.push(nameById.get(id) || id);
        }
        for (const s of result.skipped) {
          skipped.push({ name: nameById.get(s.groupId) || s.groupId, reason: s.reason });
        }
      }

      return { queued, skipped };
    },
  },

  // ── Campaigns (stats) ──────────────────────────────────

  {
    name: "get_campaign_stats",
    description: "Get posting stats for a campaign by title (matched case-insensitively): exported/posted/failed counts and post success rate.",
    parameters: {
      type: "object",
      properties: {
        campaignName: { type: "string", description: "Campaign title" },
      },
      required: ["campaignName"],
    },
    requiredPermission: "campaigns",
    isRisky: false,
    execute: async (_userId, p) => {
      const title = String(p.campaignName).trim();
      let campaign = await prisma.campaign.findFirst({
        where: { title: { equals: title, mode: "insensitive" } },
      });
      if (!campaign) {
        campaign = await prisma.campaign.findFirst({
          where: { title: { contains: title, mode: "insensitive" } },
        });
      }
      if (!campaign) throw new Error(`Campaign not found: ${p.campaignName}`);

      const totalAttempts = campaign.postedCount + campaign.failedCount;
      return {
        title: campaign.title,
        status: campaign.status,
        type: campaign.type,
        exportedCount: campaign.exportedCount,
        postedCount: campaign.postedCount,
        failedCount: campaign.failedCount,
        postSuccessRate:
          totalAttempts > 0
            ? Math.round((campaign.postedCount / totalAttempts) * 100) / 100
            : null,
      };
    },
  },
];

// ─── Exports ───────────────────────────────────────────

export function getActionRegistry(): ActionDefinition[] {
  return actions;
}

export function getAction(name: string): ActionDefinition | undefined {
  return actions.find((a) => a.name === name);
}

/**
 * Build Gemini-compatible function declarations from the registry.
 */
export function getToolDeclarations() {
  return actions.map((a) => ({
    name: a.name,
    description: a.description,
    parameters: a.parameters,
  }));
}
