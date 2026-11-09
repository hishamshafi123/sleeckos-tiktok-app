import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  accountStateName,
  CATEGORIES,
  DeskError,
  integer,
  publicUrl,
  SOURCE_KINDS,
  sourceUrl,
  STATES,
  STATUSES,
  text,
} from "./rules";
import { ingest } from "./ingest";

export type Actor = { userId: string; role: string };
export const DEFAULT_SETTINGS = {
  dailySocialRuns: 30,
  dailyAiBriefs: 100,
  shortlistHour: 9,
};
// Stable IDs verified against the YouTube channel API.
const VERIFIED_CHANNEL_IDS: Record<string, string> = {
  NM: "UCJnpF9oROFPvd7wWbPUDdGA",
  MI: "UCqMdEOPBZbGPykVOhUqWqfA",
  PA: "UCw77677G3EAODp61b0izs7w",
};
const LOCAL_FEEDS: Record<string, string> = {
  SC: "https://www.wltx.com/feeds/syndication/rss/news",
  NV: "https://www.8newsnow.com/feed/",
  NH: "https://www.wmur.com/topstories-rss",
  NM: "https://www.krqe.com/feed/",
  MI: "https://www.clickondetroit.com/arc/outboundfeeds/rss/category/news/?outputType=xml",
  VA: "https://www.wric.com/feed/",
  GA: "https://www.11alive.com/feeds/syndication/rss/news",
  AZ: "https://www.12news.com/feeds/syndication/rss/news",
  OH: "https://www.10tv.com/feeds/syndication/rss/news",
  PA: "https://6abc.com/feed/",
};
export async function ensureDesk() {
  // The marker prevents deleted or edited seed sources from reappearing.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(893278)`;
      if (
        await tx.appSetting.findUnique({
          where: { key: "content_desk_seed_v1" },
        })
      )
        return;
      for (const state of STATES) {
        await tx.contentState.upsert({
          where: { code: state.code },
          update: {},
          create: {
            code: state.code,
            name: state.name,
            keywords: `${state.name},${state.cities}`,
            excludedKeywords:
              state.code === "GA"
                ? "Tbilisi,Georgian Dream,South Ossetia"
                : state.code === "VA"
                  ? "West Virginia"
                  : "",
          },
        });
        const search = (q: string) =>
          `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" })}`;
        const suffix =
          state.code === "GA"
            ? " -Tbilisi -country"
            : state.code === "VA"
              ? ' -"West Virginia"'
              : "";
        const seeds = [
          {
            name: `${state.name} local reporting`,
            kind: "RSS",
            url: LOCAL_FEEDS[state.code],
            category: "AUTO",
            intervalMinutes: 60,
          },
          {
            name: `${state.name} news discovery`,
            kind: "RSS",
            url: search(`"${state.name}"${suffix} when:2d`),
            category: "AUTO",
            intervalMinutes: 60,
          },
          {
            name: `${state.name} culture & events`,
            kind: "RSS",
            url: search(
              `"${state.name}" (festival OR music OR food OR museum OR culture)${suffix} when:7d`,
            ),
            category: "CULTURE",
            intervalMinutes: 240,
          },
          {
            name: `${state.channel} on YouTube`,
            kind: "YOUTUBE",
            url: VERIFIED_CHANNEL_IDS[state.code]
              ? `https://www.youtube.com/channel/${VERIFIED_CHANNEL_IDS[state.code]}`
              : `https://www.youtube.com/@${state.channel}`,
            category: "AUTO",
            intervalMinutes: 60,
          },
        ];
        for (const seed of seeds)
          await tx.contentSource.upsert({
            where: {
              stateCode_kind_url: {
                stateCode: state.code,
                kind: seed.kind,
                url: seed.url,
              },
            },
            update: {},
            create: { ...seed, stateCode: state.code },
          });
      }
      await tx.appSetting.create({
        data: { key: "content_desk_seed_v1", value: "1" },
      });
    },
    { timeout: 20000 },
  );
}
export async function deskSettings() {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: { in: ["content_desk_settings", "state_accounts_timezone"] },
    },
  });
  let config = DEFAULT_SETTINGS;
  try {
    config = {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(
        rows.find((r) => r.key === "content_desk_settings")?.value || "{}",
      ),
    };
  } catch {}
  return {
    ...config,
    timezone:
      rows.find((r) => r.key === "state_accounts_timezone")?.value ||
      "Asia/Kolkata",
  };
}
export async function businessStart(now = new Date()) {
  const settings = await deskSettings();
  return fromZonedTime(
    `${formatInTimeZone(now, settings.timezone, "yyyy-MM-dd")}T00:00:00`,
    settings.timezone,
  );
}
export async function deskData(params: URLSearchParams, actor: Actor) {
  await ensureDesk();
  const state = params.get("state"),
    status = params.get("status"),
    cat = params.get("category"),
    q = (params.get("q") || "").slice(0, 150),
    team = params.get("team");
  const page = Math.max(0, Math.min(10000, Number(params.get("page")) || 0));
  const where: Prisma.ContentStoryWhereInput = {
    ...(params.get("story") ? { id: params.get("story")! } : {}),
    ...(state ? { stateCode: state } : {}),
    ...(status ? { status } : { status: { notIn: ["REJECTED", "OUTDATED"] } }),
    ...(cat ? { category: cat } : {}),
    ...(team ? { teamId: team } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [
    stories,
    total,
    states,
    sources,
    runs,
    teams,
    accounts,
    settings,
    heartbeat,
    shortlist,
    actorUser,
    counts,
  ] = await Promise.all([
    prisma.contentStory.findMany({
      where,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 50,
      skip: Math.floor(page) * 50,
      include: {
        items: { orderBy: { firstSeenAt: "asc" } },
        selectedBy: { select: { id: true, name: true, email: true } },
        events: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    }),
    prisma.contentStory.count({ where }),
    prisma.contentState.findMany({ orderBy: { name: "asc" } }),
    prisma.contentSource.findMany({
      orderBy: [{ stateCode: "asc" }, { name: "asc" }],
    }),
    prisma.contentRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 60,
      include: { source: { select: { name: true, stateCode: true } } },
    }),
    prisma.stateTeam.findMany({
      select: { id: true, name: true, members: { select: { userId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.stateAccount.findMany({
      where: { account: { revokedAt: null } },
      select: {
        accountId: true,
        stateName: true,
        teamId: true,
        guardianPhone: { select: { name: true } },
        account: {
          select: {
            tiktokUsername: true,
            driveFolderName: true,
            tiktokDisplayName: true,
          },
        },
      },
    }),
    deskSettings(),
    prisma.appSetting.findUnique({ where: { key: "content_desk_heartbeat" } }),
    prisma.appSetting.findUnique({ where: { key: "content_desk_shortlist" } }),
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    }),
    prisma.contentStory.groupBy({ by: ["status"], _count: true }),
  ]);
  const today = await businessStart();
  const usage = await prisma.contentRun.groupBy({
    by: ["kind"],
    where: {
      startedAt: { gte: today },
      kind: { in: ["SOCIAL_START", "AI_BRIEF"] },
    },
    _count: true,
    _sum: { costUsd: true },
  });
  return {
    stories,
    total,
    states,
    sources,
    runs,
    teams,
    accounts: accounts.map((a) => ({ ...a, stateName: accountStateName(a) })),
    settings,
    heartbeat: heartbeat?.value || null,
    shortlist: shortlist ? JSON.parse(shortlist.value) : null,
    user: { ...actor, name: actorUser?.name },
    counts,
    usage,
    providers: {
      youtube: !!process.env.YOUTUBE_API_KEY,
      social: !!process.env.APIFY_TOKEN,
      ai: !!process.env.GEMINI_API_KEY,
    },
    generatedAt: new Date().toISOString(),
  };
}
const required = (value: unknown, max: number, label: string) => {
  const s = text(value, max, label);
  if (!s) throw new DeskError("INVALID", `${label} is required.`);
  return s;
};
async function knownState(value: unknown) {
  const code = required(value, 2, "State");
  const state = await prisma.contentState.findUnique({ where: { code } });
  if (!state)
    throw new DeskError("INVALID", "Select one of the configured states.");
  return state;
}
function admin(actor: Actor) {
  if (actor.role !== "admin")
    throw new DeskError(
      "FORBIDDEN",
      "Only admins can change automation settings.",
      403,
    );
}
export async function mutateDesk(body: Record<string, unknown>, actor: Actor) {
  await ensureDesk();
  const action = body.action;
  if (action === "source.save") {
    const state = await knownState(body.stateCode),
      kind = required(body.kind, 20, "Source type");
    if (!(SOURCE_KINDS as readonly string[]).includes(kind))
      throw new DeskError("INVALID", "Choose a supported source type.");
    const url = sourceUrl(kind, required(body.url, 2000, "URL"));
    const name = required(body.name, 120, "Source name"),
      category = required(body.category || "AUTO", 20, "Category");
    if (!(CATEGORIES as readonly string[]).includes(category))
      throw new DeskError("INVALID", "Invalid category.");
    const intervalMinutes = integer(
      body.intervalMinutes,
      kind === "TIKTOK" || kind === "INSTAGRAM" ? 240 : 30,
      10080,
    );
    if (body.id) {
      const id = required(body.id, 100, "Source ID"),
        old = await prisma.contentSource.findUnique({ where: { id } });
      if (!old)
        throw new DeskError("NOT_FOUND", "Source no longer exists.", 404);
      if (actor.role !== "admin" && old.createdBy !== actor.userId)
        throw new DeskError(
          "FORBIDDEN",
          "Only the source owner or an admin can edit this source.",
          403,
        );
      if (old.pendingRunId)
        throw new DeskError(
          "RUNNING",
          "Wait for the active social collection to finish before editing this source.",
          409,
        );
      await prisma.contentSource.update({
        where: { id },
        data: {
          name,
          url,
          kind,
          stateCode: state.code,
          category,
          intervalMinutes,
          nextRunAt: new Date(),
          errorCode: null,
          errorMessage: null,
          failureCount: 0,
        },
      });
    } else {
      if (
        (await prisma.contentSource.count({
          where: { stateCode: state.code },
        })) >= 100
      )
        throw new DeskError(
          "LIMIT",
          "This state already has 100 sources. Pause or edit an existing source first.",
        );
      await prisma.contentSource.create({
        data: {
          name,
          url,
          kind,
          stateCode: state.code,
          category,
          intervalMinutes,
          createdBy: actor.userId,
        },
      });
    }
    return {
      message: "Source saved. It is queued for the next collection cycle.",
    };
  }
  if (action === "source.toggle" || action === "source.retry") {
    const id = required(body.id, 100, "Source ID"),
      source = await prisma.contentSource.findUnique({ where: { id } });
    if (!source) throw new DeskError("NOT_FOUND", "Source not found.", 404);
    if (actor.role !== "admin" && source.createdBy !== actor.userId)
      throw new DeskError(
        "FORBIDDEN",
        "Only the source owner or an admin can manage this source.",
        403,
      );
    if (action === "source.toggle" && typeof body.enabled !== "boolean")
      throw new DeskError("INVALID", "Enabled must be true or false.");
    await prisma.contentSource.update({
      where: { id },
      data:
        action === "source.toggle"
          ? { enabled: body.enabled as boolean, nextRunAt: new Date() }
          : { nextRunAt: new Date(), failureCount: 0 },
    });
    return {
      message:
        action === "source.retry"
          ? "Retry queued. Collection runs every five minutes."
          : body.enabled
            ? "Source resumed."
            : "Source paused. Existing content is retained.",
    };
  }
  if (action === "manual.add") {
    const state = await knownState(body.stateCode),
      url = publicUrl(required(body.url, 2000, "Content URL")),
      title = required(body.title, 500, "Title"),
      notes = text(body.notes || "", 4000, "Notes");
    const storyId = await ingest(
      {
        url,
        title,
        excerpt: notes,
        publisher: "Team submission",
        platform: "MANUAL",
        publishedAt: null,
        coverage: "MANUAL_NOTES",
      },
      state,
      null,
      true,
    );
    if (storyId)
      await prisma.contentEvent.create({
        data: {
          storyId,
          userId: actor.userId,
          actorName:
            (await prisma.user.findUnique({ where: { id: actor.userId } }))
              ?.name || "Team member",
          action: "SUBMITTED",
          detail: `Added a link. Original claims need review.${notes ? ` Team notes: ${notes}` : ""}`,
        },
      });
    return { message: "Content added to the review queue.", storyId };
  }
  if (action === "state.save") {
    admin(actor);
    const state = await knownState(body.code);
    if (typeof body.enabled !== "boolean")
      throw new DeskError("INVALID", "Enabled must be true or false.");
    await prisma.contentState.update({
      where: { code: state.code },
      data: {
        keywords: required(body.keywords, 3000, "Location keywords"),
        excludedKeywords: text(
          body.excludedKeywords || "",
          2000,
          "Excluded keywords",
        ),
        dailyTarget: integer(body.dailyTarget, 1, 50),
        enabled: body.enabled,
      },
    });
    return { message: "State preferences saved." };
  }
  if (action === "settings.save") {
    admin(actor);
    const value = JSON.stringify({
      dailySocialRuns: integer(body.dailySocialRuns, 0, 500),
      dailyAiBriefs: integer(body.dailyAiBriefs, 0, 1000),
      shortlistHour: integer(body.shortlistHour, 0, 23),
    });
    await prisma.appSetting.upsert({
      where: { key: "content_desk_settings" },
      create: { key: "content_desk_settings", value },
      update: { value },
    });
    return { message: "Automation limits saved." };
  }
  if (action === "brief.retry") {
    const id = required(body.id, 100, "Story ID");
    await prisma.contentStory.update({
      where: { id },
      data: {
        briefAttempts: 0,
        briefNextAt: new Date(0),
        briefError: null,
        evidenceHash: "",
      },
    });
    return { message: "Brief queued for regeneration." };
  }
  if (action === "story.update") {
    const ids = Array.isArray(body.ids)
      ? body.ids.map((v) => required(v, 100, "Story ID"))
      : [required(body.id, 100, "Story ID")];
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      throw new DeskError(
        "INVALID",
        "Select between 1 and 20 different stories.",
      );
    const versions = body.versions as Record<string, unknown>;
    if (!versions || typeof versions !== "object")
      throw new DeskError("INVALID", "Reload the story before saving.");
    const status = required(body.status, 30, "Status");
    if (!(STATUSES as readonly string[]).includes(status))
      throw new DeskError("INVALID", "Invalid status.");
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        const current = await tx.contentStory.findUnique({ where: { id } });
        if (!current)
          throw new DeskError(
            "NOT_FOUND",
            "A selected story no longer exists.",
            404,
          );
        const version = integer(versions[id], 0, 2_000_000_000);
        if (current.version !== version)
          throw new DeskError(
            "CONFLICT",
            "A teammate updated this story. Reload to see their changes before saving.",
            409,
          );
        let teamId =
          body.teamId === undefined
            ? current.teamId
            : body.teamId
              ? required(body.teamId, 100, "Team")
              : null;
        let accountId =
          body.accountId === undefined
            ? current.accountId
            : body.accountId
              ? required(body.accountId, 100, "Account")
              : null;
        if (
          actor.role !== "admin" &&
          current.teamId &&
          !(await tx.stateTeamMember.findUnique({
            where: {
              teamId_userId: { teamId: current.teamId, userId: actor.userId },
            },
          }))
        )
          throw new DeskError(
            "FORBIDDEN",
            "This story belongs to another team. Ask an admin to reassign it.",
            403,
          );
        if (teamId) {
          if (!(await tx.stateTeam.findUnique({ where: { id: teamId } })))
            throw new DeskError("INVALID", "Select an existing team.");
          if (
            actor.role !== "admin" &&
            !(await tx.stateTeamMember.findUnique({
              where: { teamId_userId: { teamId, userId: actor.userId } },
            }))
          )
            throw new DeskError(
              "FORBIDDEN",
              "Select a team you belong to.",
              403,
            );
        }
        if (["SELECTED", "APPROVED", "POSTED"].includes(status) && !teamId)
          throw new DeskError(
            "INVALID",
            "Choose a team to select or approve content.",
          );
        if (accountId) {
          const account = await tx.stateAccount.findUnique({
            where: { accountId },
            include: {
              guardianPhone: { select: { name: true } },
              account: {
                select: {
                  revokedAt: true,
                  driveFolderName: true,
                  tiktokDisplayName: true,
                  tiktokUsername: true,
                },
              },
            },
          });
          const state = await tx.contentState.findUnique({
            where: { code: current.stateCode },
          });
          if (
            !account ||
            account.account.revokedAt ||
            account.teamId !== teamId ||
            accountStateName(account).toLowerCase() !==
              state?.name.toLowerCase()
          )
            throw new DeskError(
              "INVALID",
              "Choose an active account assigned to this team and state.",
            );
        }
        if (status === "NEW") {
          teamId = null;
          accountId = null;
        }
        const publishedUrl =
          body.publishedUrl === undefined
            ? current.publishedUrl
            : body.publishedUrl
              ? publicUrl(required(body.publishedUrl, 2000, "Published URL"))
              : null;
        if (status === "POSTED" && !publishedUrl)
          throw new DeskError(
            "INVALID",
            "Add the published post URL before marking this story posted.",
          );
        const notes =
          body.notes === undefined
            ? current.notes
            : text(body.notes, 8000, "Notes");
        const changed = await tx.contentStory.updateMany({
          where: { id, version },
          data: {
            status,
            teamId,
            accountId,
            notes,
            publishedUrl,
            postedAt:
              status === "POSTED"
                ? current.postedAt || new Date()
                : current.postedAt,
            selectedById:
              status === "NEW" ? null : current.selectedById || actor.userId,
            needsReview: status === "APPROVED" ? false : current.needsReview,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new DeskError(
            "CONFLICT",
            "A teammate updated this story. Reload before saving.",
            409,
          );
        await tx.contentEvent.create({
          data: {
            storyId: id,
            userId: actor.userId,
            actorName: actorUser?.name || actorUser?.email || "Team member",
            action: status,
            detail: `${current.status} → ${status}${notes !== current.notes ? "; notes edited" : ""}`,
          },
        });
      }
    });
    return {
      message: `${ids.length === 1 ? "Story" : `${ids.length} stories`} updated.`,
    };
  }
  throw new DeskError("INVALID", "Unknown action.");
}
