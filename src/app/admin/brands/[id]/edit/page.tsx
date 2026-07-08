import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BrandForm } from "../../BrandForm";

interface EditBrandPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditBrandPage({ params }: EditBrandPageProps) {
  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل العلامة التجارية</h2>
      <BrandForm brand={brand} />
    </div>
  );
}
