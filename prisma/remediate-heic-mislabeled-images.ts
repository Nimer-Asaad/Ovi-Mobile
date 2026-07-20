/**
 * One-time, narrowly-scoped remediation for exactly two known-broken
 * ProductImage files on SKU OVI-CASE-STN-001 ("Stanley Shock Collection"),
 * confirmed via live production investigation to be raw HEIC files saved
 * under fake .png/.jpg extensions by the upload pipeline that existed
 * before HEIC signature validation was added.
 *
 * This script is deliberately NOT a generic "scan and fix everything"
 * tool — it only ever touches the two exact files/rows hardcoded below.
 * It will refuse to run if either target doesn't match every expectation.
 *
 * Safety model:
 * - Defaults to --dry-run. Requires explicit --execute to write anything.
 * - Verifies file existence, then the file's real binary signature is
 *   actually HEIC, before doing anything else.
 * - Verifies the ProductImage row exists, its url matches, and its parent
 *   product's SKU is exactly OVI-CASE-STN-001, before doing anything else.
 * - Backs up each original file (byte-for-byte copy, size-verified) to a
 *   timestamped directory BEFORE any conversion happens.
 * - Converts via the exact same pipeline as new uploads (heic-convert -> a
 *   sharp pipeline: EXIF auto-rotate, cap 2400x2400 without upscaling,
 *   WebP quality 85, metadata stripped by not calling withMetadata()).
 * - Writes the new file under a fresh UUID name, then re-reads it from
 *   disk and re-validates its signature/size before ever touching the DB.
 * - Updates exactly one ProductImage row per file, inside its own
 *   transaction, re-asserting the row id AND the exact old url as an
 *   optimistic-concurrency guard (updateMany + count===1 check) — refuses
 *   to update anything if that row has changed since it was read.
 * - NEVER deletes the original file from public/uploads/products/. The
 *   original stays in place (now an unreferenced, harmless orphan — no
 *   ProductImage row points at it anymore) in addition to the explicit
 *   backup copy. Two independent copies survive every run.
 * - Any unexpected condition at any step aborts immediately (fail closed)
 *   with no partial/silent state — see fail().
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/remediate-heic-mislabeled-images.ts             # dry run (default)
 *   npx tsx --env-file=.env prisma/remediate-heic-mislabeled-images.ts --execute   # actually writes
 */

import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import convertHeic from "heic-convert";
import { PrismaClient } from "@prisma/client";
import { sniffMediaFormat } from "../src/lib/validation/productMedia";

const prisma = new PrismaClient();

const EXPECTED_SKU = "OVI-CASE-STN-001";
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "products");

/** The ONLY two files/rows this script will ever touch — hardcoded, never
 * discovered by scanning. Confirmed via production investigation. */
const TARGETS = [
  { filename: "46e1464a-6e60-4c87-aa0a-12c5c9c5ae32.png", url: "/uploads/products/46e1464a-6e60-4c87-aa0a-12c5c9c5ae32.png" },
  { filename: "4e206436-4873-4200-a771-9c1d86292595.jpg", url: "/uploads/products/4e206436-4873-4200-a771-9c1d86292595.jpg" },
] as const;

const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = !EXECUTE;

const MAX_IMAGE_DIMENSION_PX = 2400;
const WEBP_QUALITY = 85;
const HEIC_INTERMEDIATE_JPEG_QUALITY = 0.92;

function fail(message: string): never {
  console.error(`\nABORTED: ${message}`);
  console.error("No further changes were made beyond what was already logged above.");
  process.exit(1);
}

interface ReportRow {
  sku: string;
  productImageId: string;
  oldUrl: string;
  detectedFormat: string;
  outputUrl: string;
  sourceBytes: number;
  outputBytes: number | null;
  dbUpdateStatus: string;
}

function printReport(rows: ReportRow[]) {
  console.log("\n=== Remediation Report ===");
  for (const r of rows) {
    console.log(`SKU: ${r.sku}`);
    console.log(`ProductImage ID: ${r.productImageId}`);
    console.log(`Old URL: ${r.oldUrl}`);
    console.log(`Detected real format: ${r.detectedFormat}`);
    console.log(`Output URL: ${r.outputUrl}`);
    console.log(`Source file size: ${r.sourceBytes} bytes`);
    console.log(`Output file size: ${r.outputBytes ?? "n/a"} bytes`);
    console.log(`DB update status: ${r.dbUpdateStatus}`);
    console.log("---");
  }
}

