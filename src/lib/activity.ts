import "server-only";
import { headers } from "next/headers";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}

/** Longest textual IPv6 form is 45 chars (e.g. an IPv4-mapped address) —
 * anything longer than this is not an IP and must not be stored. */
const MAX_IP_LENGTH = 45;
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/** Real user agents run a few hundred characters at most; this is generous
 * headroom while still bounding storage against an attacker sending an
 * oversized header. */
const MAX_USER_AGENT_LENGTH = 512;

function isPlausibleIp(value: string): boolean {
  if (value.length === 0 || value.length > MAX_IP_LENGTH) return false;
  return IPV4_PATTERN.test(value) || IPV6_PATTERN.test(value);
}

/** Resolves the caller's IP from trusted proxy headers only — never trusts
 * an arbitrary, attacker-controlled value.
 *
 * `X-Real-IP` is set by our nginx config from the raw TCP connection
 * (`$remote_addr`), so a client can never spoof it — it's always preferred.
 *
 * `X-Forwarded-For` is different: nginx is configured with
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, which
 * *appends* the real client IP to whatever the client already sent rather
 * than replacing it. That means the first entry can be attacker-controlled
 * garbage — only the *last* entry (the one nginx itself appended) can be
 * trusted with exactly one reverse proxy in front of this app. Every
 * candidate is validated against a strict IP shape before being accepted;
 * anything else is discarded rather than stored. */
function extractIpAddress(headerList: Headers): string | null {
  const realIp = headerList.get("x-real-ip")?.trim();
  if (realIp && isPlausibleIp(realIp)) return realIp;

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((part) => part.trim());
    const lastHop = parts[parts.length - 1];
    if (lastHop && isPlausibleIp(lastHop)) return lastHop;
  }

  return null;
}

/** Dependency-free, best-effort User-Agent parsing for admin display only —
 * not meant to be exhaustive or used for security decisions. Falls back to
 * null for anything unrecognized rather than guessing. */
function parseUserAgent(userAgent: string | null): Pick<RequestContext, "device" | "browser" | "os"> {
  if (!userAgent) return { device: null, browser: null, os: null };

  const device = /mobile/i.test(userAgent)
    ? "Mobile"
    : /tablet|ipad/i.test(userAgent)
      ? "Tablet"
      : "Desktop";

  let browser: string | null = null;
  if (/edg\//i.test(userAgent)) browser = "Edge";
  else if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) browser = "Opera";
  else if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) browser = "Chrome";
  else if (/firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/safari\//i.test(userAgent) && !/chrome/i.test(userAgent)) browser = "Safari";

  let os: string | null = null;
  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/iphone|ipad|ipod|ios/i.test(userAgent)) os = "iOS";
  else if (/mac os/i.test(userAgent)) os = "macOS";
  else if (/linux/i.test(userAgent)) os = "Linux";

  return { device, browser, os };
}

/** Reads the current request's IP/User-Agent via `next/headers` — works
 * identically from Server Actions and Route Handlers, so callers (like
 * createSession/destroySession) never need a Request object threaded
 * through them. Never throws: returns an all-null context if headers()
 * isn't available in the calling context, so activity tracking can never
 * break the auth flow that uses it. */
export async function getRequestContext(): Promise<RequestContext> {
  try {
    const headerList = await headers();
    const rawUserAgent = headerList.get("user-agent");
    const userAgent = rawUserAgent ? rawUserAgent.slice(0, MAX_USER_AGENT_LENGTH) : null;
    const ipAddress = extractIpAddress(headerList);
    return { ipAddress, userAgent, ...parseUserAgent(userAgent) };
  } catch {
    return { ipAddress: null, userAgent: null, device: null, browser: null, os: null };
  }
}
