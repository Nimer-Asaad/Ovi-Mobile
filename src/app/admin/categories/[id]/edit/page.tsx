import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CategoryForm } from "../../CategoryForm";

interface EditCategoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditCategoryPage({ params }: EditCategoryPageProps) {
  const { id } = await params;

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل القسم</h2>
      <CategoryForm category={category} />
    </div>
  );
}
