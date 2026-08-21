/**
 * Next.js server boot hook (App Router, stable — no config flag needed).
 *
 * The Smart Export and multiplier render workers run as in-memory loops keyed
 * on module-level flags; a deploy/restart strands their pending rows forever
 * because nothing re-triggers the loop on boot. register() runs once per
 * server instance — resume both queues here (fire-and-forget; register must
 * not block startup on DB work). The post-scheduler cron repeats this every
 * 5 minutes as the mid-day-crash safety net.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic imports keep Prisma/Drive clients out of non-node bundles.
  const { resumeSmartExportQueue } = await import("@/lib/services/multiplier-export");
  const { resumeRenderQueueIfWorkPending } = await import("@/lib/services/multiplier");

  resumeSmartExportQueue().catch((err) => {
    console.error("[Boot] Smart Export queue resume failed:", err);
  });
  resumeRenderQueueIfWorkPending().catch((err) => {
    console.error("[Boot] Render queue resume failed:", err);
  });
}
