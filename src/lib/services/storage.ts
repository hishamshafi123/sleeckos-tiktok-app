import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const isR2Configured = (): boolean => {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
};

let s3Client: S3Client | null = null;

if (isR2Configured()) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".tar":
      return "application/x-tar";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

export async function uploadToR2(localPath: string, key: string, contentType?: string): Promise<boolean> {
  if (!isR2Configured() || !s3Client) {
    console.log(`[R2 Fallback] R2 is not configured. Local file preserved at ${localPath}`);
    return false;
  }

  try {
    if (!fs.existsSync(localPath)) {
      console.error(`[R2 Upload Error] File does not exist at local path: ${localPath}`);
      return false;
    }

    const fileBuffer = await fs.promises.readFile(localPath);
    const resolvedContentType = contentType || getContentType(localPath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: fileBuffer,
        ContentType: resolvedContentType,
      })
    );

    console.log(`[R2 Upload Success] Uploaded ${localPath} to R2 with key: ${key}`);
    return true;
  } catch (err) {
    console.error(`[R2 Upload Error] Failed to upload ${localPath} with key ${key}:`, err);
    return false;
  }
}

export async function getR2SignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string | null> {
  if (!isR2Configured() || !s3Client) {
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    return url;
  } catch (err) {
    console.error(`[R2 Signed URL Error] Failed to get signed URL for key ${key}:`, err);
    return null;
  }
}

export async function downloadFromR2(key: string, localPath: string): Promise<boolean> {
  if (!isR2Configured() || !s3Client) {
    return false;
  }

  const tempPath = `${localPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    });

    const response = await s3Client.send(command);
    if (!response.Body) {
      return false;
    }

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await pipeline(response.Body as Readable, fs.createWriteStream(tempPath));
    await fs.promises.rename(tempPath, localPath);

    console.log(`[R2 Download Success] Downloaded key: ${key} to ${localPath}`);
    return true;
  } catch (err) {
    try { await fs.promises.unlink(tempPath); } catch {}
    console.error(`[R2 Download Error] Failed to download key ${key} to ${localPath}:`, err);
    return false;
  }
}

export async function deleteFromR2(key: string): Promise<boolean> {
  if (!isR2Configured() || !s3Client) {
    return false;
  }

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      })
    );
    console.log(`[R2 Delete Success] Deleted key: ${key} from R2`);
    return true;
  } catch (err) {
    console.error(`[R2 Delete Error] Failed to delete key ${key}:`, err);
    return false;
  }
}

export { isR2Configured };