function findTargetRow(url: string) {
  return prisma.productImage.findFirst({
    where: { url },
    include: { product: { select: { sku: true } } },
  });
}

async function convertHeicBufferToWebp(buffer: Buffer): Promise<Buffer> {
  const jpegOutput = await convertHeic({ buffer, format: "JPEG", quality: HEIC_INTERMEDIATE_JPEG_QUALITY });
  return sharp(Buffer.from(jpegOutput))
    .rotate()
    .resize({ width: MAX_IMAGE_DIMENSION_PX, height: MAX_IMAGE_DIMENSION_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes will be made)" : "EXECUTE (will write files and update the database)"}`);
  console.log(`Scope: exactly ${TARGETS.length} file(s)/row(s), SKU ${EXPECTED_SKU}\n`);

  // --- Step 1+2: file existence + real HEIC signature, for every target,
  // before anything else happens. ---
  const verified: { filename: string; url: string; diskPath: string; buffer: Buffer; sourceFormat: string }[] = [];
  for (const target of TARGETS) {
    const diskPath = path.join(UPLOAD_DIR, target.filename);
    if (!existsSync(diskPath)) {
      fail(`File does not exist on disk: ${diskPath}`);
    }
    const buffer = readFileSync(diskPath);
    const sniffed = sniffMediaFormat(buffer);
    if (sniffed !== "heic") {
      fail(
        `File ${target.filename} does not have a HEIC signature (detected: ${sniffed}). ` +
          `This script only touches files that match the confirmed defect — refusing to proceed.`,
      );
    }
    console.log(`[verified] ${target.filename} — exists on disk, real signature = HEIC, ${buffer.length} bytes`);
    verified.push({ filename: target.filename, url: target.url, diskPath, buffer, sourceFormat: sniffed });
  }

  // --- Step 3: DB linkage — row must exist, url must match, product must
  // be exactly the expected SKU. Never queries/touches any other row. ---
  const dbRows: { id: string; url: string; sku: string; isMain: boolean; mediaType: string }[] = [];
  for (const target of verified) {
    let row: Awaited<ReturnType<typeof findTargetRow>>;
    try {
      row = await findTargetRow(target.url);
    } catch (err) {
      fail(
        `Database query failed while verifying ${target.url}: ${err instanceof Error ? err.message : String(err)}. ` +
          `No files were changed, no DB rows were touched.`,
      );
    }
    if (!row) {
      fail(`No ProductImage row found with url = "${target.url}". Refusing to proceed without a confirmed DB match.`);
    }
    if (row.product.sku !== EXPECTED_SKU) {
      fail(
        `ProductImage ${row.id} (url ${target.url}) belongs to SKU "${row.product.sku}", not the expected ` +
          `"${EXPECTED_SKU}". Refusing to touch a row outside the confirmed scope.`,
      );
    }
    console.log(`[verified] ${target.url} -> ProductImage id=${row.id}, sku=${row.product.sku}, isMain=${row.isMain}`);
    dbRows.push({ id: row.id, url: row.url, sku: row.product.sku, isMain: row.isMain, mediaType: row.mediaType });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(UPLOAD_DIR, "_backup-heic-remediation", timestamp);
  console.log(`\nBackup directory: ${backupDir}${DRY_RUN ? " (dry run — not created)" : ""}`);

  const rows: ReportRow[] = [];

  if (verified.length !== dbRows.length) {
    fail(`Internal consistency check failed: ${verified.length} file(s) verified but ${dbRows.length} DB row(s) matched.`);
  }
  const pairs = verified.map((v, i) => {
    const row = dbRows[i];
    if (!row) fail(`Internal consistency check failed: no DB row at index ${i} for ${v.filename}.`);
    return { v, row };
  });

  if (DRY_RUN) {
    for (const { v, row } of pairs) {
      let outputBytes: number | null = null;
      try {
        outputBytes = (await convertHeicBufferToWebp(v.buffer)).length;
      } catch (err) {
        fail(
          `Conversion preview failed for ${v.filename}: ${err instanceof Error ? err.message : String(err)}. ` +
            `This would also fail in --execute mode — fix the underlying issue before running --execute.`,
        );
      }
      rows.push({
        sku: row.sku,
        productImageId: row.id,
        oldUrl: v.url,
        detectedFormat: v.sourceFormat,
        outputUrl: "(preview only — not written in dry run)",
        sourceBytes: v.buffer.length,
        outputBytes,
        dbUpdateStatus: "NOT APPLIED (dry run)",
      });
    }
    printReport(rows);
    console.log("\nDRY RUN complete. No files were written, no backups made, no database rows changed.");
    console.log("Re-run with --execute (against a real, reachable database and filesystem) to apply.");
    return;
  }

  // --- EXECUTE mode ---
  mkdirSync(backupDir, { recursive: true });

  for (const { v, row } of pairs) {
    // Step 4: backup BEFORE any mutation, and verify the backup itself.
    const backupPath = path.join(backupDir, v.filename);
    copyFileSync(v.diskPath, backupPath);
    if (!existsSync(backupPath) || statSync(backupPath).size !== v.buffer.length) {
      fail(`Backup verification failed for ${v.filename} — refusing to proceed without a confirmed, byte-exact backup.`);
    }
    console.log(`[backup] ${v.filename} -> ${backupPath} (${statSync(backupPath).size} bytes, verified)`);

    // Step 5: convert (HEIC decode -> EXIF auto-rotate -> resize <=2400,
    // no upscale -> WebP q85 -> metadata stripped by default).
    let webpBuffer: Buffer;
    try {
      webpBuffer = await convertHeicBufferToWebp(v.buffer);
    } catch (err) {
      fail(
        `HEIC conversion failed for ${v.filename}: ${err instanceof Error ? err.message : String(err)}. ` +
          `Original file at ${v.diskPath} and the database were NOT touched. Backup remains at ${backupPath}.`,
      );
    }

    // Step 6: new UUID filename — never derived from the old filename.
    const newFilename = `${randomUUID()}.webp`;
    const newDiskPath = path.join(UPLOAD_DIR, newFilename);
    const newUrl = `/uploads/products/${newFilename}`;

    writeFileSync(newDiskPath, webpBuffer);

    // Step 9 (validation before DB write): re-read from disk and confirm
    // it's really a valid WebP of the expected size before the DB is ever
    // touched.
    const writtenBuffer = readFileSync(newDiskPath);
    const writtenSignature = sniffMediaFormat(writtenBuffer);
    if (writtenSignature !== "webp" || writtenBuffer.length !== webpBuffer.length) {
      fail(
        `Output file validation failed for ${newFilename} (signature=${writtenSignature}, size=${writtenBuffer.length} ` +
          `vs expected ${webpBuffer.length}) — refusing to update the database. Original file at ${v.diskPath} is ` +
          `untouched; backup is at ${backupPath}.`,
      );
    }
    console.log(`[converted] ${v.filename} (${v.buffer.length}B, HEIC) -> ${newFilename} (${writtenBuffer.length}B, WebP, validated)`);

    // Step 7+8: update exactly this one row, inside its own transaction,
    // re-asserting id AND the exact old url as an optimistic-concurrency
    // guard against a concurrent change.
    let dbUpdateStatus = "FAILED";
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.productImage.updateMany({
          where: { id: row.id, url: v.url },
          data: { url: newUrl },
        });
        if (updated.count !== 1) {
          throw new Error(`Expected to update exactly 1 row (id=${row.id}), matched ${updated.count} — the row may have changed concurrently.`);
        }
      });
      dbUpdateStatus = "OK";
      console.log(`[db] ProductImage ${row.id} url updated: ${v.url} -> ${newUrl}`);
    } catch (err) {
      fail(
        `Database update failed for ProductImage ${row.id}: ${err instanceof Error ? err.message : String(err)}. ` +
          `The converted file was written to ${newDiskPath} but is NOT referenced by any ProductImage row — safe to ` +
          `delete manually if you want, or investigate first. The original file at ${v.diskPath} was never touched.`,
      );
    }

    // Step 9 (deletion policy) / Step 10: the original is deliberately
    // NEVER deleted from the live uploads directory — it is simply no
    // longer referenced by any ProductImage row after the update above. It
    // now exists twice, harmlessly: once in place, once in the backup dir.
    rows.push({
      sku: row.sku,
      productImageId: row.id,
      oldUrl: v.url,
      detectedFormat: v.sourceFormat,
      outputUrl: newUrl,
      sourceBytes: v.buffer.length,
      outputBytes: webpBuffer.length,
      dbUpdateStatus,
    });
  }

  printReport(rows);
  console.log(`\nEXECUTE complete. Originals backed up to: ${backupDir}`);
  console.log("Originals were also left in place at their original path (not deleted) as an extra safety margin.");
}

main()
  .catch((e) => {
    console.error("Unexpected error:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
