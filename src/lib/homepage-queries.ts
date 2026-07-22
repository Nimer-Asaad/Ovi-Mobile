import { prisma } from "@/lib/prisma";
import { buildProductsUrl } from "@/lib/product-filter-url";

export type HomepageCollectionTarget =
  | { type: "category"; slug: string }
  | { type: "brand"; slug: string };

export interface HomepageCollection {
  type: HomepageCollectionTarget["type"];
  slug: string;
  title: string;
  href: string;
  productCount: number;
}

const HOMEPAGE_COLLECTION_TARGETS = [
  { type: "category", slug: "phone-cases" },
  { type: "category", slug: "screen-lens-protectors" },
  { type: "category", slug: "cables" },
  { type: "brand", slug: "apple" },
] as const satisfies readonly HomepageCollectionTarget[];

/** Bounded editorial targets are revalidated against live catalog data so
 * missing, inactive, or empty collections never reach the homepage. */
export async function getHomepageCollections(): Promise<HomepageCollection[]> {
  const categorySlugs = HOMEPAGE_COLLECTION_TARGETS.filter((target) => target.type === "category").map((target) => target.slug);
  const brandSlugs = HOMEPAGE_COLLECTION_TARGETS.filter((target) => target.type === "brand").map((target) => target.slug);

  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, slug: { in: categorySlugs } },
      select: {
        slug: true,
        name: true,
        nameAr: true,
        _count: { select: { products: { where: { isActive: true } } } },
      },
    }),
    prisma.brand.findMany({
      where: { isActive: true, slug: { in: brandSlugs } },
      select: {
        slug: true,
        name: true,
        _count: { select: { products: { where: { isActive: true } } } },
      },
    }),
  ]);

  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
  const brandsBySlug = new Map(brands.map((brand) => [brand.slug, brand]));

  return HOMEPAGE_COLLECTION_TARGETS.flatMap((target): HomepageCollection[] => {
    if (target.type === "category") {
      const category = categoriesBySlug.get(target.slug);
      if (!category || category._count.products === 0) return [];
      return [{
        type: target.type,
        slug: target.slug,
        title: category.nameAr ?? category.name,
        href: buildProductsUrl({ category: target.slug }),
        productCount: category._count.products,
      }];
    }

    const brand = brandsBySlug.get(target.slug);
    if (!brand || brand._count.products === 0) return [];
    return [{
      type: target.type,
      slug: target.slug,
      title: brand.name,
      href: buildProductsUrl({ brand: target.slug }),
      productCount: brand._count.products,
    }];
  });
}
