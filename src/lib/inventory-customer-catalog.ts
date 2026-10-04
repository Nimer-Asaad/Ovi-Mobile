import { buildAvailabilityTables, type AvailabilityBrand, type ProductAvailabilitySheet } from "@/lib/inventory-availability-sheet";

/** Pure layout for the CUSTOMER-FACING catalog image ("صورة للزبون").
 *
 * The data is the existing warehouse-only availability sheet (>= 5 in the
 * WAREHOUSE locations, REP_CAR never read) — this module never computes stock,
 * never touches the database and never sees a quantity. It only decides WHAT a
 * customer sees (brand + model, real colors) and WHERE it goes, as fixed pixel
 * geometry: every row has an exact height, every image an exact box, so the
 * renderer can size the canvas without measuring anything and nothing can be
 * clipped or overlap. */

export const CUSTOMER_IMAGE_WIDTH = 1080;
/** More brands than this are split into balanced stacked tables (4 -> one
 * 4-column table, 5 -> 3+2, 6 -> 3+3, 9 -> 3+3+3 ...), never a lone column. */
export const CUSTOMER_MAX_BRAND_COLUMNS = 4;
export const CUSTOMER_MAX_IMAGES = 3;

const SIDE_MARGIN = 40;
const CONTENT_WIDTH = CUSTOMER_IMAGE_WIDTH - SIDE_MARGIN * 2;
const SINGLE_BRAND_TABLE_WIDTH = 560;
const SECTION_GAP = 36;
const TITLE_TEXT_WIDTH = CONTENT_WIDTH - 40;
const HEAD_MIN_HEIGHT = 72;
const ROW_MIN_HEIGHT = 66;
const CELL_PAD_X = 14;
const CELL_PAD_Y = 14;
const LINE_HEIGHT = 1.2;
/** Last resort for a single unbreakable token wider than its cell (e.g. a
 * 30+ character hyphenated model name): shrink it rather than let it overflow. */
const MIN_FALLBACK_FONT_SIZE = 12;
const MIN_SLOT_WIDTH = 250;
const MIN_SLOT_HEIGHT = 210;
const SLOT_PAD = 16;
const FOOTER_BAR_HEIGHT = 14;
const BOTTOM_PAD = 40;
/** Outer frame of a table (drawn as a border; the renderer is border-box). */
const TABLE_FRAME = 3;

/** Labels that describe HOW a variant is stocked, not WHICH phone it fits —
 * never shown to a customer as a model/color suffix. Whole-label match only,
 * after normalising Arabic diacritics ("مشكّل" == "مشكل"). A real product NAME
 * is never filtered — this only ever sees per-model color metadata. */
const GENERIC_CUSTOMER_LABELS: ReadonlySet<string> = new Set(["شفاف", "مشكل", "assorted", "generic", "mixed"]);

export function normalizeCustomerLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isGenericCustomerLabel(label: string): boolean {
  const normalized = normalizeCustomerLabel(label);
  return normalized === "" || GENERIC_CUSTOMER_LABELS.has(normalized);
}

/** Customer copy of the sheet's brands: only per-model color metadata is
 * cleaned; brand names, model names and which models exist are untouched. */
export function customerBrandsFromSheet(brands: AvailabilityBrand[]): AvailabilityBrand[] {
  return brands.map((brand) => ({
    ...brand,
    models: brand.models.map((model) => ({ ...model, colors: model.colors.filter((color) => !isGenericCustomerLabel(color.label)) })),
  }));
}

export interface CatalogMediaRow {
  url: string | null;
  mediaType: string;
  isMain: boolean;
  sortOrder: number;
}

/** Deterministic image pick: IMAGE rows only (never video), main first then
 * sortOrder, the same URL never twice, at most CUSTOMER_MAX_IMAGES. */
