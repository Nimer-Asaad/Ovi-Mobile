import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { AccountStatementView } from "@/components/admin/accounts/AccountStatementView";

interface RepMerchantDetailPageProps {
  params: Promise<{ id: string }>;
}

/** A rep's read-only view of one assigned merchant's account statement —
 * reuses AccountStatementView as-is (same component the admin print-statement
 * page uses) so a rep sees exactly the same orders/payments breakdown admin
 * does. Scoped to `assignedRepId` so a rep can never open another rep's
 * merchant by guessing an id. */
export default async function RepMerchantDetailPage({ params }: RepMerchantDetailPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const merchant = rep
    ? await prisma.merchant.findFirst({
        where: { id, assignedRepId: rep.id },
        select: {
          businessName: true,
          region: true,
          contactPhone: true,
          user: { select: { phone: true } },
          account: {
            select: {
              orders: {
                orderBy: { createdAt: "desc" },
                select: { orderNumber: true, createdAt: true, status: true, totalCents: true },
              },
              payments: {
                orderBy: { createdAt: "desc" },
                select: { id: true, amountCents: true, method: true, createdAt: true, note: true },
              },
            },
          },
        },
      })
    : null;

  if (!merchant) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={merchant.businessName}
        subtitle={merchant.region ? `المنطقة: ${merchant.region}` : "كشف حساب التاجر"}
      />
      <AccountStatementView
        account={{
          displayName: merchant.businessName,
          phone: merchant.contactPhone ?? merchant.user?.phone ?? null,
          kindLabel: "تاجر جملة",
          orders: merchant.account?.orders ?? [],
          payments: merchant.account?.payments ?? [],
        }}
      />
    </div>
  );
}
