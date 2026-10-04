import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement as h, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { loadProductAvailabilitySheet } from "@/lib/inventory-availability-sheet";
import {
  CATALOG_FRAME,
  CATALOG_PAGE,
  CATALOG_ZONE_GAP,
  CATALOG_ZONE_PAD,
  CUSTOMER_MAX_IMAGES,
  RTL_ITEM_GAP_EM,
  chooseImageFit,
  hasArabic,
  planCustomerCatalog,
  selectCustomerImageUrls,
  splitBidiItems,
  type CatalogColumn,
  type CatalogLayout,
  type CatalogTable,
  type TextBlock,
} from "@/lib/inventory-customer-catalog";

/** Server side of the customer catalog image: loads the warehouse-only
 * availability sheet + the product's IMAGE media, then renders ONE A4 sheet
 * (1240x1754 PNG) from that data — Satori via next/og (already part of Next,
 * no new package) with the sharp already used for uploads preparing the
 * photos. READ-ONLY: nothing here writes to the database. */

const COLORS = {
  ink: "#111111",
  muted: "#3F4A5A",
  line: "#000000",
  titleBg: "#2E75B6",
  headBg: "#CFE0F3",
  rowEven: "#FFFFFF",
  rowOdd: "#E3EEF9",
  page: "#FFFFFF",
} as const;

const FONT_FILES = [
  { file: "Tajawal-Regular.ttf", weight: 400 },
  { file: "Tajawal-Bold.ttf", weight: 700 },
  { file: "Tajawal-ExtraBold.ttf", weight: 800 },
] as const;

type FontWeight = (typeof FONT_FILES)[number]["weight"];
let fontsPromise: Promise<{ name: string; data: Buffer; weight: FontWeight; style: "normal" }[]> | null = null;

/** The three Tajawal (SIL OFL) files shipped in src/assets/fonts — needed
 * because Arabic text cannot be drawn without a font that has the glyphs, and
 * a server has no guaranteed system fonts. */
function loadFonts() {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ({ file, weight }) => ({
      name: "Tajawal",
      data: await readFile(path.join(process.cwd(), "src", "assets", "fonts", file)),
      weight,
      style: "normal" as const,
    })),
  );
  return fontsPromise;
}

// ---------------------------------------------------------------------------
// Product photos
// ---------------------------------------------------------------------------

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

/** The raw bytes behind a stored image URL: a `/uploads/...`-style path from
 * the app's own public folder (path-traversal safe) or a public http(s) URL
 * (Cloudinary, pasted external links). Anything else yields null. */
async function readImageBytes(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/") && !url.startsWith("//")) {
      const publicDir = path.join(process.cwd(), "public");
      const resolved = path.resolve(publicDir, "." + decodeURIComponent(url.split("?")[0]!));
      if (!resolved.startsWith(publicDir + path.sep)) return null;
      return await readFile(resolved);
    }
    const parsed = new URL(url);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || PRIVATE_HOST_RE.test(parsed.hostname)) return null;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength > MAX_IMAGE_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

interface DecodedImage {
  bytes: Buffer;
  width: number;
  height: number;
}

/** Only photos that really decode are kept, so a dead link can never leave a
 * broken placeholder in the finished image. */
