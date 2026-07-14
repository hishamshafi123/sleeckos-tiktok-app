import prisma from "@/lib/db";
import { notifyTelegram } from "./telegram";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Helper to log project activity
async function logActivity(projectId: string, actorId: string, action: string, target: string) {
  try {
    await prisma.activityLog.create({
      data: {
        projectId,
        actorId,
        action,
        target,
      },
    });
  } catch (err) {
    console.error("[logActivity] Failed to write activity log:", err);
  }
}

// Helper to parse mentions from message text and send Telegram notifications
async function handleChatMentions(
  body: string,
  projectId: string,
  projectName: string,
  authorName: string,
  taskId?: string | null
) {
  const words = body.split(/\s+/);
  const mentionTokens = words
    .filter((w) => w.startsWith("@"))
    .map((w) => w.substring(1).replace(/[^\w.@]/g, ""));

  if (mentionTokens.length === 0) return [];

  const userIds = new Set<string>();

  for (const token of mentionTokens) {
    if (!token) continue;
    const matchedUsers = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: token, mode: "insensitive" } },
          { name: { contains: token, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });

    for (const u of matchedUsers) {
      userIds.add(u.id);
    }
  }

  const mentionsArray = Array.from(userIds);

  // Send notifications to mentioned users
  for (const mentionedId of mentionsArray) {
    const notifyMsg = taskId
      ? `💬 ${authorName} mentioned you in a task thread inside "${projectName}"`
      : `💬 ${authorName} mentioned you in the "${projectName}" project chat`;
      
    const relativeLink = taskId
      ? `/admin/projects?id=${projectId}&taskId=${taskId}`
      : `/admin/projects?id=${projectId}`;
      
    await notifyTelegram(mentionedId, notifyMsg, `${APP_URL}${relativeLink}`);
  }

  return mentionsArray;
}

/**
 * Creates a project linked to a campaign.
 */
export async function createProject(userId: string, name: string, campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new Error("Campaign not found");

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      campaignId,
      createdBy: userId,
    },
  });

  // Assign the creator as LEAD member
  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId,
      projectRole: "LEAD",
    },
  });

  await logActivity(project.id, userId, "create_project", `Created project "${name.trim()}"`);

  return project;
}

/**
 * Adds a user to a project with a specific role.
 */
export async function addProjectMember(userId: string, projectId: string, memberUserId: string, projectRole: string) {
  const member = await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId: memberUserId,
      },
    },
    update: { projectRole },
    create: {
      projectId,
      userId: memberUserId,
      projectRole,
    },
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  await logActivity(
    projectId,
    userId,
    "add_member",
    `Added ${member.user.name || member.user.email} as ${projectRole}`
  );

  // Notify member via Telegram
  await notifyTelegram(
    memberUserId,
    `📂 You have been added to the project workspace as ${projectRole}`,
    `${APP_URL}/admin/projects?id=${projectId}`
  );

  return member;
}

/**
 * Removes a user from a project.
 */
export async function removeProjectMember(userId: string, projectId: string, memberUserId: string) {
  const deleted = await prisma.projectMember.delete({
    where: {
      projectId_userId: {
        projectId,
        userId: memberUserId,
      },
    },
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  await logActivity(
    projectId,
    userId,
    "remove_member",
    `Removed member ${deleted.user.name || deleted.user.email}`
  );

  return deleted;
}

/**
 * Creates a project task.
 */
export async function createTask(
  userId: string,
  projectId: string,
  taskData: {
    title: string;
    description?: string;
    assigneeId?: string;
    dueDate?: string | Date;
    tags?: string[];
    clipMixerBatchId?: string;
  }
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  if (!project) throw new Error("Project not found");

  const task = await prisma.task.create({
    data: {
      projectId,
      title: taskData.title.trim(),
      description: taskData.description,
      assigneeId: taskData.assigneeId || null,
      dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
      tags: taskData.tags || [],
      clipMixerBatchId: taskData.clipMixerBatchId || null,
    },
    include: {
      assignee: { select: { name: true, email: true } },
    },
  });

  await logActivity(projectId, userId, "create_task", `Created task "${task.title}"`);

  // Notify assignee via Telegram
  if (task.assigneeId) {
    await notifyTelegram(
      task.assigneeId,
      `📋 Task Assigned: "${task.title}" in project "${project.name}"`,
      `${APP_URL}/admin/projects?id=${projectId}&taskId=${task.id}`
    );
  }

  return task;
}

/**
 * Updates a task (details, status, assignee).
 */
export async function updateTask(
  userId: string,
  taskId: string,
  taskData: {
    title?: string;
    description?: string;
    assigneeId?: string | null;
    status?: string;
    dueDate?: string | Date | null;
    tags?: string[];
    clipMixerBatchId?: string | null;
  }
) {
  const originalTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { name: true } } },
  });
  if (!originalTask) throw new Error("Task not found");

  // Format data for update
  const data: any = {};
  if (taskData.title !== undefined) data.title = taskData.title.trim();
  if (taskData.description !== undefined) data.description = taskData.description;
  if (taskData.assigneeId !== undefined) data.assigneeId = taskData.assigneeId;
  if (taskData.status !== undefined) data.status = taskData.status;
  if (taskData.dueDate !== undefined) data.dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
  if (taskData.tags !== undefined) data.tags = taskData.tags;
  if (taskData.clipMixerBatchId !== undefined) data.clipMixerBatchId = taskData.clipMixerBatchId;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data,
    include: {
      assignee: { select: { name: true, email: true } },
    },
  });

  // Log changes
  if (taskData.status && taskData.status !== originalTask.status) {
    await logActivity(
      originalTask.projectId,
      userId,
      "change_task_status",
      `Task "${updated.title}" moved to ${taskData.status.toUpperCase()}`
    );
  }

  if (taskData.assigneeId && taskData.assigneeId !== originalTask.assigneeId) {
    await logActivity(
      originalTask.projectId,
      userId,
      "reassign_task",
      `Task "${updated.title}" reassigned to ${updated.assignee?.name || updated.assignee?.email}`
    );

    // Notify new assignee
    if (updated.assigneeId) {
      await notifyTelegram(
        updated.assigneeId,
        `📋 Task Assigned: "${updated.title}" in project "${originalTask.project.name}"`,
        `${APP_URL}/admin/projects?id=${originalTask.projectId}&taskId=${updated.id}`
      );
    }
  }

  return updated;
}

