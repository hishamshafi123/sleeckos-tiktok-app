/** Browser integration against a disposable local DB/server; never exports or posts. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert(
    database.hostname === "localhost" &&
      database.pathname.endsWith("state_accounts_verify"),
  );
  process.env.MIXER_STORAGE_DIR = path.join(
    process.cwd(),
    "scratch/mixer-e2e/storage",
  );
  const { default: db } = await import("../src/lib/db");
  const { createSession } = await import("../src/lib/services/sessions");
  const { mediaCommand } =
    await import("../src/lib/services/campaign-mixer/media");
  const marker = crypto.randomUUID();
  const root = path.join(process.cwd(), "scratch/mixer-e2e");
  await fs.promises.mkdir(root, { recursive: true });
  const source = path.join(root, `${marker}.mp4`),
    music = path.join(root, `${marker}.wav`);
  await mediaCommand("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x406070:size=1080x1920:rate=30",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    source,
  ]);
  await mediaCommand("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000",
    "-t",
    "3",
    music,
  ]);
  const role = await db.role.findUniqueOrThrow({ where: { key: "admin" } });
  const user = await db.user.create({
    data: {
      email: `mixer-ui-${marker}@example.invalid`,
      roleId: role.id,
      status: "ACTIVE",
      name: "Mixer QA",
    },
  });
  const campaign = await db.campaign.create({
    data: {
      title: `Mixer UI ${marker.slice(0, 8)}`,
      slug: `mixer-ui-${marker}`,
      description: "Disposable browser QA",
      brief: "QA",
      requiredHashtags: [],
      requiredMentions: [],
      payoutPerPostCents: 0,
      totalBudgetCents: 0,
      maxCreators: 1,
      applicationDeadline: new Date(),
      deliveryDeadline: new Date(),
      nicheTags: [],
      exampleVideos: [],
    },
  });
  const { token } = await createSession({ userId: user.id, rememberMe: false });
  const browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage();
  let workspaceId = "";
  const errors: string[] = [];
  try {
    assert.equal(
      (await fetch("http://localhost:3101/api/multiplier/mixer/workspaces"))
        .status,
      401,
    );
    await page.setViewport({ width: 1600, height: 1000 });
    await browser.setCookie({
      name: "session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("http://localhost:3101/admin/multiplier", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });
    async function click(text: string, exact = true) {
      console.log(`UI step: ${text}`);
      await page.waitForFunction(
        (text, exact) =>
          Array.from(document.querySelectorAll("button")).some(
            (b) =>
              !b.disabled &&
              (exact
                ? b.textContent?.trim() === text
                : b.textContent?.trim().startsWith(text)),
          ),
        { timeout: 90000 },
        text,
        exact,
      );
      await page.evaluate(
        (text, exact) => {
          const b = Array.from(document.querySelectorAll("button")).find(
            (b) =>
              !b.disabled &&
              (exact
                ? b.textContent?.trim() === text
                : b.textContent?.trim().startsWith(text)),
          );
          b?.click();
        },
        text,
        exact,
      );
    }
    async function waitText(text: string) {
      await page.waitForFunction(
        (text) =>
          document
            .querySelector('section[aria-label="Campaign Mixer"]')
            ?.textContent?.includes(text),
        { timeout: 90000 },
        text,
      );
    }
    await click("Campaign Mixer");
    await waitText("Add a campaign library");
    await page.select(
      'section[aria-label="Campaign Mixer"] select:not([aria-label="Saved campaign"])',
      campaign.id,
    );
    await click("Create library");
    await waitText("Add clips");
    workspaceId = (
      await db.mixerWorkspace.findUniqueOrThrow({
        where: { campaignId: campaign.id },
      })
    ).id;
    const upload = await page.$(
      'section[aria-label="Campaign Mixer"] input[type="file"]',
    );
    assert(upload);
    await upload.uploadFile(source);
    await waitText(`${marker}.mp4`);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.includes("Add clips") && !b.disabled,
        ),
      { timeout: 90000 },
    );
    await click("music", false);
    const musicInput = await page.$(
      'section[aria-label="Campaign Mixer"] input[type="file"]',
    );
    assert(musicInput);
    await musicInput.uploadFile(music);
    await waitText(`${marker}.wav`);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.includes("Add music") && !b.disabled,
        ),
      { timeout: 90000 },
    );
    await click("texts", false);
    await page.type("#mixer-texts", "A new perspective\nMake today count");
    await click("Add texts");
    await waitText("A new perspective");
    await page.waitForSelector(
      'input[aria-label="Select text A new perspective"]',
    );
    await page.waitForSelector(
      'input[aria-label="Total outputs"]:not(:disabled)',
    );
    const count = await page.$('input[aria-label="Total outputs"]');
    assert(count);
    await count.evaluate((el) => (el as HTMLInputElement).select());
    await count.type("2");
    await page.waitForFunction(
      () =>
        document.querySelector(
          'section[aria-label="Campaign Mixer"] [role="status"]',
        )?.textContent === "Saved",
      { timeout: 15000 },
    );
    await page.screenshot({
      path: path.join(root, "library-desktop.png"),
      fullPage: true,
    });
    await click("Preview batch");
    await waitText("Review your batch");
    await page.screenshot({
      path: path.join(root, "review-desktop.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "Desktop has no horizontal overflow",
    );
    await click("Render sample", false);
    await waitText("Review your batch");
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.includes("Render sample") && b.disabled,
        ),
      { timeout: 120000 },
    );
    await click("Confirm and render 2 videos");
    await waitText("Batch queued");
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some((b) =>
          b.textContent?.includes("Smart Export (2)"),
        ),
      { timeout: 120000 },
    );
    const batch = await db.mixerBatch.findFirstOrThrow({
      where: { workspaceId },
      include: { recipes: { include: { output: true } } },
    });
    assert(batch.recipes.every((r) => r.output?.status === "COMPLETED"));
    const zipResponse = await fetch(
      `http://localhost:3101/api/multiplier/mixer/batches/${batch.id}/download`,
      { headers: { cookie: `session=${token}` } },
    );
    assert.equal(zipResponse.status, 200);
    const zipFile = path.join(root, "batch.zip");
    await fs.promises.writeFile(
      zipFile,
      Buffer.from(await zipResponse.arrayBuffer()),
    );
    const zipResult = await mediaCommand("python3", [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert len(z.namelist())==2; assert z.testzip() is None; print('ZIP valid: 2 videos')",
      zipFile,
    ]);
    console.log(zipResult.trim());
    await page.screenshot({
      path: path.join(root, "completed-desktop.png"),
      fullPage: true,
    });
    await click("Smart Export (2)");
    await page.waitForFunction(
      () =>
        document.body.textContent?.includes(
          "Selected batches can supply multiple distinct Mixer videos per account",
        ),
      { timeout: 30000 },
    );
    await page.screenshot({
      path: path.join(root, "export-desktop.png"),
      fullPage: true,
    });
    await page.reload({ waitUntil: "networkidle2" });
    await click("Campaign Mixer");
    await page.waitForFunction(
      (id) =>
        Array.from(
          document.querySelectorAll(
            'select[aria-label="Saved campaign"] option',
          ),
        ).some((option) => (option as HTMLOptionElement).value === id),
      {},
      workspaceId,
    );
    const workspaceSelect = await page.$(
      'section[aria-label="Campaign Mixer"] select',
    );
    assert(workspaceSelect);
    await workspaceSelect.select(workspaceId);
    await waitText("Add clips");
    const reopened = await db.mixerWorkspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    assert.equal((reopened.draft as { count: number }).count, 2);
    assert.equal(await db.mixerAsset.count({ where: { workspaceId } }), 2);
    await page.setViewport({ width: 1100, height: 900 });
    await page.screenshot({
      path: path.join(root, "library-laptop.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "Laptop has no horizontal overflow",
    );
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        (document.querySelector("#admin-navigation")?.getBoundingClientRect()
          .right ?? 1) <= 0,
    );
    await page.screenshot({
      path: path.join(root, "library-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "Mobile has no horizontal overflow",
    );
    await page.click('button[aria-label="Open navigation"]');
    await page.waitForSelector('button[aria-label="Close navigation"]');
    await page.click('button[aria-label="Close navigation"]');
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      "UI: library uploads, text list, saved settings, preview, real sample/batch render, ZIP, Smart Export and reopen passed. No exports or posts were sent.",
    );
  } catch (error) {
    await page
      .screenshot({ path: path.join(root, "failure.png"), fullPage: true })
      .catch(() => {});
    console.error(
      "Page text:",
      (
        await page
          .$eval('section[aria-label="Campaign Mixer"]', (el) => el.textContent)
          .catch(() => "No Mixer section")
      ).slice(-5000),
    );
    throw error;
  } finally {
    await browser.close();
    if (workspaceId) {
      const batches = await db.mixerBatch.findMany({
        where: { workspaceId },
        select: { groupId: true },
      });
      const groupIds = batches.flatMap((b) => (b.groupId ? [b.groupId] : []));
      const outputs = await db.multiplierOutput.findMany({
        where: { groupId: { in: groupIds } },
        select: { outputRef: true },
      });
      for (const output of outputs)
        if (output.outputRef)
          await fs.promises
            .unlink(path.join(process.cwd(), "public", output.outputRef))
            .catch(() => {});
      const assets = await db.mixerAsset.findMany({
        where: { workspaceId },
        select: { filePath: true },
      });
      await db.multiplierGroup.deleteMany({ where: { id: { in: groupIds } } });
      await db.mixerWorkspace.delete({ where: { id: workspaceId } });
      for (const asset of assets)
        await fs.promises.rm(
          path.dirname(
            path.join(process.env.MIXER_STORAGE_DIR, asset.filePath),
          ),
          { recursive: true, force: true },
        );
    }
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.user.delete({ where: { id: user.id } });
    await fs.promises.unlink(source);
    await fs.promises.unlink(music);
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