export function selectCustomerImageUrls(rows: CatalogMediaRow[], max: number = CUSTOMER_MAX_IMAGES): string[] {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.mediaType.toUpperCase() === "IMAGE" && typeof row.url === "string" && row.url.trim() !== "")
    .sort((a, b) => Number(b.row.isMain) - Number(a.row.isMain) || a.row.sortOrder - b.row.sortOrder || a.index - b.index);
  const urls: string[] = [];
  for (const { row } of ordered) {
    const url = row.url!.trim();
    if (!urls.includes(url)) urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

/** Safe download name: "<SKU>-models.png". */
export function customerImageFilename(sku: string): string {
  const safe = sku.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  return `${safe || "product"}-models.png`;
}

// ---------------------------------------------------------------------------
// Right-to-left text. The image renderer (Satori) shapes Arabic letters
// correctly but lays WORDS out left-to-right, and draws Arabic word spaces far
// too wide. So a line is split into display ITEMS (every Arabic word on its
// own; an embedded Latin/number run kept whole, with its own spaces) that the
// renderer lays out in a row-reverse flex row with a controlled gap — the
// logical order below is exactly the right-to-left reading order.
// ---------------------------------------------------------------------------

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

/** Logical-order display items of one line. Text without Arabic is a single item. */
export function splitBidiItems(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!hasArabic(text)) return words.length > 0 ? [words.join(" ")] : [""];
  const items: string[] = [];
  let latinRun: string[] = [];
  const flush = () => {
    if (latinRun.length > 0) items.push(latinRun.join(" "));
    latinRun = [];
  };
  for (const word of words) {
    if (hasArabic(word)) {
      flush();
      items.push(word);
    } else {
      latinRun.push(word);
    }
  }
  flush();
  return items;
}

/** Gap between display items, as a fraction of the font size. */
export const RTL_ITEM_GAP_EM = 0.12;

// ---------------------------------------------------------------------------
// Text fitting. Widths are estimated per character class (calibrated on
// Tajawal) with a deliberate safety margin: a row/heading is sized for the
// number of lines it really needs, so text can wrap but never clip.
// ---------------------------------------------------------------------------

export function estimateTextWidth(text: string, fontSize: number, options: { bold?: boolean; uppercase?: boolean } = {}): number {
  // Per-character widths in em, measured with the real renderer on Tajawal
  // (Latin lower ~0.49, upper ~0.57, digits ~0.49). Arabic is the BOX Satori
  // allots, not the ink: 0.6-0.93 em per letter (it sizes unjoined glyphs), so
  // 0.85 is used. Plus a 3% safety margin.
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 0.26;
    else if (ARABIC_RE.test(char)) width += 0.85;
    else if (/[A-Z]/.test(char) || (options.uppercase && /[a-z]/.test(char))) width += 0.58;
    else if (/[a-z]/.test(char)) width += 0.5;
    else if (/[0-9]/.test(char)) width += 0.5;
    else width += 0.46;
  }
  return width * fontSize * 1.03;
}

export interface TextBlock {
  /** Logical-order lines; the renderer lays each out via splitBidiItems. */
  lines: string[];
  fontSize: number;
  lineHeight: number;
  height: number;
}

export interface FitTextOptions {
  maxFontSize: number;
  singleLineMinFontSize: number;
  multiLineMinFontSize: number;
  maxLines: number;
  bold?: boolean;
  uppercase?: boolean;
}

function wrapWords(words: string[], width: number, fontSize: number, options: FitTextOptions): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, fontSize, options) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function block(lines: string[], fontSize: number): TextBlock {
  const lineHeight = Math.round(fontSize * LINE_HEIGHT);
  return { lines, fontSize, lineHeight, height: lines.length * lineHeight };
}

/** One line at the largest size that fits; else wrapped (up to maxLines) at the
 * largest size that fits; else — a pathological unbreakable token — the largest
 * size at which even the longest word fits, with as many lines as needed. The
 * returned height always covers every line, so nothing is ever clipped. */
