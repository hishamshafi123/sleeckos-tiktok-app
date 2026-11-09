import https from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { DeskError, publicUrl } from "./rules";

export function isPublicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}
// Resolve and pin public addresses for each redirect. No private-network fetches,
// proxy credentials, unbounded responses, or DNS-rebinding window.
export async function safeText(
  input: string,
  redirects = 0,
): Promise<{ body: string; url: string }> {
  const url = new URL(publicUrl(input));
  let ips: string[];
  try {
    ips = isIP(url.hostname) ? [url.hostname] : await resolve4(url.hostname);
  } catch {
    throw new DeskError(
      "DNS",
      "This website could not be found. Check the URL and retry.",
    );
  }
  if (!ips.length || ips.some((ip) => !isPublicIPv4(ip)))
    throw new DeskError(
      "BLOCKED_URL",
      "This URL does not resolve to a public website. Use a public HTTPS source.",
    );
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        family: 4,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: ips[0], family: 4 }]);
          else callback(null, ips[0], 4);
        },
        headers: {
          "User-Agent": "SleeckOS-ContentDesk/1.0",
          Accept:
            "application/rss+xml, application/atom+xml, text/xml, text/html;q=0.9, */*;q=0.5",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects >= 4) {
            reject(
              new DeskError(
                "REDIRECT",
                "Too many redirects. Use the feed's final URL.",
              ),
            );
            return;
          }
          safeText(
            new URL(response.headers.location, url).toString(),
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (status >= 400) {
          response.resume();
          reject(
            new DeskError(
              `HTTP_${status}`,
              status === 403
                ? "This publisher blocks automated access. Use its public RSS feed or another source; existing content is preserved."
                : status === 404
                  ? "This page or feed no longer exists. Edit the source URL."
                  : status === 429
                    ? "The website is rate-limiting requests. Collection will retry with backoff."
                    : `The website returned HTTP ${status}. Collection will retry automatically.`,
            ),
          );
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000)
            request.destroy(
              new DeskError(
                "TOO_LARGE",
                "This response is too large. Use a smaller RSS feed instead.",
              ),
            );
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            url: url.toString(),
          }),
        );
      },
    );
    const timer = setTimeout(
      () =>
        request.destroy(
          new DeskError(
            "TIMEOUT",
            "The website took too long to respond. Collection will retry automatically.",
          ),
        ),
      18000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", (error) =>
      reject(
        error instanceof DeskError
          ? error
          : new DeskError(
              "NETWORK",
              "Could not securely connect to this website. Check the URL or retry later.",
            ),
      ),
    );
  });
}
export async function providerJson(url: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new DeskError(
      "PROVIDER_TIMEOUT",
      "The provider did not respond. The job will retry automatically.",
    );
  }
  if (!res.ok)
    throw new DeskError(
      `PROVIDER_${res.status}`,
      res.status === 401 || res.status === 403
        ? "Provider access was denied. Ask an admin to check the API key, permissions, and available quota."
        : res.status === 429
          ? "Provider quota or rate limit reached. Retry later or increase the provider limit."
          : `Provider returned HTTP ${res.status}. Retry later; existing content is preserved.`,
    );
  return res.json();
}
