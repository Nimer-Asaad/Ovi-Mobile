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

const LINE_HEIGHT = 1.2;
/** Last resort for a single unbreakable token wider than its cell (e.g. a
 * 30+ character hyphenated model name): shrink it rather than let it overflow. */
const MIN_FALLBACK_FONT_SIZE = 12;

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
// Layout — ONE fixed A4 sheet in the style of a wholesaler's catalog table:
// a blue title band, one pale brand header row, compact alternating model
// rows, and the product photos MERGED into the unused area under the shorter
// brand columns (a rectangle of merged cells, not a card, not a blank grid).
//
// THE CANVAS NEVER GROWS. The page is always CATALOG_PAGE (1240 x 1754). When
// the models do not fit legibly the layout tightens in fixed steps (see
// planCustomerCatalog); if even the tightest step cannot fit, the result is
// TOO_LARGE — a controlled "cannot fit on one A4 sheet" state — never a taller
// image.
// ---------------------------------------------------------------------------

/** A4 portrait at 150 dpi. Every customer catalog is exactly this size. */
export const CATALOG_PAGE = { width: 1240, height: 1754 } as const;

/** Brand columns per table: 1-4 brands are always ONE table; more brands are
 * balanced over several tables on the same page (5 -> 3+2, 7 -> 4+3 ...). */
export const CUSTOMER_MAX_BRAND_COLUMNS = 4;
export const CUSTOMER_MAX_IMAGES = 3;

/** Fitting steps, tried in this order until the longest column fits:
 *  1-3 NORMAL chrome with 4, 5, then 6 brand columns per table (rebalancing
 *      brand groups only matters for 5+ brands);
 *  4-6 COMPACT chrome (smaller margins / title / header, tighter gaps), same
 *      three groupings, with a slightly lower row floor.
 * The row floor is the safe minimum: 22px rows (14px font) normally, 20px rows
 * (13px font) in COMPACT. Below that: TOO_LARGE. */
const FIT_GROUPINGS = [4, 5, 6] as const;
const CHROME = {
  NORMAL: { marginX: 64, marginTop: 52, marginBottom: 52, headHeight: 44, headFont: 24, titleMin: 52, titlePad: 22, tableGap: 24, rowMin: 22 },
  COMPACT: { marginX: 56, marginTop: 36, marginBottom: 36, headHeight: 36, headFont: 20, titleMin: 44, titlePad: 14, tableGap: 14, rowMin: 20 },
} as const;
export type CatalogDensity = keyof typeof CHROME;
export const CATALOG_CHROME = CHROME;
/** Outer frame; every other grid line is 1px. The renderer is border-box. */
export const CATALOG_FRAME = 2;
export const CATALOG_ZONE_PAD = 6;
export const CATALOG_ZONE_GAP = 6;

const ROW_MAX = 60;
const ROW_FONT_RATIO = 0.66;
const ROW_FONT_MIN = 13;
const ROW_FONT_MAX = 26;
const CELL_PAD_X = 6;
const ZONE_MIN_ROWS = 4;
const ZONE_MIN_HEIGHT = 140;
const ZONE_MIN_IMAGE_HEIGHT = 140;
const ZONE_IMAGE_WEIGHTS: Record<number, number[]> = { 1: [1], 2: [0.62, 0.38], 3: [0.5, 0.3, 0.2] };
const BOTTOM_ZONE_RESERVE = 0.26;
const BOTTOM_ZONE_MIN_HEIGHT = 160;
/** A bottom photo area is only reserved while rows stay at least this tall —
 * readability always wins over fitting a photo (very long lists show no photo). */
const BOTTOM_ZONE_MIN_ROW = 30;
const SINGLE_BRAND_MAX_WIDTH = 620;

/** The largest font size (down to the 12px last resort) at which `text` fits
 * on ONE line — an exceptionally long name shrinks alone, it never wraps. */
