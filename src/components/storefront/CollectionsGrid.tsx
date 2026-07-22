import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CategoryIcon } from "@/components/storefront/CategoryIcon";
import type { HomepageCollection } from "@/lib/homepage-queries";

export interface CollectionsGridProps {
  collections: HomepageCollection[];
}

function getInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function CollectionsGrid({ collections }: CollectionsGridProps) {
  if (collections.length === 0) return null;

  return (
    <nav aria-label="تصفح المجموعات المختارة" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {collections.map((collection) => (
        <Link
          key={`${collection.type}-${collection.slug}`}
          href={collection.href}
          aria-label={`تصفح مجموعة ${collection.title}، ${collection.productCount} منتج`}
          className="rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-dark"
        >
          <Card className="group flex h-full min-h-40 flex-col items-center justify-center gap-4 overflow-hidden px-3 py-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-gold-champagne/55 hover:shadow-[0_18px_38px_-24px_rgba(6,20,37,0.5)] sm:min-h-44">
            <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-champagne/12 text-gold-dark ring-1 ring-gold-champagne/20 transition duration-300 group-hover:scale-105 group-hover:bg-gold-champagne/18 sm:h-16 sm:w-16">
              {collection.type === "category" ? (
                <CategoryIcon slug={collection.slug} className="h-8 w-8 sm:h-9 sm:w-9" />
              ) : (
                <span className="text-base font-bold sm:text-lg">{getInitials(collection.title)}</span>
              )}
            </span>
            <span className="font-semibold leading-6 text-neutral-bg">{collection.title}</span>
            <span className="text-xs text-neutral-bg/55">{collection.productCount} منتج</span>
          </Card>
        </Link>
      ))}
    </nav>
  );
}
