import Link from "next/link";
import { requireCartEligibleUser } from "@/lib/auth/guards";
import { getCurrentUserCart, getCartTotalCents, getAvailableStock } from "@/lib/cart";
import { isWholesalePriced, readCatalogPriceCents } from "@/lib/catalog-queries";
import { formatCurrencyFromCents } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { CartQuantityForm } from "./CartQuantityForm";
import { removeCartItem, clearCart } from "./actions";

export default async function CartPage() {
  const user = await requireCartEligibleUser();
  const cart = await getCurrentUserCart(user);
  const items = cart?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto max-w-lg px-4 py-24">
          <EmptyState
            as="h1"
            icon={<ProductImagePlaceholder className="h-32 w-32 rounded-card" />}
            title="سلتك فارغة"
            message="لم تقم بإضافة أي منتجات إلى السلة بعد."
            action={
              <Link href="/products">
                <Button>تصفح المنتجات</Button>
              </Link>
            }
          />
        </main>
        <Footer />
      </div>
    );
  }

  const totalCents = getCartTotalCents({ items });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-bg">سلة المشتريات</h1>
        <form action={clearCart}>
          <Button type="submit" variant="outline" size="sm">
            إفراغ السلة
          </Button>
        </form>
      </div>

      <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft bg-navy-surface">
        {items.map((item) => {
          const unitPriceCents = readCatalogPriceCents(item.product);
          const isWholesale = isWholesalePriced(item.product);
          const availableStock = getAvailableStock(item.product);
          const thumbnail = item.product.images[0];

          return (
            <div key={item.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-card bg-navy-soft">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                  <img
                    src={thumbnail.url}
                    alt={thumbnail.altText ?? item.product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ProductImagePlaceholder className="h-full w-full" />
                )}
              </div>

              <div className="min-w-[10rem] flex-1">
                <Link
                  href={`/products/${encodeURIComponent(item.product.sku)}`}
                  className="font-medium text-neutral-bg hover:text-gold-champagne"
                >
                  {item.product.nameAr ?? item.product.name}
                </Link>
                <p className="text-xs text-neutral-bg/50">{item.product.sku}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-gold-champagne">{formatCurrencyFromCents(unitPriceCents)}</span>
                  {isWholesale && <Badge variant="gold">سعر الجملة</Badge>}
                </div>
              </div>

              <CartQuantityForm cartItemId={item.id} quantity={item.quantity} maxQuantity={availableStock} />

              <p className="w-24 text-end font-semibold text-neutral-bg">
                {formatCurrencyFromCents(unitPriceCents * item.quantity)}
              </p>

              <form action={removeCartItem.bind(null, item.id)}>
                <Button type="submit" variant="outline" size="sm">
                  حذف
                </Button>
              </form>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الإجمالي</CardTitle>
          <span className="text-xl font-semibold text-gold-champagne">{formatCurrencyFromCents(totalCents)}</span>
        </CardHeader>
        <CardContent>
          <Link href="/checkout">
            <Button className="w-full sm:w-auto">إتمام الطلب</Button>
          </Link>
        </CardContent>
      </Card>
      </main>
      <Footer />
    </div>
  );
}