export function fitSingleLine(text: string, width: number, maxFontSize: number, options: { bold?: boolean; uppercase?: boolean } = {}): number {
  for (let size = maxFontSize; size > MIN_FALLBACK_FONT_SIZE; size -= 1) {
    if (estimateTextWidth(text, size, options) <= width) return size;
  }
  return MIN_FALLBACK_FONT_SIZE;
}

export interface CatalogLabel {
  text: string;
  fontSize: number;
}

export interface CatalogCell extends CatalogLabel {
  /** Real (non-generic) colors only, shown after the model — DEVICE_MODEL_COLOR. */
  colors: string | null;
}

export interface CatalogColumn {
  brand: CatalogLabel;
  cells: CatalogCell[];
  /** Rows below the last model that are neither a photo zone nor a model:
   * drawn as ONE merged blank cell, never as a grid of empty cells. */
  tailRows: number;
}

export interface CatalogImageBox {
  imageIndex: number;
  /** Inside the zone, excluding the zone padding. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CatalogZone {
  /** COLUMNS: merged under adjacent shorter columns, long columns continue
   * beside it. BOTTOM: merged across ALL columns below the last model row. */
  kind: "COLUMNS" | "BOTTOM";
  firstColumn: number;
  columnCount: number;
  /** Model rows above the zone in the columns it spans. */
  topRows: number;
  rows: number;
  width: number;
  height: number;
  boxes: CatalogImageBox[];
}

export interface CatalogTable {
  /** Inner width (frame excluded). */
  width: number;
  columnWidth: number;
  rowCount: number;
  /** Height of each model row: the base row height, +1px on the first few rows
   * when the page does not divide evenly, so the table fills the sheet exactly. */
  rowHeights: number[];
  columns: CatalogColumn[];
  zone: CatalogZone | null;
  /** Page height left over once the rows are placed (rows are capped at ROW_MAX),
   * given to the photo zone and, as one merged blank cell, to the other columns
   * — so a short product still fills the sheet instead of leaving a blank footer.
   * Zero whenever the leftover is small enough to be spread over the rows. */
  extraHeight: number;
  /** First table only: the merged full-width title band. */
  title: TextBlock | null;
  titleHeight: number;
  /** Outer height, frame included. */
  height: number;
}

export interface CatalogLayout {
  /** Always exactly CATALOG_PAGE — the type makes any other size a compile error. */
  width: typeof CATALOG_PAGE.width;
  height: typeof CATALOG_PAGE.height;
  density: CatalogDensity;
  headHeight: number;
  marginTop: number;
  rowHeight: number;
  rowFontSize: number;
  tableGap: number;
  tables: CatalogTable[];
  /** Pixel box each placed image is prepared for, by image index. */
  imageBoxes: { width: number; height: number }[];
}

/** Cover when the photo's proportions are close to its box (a cleanly cropped
 * edge-to-edge fill), contain otherwise (never distorted, never cut hard). */
export function chooseImageFit(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): "cover" | "contain" {
  const ratio = imageWidth / imageHeight / (boxWidth / boxHeight);
  return ratio >= 0.7 && ratio <= 1.43 ? "cover" : "contain";
}

function zoneBoxes(width: number, height: number, imageCount: number, borderRight: boolean): CatalogImageBox[] {
  const innerWidth = width - CATALOG_ZONE_PAD * 2 - (borderRight ? 1 : 0);
  let count = Math.min(imageCount, CUSTOMER_MAX_IMAGES);
  const heightFor = (k: number) => height - CATALOG_ZONE_PAD * 2 - CATALOG_ZONE_GAP * (k - 1);
  while (count > 1 && heightFor(count) * Math.min(...ZONE_IMAGE_WEIGHTS[count]!) < ZONE_MIN_IMAGE_HEIGHT) count--;
  if (count < 1) return [];
  const innerHeight = heightFor(count);
  const weights = ZONE_IMAGE_WEIGHTS[count]!;
  const boxes: CatalogImageBox[] = [];
  let y = CATALOG_ZONE_PAD;
  weights.forEach((weight, index) => {
    const boxHeight = index === weights.length - 1 ? CATALOG_ZONE_PAD + innerHeight + CATALOG_ZONE_GAP * (count - 1) - y : Math.floor(innerHeight * weight);
    boxes.push({ imageIndex: index, x: CATALOG_ZONE_PAD, y, width: innerWidth, height: boxHeight });
    y += boxHeight + CATALOG_ZONE_GAP;
  });
  return boxes;
}

