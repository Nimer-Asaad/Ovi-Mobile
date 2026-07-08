import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

/**
 * Home page skeleton. Real product/category data arrives in Phase 3
 * (catalog); this page currently renders static placeholder sections only.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-20 text-center">
          <p className="mb-3 text-sm font-medium tracking-wide text-gold-champagne">
            Ovi Mobile
          </p>
          <h1 className="mx-auto max-w-2xl text-3xl font-bold text-neutral-bg md:text-5xl">
            إكسسوارات موبايل بجودة عالية، بالتجزئة والجملة
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-neutral-bg/70">
            منصة عوفي موبايل لإدارة المبيعات والمخزون والتجار والمندوبين — قريباً.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button variant="primary" size="lg">
              تصفح المنتجات
            </Button>
            <Button variant="outline" size="lg">
              انضم كتاجر جملة
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <h2 className="mb-6 text-xl font-semibold text-neutral-bg">الأقسام المميزة</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["سماعات", "شواحن", "كفرات", "كابلات"].map((category) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle>{category}</CardTitle>
                </CardHeader>
                <CardContent>قسم قيد الإضافة — سيتم ربطه بالمنتجات في المرحلة القادمة.</CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
