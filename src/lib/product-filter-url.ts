export const PRODUCT_SORT_OPTIONS = {
  LATEST: "latest",
  NAME: "name",
  PRICE_ASC: "price-asc",
  PRICE_DESC: "price-desc",
} as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[keyof typeof PRODUCT_SORT_OPTIONS];

const VALID_SORTS: readonly string[] = Object.values(PRODUCT_SORT_OPTIONS);

/** Single source of truth for the visible sort labels — shared by the sort
 * select and the active-filter chip so the two never drift apart. */
export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = {
  [PRODUCT_SORT_OPTIONS.LATEST]: "الأحدث",
  [PRODUCT_SORT_OPTIONS.NAME]: "الاسم",
  [PRODUCT_SORT_OPTIONS.PRICE_ASC]: "السعر: من الأقل للأعلى",
  [PRODUCT_SORT_OPTIONS.PRICE_DESC]: "السعر: من الأعلى للأقل",
};

/** Any unknown/missing sort value falls back to "latest" — never lets a bad
 * query string produce an unpredictable order. */
export function normalizeProductSort(sort: string | undefined): ProductSort {
  return sort && (VALID_SORTS as string[]).includes(sort) ? (sort as ProductSort) : PRODUCT_SORT_OPTIONS.LATEST;
}

export interface ProductFilterParams {
  q?: string;
  category?: string;
  brand?: string;
  sort?: string;
}

/** Builds a shareable `/products` URL from the given filters, omitting
 * empty values and the default sort so URLs stay clean. Every filter link
 * on the page (category/brand pills, chips, sort select) goes through this
 * so changing one filter always preserves the others. */
export function buildProductsUrl(params: ProductFilterParams): string {
  const searchParams = new URLSearchParams();

  if (params.q) searchParams.set("q", params.q);
  if (params.category) searchParams.set("category", params.category);
  if (params.brand) searchParams.set("brand", params.brand);
  if (params.sort && params.sort !== PRODUCT_SORT_OPTIONS.LATEST) searchParams.set("sort", params.sort);

  const query = searchParams.toString();
  return query ? `/products?${query}` : "/products";
}
