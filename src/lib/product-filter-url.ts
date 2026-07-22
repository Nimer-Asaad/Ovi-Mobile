export const PRODUCT_SORT_OPTIONS = {
  LATEST: "latest",
  FEATURED: "featured",
  NAME: "name",
  PRICE_ASC: "price-asc",
  PRICE_DESC: "price-desc",
  OLDEST: "oldest",
} as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[keyof typeof PRODUCT_SORT_OPTIONS];

const VALID_SORTS: readonly string[] = Object.values(PRODUCT_SORT_OPTIONS);

export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = {
  [PRODUCT_SORT_OPTIONS.LATEST]: "الأحدث",
  [PRODUCT_SORT_OPTIONS.FEATURED]: "مميز أولًا",
  [PRODUCT_SORT_OPTIONS.NAME]: "الاسم",
  [PRODUCT_SORT_OPTIONS.PRICE_ASC]: "السعر: الأقل إلى الأعلى",
  [PRODUCT_SORT_OPTIONS.PRICE_DESC]: "السعر: الأعلى إلى الأقل",
  [PRODUCT_SORT_OPTIONS.OLDEST]: "الأقدم",
};

export function normalizeProductSort(sort: string | undefined): ProductSort {
  return sort && VALID_SORTS.includes(sort) ? (sort as ProductSort) : PRODUCT_SORT_OPTIONS.LATEST;
}

export interface ProductFilterParams {
  q?: string;
  category?: string;
  brand?: string;
  sort?: ProductSort | string;
  page?: number;
  inStock?: boolean;
  isNew?: boolean;
  minPrice?: string;
  maxPrice?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Canonical shareable catalog URL. Filter and sort callers omit `page`,
 * which intentionally resets pagination to page one. */
export function buildProductsUrl(params: ProductFilterParams): string {
  const searchParams = new URLSearchParams();
  const query = clean(params.q);
  const category = clean(params.category);
  const brand = clean(params.brand);
  const minPrice = clean(params.minPrice);
  const maxPrice = clean(params.maxPrice);
  const sort = normalizeProductSort(clean(params.sort));

  if (query) searchParams.set("q", query);
  if (category) searchParams.set("category", category);
  if (brand) searchParams.set("brand", brand);
  if (minPrice) searchParams.set("minPrice", minPrice);
  if (maxPrice) searchParams.set("maxPrice", maxPrice);
  if (sort !== PRODUCT_SORT_OPTIONS.LATEST) searchParams.set("sort", sort);
  if (params.page && Number.isInteger(params.page) && params.page > 1) searchParams.set("page", String(params.page));
  if (params.inStock) searchParams.set("inStock", "1");
  if (params.isNew) searchParams.set("isNew", "1");

  const serialized = searchParams.toString();
  return serialized ? `/products?${serialized}` : "/products";
}
