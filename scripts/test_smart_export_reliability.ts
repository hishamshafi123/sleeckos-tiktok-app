import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

function driveError(status: number, message: string, reason?: string, retryAfter?: string) {
  return {
    message,
    response: {
      status,
      headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      data: {
        error: {
          message,
          errors: reason ? [{ reason }] : [],
        },
      },
    },
  };
}

async function readUploadBody(body: fs.ReadStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  console.log("Starting Smart Export reliability tests...");

  const originalCwd = process.cwd();
  const originalRandom = Math.random;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-export-reliability-"));
  const tempFilePath = path.join(tempDir, "source.mp4");

  process.env.DATABASE_URL = "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";
  process.env.R2_ACCOUNT_ID = "placeholder";
  process.env.R2_ACCESS_KEY_ID = "placeholder";
  process.env.R2_SECRET_ACCESS_KEY = "placeholder";
  process.env.R2_BUCKET_NAME = "placeholder";

  try {
    // db.ts reads .env from cwd; use an empty cwd so only placeholders are loaded.
    process.chdir(tempDir);
    const {
      createSmartExportRequestHash,
      getDriveRetryDelayMs,
      isDriveQuotaError,
      isRetryableDriveError,
      uploadWithRetry,
    } = await import("../src/lib/services/multiplier-export");
    process.chdir(originalCwd);

    type RequestHashInput = Parameters<typeof createSmartExportRequestHash>[0];

    const baseInput: RequestHashInput = {
      groupIds: ["group-b", "group-a"],
      accounts: [
        { driveFolderId: "folder-b", name: "Beta", count: 2 },
        { driveFolderId: "folder-a", name: "Alpha", count: 1 },
      ],
      plan: [
        {
          driveFolderId: "folder-b",
          driveFolderName: "Beta",
          videoIds: ["video-3", "video-2"],
        },
        {
          driveFolderId: "folder-a",
          driveFolderName: "Alpha",
          videoIds: ["video-1"],
        },
      ],
      days: 2,
      includeExported: true,
      countsAreTotal: true,
    };
    const reorderedInput: RequestHashInput = {
      ...baseInput,
      groupIds: [...baseInput.groupIds].reverse(),
      accounts: [...baseInput.accounts!].reverse(),
      plan: baseInput.plan!
        .map((assignment) => ({
          ...assignment,
          videoIds: [...assignment.videoIds].reverse(),
        }))
        .reverse(),
    };
    const originalInputJson = JSON.stringify(baseInput);
    const canonicalHash = createSmartExportRequestHash(baseInput);

    assert.equal(
      createSmartExportRequestHash(reorderedInput),
      canonicalHash,
      "Equivalent request ordering must produce the same hash"
    );
    assert.equal(
      JSON.stringify(baseInput),
      originalInputJson,
      "Request hashing must not mutate its input"
    );

    const defaultFalseInput: RequestHashInput = { ...baseInput, includeExported: false };
    const defaultOmittedInput: RequestHashInput = { ...defaultFalseInput };
    delete defaultOmittedInput.includeExported;
    assert.equal(
      createSmartExportRequestHash(defaultOmittedInput),
      createSmartExportRequestHash(defaultFalseInput),
      "Omitted includeExported must canonically equal explicit false"
    );

    const changedInputs: Array<[string, RequestHashInput]> = [
      ["group IDs", { ...baseInput, groupIds: ["group-a", "group-c"] }],
      [
        "account allocation",
        {
          ...baseInput,
          accounts: baseInput.accounts!.map((account) =>
            account.driveFolderId === "folder-a"
              ? { ...account, count: account.count + 1 }
              : account
          ),
        },
      ],
      [
        "plan videos",
        {
          ...baseInput,
          plan: baseInput.plan!.map((assignment) =>
            assignment.driveFolderId === "folder-b"
              ? { ...assignment, videoIds: [...assignment.videoIds, "video-4"] }
              : assignment
          ),
        },
      ],
      ["days", { ...baseInput, days: 3 }],
      ["includeExported", { ...baseInput, includeExported: false }],
      ["countsAreTotal", { ...baseInput, countsAreTotal: false }],
    ];
    for (const [label, changedInput] of changedInputs) {
      assert.notEqual(
        createSmartExportRequestHash(changedInput),
        canonicalHash,
        `Changing ${label} must change the request hash`
      );
    }
    console.log("Request hash canonicalization and changed-input detection passed");

    for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
      assert.equal(
        isRetryableDriveError(driveError(403, "Rate limited", reason)),
        true,
        `${reason} 403 must be retryable`
      );
      const mixedQuotaSignals = driveError(403, "Storage quota exceeded", reason);
      mixedQuotaSignals.response.data.error.errors.push({ reason: "storageQuotaExceeded" });
      assert.equal(
        isDriveQuotaError(mixedQuotaSignals),
        false,
        `${reason} must take precedence over storage-pause classification`
      );
      assert.equal(
        isRetryableDriveError(mixedQuotaSignals),
        true,
        `${reason} must remain retryable when storage-like text is also present`
      );
    }
    const storageQuotaError = driveError(403, "Storage quota exceeded", "storageQuotaExceeded");
    assert.equal(isDriveQuotaError(storageQuotaError), true, "Storage-specific quota must pause the job");
    assert.equal(
      isRetryableDriveError(storageQuotaError),
      false,
      "Drive storage quota 403 must not be retried"
    );
    const broadApiQuotaError = driveError(
      403,
      "Quota exceeded for quota metric 'drive.googleapis.com/write'",
      "quotaExceeded"
    );
    assert.equal(isDriveQuotaError(broadApiQuotaError), false, "Drive API quota is not storage exhaustion");
    assert.equal(isDriveQuotaError(driveError(403, "Drive quota exceeded")), false);
    assert.equal(
      isRetryableDriveError(driveError(403, "Permission denied", "insufficientPermissions")),
      false,
      "Drive permission 403 must not be retried"
    );
    assert.equal(isRetryableDriveError(driveError(429, "Too many requests")), true);
    assert.equal(isRetryableDriveError(driveError(503, "Backend unavailable")), true);
    assert.equal(
      isRetryableDriveError(Object.assign(new Error("Socket reset"), { code: "ECONNRESET" })),
      true,
      "Transient network errors must be retryable"
    );
    console.log("Drive retry classification passed");

    Math.random = () => 0;
    assert.equal(
      getDriveRetryDelayMs(driveError(429, "Slow down", undefined, "2"), 1),
      2000,
      "Retry-After seconds must override shorter exponential jitter"
    );
    assert.equal(
      getDriveRetryDelayMs(
        {
          response: {
            headers: {
              get: (name: string) => name.toLowerCase() === "retry-after" ? "3" : null,
            },
          },
        },
        1
      ),
      3000,
      "Headers.get Retry-After values must be honored"
    );
    assert.equal(
      getDriveRetryDelayMs(driveError(503, "Unavailable", undefined, "0"), 1),
      250,
      "A zero Retry-After must retain the minimum jitter delay"
    );
    console.log("Retry-After-aware delay passed");

    const payload = "temporary Smart Export upload payload";
    const fileName = "smart-export-test.mp4";
    const folderId = "folder-1";
    const expectedQuery = `name = '${fileName}' and '${folderId}' in parents and trashed = false`;
    fs.writeFileSync(tempFilePath, payload, "utf8");

    let uploadListCalls = 0;
    let uploadCreateCalls = 0;
    const transientDrive = {
      files: {
        list: async (request: { q: string }) => {
          uploadListCalls++;
          assert.equal(request.q, expectedQuery);
          return { data: { files: [] } };
        },
        create: async (request: {
          requestBody: { name: string; parents: string[] };
          media: { body: fs.ReadStream };
        }) => {
          uploadCreateCalls++;
          assert.equal(request.requestBody.name, fileName);
          assert.deepEqual(request.requestBody.parents, [folderId]);
          assert.equal(await readUploadBody(request.media.body), payload);
          if (uploadCreateCalls === 1) {
            throw driveError(503, "Transient backend failure");
          }
          return { data: { id: "uploaded-on-retry" } };
        },
      },
    };

    const uploadResult = await uploadWithRetry(
      transientDrive,
      tempFilePath,
      fileName,
      folderId,
      3
    );
    assert.deepEqual(uploadResult, { success: true, fileId: "uploaded-on-retry" });
    assert.equal(uploadCreateCalls, 2, "A transient 503 must be uploaded again");
    assert.equal(uploadListCalls, 2, "Each upload attempt must check for an existing file");

    const mixedRetryError = driveError(403, "Storage quota exceeded after rate limiting", "rateLimitExceeded");
    let exhaustedCreateCalls = 0;
    const exhaustedDrive = {
      files: {
        list: async () => ({ data: { files: [] } }),
        create: async (request: { media: { body: fs.ReadStream } }) => {
          exhaustedCreateCalls++;
          assert.equal(await readUploadBody(request.media.body), payload);
          throw mixedRetryError;
        },
      },
    };
    const exhaustedResult = await uploadWithRetry(
      exhaustedDrive,
      tempFilePath,
      fileName,
      folderId,
      2
    );
    assert.equal(exhaustedResult.success, false);
    assert.equal(exhaustedResult.cause, mixedRetryError, "Exhausted retries must retain the Drive error");
    assert.equal(exhaustedCreateCalls, 2, "The focused failure must exhaust all upload retries");
    assert.throws(
      () => {
        throw new Error(exhaustedResult.error || "Drive upload failed", { cause: exhaustedResult.cause });
      },
      (err: unknown) => {
        assert.equal(isDriveQuotaError(err), false, "Thrown mixed-signal errors must not pause for storage");
        assert.equal(isRetryableDriveError(err), true, "Thrown mixed-signal errors must remain rate-limit retryable");
        return true;
      }
    );
    console.log("Exhausted upload retry cause propagation passed");

    let dedupCreateCalls = 0;
    const dedupDrive = {
      files: {
        list: async (request: { q: string }) => {
          assert.equal(request.q, expectedQuery);
          return { data: { files: [{ id: "existing-drive-file", name: fileName }] } };
        },
        create: async () => {
          dedupCreateCalls++;
          throw new Error("Dedup must skip Drive file creation");
        },
      },
    };
    const dedupResult = await uploadWithRetry(
      dedupDrive,
      tempFilePath,
      fileName,
      folderId,
      3
    );
    assert.deepEqual(dedupResult, { success: true, fileId: "existing-drive-file" });
    assert.equal(dedupCreateCalls, 0, "An exact-name Drive match must prevent re-upload");
    console.log("Transient upload retry and existing-name dedup passed");
  } finally {
    Math.random = originalRandom;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(fs.existsSync(tempDir), false, "Temporary upload files must be cleaned up");
  console.log("All Smart Export reliability tests passed");
}

main().catch((err) => {
  console.error("Smart Export reliability test failed:", err);
  process.exitCode = 1;
});
