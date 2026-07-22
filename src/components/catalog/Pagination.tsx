import Link from "next/link";
import { buildProductsUrl, type ProductFilterParams } from "@/lib/product-filter-url";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  filters: Omit<ProductFilterParams, "page">;
}

function pageWindow(currentPage: number, totalPages: number): Array<number | "ellipsis-start" | "ellipsis-end"> {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result: Array<number | "ellipsis-start" | "ellipsis-end"> = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) result.push(index === 1 ? "ellipsis-start" : "ellipsis-end");
    result.push(page);
  });
  return result;
}

const controlClass = "inline-flex min-h-10 items-center justify-center rounded-card border border-navy-soft px-3 text-sm font-medium text-neutral-bg transition-colors hover:border-gold-champagne/60 hover:text-gold-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark";
const disabledClass = "inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-card border border-navy-soft/60 px-3 text-sm text-neutral-bg/35";

export function Pagination({ currentPage, totalPages, filters }: PaginationProps) {
  if (totalPages <= 1) return null;
  const previous = currentPage - 1;
  const next = currentPage + 1;

  return (
    <nav aria-label="ترقيم صفحات المنتجات" className="mt-10">
      <div className="flex items-center gap-3 sm:hidden">
        {currentPage > 1 ? <Link href={buildProductsUrl({ ...filters, page: previous })} aria-label="الصفحة السابقة" className={`${controlClass} flex-1`}>السابق</Link> : <span aria-disabled="true" className={`${disabledClass} flex-1`}>السابق</span>}
        <span className="shrink-0 text-sm font-medium text-neutral-bg/65">صفحة {currentPage} من {totalPages}</span>
        {currentPage < totalPages ? <Link href={buildProductsUrl({ ...filters, page: next })} aria-label="الصفحة التالية" className={`${controlClass} flex-1`}>التالي</Link> : <span aria-disabled="true" className={`${disabledClass} flex-1`}>التالي</span>}
      </div>

      <div className="hidden items-center justify-center gap-2 sm:flex">
        {currentPage > 1 ? <Link href={buildProductsUrl({ ...filters, page: previous })} aria-label="الصفحة السابقة" className={controlClass}>السابق</Link> : <span aria-disabled="true" className={disabledClass}>السابق</span>}
        {pageWindow(currentPage, totalPages).map((item) =>
          typeof item === "number" ? (
            <Link key={item} href={buildProductsUrl({ ...filters, page: item })} aria-current={item === currentPage ? "page" : undefined} className={item === currentPage ? "inline-flex h-10 min-w-10 items-center justify-center rounded-card border border-gold-champagne bg-gold-champagne/12 px-3 text-sm font-bold text-gold-dark" : controlClass}>{item}</Link>
          ) : <span key={item} aria-hidden="true" className="px-1 text-neutral-bg/40">…</span>,
        )}
        {currentPage < totalPages ? <Link href={buildProductsUrl({ ...filters, page: next })} aria-label="الصفحة التالية" className={controlClass}>التالي</Link> : <span aria-disabled="true" className={disabledClass}>التالي</span>}
      </div>
    </nav>
  );
}
