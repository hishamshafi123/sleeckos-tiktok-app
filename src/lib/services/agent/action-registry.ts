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
