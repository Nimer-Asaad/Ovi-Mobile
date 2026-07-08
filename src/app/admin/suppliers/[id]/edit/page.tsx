import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SupplierForm } from "../../SupplierForm";

interface EditSupplierPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSupplierPage({ params }: EditSupplierPageProps) {
  const { id } = await params;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل المورد</h2>
      <SupplierForm supplier={supplier} />
    </div>
  );
}
