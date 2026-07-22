import Link from "next/link";
import { Card } from "@/components/ui/Card";

export function ContinueShoppingCard({ cartItemCount }: { cartItemCount: number }) {
  if (cartItemCount <= 0) return null;

  return (
    <section aria-labelledby="continue-shopping-title" className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-4">
      <Card className="flex flex-col gap-5 border-gold-champagne/35 bg-gold-champagne/10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="continue-shopping-title" className="text-xl font-bold text-neutral-bg">أكمل طلبك</h2>
          <p className="mt-1.5 text-sm text-neutral-bg/65">عدد القطع في السلة: {cartItemCount}</p>
        </div>
        <Link href="/cart" className="inline-flex min-h-11 items-center justify-center rounded-card bg-gold-champagne px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-gold-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">
          الذهاب إلى السلة
        </Link>
      </Card>
    </section>
  );
}
