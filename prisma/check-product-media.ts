/**
 * Read-only dry-run audit of every ProductImage row against the local
 * filesystem. Never writes to the database and never deletes/modifies any
 * file — purely reports what it finds, so a human can decide whether any
 * stored URL actually needs fixing.
 *
 * For each row, reports:
 * - Product SKU
 * - Current stored URL
 * - Whether that URL "looks" correct (starts with /uploads/products/ or
 *   /products/, uses forward slashes, isn't an absolute filesystem path)
 * - Whether the referenced file actually exists on disk under public/
 *   (for http(s) URLs, existence isn't checked here — those point off-server)
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/check-product-media.ts
 *
 * This performs no writes under any flag — there is no --confirm mode,
 * intentionally, because fixing a broken URL requires a human decision
 * (re-upload vs. relink vs. remove), not an automated guess.
 */

import { existsSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function classifyUrl(url: string): { wellFormed: boolean; note: string } {
  if (/^https?:\/\//i.test(url)) {
    return { wellFormed: true, note: "external URL (not checked on disk)" };
  }
  if (url.includes("\\")) {
    return { wellFormed: false, note: "contains a Windows backslash — never a valid public URL" };
  }
  if (/^[A-Za-z]:[\\/]/.test(url)) {
    return { wellFormed: false, note: "looks like an absolute Windows filesystem path" };
  }
  if (/^Items[\\/]/i.test(url)) {
    return { wellFormed: false, note: "points into Items/ — not a public/ path, never web-servable" };
  }
  if (url.startsWith("/uploads/products/") || url.startsWith("/products/")) {
    return { wellFormed: true, note: "relative public/ path" };
  }
  return { wellFormed: false, note: "unrecognized URL shape" };
}

async function main() {
  const images = await prisma.productImage.findMany({
    select: {
      id: true,
      url: true,
      mediaType: true,
      isMain: true,
      product: { select: { sku: true, isActive: true } },
    },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
  });

  console.log(`Auditing ${images.length} ProductImage row(s)...\n`);

  let flaggedCount = 0;
  const flaggedRows: string[] = [];

  for (const img of images) {
    const { wellFormed, note } = classifyUrl(img.url);
    let existsOnDisk: boolean | "not-checked" = "not-checked";

    if (wellFormed && !/^https?:\/\//i.test(img.url)) {
      const diskPath = path.join(process.cwd(), "public", img.url.replace(/^\//, ""));
      existsOnDisk = existsSync(diskPath);
    }

    const isBroken = !wellFormed || existsOnDisk === false;
    if (isBroken) flaggedCount++;

    const line =
      `${isBroken ? "[BROKEN] " : "[ok]     "}` +
      `sku=${img.product.sku} active=${img.product.isActive} mediaType=${img.mediaType} isMain=${img.isMain}\n` +
      `           url="${img.url}"\n` +
      `           shape=${note}${existsOnDisk !== "not-checked" ? ` existsOnDisk=${existsOnDisk}` : ""}`;

    console.log(line);
    if (isBroken) flaggedRows.push(img.product.sku);
  }

  console.log(`\n${images.length} row(s) audited, ${flaggedCount} flagged as broken.`);
  if (flaggedRows.length > 0) {
    console.log("Flagged SKUs:", [...new Set(flaggedRows)].join(", "));
  }
  console.log("\nThis script made no changes. Nothing was written or deleted.");
}

main()
  .catch((e) => {
    console.error("Audit failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