interface ColumnSpan {
  first: number;
  count: number;
  topRows: number;
  rows: number;
}

/** The largest rectangle of ADJACENT columns that all finish early: it starts
 * under the tallest column of the span, runs to the end of the table, and is
 * only used when tall and wide enough to look intentional. */
function bestColumnSpan(lengths: number[], rowCount: number, rowHeight: number, columnWidth: number): ColumnSpan | null {
  let best: (ColumnSpan & { area: number }) | null = null;
  for (let first = 0; first < lengths.length; first++) {
    let tallest = 0;
    for (let last = first; last < lengths.length; last++) {
      tallest = Math.max(tallest, lengths[last]!);
      const rows = rowCount - tallest;
      if (rows < ZONE_MIN_ROWS || rows * rowHeight < ZONE_MIN_HEIGHT) continue;
      const area = (last - first + 1) * columnWidth * rows * rowHeight;
      if (!best || area > best.area) best = { first, count: last - first + 1, topRows: tallest, rows, area };
    }
  }
  if (!best) return null;
  return { first: best.first, count: best.count, topRows: best.topRows, rows: best.rows };
}

export interface CatalogInput {
  /** The warehouse-only availability sheet (already filtered to >= 5). */
  sheet: ProductAvailabilitySheet;
  /** How many images (0..3) the renderer will actually be able to draw. */
  imageCount: number;
}

export type CatalogPlan =
  | { status: "OK"; layout: CatalogLayout }
  /** Nothing a customer could choose from: a simple stock product, or no
   * model reaches the warehouse minimum. */
  | { status: "NONE" }
  /** Even the tightest legible arrangement cannot put every model on one A4
   * sheet. The canvas is NEVER enlarged; the caller reports this state. */
  | { status: "TOO_LARGE"; longestColumn: number; capacity: number };

/** Decides the one-A4 arrangement, or reports that none exists. */
export function planCustomerCatalog({ sheet, imageCount }: CatalogInput): CatalogPlan {
  if (sheet.mode === "TOTAL_STOCK" || !sheet.hasAvailability) return { status: "NONE" };
  const showColors = sheet.mode === "DEVICE_MODEL_COLOR";
  const brands = customerBrandsFromSheet(sheet.brands);
  const images = Math.max(0, Math.min(CUSTOMER_MAX_IMAGES, Math.floor(imageCount)));
  const title = sheet.product.nameAr?.trim() || sheet.product.name;

  // brand-group rebalancing only changes anything for 5+ brands
  const groupings = brands.length <= CUSTOMER_MAX_BRAND_COLUMNS ? [CUSTOMER_MAX_BRAND_COLUMNS] : [...FIT_GROUPINGS];
  let longestColumn = 0;
  let capacity = 0;
  for (const density of ["NORMAL", "COMPACT"] as const) {
    for (const maxColumns of groupings) {
      const attempt = layoutAttempt(brands, showColors, maxColumns, density, images, title);
      if (attempt.layout) return { status: "OK", layout: attempt.layout };
      longestColumn = attempt.longestColumn;
      capacity = attempt.capacity;
    }
  }
  return { status: "TOO_LARGE", longestColumn, capacity };
}

/** Layout for callers that only need the sheet itself: null for NONE and for
 * TOO_LARGE alike (use planCustomerCatalog to tell them apart). */
