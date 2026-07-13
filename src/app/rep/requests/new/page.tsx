import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { RepStockRequestForm } from "@/components/reps/RepStockRequestForm";

export default async function NewRepStockRequestPage() {
  await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      category: { select: { name: true, nameAr: true } },
      brand: { select: { name: true } },
    },
  });

  const options = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
    brandLabel: product.brand?.name ?? null,
  }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">طلب تزويد مخزون السيارة</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">
            اختر المنتجات والكميات التي تحتاجها — سيقوم المدير بمراجعة الطلب وتجهيزه
          </p>
        </div>
        <LogoutButton />
      </div>

      <RepStockRequestForm products={options} />
    </div>
  );
}