export function fitText(text: string, width: number, options: FitTextOptions): TextBlock {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  if (words.length === 0) return block([""], options.maxFontSize);

  for (let size = options.maxFontSize; size >= options.singleLineMinFontSize; size -= 2) {
    if (estimateTextWidth(clean, size, options) <= width) return block([clean], size);
  }
  if (options.maxLines > 1) {
    for (let size = options.singleLineMinFontSize; size >= options.multiLineMinFontSize; size -= 2) {
      const lines = wrapWords(words, width, size, options);
      if (lines.length <= options.maxLines && words.every((word) => estimateTextWidth(word, size, options) <= width)) return block(lines, size);
    }
  }
  for (let size = options.multiLineMinFontSize; size >= MIN_FALLBACK_FONT_SIZE; size -= 2) {
    if (words.every((word) => estimateTextWidth(word, size, options) <= width) || size === MIN_FALLBACK_FONT_SIZE) {
      return block(wrapWords(words, width, size, options), size);
    }
  }
  return block(wrapWords(words, width, MIN_FALLBACK_FONT_SIZE, options), MIN_FALLBACK_FONT_SIZE);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface CatalogCell {
  model: TextBlock;
  /** Real (non-generic) colors only — DEVICE_MODEL_COLOR; null otherwise. */
  colors: TextBlock | null;
}

/** A rectangle inside a table body, in pixels from the body's top-left. */
export interface CatalogImageSlot {
  firstColumn: number;
  columnCount: number;
  top: number;
  width: number;
  height: number;
}

export interface CatalogTable {
  width: number;
  columnWidth: number;
  headHeight: number;
  brands: { id: string; text: TextBlock }[];
  rowHeights: number[];
  /** rows[r][c]: the r-th model of brand column c, or null when it has fewer. */
  rows: (CatalogCell | null)[][];
  bodyHeight: number;
  /** The product photo, placed in the free area under the shorter columns. */
  imageSlot: CatalogImageSlot | null;
  /** head + body + the outer frame (TABLE_FRAME on every side). */
  height: number;
}

export interface CatalogImageBox {
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CatalogLayout {
  width: number;
  height: number;
  titleHeight: number;
  brandLine: string;
  title: TextBlock;
  sku: string;
  tables: CatalogTable[];
  /** Index (into the image list) of the picture placed inside a table, or null. */
  slotImageIndex: number | null;
  collage: { width: number; height: number; boxes: CatalogImageBox[] } | null;
  sectionGap: number;
  bottomPad: number;
  footerBarHeight: number;
  /** Pixel size to pre-scale each image to (contain-fit) — one entry per image. */
  imageBoxes: { width: number; height: number }[];
}

/** One model font size for the whole table (looks like a printed sheet, not a
 * ragged list): the largest size (32 down to 26) at which EVERY model fits on
 * one line. When some name is longer than that, the table stays at 26 and only
 * those outliers wrap (or shrink) — one unusually long name never makes every
 * other cell small. */
function uniformModelFontSize(table: { rows: ({ label: string } | null)[][] }, textWidth: number): number {
  for (let size = 32; size >= 26; size -= 2) {
    if (table.rows.every((row) => row.every((cell) => !cell || estimateTextWidth(cell.label, size) <= textWidth))) return size;
  }
  return 26;
}

function buildSlot(table: Pick<CatalogTable, "columnWidth" | "rowHeights" | "rows">, columnCount: number): CatalogImageSlot | null {
  const rowCount = table.rowHeights.length;
  const lengths = Array.from({ length: columnCount }, (_, column) => table.rows.reduce((count, row) => (row[column] ? count + 1 : count), 0));
  let best: (CatalogImageSlot & { area: number }) | null = null;
  for (let first = 0; first < columnCount; first++) {
    let tallest = 0;
    for (let last = first; last < columnCount; last++) {
      tallest = Math.max(tallest, lengths[last]!);
      if (tallest >= rowCount) break;
      const width = (last - first + 1) * table.columnWidth;
      const top = table.rowHeights.slice(0, tallest).reduce((sum, height) => sum + height, 0);
      const height = table.rowHeights.slice(tallest).reduce((sum, rowHeight) => sum + rowHeight, 0);
      if (width < MIN_SLOT_WIDTH || height < MIN_SLOT_HEIGHT) continue;
      const area = width * height;
      if (!best || area > best.area) best = { firstColumn: first, columnCount: last - first + 1, top, width, height, area };
    }
  }
  if (!best) return null;
  const { area: _area, ...slot } = best;
  void _area;
  return slot;
}

function collageFor(count: number, hasSlotImage: boolean): { height: number; boxes: Omit<CatalogImageBox, "imageIndex">[] } | null {
  if (count <= 0) return null;
  if (hasSlotImage) {
    if (count === 1) return { height: 400, boxes: [{ x: 250, y: 0, width: 500, height: 400 }] };
    return { height: 360, boxes: [{ x: 0, y: 0, width: 490, height: 360 }, { x: 510, y: 0, width: 490, height: 360 }] };
  }
  if (count === 1) return { height: 680, boxes: [{ x: 100, y: 0, width: 800, height: 680 }] };
  if (count === 2) return { height: 440, boxes: [{ x: 0, y: 0, width: 490, height: 440 }, { x: 510, y: 0, width: 490, height: 440 }] };
  return {
    height: 520,
    boxes: [
      { x: 0, y: 0, width: 590, height: 520 },
      { x: 610, y: 0, width: 390, height: 250 },
      { x: 610, y: 270, width: 390, height: 250 },
    ],
  };
}

export interface CatalogInput {
  /** The warehouse-only availability sheet (already filtered to >= 5). */
  sheet: ProductAvailabilitySheet;
  /** How many images (0..3) the renderer will actually be able to draw. */
  imageCount: number;
}

/** Null when there is nothing a customer could choose from (a simple stock
 * product, or no model reaches the warehouse minimum). */
export function buildCustomerCatalogLayout({ sheet, imageCount }: CatalogInput): CatalogLayout | null {
  if (sheet.mode === "TOTAL_STOCK" || !sheet.hasAvailability) return null;
  const showColors = sheet.mode === "DEVICE_MODEL_COLOR";
  const tables = buildAvailabilityTables(customerBrandsFromSheet(sheet.brands), showColors, CUSTOMER_MAX_BRAND_COLUMNS);
  if (tables.length === 0) return null;
  const images = Math.max(0, Math.min(CUSTOMER_MAX_IMAGES, Math.floor(imageCount)));

  const laidOut: CatalogTable[] = tables.map((table) => {
    const columnCount = table.brands.length;
    const width = columnCount === 1 ? SINGLE_BRAND_TABLE_WIDTH : Math.floor(CONTENT_WIDTH / columnCount) * columnCount;
    const columnWidth = width / columnCount;
    const textWidth = columnWidth - CELL_PAD_X * 2;

    const modelFontSize = uniformModelFontSize(table, textWidth);
    const brandBlocks = table.brands.map((brand) => ({
      id: brand.id,
      text: fitText(brand.label, textWidth, { maxFontSize: 30, singleLineMinFontSize: 22, multiLineMinFontSize: 20, maxLines: 2, uppercase: true }),
    }));
    const headHeight = Math.max(HEAD_MIN_HEIGHT, ...brandBlocks.map((brand) => brand.text.height + CELL_PAD_Y * 2));

    const rows = table.rows.map((row) =>
      row.map((cell): CatalogCell | null => {
        if (!cell) return null;
        const model = fitText(cell.label, textWidth, { maxFontSize: modelFontSize, singleLineMinFontSize: modelFontSize, multiLineMinFontSize: 20, maxLines: 2 });
        const colors =
          cell.colors.length > 0
            ? fitText(cell.colors.join(" · "), textWidth, { maxFontSize: 22, singleLineMinFontSize: 18, multiLineMinFontSize: 18, maxLines: 3, bold: false, uppercase: true })
            : null;
        return { model, colors };
      }),
    );
    const rowHeights = rows.map((row) =>
      Math.max(ROW_MIN_HEIGHT, ...row.map((cell) => (cell ? CELL_PAD_Y * 2 + cell.model.height + (cell.colors ? 6 + cell.colors.height : 0) : 0))),
    );
    const bodyHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    return { width, columnWidth, headHeight, brands: brandBlocks, rowHeights, rows, bodyHeight, imageSlot: null, height: headHeight + bodyHeight + TABLE_FRAME * 2 };
  });

  // The primary photo goes into the largest free rectangle under the shorter
  // columns of any table, when one is big enough to look intentional;
  // otherwise it joins the collage below the tables.
  let slotImageIndex: number | null = null;
  if (images > 0) {
    let bestTable = -1;
    let bestSlot: CatalogImageSlot | null = null;
    laidOut.forEach((table, index) => {
      const slot = buildSlot(table, table.brands.length);
      if (slot && (!bestSlot || slot.width * slot.height > bestSlot.width * bestSlot.height)) {
        bestSlot = slot;
        bestTable = index;
      }
    });
    if (bestSlot && bestTable >= 0) {
      laidOut[bestTable]!.imageSlot = bestSlot;
      slotImageIndex = 0;
    }
  }

  const remaining = images - (slotImageIndex === null ? 0 : 1);
  const collageSpec = collageFor(remaining, slotImageIndex !== null);
  const firstCollageImage = slotImageIndex === null ? 0 : 1;
  const collage = collageSpec
    ? {
        width: CONTENT_WIDTH,
        height: collageSpec.height,
        boxes: collageSpec.boxes.map((box, index) => ({ ...box, imageIndex: firstCollageImage + index })),
      }
    : null;

  const title = fitText(sheet.product.nameAr?.trim() || sheet.product.name, TITLE_TEXT_WIDTH, {
    maxFontSize: 62,
    singleLineMinFontSize: 44,
    multiLineMinFontSize: 36,
    maxLines: 3,
  });
  const brandLine = "OVI MOBILE";
  const titleHeight = 40 + 28 + 16 + title.height + 14 + 30 + 38;

  const imageBoxes: { width: number; height: number }[] = [];
  const slotTable = laidOut.find((table) => table.imageSlot);
  if (slotImageIndex !== null && slotTable?.imageSlot) {
    imageBoxes[0] = { width: slotTable.imageSlot.width - SLOT_PAD * 2, height: slotTable.imageSlot.height - SLOT_PAD * 2 };
  }
  for (const box of collage?.boxes ?? []) imageBoxes[box.imageIndex] = { width: box.width - SLOT_PAD * 2, height: box.height - SLOT_PAD * 2 };

  const tablesHeight = laidOut.reduce((sum, table) => sum + table.height, 0) + SECTION_GAP * Math.max(0, laidOut.length - 1);
  const height = titleHeight + SECTION_GAP + tablesHeight + (collage ? SECTION_GAP + collage.height : 0) + BOTTOM_PAD + FOOTER_BAR_HEIGHT;

  return {
    width: CUSTOMER_IMAGE_WIDTH,
    height,
    titleHeight,
    brandLine,
    title,
    sku: sheet.product.sku,
    tables: laidOut,
    slotImageIndex,
    collage,
    sectionGap: SECTION_GAP,
    bottomPad: BOTTOM_PAD,
    footerBarHeight: FOOTER_BAR_HEIGHT,
    imageBoxes,
  };
}

export const CATALOG_SLOT_PAD = SLOT_PAD;
export const CATALOG_TABLE_FRAME = TABLE_FRAME;
