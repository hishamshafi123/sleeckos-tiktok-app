/**
 * Agent Service — Gemini-powered function-calling orchestrator.
 * Runs as the signed-in user, bound by their permissions.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getAction, getToolDeclarations } from "./action-registry";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// ─── Types ─────────────────────────────────────────────

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallResult[];
  confirmationRequired?: PendingConfirmation;
}

export interface ToolCallResult {
  toolName: string;
  input: Record<string, any>;
  output: any;
  status: "success" | "denied" | "error";
}

export interface PendingConfirmation {
  id: string; // audit log ID
  toolName: string;
  input: Record<string, any>;
  description: string;
}

// ─── System Prompt ─────────────────────────────────────

const SYSTEM_PROMPT = `You are the Sleeckos platform assistant. You help operators manage their TikTok content creation platform via natural language commands.

You have access to tools that let you manage campaigns, clip mixer batches, style studio renders, projects, tasks, LMS courses, and user permissions.

Guidelines:
- Be concise and professional. No fluff.
- When listing data, summarize it clearly. Don't dump raw JSON unless asked.
- If a user asks something you can't do with your tools, say so directly.
- When calling tools, always use the exact parameter names and types specified.
- If you need an ID but only have a name, call the relevant list function first to find the ID.
- For risky operations, explain what you're about to do before calling the tool.

You act as the currently signed-in user. You cannot bypass their permissions.`;

// ─── Core Agent ────────────────────────────────────────

export async function runAgentTurn(
  userId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<AgentMessage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      role: "assistant",
      content: "Agent is not configured. Please set the GEMINI_API_KEY environment variable.",
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  // Build conversation contents for Gemini
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  // Add current user message
  contents.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  const toolDeclarations = getToolDeclarations();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [
          {
            functionDeclarations: toolDeclarations as any,
          },
        ],
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content?.parts) {
      return {
        role: "assistant",
        content: "I wasn't able to generate a response. Please try again.",
      };
    }

    // Check if the model wants to call functions
    const functionCalls = candidate.content.parts.filter(
      (p: any) => p.functionCall
    );

    if (functionCalls.length === 0) {
      // Pure text response
      const text = candidate.content.parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("");
      return { role: "assistant", content: text };
    }

    // Process function calls
    const toolResults: ToolCallResult[] = [];

    for (const part of functionCalls) {
      const fc = (part as any).functionCall;
      const toolName = fc.name;
      const toolInput = fc.args || {};

      const action = getAction(toolName);
      if (!action) {
        toolResults.push({
          toolName,
          input: toolInput,
          output: { error: `Unknown tool: ${toolName}` },
          status: "error",
        });
        await logAudit(userId, userMessage, toolName, toolInput, { error: "Unknown tool" }, "error");
        continue;
      }

      // Permission check
      const hasPermission = await can(userId, action.requiredPermission);
      if (!hasPermission) {
        const denial = `You don't have access to ${action.requiredPermission}. This action requires the "${action.requiredPermission}" permission.`;
        toolResults.push({
          toolName,
          input: toolInput,
          output: { error: denial },
          status: "denied",
        });
        await logAudit(userId, userMessage, toolName, toolInput, { error: denial }, "denied");
        continue;
      }

      // Risky action — require confirmation
      if (action.isRisky) {
        const auditId = await logAudit(
          userId,
          userMessage,
          toolName,
          toolInput,
          null,
          "pending_confirmation"
        );
        return {
          role: "assistant",
          content: `This action requires your confirmation before I execute it.`,
          confirmationRequired: {
            id: auditId,
            toolName,
            input: toolInput,
            description: `**${action.description}**\n\nParameters: ${JSON.stringify(toolInput, null, 2)}`,
          },
        };
      }

      // Execute the action
      try {
        const result = await action.execute(userId, toolInput);
        toolResults.push({
          toolName,
          input: toolInput,
          output: result,
          status: "success",
        });
        await logAudit(userId, userMessage, toolName, toolInput, result, "success");
      } catch (err: any) {
        toolResults.push({
          toolName,
          input: toolInput,
          output: { error: err.message },
          status: "error",
        });
        await logAudit(userId, userMessage, toolName, toolInput, { error: err.message }, "error");
      }
    }

    // Generate a natural language summary of the tool results
    const summaryContents = [
      ...contents,
      {
        role: "model",
        parts: functionCalls,
      },
      {
        role: "user",
        parts: [
          {
            text: `Tool results:\n${toolResults
              .map(
                (r) =>
                  `${r.toolName} (${r.status}): ${JSON.stringify(r.output)}`
              )
              .join("\n")}\n\nPlease summarize these results for the user in a clear, concise way.`,
          },
        ],
      },
    ];

    const summaryResponse = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: summaryContents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });

    const summaryText =
      summaryResponse.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("") || "Actions completed.";

    return {
      role: "assistant",
      content: summaryText,
      toolCalls: toolResults,
    };
  } catch (err: any) {
    console.error("[Agent] Error:", err);
    return {
      role: "assistant",
      content: `An error occurred while processing your request: ${err.message}`,
    };
  }
}

// ─── Confirm Risky Action ──────────────────────────────

export async function confirmAction(
  userId: string,
  auditLogId: string,
  approved: boolean
): Promise<AgentMessage> {
  const auditLog = await prisma.agentAuditLog.findUnique({
    where: { id: auditLogId },
  });

  if (!auditLog || auditLog.userId !== userId) {
    return {
      role: "assistant",
      content: "Confirmation request not found or does not belong to you.",
    };
  }

  if (auditLog.status !== "pending_confirmation") {
    return {
      role: "assistant",
      content: "This action has already been processed.",
    };
  }

  if (!approved) {
    await prisma.agentAuditLog.update({
      where: { id: auditLogId },
      data: { status: "denied", toolOutput: { result: "User denied the action" } as any },
    });
    return {
      role: "assistant",
      content: "Action cancelled. No changes were made.",
    };
  }

  // Execute the held action
  const action = getAction(auditLog.toolName);
  if (!action) {
    return {
      role: "assistant",
      content: `Unknown action: ${auditLog.toolName}. Cannot execute.`,
    };
  }

  try {
    const input = auditLog.toolInput as Record<string, any>;
    const result = await action.execute(userId, input);

    await prisma.agentAuditLog.update({
      where: { id: auditLogId },
      data: { status: "confirmed", toolOutput: result as any },
    });

    return {
      role: "assistant",
      content: `Action confirmed and executed successfully.`,
      toolCalls: [
        {
          toolName: auditLog.toolName,
          input,
          output: result,
          status: "success",
        },
      ],
    };
  } catch (err: any) {
    await prisma.agentAuditLog.update({
      where: { id: auditLogId },
      data: { status: "error", toolOutput: { error: err.message } as any },
    });
    return {
      role: "assistant",
      content: `Action failed: ${err.message}`,
    };
  }
}

// ─── Audit Log ─────────────────────────────────────────

async function logAudit(
  userId: string,
  instruction: string,
  toolName: string,
  toolInput: any,
  toolOutput: any,
  status: string
): Promise<string> {
  const entry = await prisma.agentAuditLog.create({
    data: {
      userId,
      instruction,
      toolName,
      toolInput: toolInput as any,
      toolOutput: toolOutput as any,
      status,
    },
  });
  return entry.id;
}

export async function getAuditHistory(
  userId: string,
  isAdmin: boolean,
  limit = 50
) {
  return prisma.agentAuditLog.findMany({
    where: isAdmin ? {} : { userId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
