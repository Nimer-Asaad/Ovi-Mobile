import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { WalkInAccountForm } from "@/components/admin/accounts/WalkInAccountForm";

export default async function NewWalkInAccountPage() {
  const existingAccounts = await prisma.customerAccount.findMany({
    where: { merchantId: null, customerId: null, isActive: true },
    select: { id: true, displayName: true, phone: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="حساب عميل مباشر جديد"
        subtitle="لعميل يشتري بالدين من المكتب دون حساب مسجّل على التطبيق"
      />
      <WalkInAccountForm existingAccounts={existingAccounts} />
    </div>
  );
}
