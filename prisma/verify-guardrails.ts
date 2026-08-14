/**
 * Shared safety guardrails for every prisma/verify-*.ts script in this
 * project. A verify script runs destructive operations (create/delete rows,
 * apply migrations) — this module is the single place that decides whether
 * a given connection string is a legitimate, isolated, disposable test
 * database before any script is allowed to touch it. Never edit a verify
 * script to bypass or duplicate this logic; import it instead, so every
 * script gets the same protection and a single fix covers all of them.
 *
 * Checks enforced, all must pass:
 *  1. The env var name the caller asks for must actually be set — verify
 *     scripts never fall back to DATABASE_URL/DIRECT_URL.
 *  2. The connection string must parse as a URL.
 *  3. The database name (URL pathname) must contain "verify" (case
 *     insensitive) — a lightweight but effective guard against pointing at
 *     a normally-named database by mistake.
 *  4. The host must be localhost/127.0.0.1/::1, OR — for a real remote test
 *     server — must exactly match INVENTORY_TRACKING_VERIFY_ALLOWED_HOST,
 *     an env var the operator must set *in addition to* the connection
 *     string itself. Requiring the host twice (once inside the URL, once as
 *     a standalone confirmation) is a deliberate double opt-in: a single
 *     copy-pasted non-local URL is never enough on its own to unlock a
 *     remote target.
 *  5. The resolved string must not equal the project's real DATABASE_URL —
 *     checked both as an already-exported process.env.DATABASE_URL (covers
 *     hosting/CI environments that inject it) and by reading the literal
 *     value out of a local .env file if one exists (covers local dev, where
 *     a plain `tsx` script never auto-loads .env). Comparison is done both
 *     as a raw string and as parsed host+port+pathname, so cosmetic
 *     differences (trailing slash, query string order) can't slip past it.
 *
 * Nothing here ever prints a full connection string — only a masked form
 * with credentials stripped, safe to log.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export class VerifyGuardrailError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_HOST_ENV_VAR = "INVENTORY_TRACKING_VERIFY_ALLOWED_HOST";

/** Strips userinfo (user:pass@) and query string — safe to print/log. */
export function maskDbUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<unparseable-url>";
  }
}

/** Reads a single key's raw value out of a .env file without loading or
 * evaluating the rest of the file, and without any external dependency.
 * Returns null if the file or key doesn't exist. Deliberately minimal — it
 * only needs to support `KEY=value` / `KEY="value"` lines, which is all
 * this project's .env ever contains. */
function readDotEnvValue(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const lineKey = trimmed.slice(0, eq).trim();
    if (lineKey !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function parsedEquals(a: URL, b: URL): boolean {
  return a.hostname === b.hostname && a.port === b.port && a.pathname === b.pathname;
}

/** Collects every value that must NOT match the verify URL: whatever is
 * already in process.env.DATABASE_URL/DIRECT_URL (covers CI/hosting), plus
 * whatever a local .env file (if present) declares for those same keys
 * (covers local dev, since a plain tsx invocation never auto-loads .env). */
function collectRealDatabaseUrls(): string[] {
  const candidates: (string | null | undefined)[] = [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    readDotEnvValue(resolve(process.cwd(), ".env"), "DATABASE_URL"),
    readDotEnvValue(resolve(process.cwd(), ".env"), "DIRECT_URL"),
    readDotEnvValue(resolve(process.cwd(), ".env.local"), "DATABASE_URL"),
    readDotEnvValue(resolve(process.cwd(), ".env.local"), "DIRECT_URL"),
  ];
  return candidates.filter((value): value is string => Boolean(value && value.trim()));
}

export interface ResolvedVerifyDatabase {
  /** The raw, full connection string — pass this to the process env right
   * before connecting. Never log this value directly; use `masked`. */
  url: string;
  /** Safe to print: host + port + database name only. */
  masked: string;
}

/**
 * Validates and returns the verify database connection string read from
 * `envVarName`. Throws VerifyGuardrailError with a clear, specific message
 * if any check fails. Callers must call this before importing/using
 * @prisma/client or touching the database in any way.
 */
export function resolveVerifyDatabaseUrl(envVarName: string): ResolvedVerifyDatabase {
  const rawUrl = process.env[envVarName];
  if (!rawUrl || !rawUrl.trim()) {
    throw new VerifyGuardrailError(
      `Set ${envVarName} to a disposable PostgreSQL database whose name contains "verify". ` +
        `This script never falls back to DATABASE_URL/DIRECT_URL.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new VerifyGuardrailError(`${envVarName} is not a valid connection URL.`);
  }

  if (!parsed.pathname.toLowerCase().includes("verify")) {
    throw new VerifyGuardrailError(
      `${envVarName} must point at a database whose name contains "verify" (got database "${parsed.pathname.replace(/^\//, "")}").`,
    );
  }

  const isLocalHost = LOCAL_HOSTS.has(parsed.hostname);
  if (!isLocalHost) {
    const allowedHost = process.env[ALLOWED_HOST_ENV_VAR];
    if (!allowedHost || allowedHost !== parsed.hostname) {
      throw new VerifyGuardrailError(
        `${envVarName} points at host "${parsed.hostname}", which is not localhost. ` +
          `To explicitly authorize a real test server, also set ${ALLOWED_HOST_ENV_VAR}="${parsed.hostname}" ` +
          `(the host must be named twice — once in the URL, once here — as a deliberate double opt-in). ` +
          `Never point this at a production or shared database.`,
      );
    }
  }

  for (const realUrl of collectRealDatabaseUrls()) {
    if (realUrl === rawUrl) {
      throw new VerifyGuardrailError(
        `${envVarName} is identical to a configured DATABASE_URL/DIRECT_URL. Refusing to run — ` +
          `verify scripts must never point at the same database as the application.`,
      );
    }
    try {
      if (parsedEquals(parsed, new URL(realUrl))) {
        throw new VerifyGuardrailError(
          `${envVarName} resolves to the same host+port+database as a configured DATABASE_URL/DIRECT_URL ` +
            `(only credentials differ). Refusing to run — verify scripts must never point at the same ` +
            `database as the application.`,
        );
      }
    } catch (err) {
      if (err instanceof VerifyGuardrailError) throw err;
      // realUrl didn't parse as a URL — nothing to compare, ignore it.
    }
  }

  return { url: rawUrl, masked: maskDbUrl(rawUrl) };
}
