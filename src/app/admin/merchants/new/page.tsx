import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { AddMerchantForm } from "../AddMerchantForm";

export default async function AdminAddMerchantPage() {
  const reps = await prisma.salesRepresentative.findMany({
    where: { isActive: true },
    orderBy: { user: { name: "asc" } },
    select: { id: true, employeeCode: true, user: { select: { name: true } } },
  });

  const repOptions = reps.map((rep) => ({ id: rep.id, label: `${rep.user.name} (${rep.employeeCode})` }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="إضافة تاجر" subtitle="إضافة تاجر مباشرة ببياناته الأساسية — بدون بريد إلكتروني أو كلمة مرور" />
      <AddMerchantForm reps={repOptions} />
    </div>
  );
}
