import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";

/** "إرسالية مخزون سيارة المندوب" — the printable hand-over note for one
 * representative's car.
 *
 * SOURCE OF TRUTH: the canonical current REP_CAR InventoryItem rows of that
 * rep's own car location with quantity > 0 — exactly the rows
 * getRepStockStats (src/lib/reps.ts) and the existing inventory sheet count.
 * Never Product.stock, never StockMovement sums, never warehouse stock, never
 * another rep's car. READ-ONLY: nothing here writes anything.
 *
 * A REP car keeps one plain balance per product (variantId and
 * deviceColorVariantId are null), but any legacy per-variant row of the same
 * product is folded into that product's single line, so the sheet always has
 * ONE row per product and the physical count has one number per product. */

export interface DispatchNoteRawItem {
  productId: string;
  quantity: number;
  product: {
    sku: string;
    name: string;
    nameAr: string | null;
    category: { name: string; nameAr: string | null } | null;
  };
}

export interface DispatchNoteRow {
  productId: string;
  sku: string;
  /** Arabic name when present, else the base name. */
  name: string;
  categoryName: string | null;
  /** Current quantity in the rep's car — a positive integer, the number the
   * physical count is checked against. */
  quantity: number;
}

export interface DispatchNoteTotals {
  /** Distinct positive REP-car product lines shown. */
  itemCount: number;
  /** Exact sum of the visible quantity column. */
  totalPieces: number;
}

/** Natural order: "OVI 4" before "OVI 10", "صنف 2" before "صنف 11". */
const NATURAL = { numeric: true } as const;

const isCountable = (quantity: number) => Number.isInteger(quantity) && quantity > 0;

/** Pure: one row per product (quantities of the same product summed), only
 * positive integers count, ordered category -> product name -> SKU so the
 * sheet is deterministic (uncategorised products last). */
export function buildDispatchNoteRows(items: DispatchNoteRawItem[]): DispatchNoteRow[] {
  const byProduct = new Map<string, DispatchNoteRow>();
  for (const item of items) {
    if (!isCountable(item.quantity)) continue;
    const existing = byProduct.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    byProduct.set(item.productId, {
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.nameAr?.trim() || item.product.name,
      categoryName: item.product.category ? item.product.category.nameAr?.trim() || item.product.category.name : null,
      quantity: item.quantity,
    });
  }
  return [...byProduct.values()].sort((a, b) => {
    if ((a.categoryName === null) !== (b.categoryName === null)) return a.categoryName === null ? 1 : -1;
    return (
      (a.categoryName ?? "").localeCompare(b.categoryName ?? "", "ar", NATURAL) ||
      a.name.localeCompare(b.name, "ar", NATURAL) ||
      a.sku.localeCompare(b.sku, "en", NATURAL) ||
      a.productId.localeCompare(b.productId)
    );
  });
}

/** The two totals, derived from the VISIBLE rows only — the sheet can never
 * show a total that differs from the sum of its own quantity cells. */
export function summarizeDispatchNote(rows: DispatchNoteRow[]): DispatchNoteTotals {
  return { itemCount: rows.length, totalPieces: rows.reduce((sum, row) => sum + row.quantity, 0) };
}

const BUSINESS_TIMEZONE = "Asia/Hebron";

function businessParts(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** dd/MM/yyyy in Palestine business time, Latin digits (printed beside the
 * quantities, so it must read the same on every device). */
export function formatDispatchDate(now: Date): string {
  const p = businessParts(now);
  return `${p.day}/${p.month}/${p.year}`;
}

export function formatDispatchTime(now: Date): string {
  const p = businessParts(now);
  return `${p.hour}:${p.minute}`;
}

/** DISPLAY-ONLY reference — never stored anywhere (there is no dispatch-note
 * table): DISP-<employeeCode>-<yyyyMMdd>-<HHmm> in business time, the same
 * shape as the inventory sheet's INV-… reference. */
export function formatDispatchReference(employeeCode: string, now: Date): string {
  const p = businessParts(now);
  return `DISP-${employeeCode}-${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

export interface RepDispatchNoteData {
  reference: string;
  /** dd/MM/yyyy */
  date: string;
  /** HH:mm */
  time: string;
  repName: string;
  employeeCode: string;
  repPhone: string | null;
  /** The car's StockLocation.name when the rep has one. */
  carLocationName: string | null;
  rows: DispatchNoteRow[];
  itemCount: number;
  totalPieces: number;
}

/** Loads one rep's dispatch note, or null when the rep does not exist.
 * One rep query + ONE InventoryItem query, scoped three ways to the rep's own
 * car: the location id, type REP_CAR, and that location's salesRepId. */
export async function loadRepDispatchNote(repId: string, now: Date = new Date()): Promise<RepDispatchNoteData | null> {
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { name: true, phone: true } },
      carStockLocation: { select: { id: true, name: true } },
    },
  });
  if (!rep) return null;

  const items: DispatchNoteRawItem[] = rep.carStockLocation
    ? await prisma.inventoryItem.findMany({
        where: {
          locationId: rep.carStockLocation.id,
          quantity: { gt: 0 },
          location: { type: STOCK_LOCATION_TYPES.REP_CAR, salesRepId: rep.id },
        },
        select: {
          productId: true,
          quantity: true,
          product: { select: { sku: true, name: true, nameAr: true, category: { select: { name: true, nameAr: true } } } },
        },
      })
    : [];

  const rows = buildDispatchNoteRows(items);
  return {
    reference: formatDispatchReference(rep.employeeCode, now),
    date: formatDispatchDate(now),
    time: formatDispatchTime(now),
    repName: rep.user.name,
    employeeCode: rep.employeeCode,
    repPhone: rep.user.phone,
    carLocationName: rep.carStockLocation?.name ?? null,
    rows,
    ...summarizeDispatchNote(rows),
  };
}
