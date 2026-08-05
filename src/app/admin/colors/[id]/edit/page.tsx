import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ColorForm } from "../../ColorForm";

interface EditColorPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditColorPage({ params }: EditColorPageProps) {
  const { id } = await params;

  const color = await prisma.color.findUnique({ where: { id } });
  if (!color) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل اللون</h2>
      <ColorForm color={color} />
    </div>
  );
}