export function buildCustomerCatalogLayout(input: CatalogInput): CatalogLayout | null {
  const plan = planCustomerCatalog(input);
  return plan.status === "OK" ? plan.layout : null;
}

function layoutAttempt(
  brands: AvailabilityBrand[],
  showColors: boolean,
  maxColumns: number,
  density: CatalogDensity,
  images: number,
  titleText: string,
): { layout: CatalogLayout | null; longestColumn: number; capacity: number } {
  const chrome = CHROME[density];
  const rawTables = buildAvailabilityTables(brands, showColors, maxColumns);
  const innerWidth = CATALOG_PAGE.width - chrome.marginX * 2 - CATALOG_FRAME * 2;
  const title = fitText(titleText, innerWidth - 40, { maxFontSize: density === "NORMAL" ? 30 : 26, singleLineMinFontSize: 22, multiLineMinFontSize: 18, maxLines: 3 });
  const titleHeight = Math.max(chrome.titleMin, title.height + chrome.titlePad);

  const prepared = rawTables.map((raw) => {
    const columnCount = raw.brands.length;
    const width = columnCount === 1 ? Math.min(innerWidth, SINGLE_BRAND_MAX_WIDTH) : Math.floor(innerWidth / columnCount) * columnCount;
    const columnWidth = width / columnCount;
    const columns = raw.brands.map((brand, column) => ({
      brand,
      models: raw.rows.map((row) => row[column]).filter((cell): cell is NonNullable<typeof cell> => cell !== null),
    }));
    const lengths = columns.map((column) => column.models.length);
    return { width, columnWidth, columns, lengths, rowCount: Math.max(...lengths) };
  });

  const rowsTotal = prepared.reduce((sum, table) => sum + table.rowCount, 0);
  const overhead = prepared.reduce((sum, _table, index) => sum + CATALOG_FRAME * 2 + chrome.headHeight + (index === 0 ? titleHeight : 0), 0) + chrome.tableGap * (prepared.length - 1);
  const bodyAvailable = CATALOG_PAGE.height - chrome.marginTop - chrome.marginBottom - overhead;
  const fitRow = Math.floor(bodyAvailable / rowsTotal);
  const longestColumn = Math.max(...prepared.map((table) => table.rowCount));
  const capacity = Math.floor(bodyAvailable / chrome.rowMin);
  if (fitRow < chrome.rowMin) return { layout: null, longestColumn, capacity };

  let rowHeight = Math.min(ROW_MAX, fitRow);

  // 1) preferred: merge the unused area under adjacent shorter columns
  let columnZone: { table: number; span: ColumnSpan } | null = null;
  if (images > 0) {
    let bestArea = 0;
    prepared.forEach((table, index) => {
      const span = bestColumnSpan(table.lengths, table.rowCount, rowHeight, table.columnWidth);
      const area = span ? span.count * table.columnWidth * span.rows * rowHeight : 0;
      if (span && area > bestArea) {
        bestArea = area;
        columnZone = { table: index, span };
      }
    });
  }
  // 2) otherwise reserve a merged full-width area under the last table
  let bottomZoneHeight = 0;
  if (images > 0 && !columnZone) {
    const reserved = Math.round(bodyAvailable * BOTTOM_ZONE_RESERVE);
    const reservedRow = Math.min(ROW_MAX, Math.floor((bodyAvailable - reserved) / rowsTotal));
    const leftover = bodyAvailable - rowsTotal * reservedRow;
    if (leftover >= BOTTOM_ZONE_MIN_HEIGHT && reservedRow >= BOTTOM_ZONE_MIN_ROW) {
      rowHeight = reservedRow;
      bottomZoneHeight = leftover;
    }
  }
  const rowFontSize = Math.min(ROW_FONT_MAX, Math.max(ROW_FONT_MIN, Math.floor(rowHeight * ROW_FONT_RATIO)));

  // Leftover pixels: a handful (fewer than there are rows) are spread 1px per
  // row so the table fills the sheet exactly; a large leftover (rows capped at
  // ROW_MAX) goes to the photo zone instead.
  const leftover = bodyAvailable - rowsTotal * rowHeight - bottomZoneHeight;
  const spread = leftover > 0 && leftover <= rowsTotal ? leftover : 0;
  const bigLeftover = leftover > rowsTotal ? leftover : 0;
  let rowsPlaced = 0;

  const imageBoxes: { width: number; height: number }[] = [];
  const tables: CatalogTable[] = prepared.map((table, tableIndex) => {
    const span = columnZone && (columnZone as { table: number }).table === tableIndex ? (columnZone as { span: ColumnSpan }).span : null;
    const isLast = tableIndex === prepared.length - 1;
    const textWidth = table.columnWidth - CELL_PAD_X * 2;
    const extraHeight = span ? bigLeftover : 0;
    const rowHeights = Array.from({ length: table.rowCount }, (_, index) => rowHeight + (rowsPlaced + index < spread ? 1 : 0));
    rowsPlaced += table.rowCount;
    const sumRows = (from: number, to: number) => rowHeights.slice(from, to).reduce((sum, value) => sum + value, 0);

    const columns: CatalogColumn[] = table.columns.map((column, index) => {
      const inSpan = span !== null && index >= span.first && index < span.first + span.count;
      const blankUntil = inSpan ? span!.topRows : table.rowCount;
      return {
        brand: { text: column.brand.label, fontSize: fitSingleLine(column.brand.label, textWidth, chrome.headFont, { uppercase: true }) },
        cells: column.models.map((cell) => {
          const colors = cell.colors.length > 0 ? cell.colors.join(" · ") : null;
          const display = colors ? `${cell.label} — ${colors}` : cell.label;
          return { text: cell.label, colors, fontSize: fitSingleLine(display, textWidth, rowFontSize) };
        }),
        tailRows: blankUntil - column.models.length,
      };
    });

    let zone: CatalogZone | null = null;
    if (span) {
      const width = span.count * table.columnWidth;
      const height = sumRows(span.topRows, table.rowCount) + extraHeight;
      const boxes = zoneBoxes(width, height, images, span.first + span.count < columns.length);
      zone = { kind: "COLUMNS", firstColumn: span.first, columnCount: span.count, topRows: span.topRows, rows: span.rows, width, height, boxes };
    } else if (bottomZoneHeight > 0 && isLast) {
      zone = { kind: "BOTTOM", firstColumn: 0, columnCount: columns.length, topRows: table.rowCount, rows: 0, width: table.width, height: bottomZoneHeight, boxes: zoneBoxes(table.width, bottomZoneHeight, images, false) };
    }
    for (const box of zone?.boxes ?? []) imageBoxes[box.imageIndex] = { width: box.width, height: box.height };

    return {
      width: table.width,
      columnWidth: table.columnWidth,
      rowCount: table.rowCount,
      rowHeights,
      columns,
      zone,
      extraHeight,
      title: tableIndex === 0 ? title : null,
      titleHeight: tableIndex === 0 ? titleHeight : 0,
      height: CATALOG_FRAME * 2 + (tableIndex === 0 ? titleHeight : 0) + chrome.headHeight + sumRows(0, table.rowCount) + extraHeight + (zone?.kind === "BOTTOM" ? zone.height : 0),
    };
  });

  return {
    layout: {
      width: CATALOG_PAGE.width,
      height: CATALOG_PAGE.height,
      density,
      headHeight: chrome.headHeight,
      marginTop: chrome.marginTop,
      rowHeight,
      rowFontSize,
      tableGap: chrome.tableGap,
      tables,
      imageBoxes,
    },
    longestColumn,
    capacity,
  };
}
