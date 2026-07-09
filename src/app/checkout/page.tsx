import { redirect } from "next/navigation";
import { requireCartEligibleUser } from "@/lib/auth/guards";
import { getCurrentUserCart, getCartTotalCents } from "@/lib/cart";
import { isWholesalePriced, readCatalogPriceCents } from "@/lib/catalog-queries";
import { formatCurrencyFromCents } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CheckoutForm } from "./CheckoutForm";

export default async function CheckoutPage() {
  const user = await requireCartEligibleUser();
  const cart = await getCurrentUserCart(user);

  if (!cart || cart.items.length === 0) {
    redirect("/cart");
  }

  const totalCents = getCartTotalCents(cart);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold text-neutral-bg">إتمام الطلب</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>بيانات التوصيل</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckoutForm defaultName={user.name} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>ملخص الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {cart.items.map((item) => {
                const unitPriceCents = readCatalogPriceCents(item.product);
                return (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-bg/80">
                      {item.product.nameAr ?? item.product.name}
                      <span className="text-neutral-bg/50"> × {item.quantity}</span>
                    </span>
                    <span className="text-neutral-bg">
                      {formatCurrencyFromCents(unitPriceCents * item.quantity)}
                    </span>
                  </div>
                );
              })}

              {isWholesalePriced(cart.items[0]?.product ?? { retailPriceCents: 0 }) && (
                <Badge variant="gold" className="self-start">
                  أسعار الجملة
                </Badge>
              )}

              <div className="mt-2 flex items-center justify-between border-t border-navy-soft pt-3">
                <span className="font-semibold text-neutral-bg">الإجمالي</span>
                <span className="text-lg font-semibold text-gold-champagne">
                  {formatCurrencyFromCents(totalCents)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </main>
      <Footer />
    </div>
  );
}
