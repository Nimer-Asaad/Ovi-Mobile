import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement as h, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { loadProductAvailabilitySheet } from "@/lib/inventory-availability-sheet";
import {
  CATALOG_SLOT_PAD,
  CATALOG_TABLE_FRAME,
  CUSTOMER_MAX_IMAGES,
  buildCustomerCatalogLayout,
  selectCustomerImageUrls,
  RTL_ITEM_GAP_EM,
  hasArabic,
  splitBidiItems,
  type CatalogLayout,
  type CatalogTable,
  type TextBlock,
} from "@/lib/inventory-customer-catalog";

/** Server side of the customer catalog image: loads the warehouse-only
 * availability sheet + the product's IMAGE media, then renders one tall PNG
 * from that data (Satori via next/og — already part of Next, no new package —
 * with the sharp already used for uploads preparing the photos). READ-ONLY:
 * nothing here writes to the database. */

const COLORS = {
  ink: "#0F172A",
  muted: "#475569",
  navy: "#081827",
  line: "#0B1F33",
  accent: "#18B7D3",
  headBg: "#DCE6F2",
  rowEven: "#FFFFFF",
  rowOdd: "#EEF3F9",
  panel: "#F5F8FC",
  panelBorder: "#D2DBE8",
  skuOnNavy: "#9FB3C8",
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

/** Only photos that really decode are kept, so a dead link can never leave a
 * broken placeholder in the finished image. */
async function loadDecodableImages(urls: string[]): Promise<Buffer[]> {
  const loaded = await Promise.all(
    urls.map(async (url) => {
      const bytes = await readImageBytes(url);
      if (!bytes) return null;
      try {
        const metadata = await sharp(bytes, { failOn: "none" }).metadata();
        return metadata.width && metadata.height ? bytes : null;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((bytes): bytes is Buffer => bytes !== null);
}

/** Contain-fit on white at the exact pixel box the layout reserved. */
async function toDataUri(bytes: Buffer, box: { width: number; height: number }): Promise<string> {
  const jpeg = await sharp(bytes, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)), fit: "contain", background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Rendering (plain element objects — no JSX, so scripts can import this too)
// ---------------------------------------------------------------------------

function box(style: CSSProperties, ...children: ReactNode[]): ReactElement {
  return h("div", { style: { display: "flex", ...style } }, ...children);
}

/** One line of text. Latin-only lines are a single nowrap item; lines with
 * Arabic are a row-reverse flex row of display items (see splitBidiItems) so
 * the words read right-to-left with a controlled gap. */
function textLine(line: string, fontSize: number, lineHeight: number, style: CSSProperties): ReactElement {
  const items = splitBidiItems(line);
  const base: CSSProperties = { fontSize, lineHeight: `${lineHeight}px`, height: lineHeight, justifyContent: "center", whiteSpace: "nowrap", ...style };
  if (items.length === 1 && !hasArabic(line)) return box(base, line);
  return box(
    { ...base, flexDirection: "row-reverse", gap: Math.round(fontSize * RTL_ITEM_GAP_EM) },
    ...items.map((item) => box({ whiteSpace: "nowrap" }, item)),
  );
}

function textLines(block: TextBlock, style: CSSProperties): ReactElement {
  return box({ flexDirection: "column", alignItems: "center" }, ...block.lines.map((line) => textLine(line, block.fontSize, block.lineHeight, style)));
}

function renderTable(table: CatalogTable, images: string[]): ReactElement {
  const columnCount = table.brands.length;
  const head = box(
    { flexDirection: "row", width: table.width, height: table.headHeight, backgroundColor: COLORS.headBg },
    ...table.brands.map((brand, column) =>
      box(
        {
          width: table.columnWidth,
          height: table.headHeight,
          alignItems: "center",
          justifyContent: "center",
          borderBottom: `3px solid ${COLORS.line}`,
          ...(column < columnCount - 1 ? { borderRight: `2px solid ${COLORS.line}` } : {}),
        },
        textLines(brand.text, { fontWeight: 800, color: COLORS.ink, textTransform: "uppercase", letterSpacing: 1 }),
      ),
    ),
  );

  const rows = table.rows.map((row, rowIndex) =>
    box(
      { flexDirection: "row", width: table.width, height: table.rowHeights[rowIndex]!, backgroundColor: rowIndex % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd },
      ...row.map((cell, column) =>
        box(
          {
            width: table.columnWidth,
            height: table.rowHeights[rowIndex]!,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            ...(rowIndex < table.rows.length - 1 ? { borderBottom: `2px solid ${COLORS.line}` } : {}),
            ...(column < columnCount - 1 ? { borderRight: `2px solid ${COLORS.line}` } : {}),
          },
          ...(cell
            ? [
                textLines(cell.model, { fontWeight: 700, color: COLORS.ink }),
                ...(cell.colors ? [box({ height: 6 }), textLines(cell.colors, { fontWeight: 400, color: COLORS.muted, textTransform: "uppercase" })] : []),
              ]
            : []),
        ),
      ),
    ),
  );

  const slot = table.imageSlot;
  const slotElement =
    slot && images[0]
      ? box(
          {
            position: "absolute",
            left: slot.firstColumn * table.columnWidth,
            top: slot.top,
            width: slot.width,
            height: slot.height,
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
            borderTop: `2px solid ${COLORS.line}`,
            ...(slot.firstColumn + slot.columnCount < columnCount ? { borderRight: `2px solid ${COLORS.line}` } : {}),
          },
          h("img", { src: images[0], width: slot.width - CATALOG_SLOT_PAD * 2, height: slot.height - CATALOG_SLOT_PAD * 2, style: { objectFit: "contain" } }),
        )
      : null;

  const body = box({ position: "relative", flexDirection: "column", width: table.width, height: table.bodyHeight }, ...rows, ...(slotElement ? [slotElement] : []));
  return box(
    { flexDirection: "column", width: table.width + CATALOG_TABLE_FRAME * 2, height: table.height, border: `${CATALOG_TABLE_FRAME}px solid ${COLORS.line}`, backgroundColor: "#FFFFFF" },
    head,
    body,
  );
}

function renderCatalog(layout: CatalogLayout, images: string[]): ReactElement {
  const title = box(
    { position: "relative", flexDirection: "column", alignItems: "center", width: layout.width, height: layout.titleHeight, backgroundColor: COLORS.navy, paddingTop: 40 },
    box({ height: 28, fontSize: 22, fontWeight: 700, color: COLORS.accent, letterSpacing: 7 }, layout.brandLine),
    box({ height: 16 }),
    textLines(layout.title, { fontWeight: 800, color: "#FFFFFF" }),
    box({ height: 14 }),
    box({ height: 30, fontSize: 24, fontWeight: 400, color: COLORS.skuOnNavy, letterSpacing: 1 }, layout.sku),
    box({ position: "absolute", left: 0, bottom: 0, width: layout.width, height: 6, backgroundColor: COLORS.accent }),
  );

  const sections: ReactElement[] = [title];
  for (const table of layout.tables) {
    sections.push(box({ height: layout.sectionGap }));
    sections.push(box({ width: layout.width, justifyContent: "center" }, renderTable(table, images)));
  }
  if (layout.collage) {
    const collage = layout.collage;
    sections.push(box({ height: layout.sectionGap }));
    sections.push(
      box(
        { width: layout.width, justifyContent: "center" },
        box(
          { position: "relative", width: collage.width, height: collage.height },
          ...collage.boxes.map((slot) =>
            box(
              {
                position: "absolute",
                left: slot.x,
                top: slot.y,
                width: slot.width,
                height: slot.height,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: COLORS.panel,
                border: `2px solid ${COLORS.panelBorder}`,
                borderRadius: 18,
              },
              images[slot.imageIndex]
                ? h("img", { src: images[slot.imageIndex], width: slot.width - CATALOG_SLOT_PAD * 2, height: slot.height - CATALOG_SLOT_PAD * 2, style: { objectFit: "contain" } })
                : null,
            ),
          ),
        ),
      ),
    );
  }
  sections.push(box({ height: layout.bottomPad }));
  sections.push(box({ width: layout.width, height: layout.footerBarHeight, backgroundColor: COLORS.navy }));

  return box({ flexDirection: "column", width: layout.width, height: layout.height, backgroundColor: "#FFFFFF", fontFamily: "Tajawal", color: COLORS.ink }, ...sections);
}

/** Draws a finished layout. `images` are the data URIs already pre-scaled to
 * layout.imageBoxes (same order as the image list the layout was built for). */
export async function renderCustomerCatalogPng(layout: CatalogLayout, images: string[]): Promise<Buffer> {
  const response = new ImageResponse(renderCatalog(layout, images), { width: layout.width, height: layout.height, fonts: await loadFonts() });
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type CustomerCatalogResult =
  | { ok: true; png: Buffer; sku: string; width: number; height: number; imageCount: number }
  | { ok: false; reason: "NOT_FOUND" | "NO_MODELS" };

/** Product -> warehouse availability (>= 5, REP_CAR never read) -> layout ->
 * PNG. The catalog never receives a quantity: the sheet only says which
 * models qualify. */
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

  const layout = buildCustomerCatalogLayout({ sheet, imageCount: decodable.length });
  if (!layout) return { ok: false, reason: "NO_MODELS" };

  const images = await Promise.all(decodable.map((bytes, index) => (layout.imageBoxes[index] ? toDataUri(bytes, layout.imageBoxes[index]!) : Promise.resolve(""))));
  const png = await renderCustomerCatalogPng(layout, images);
  return { ok: true, png, sku: sheet.product.sku, width: layout.width, height: layout.height, imageCount: decodable.length };
}
