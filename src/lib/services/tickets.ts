import prisma from "@/lib/db";

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export class TicketError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const userSelect = { id: true, name: true, email: true } as const;

const ticketInclude = {
  creator: { select: userSelect },
  assignee: { select: userSelect },
} as const;

const OPEN_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS"];
const PRIORITY_RANK: Record<TicketPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

type TicketWithUsers = {
  status: string;
  priority: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Open tickets (OPEN/IN_PROGRESS) first: priority URGENT>HIGH>MEDIUM>LOW,
// then dueDate asc (nulls last), then createdAt desc. DONE/CANCELLED after,
// by updatedAt desc.
function sortTickets<T extends TicketWithUsers>(tickets: T[]): T[] {
  return tickets.sort((a, b) => {
    const aOpen = OPEN_STATUSES.includes(a.status as TicketStatus);
    const bOpen = OPEN_STATUSES.includes(b.status as TicketStatus);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;

    if (aOpen) {
      const pr =
        (PRIORITY_RANK[a.priority as TicketPriority] ?? 99) -
        (PRIORITY_RANK[b.priority as TicketPriority] ?? 99);
      if (pr !== 0) return pr;

      if (a.dueDate && b.dueDate) {
        const dd = a.dueDate.getTime() - b.dueDate.getTime();
        if (dd !== 0) return dd;
      } else if (a.dueDate) {
        return -1;
      } else if (b.dueDate) {
        return 1;
      }

      return b.createdAt.getTime() - a.createdAt.getTime();
    }

    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

function parseDueDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string);
  if (isNaN(date.getTime())) {
    throw new TicketError("Invalid dueDate");
  }
  return date;
}

export type TicketView = "mine" | "created" | "all";

export async function listTickets(userId: string, view: TicketView, statusFilter?: string[]) {
  const where: any = {};
  if (view === "created") {
    where.creatorId = userId;
  } else if (view === "mine") {
    where.assigneeId = userId;
  }
  if (statusFilter && statusFilter.length > 0) {
    where.status = { in: statusFilter };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: ticketInclude,
  });

  return sortTickets(tickets);
}

export async function createTicket(
  userId: string,
  data: {
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    assigneeId?: unknown;
    dueDate?: unknown;
  }
) {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) {
    throw new TicketError("title is required");
  }

  let priority: TicketPriority = "MEDIUM";
  if (data.priority !== undefined && data.priority !== null) {
    if (!TICKET_PRIORITIES.includes(data.priority as TicketPriority)) {
      throw new TicketError(`Invalid priority. Must be one of: ${TICKET_PRIORITIES.join(", ")}`);
    }
    priority = data.priority as TicketPriority;
  }

  let assigneeId: string | null = null;
  if (data.assigneeId !== undefined && data.assigneeId !== null) {
    if (typeof data.assigneeId !== "string") {
      throw new TicketError("Invalid assigneeId");
    }
    const assignee = await prisma.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee) {
      throw new TicketError("Assignee not found");
    }
    assigneeId = data.assigneeId;
  }

  return prisma.ticket.create({
    data: {
      title,
      description: typeof data.description === "string" ? data.description : null,
      priority,
      creatorId: userId,
      assigneeId,
      dueDate: parseDueDate(data.dueDate),
    },
    include: ticketInclude,
  });
}

export async function updateTicket(
  ticketId: string,
  data: {
    status?: unknown;
    priority?: unknown;
    assigneeId?: unknown;
    title?: unknown;
    description?: unknown;
    dueDate?: unknown;
  }
) {
  const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!existing) {
    throw new TicketError("Ticket not found", 404);
  }

  const update: any = {};

  if (data.status !== undefined) {
    if (!TICKET_STATUSES.includes(data.status as TicketStatus)) {
      throw new TicketError(`Invalid status. Must be one of: ${TICKET_STATUSES.join(", ")}`);
    }
    update.status = data.status as TicketStatus;
    update.completedAt = data.status === "DONE" ? new Date() : null;
  }

  if (data.priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(data.priority as TicketPriority)) {
      throw new TicketError(`Invalid priority. Must be one of: ${TICKET_PRIORITIES.join(", ")}`);
    }
    update.priority = data.priority as TicketPriority;
  }

  if (data.assigneeId !== undefined) {
    if (data.assigneeId === null) {
      update.assigneeId = null;
    } else {
      if (typeof data.assigneeId !== "string") {
        throw new TicketError("Invalid assigneeId");
      }
      const assignee = await prisma.user.findUnique({ where: { id: data.assigneeId } });
      if (!assignee) {
        throw new TicketError("Assignee not found");
      }
      update.assigneeId = data.assigneeId;
    }
  }

  if (data.title !== undefined) {
    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (!title) {
      throw new TicketError("title cannot be empty");
    }
    update.title = title;
  }

  if (data.description !== undefined) {
    update.description = data.description === null ? null : String(data.description);
  }

  if (data.dueDate !== undefined) {
    update.dueDate = parseDueDate(data.dueDate);
  }

  return prisma.ticket.update({
    where: { id: ticketId },
    data: update,
    include: ticketInclude,
  });
}

export async function deleteTicket(userId: string, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw new TicketError("Ticket not found", 404);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

  if (ticket.creatorId !== userId && !isManagement) {
    throw new TicketError("Forbidden: Only the creator or management can delete this ticket", 403);
  }

  await prisma.ticket.delete({ where: { id: ticketId } });
}

export async function listAssignees() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: userSelect,
    orderBy: { name: "asc" },
  });
}