/**
 * Deletes a task.
 */
export async function deleteTask(userId: string, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });
  if (!task) throw new Error("Task not found");

  await prisma.task.delete({
    where: { id: taskId },
  });

  await logActivity(task.projectId, userId, "delete_task", `Deleted task "${task.title}"`);
  return task;
}

/**
 * Posts a chat message, parses mentions, and pings Telegram.
 */
export async function createChatMessage(
  authorId: string,
  projectId: string,
  body: string,
  taskId?: string | null
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  if (!project) throw new Error("Project not found");

  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { name: true, email: true },
  });
  if (!author) throw new Error("Author user not found");

  const authorDisplayName = author.name || author.email;

  // Initial insert to message database
  const message = await prisma.chatMessage.create({
    data: {
      projectId,
      taskId: taskId || null,
      authorId,
      body,
      mentions: [],
    },
  });

  // Parse mentions and trigger notifications in background
  const mentions = await handleChatMentions(
    body,
    projectId,
    project.name,
    authorDisplayName,
    taskId
  );

  // Update message with parsed mentions list
  const updatedMessage = await prisma.chatMessage.update({
    where: { id: message.id },
    data: { mentions },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  return updatedMessage;
}

/**
 * Sourced clip submission by Curator.
 */
export async function submitCuratorClip(
  curatorId: string,
  campaignId: string,
  folderId: string | null,
  clipRef: string
) {
  return await prisma.curatorSubmission.create({
    data: {
      campaignId,
      folderId,
      curatorId,
      clipRef,
      status: "pending",
    },
    include: {
      campaign: { select: { title: true } },
      curator: { select: { name: true, email: true } },
    },
  });
}

/**
 * Approve curator clip submission. Imports file into campaign clip folder.
 */
export async function approveCuratorSubmission(userId: string, submissionId: string) {
  const submission = await prisma.curatorSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) throw new Error("Submission not found");
  if (submission.status !== "pending") throw new Error("Submission already processed");

  if (!submission.folderId) {
    throw new Error("Cannot approve submission: No target ClipFolder assigned.");
  }

  // Probe duration (in standard projects, we'll try parsing duration or default to 5.0)
  // Since we save the path relative, let's look up if there is a local file to determine duration
  let videoDuration = 5.0;
  try {
    const fs = require("fs");
    const path = require("path");
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);

    const localPath = path.join(process.cwd(), "public", submission.clipRef);
    if (fs.existsSync(localPath)) {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localPath}"`
      );
      const parsed = parseFloat(stdout.trim());
      if (!isNaN(parsed) && parsed > 0) {
        videoDuration = parsed;
      }
    }
  } catch (probeErr) {
    console.warn("[approveCuratorSubmission] Duration probe error, falling back to 5.0s:", probeErr);
  }

  // Create the ClipVideo record
  const clipVideo = await prisma.clipVideo.create({
    data: {
      folderId: submission.folderId,
      videoUrl: submission.clipRef,
      duration: videoDuration,
    },
  });

  // Update submission status
  const updatedSubmission = await prisma.curatorSubmission.update({
    where: { id: submissionId },
    data: { status: "approved" },
  });

  // Create ActivityEvent for Curator KPI
  try {
    await prisma.activityEvent.create({
      data: {
        userId: submission.curatorId,
        functionType: "curator",
        count: 1,
        source: "auto",
        meta: { submissionId, campaignId: submission.campaignId },
        createdBy: userId,
        approved: true
      }
    });
  } catch (err) {
    console.warn("Failed to create curator ActivityEvent:", err);
  }

  // Notify curator
  await notifyTelegram(
    submission.curatorId,
    `✅ Curator Submission Approved for Campaign: Sourced clip has been added to Clip Mixer folders!`
  );

  return { submission: updatedSubmission, clipVideo };
}

/**
 * Reject curator submission with feedback.
 */
export async function rejectCuratorSubmission(userId: string, submissionId: string, feedback: string) {
  const submission = await prisma.curatorSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) throw new Error("Submission not found");
  if (submission.status !== "pending") throw new Error("Submission already processed");

  const updatedSubmission = await prisma.curatorSubmission.update({
    where: { id: submissionId },
    data: {
      status: "rejected",
      feedback,
    },
  });

  // Notify curator
  await notifyTelegram(
    submission.curatorId,
    `❌ Curator Submission Rejected.\nFeedback: "${feedback}"`
  );

  return updatedSubmission;
}

/**
 * Retrieve submissions (role aware).
 */
export async function getCuratorSubmissions(userId: string, status?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (!user) throw new Error("User not found");

  const isManagement = user.role.key === "admin" || user.role.key === "team_lead";

  const where: any = {};
  if (!isManagement) {
    where.curatorId = userId;
  }
  if (status) {
    where.status = status;
  }

  return await prisma.curatorSubmission.findMany({
    where,
    include: {
      campaign: { select: { id: true, title: true } },
      folder: { select: { id: true, name: true } },
      curator: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
