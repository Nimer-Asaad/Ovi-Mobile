import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { EditMerchantForm } from "../../EditMerchantForm";

interface AdminEditMerchantPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminEditMerchantPage({ params }: AdminEditMerchantPageProps) {
  const { id } = await params;

  const [merchant, reps] = await Promise.all([
    prisma.merchant.findUnique({
      where: { id },
      select: {
        id: true,
        businessName: true,
        contactName: true,
        contactPhone: true,
        whatsappPhone: true,
        city: true,
        address: true,
        region: true,
        notes: true,
        assignedRepId: true,
        user: { select: { phone: true } },
      },
    }),
    prisma.salesRepresentative.findMany({
      where: { isActive: true },
      orderBy: { user: { name: "asc" } },
      select: { id: true, employeeCode: true, user: { select: { name: true } } },
    }),
  ]);

  if (!merchant) {
    notFound();
  }

  const repOptions = reps.map((rep) => ({ id: rep.id, label: `${rep.user.name} (${rep.employeeCode})` }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`تعديل — ${merchant.businessName}`} subtitle="تعديل بيانات التاجر الأساسية" />
      <EditMerchantForm
        merchantId={merchant.id}
        reps={repOptions}
        initial={{
          businessName: merchant.businessName,
          contactName: merchant.contactName,
          contactPhone: merchant.contactPhone ?? merchant.user?.phone ?? "",
          whatsappPhone: merchant.whatsappPhone,
          city: merchant.city,
          address: merchant.address,
          region: merchant.region,
          notes: merchant.notes,
          assignedRepId: merchant.assignedRepId,
        }}
      />
    </div>
  );
}