async function loadDecodableImages(urls: string[]): Promise<DecodedImage[]> {
  const loaded = await Promise.all(
    urls.map(async (url): Promise<DecodedImage | null> => {
      const bytes = await readImageBytes(url);
      if (!bytes) return null;
      try {
        const metadata = await sharp(bytes, { failOn: "none" }).rotate().metadata();
        const rotated = (metadata.orientation ?? 1) >= 5;
        const width = rotated ? metadata.height : metadata.width;
        const height = rotated ? metadata.width : metadata.height;
        return width && height ? { bytes, width, height } : null;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((image): image is DecodedImage => image !== null);
}

/** Exactly the pixel box the layout reserved: edge-to-edge (cover) when the
 * photo's proportions suit the box, otherwise contained on white — never
 * stretched. */
async function toDataUri(image: DecodedImage, box: { width: number; height: number }): Promise<string> {
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const fit = chooseImageFit(image.width, image.height, width, height);
  const jpeg = await sharp(image.bytes, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width, height, fit, position: "centre", background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Rendering (plain element objects — no JSX, so scripts can import this too)
// ---------------------------------------------------------------------------

const GRID_LINE = `1px solid ${COLORS.line}`;

function box(style: CSSProperties, ...children: ReactNode[]): ReactElement {
  return h("div", { style: { display: "flex", ...style } }, ...children);
}

/** One line of text. Latin-only lines are a single nowrap item; lines with
 * Arabic are a row-reverse flex row of display items (see splitBidiItems) so
 * the words read right-to-left with a controlled gap. */
function textLine(line: string, fontSize: number, style: CSSProperties): ReactElement {
  const lineHeight = Math.round(fontSize * 1.2);
  const items = splitBidiItems(line);
  const base: CSSProperties = { fontSize, lineHeight: `${lineHeight}px`, height: lineHeight, justifyContent: "center", whiteSpace: "nowrap", ...style };
  if (items.length === 1 && !hasArabic(line)) return box(base, line);
  return box({ ...base, flexDirection: "row-reverse", gap: Math.round(fontSize * RTL_ITEM_GAP_EM) }, ...items.map((item) => box({ whiteSpace: "nowrap" }, item)));
}

function titleBand(table: CatalogTable, block: TextBlock): ReactElement {
  return box(
    { width: table.width, height: table.titleHeight, backgroundColor: COLORS.titleBg, alignItems: "center", justifyContent: "center", flexDirection: "column", borderBottom: GRID_LINE },
    ...block.lines.map((line) => textLine(line, block.fontSize, { color: "#FFFFFF", fontWeight: 800 })),
  );
}

function headRow(table: CatalogTable, headHeight: number): ReactElement {
  return box(
    { flexDirection: "row", width: table.width, height: headHeight, backgroundColor: COLORS.headBg },
    ...table.columns.map((column, index) =>
      box(
        {
          width: table.columnWidth,
          height: headHeight,
          alignItems: "center",
          justifyContent: "center",
          borderBottom: GRID_LINE,
          ...(index < table.columns.length - 1 ? { borderRight: GRID_LINE } : {}),
        },
        textLine(column.brand.text, column.brand.fontSize, { fontWeight: 800, color: COLORS.ink, textTransform: "uppercase", letterSpacing: 1 }),
      ),
    ),
  );
}

interface ColumnOptions {
  rowHeights: number[];
  columnWidth: number;
  rowCount: number;
  /** Draw the column's right grid line (every column but the table's last). */
  rightLine: boolean;
  /** A photo zone or bottom zone follows, so the bottom line of the last row is needed. */
  lineBelow: boolean;
  /** Extra blank pixels under the column (leftover page height, see CatalogTable.extraHeight). */
  extraHeight: number;
}

/** One brand column: model cells (alternating white / light blue) then, when
 * the brand has fewer models than the table, ONE merged blank cell. */
function renderColumn(column: CatalogColumn, options: ColumnOptions): ReactElement {
  const { rowHeights, columnWidth, rowCount, rightLine, lineBelow, extraHeight } = options;
  const cells = column.cells.map((cell, rowIndex) => {
    const lastRowOfTable = rowIndex === rowCount - 1 && !lineBelow;
    const content = cell.colors
      ? box(
          { flexDirection: "row", alignItems: "center", gap: Math.round(cell.fontSize * 0.4) },
          textLine(cell.text, cell.fontSize, { fontWeight: 700, color: COLORS.ink }),
          textLine(`— ${cell.colors}`, cell.fontSize, { fontWeight: 400, color: COLORS.muted, textTransform: "uppercase" }),
        )
      : textLine(cell.text, cell.fontSize, { fontWeight: 700, color: COLORS.ink });
    return box(
      {
        width: columnWidth,
        height: rowHeights[rowIndex]!,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: rowIndex % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd,
        ...(lastRowOfTable ? {} : { borderBottom: GRID_LINE }),
        ...(rightLine ? { borderRight: GRID_LINE } : {}),
      },
      content,
    );
  });
  const tailPixels = rowHeights.slice(column.cells.length, column.cells.length + column.tailRows).reduce((sum, value) => sum + value, 0) + extraHeight;
  const tail =
    tailPixels > 0
      ? [box({ width: columnWidth, height: tailPixels, backgroundColor: COLORS.page, ...(lineBelow ? { borderBottom: GRID_LINE } : {}), ...(rightLine ? { borderRight: GRID_LINE } : {}) })]
      : [];
  return box({ flexDirection: "column", width: columnWidth }, ...cells, ...tail);
}

/** The photos, stacked vertically and filling the merged zone with only a
 * small gap — squared images, no card styling. */
function zoneImages(width: number, height: number, zone: NonNullable<CatalogTable["zone"]>, images: string[], rightLine: boolean): ReactElement {
  return box(
    { flexDirection: "column", width, height, backgroundColor: COLORS.page, padding: CATALOG_ZONE_PAD, gap: CATALOG_ZONE_GAP, ...(rightLine ? { borderRight: GRID_LINE } : {}) },
    ...zone.boxes.map((slot) =>
      images[slot.imageIndex] ? h("img", { src: images[slot.imageIndex], width: slot.width, height: slot.height }) : box({ width: slot.width, height: slot.height }),
    ),
  );
}

function renderTable(table: CatalogTable, layout: CatalogLayout, images: string[]): ReactElement {
  const zone = table.zone;
  const columnCount = table.columns.length;
  const options = { rowHeights: table.rowHeights, columnWidth: table.columnWidth, rowCount: table.rowCount };
  const bottomZone = zone?.kind === "BOTTOM" ? zone : null;

  const groups: ReactElement[] = [];
  for (let index = 0; index < columnCount; ) {
    const last = (end: number) => end === columnCount - 1;
    if (zone?.kind === "COLUMNS" && index === zone.firstColumn) {
      const end = index + zone.columnCount - 1;
      const top = box(
        { flexDirection: "row", width: zone.width },
        ...table.columns.slice(index, end + 1).map((column, offset) =>
          renderColumn(column, { ...options, rightLine: !(last(index + offset)), lineBelow: true, extraHeight: 0 }),
        ),
      );
      groups.push(box({ flexDirection: "column", width: zone.width }, top, zoneImages(zone.width, zone.height, zone, images, !last(end))));
      index = end + 1;
    } else {
      groups.push(renderColumn(table.columns[index]!, { ...options, rightLine: !last(index), lineBelow: bottomZone !== null, extraHeight: table.extraHeight }));
      index += 1;
    }
  }

  const body = box({ flexDirection: "row", width: table.width }, ...groups);
  const bottom = bottomZone ? [box({ width: table.width, borderTop: GRID_LINE }, zoneImages(table.width, bottomZone.height - 1, bottomZone, images, false))] : [];
  return box(
    { flexDirection: "column", width: table.width + CATALOG_FRAME * 2, height: table.height, border: `${CATALOG_FRAME}px solid ${COLORS.line}`, backgroundColor: COLORS.page },
    ...(table.title ? [titleBand(table, table.title)] : []),
    headRow(table, layout.headHeight),
    body,
    ...bottom,
  );
}

function renderCatalog(layout: CatalogLayout, images: string[]): ReactElement {
  return box(
    {
      flexDirection: "column",
      alignItems: "center",
      width: layout.width,
      height: layout.height,
      paddingTop: layout.marginTop,
      backgroundColor: COLORS.page,
      fontFamily: "Tajawal",
      color: COLORS.ink,
    },
    ...layout.tables.map((table, index) => box({ marginTop: index === 0 ? 0 : layout.tableGap }, renderTable(table, layout, images))),
  );
}

/** Draws a finished layout. `images` are the data URIs already prepared for
 * layout.imageBoxes (same order as the image list the layout was built for). */
export async function renderCustomerCatalogPng(layout: CatalogLayout, images: string[]): Promise<Buffer> {
  const response = new ImageResponse(renderCatalog(layout, images), { width: CATALOG_PAGE.width, height: CATALOG_PAGE.height, fonts: await loadFonts() });
  const png = Buffer.from(await response.arrayBuffer());
  // Hard guarantee: whatever happens upstream, a customer catalog is ALWAYS 1240x1754.
  if (png.readUInt32BE(16) !== CATALOG_PAGE.width || png.readUInt32BE(20) !== CATALOG_PAGE.height) {
    throw new Error("customer catalog must be exactly " + CATALOG_PAGE.width + "x" + CATALOG_PAGE.height);
  }
  return png;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type CustomerCatalogResult =
  | { ok: true; png: Buffer; sku: string; width: number; height: number; imageCount: number }
  /** TOO_LARGE: even the tightest legible arrangement cannot fit every model on ONE A4 sheet — the canvas is never enlarged, nothing is generated. */
  | { ok: false; reason: "NOT_FOUND" | "NO_MODELS" | "TOO_LARGE" };

/** Product -> warehouse availability (>= 5, REP_CAR never read) -> layout ->
 * PNG. The catalog never receives a quantity: the sheet only says which
 * models qualify. The SKU is used for the download filename only — it is never
 * drawn on the sheet. */
export async function generateCustomerCatalogPng(productId: string): Promise<CustomerCatalogResult> {
  const sheet = await loadProductAvailabilitySheet(productId);
  if (!sheet) return { ok: false, reason: "NOT_FOUND" };

  const mediaRows = await prisma.productImage.findMany({
    where: { productId },
    select: { url: true, mediaType: true, isMain: true, sortOrder: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 24,
  });
  const decodable = await loadDecodableImages(selectCustomerImageUrls(mediaRows, CUSTOMER_MAX_IMAGES));

  const plan = planCustomerCatalog({ sheet, imageCount: decodable.length });
  if (plan.status === "NONE") return { ok: false, reason: "NO_MODELS" };
  if (plan.status === "TOO_LARGE") return { ok: false, reason: "TOO_LARGE" };
  const layout = plan.layout;

  // Only the photos the layout actually found room for are prepared and drawn.
  const placed = layout.imageBoxes.length;
  const images = await Promise.all(layout.imageBoxes.map((slot, index) => (decodable[index] && index < placed ? toDataUri(decodable[index]!, slot) : Promise.resolve(""))));
  const png = await renderCustomerCatalogPng(layout, images);
  return { ok: true, png, sku: sheet.product.sku, width: layout.width, height: layout.height, imageCount: layout.imageBoxes.filter(Boolean).length };
}
