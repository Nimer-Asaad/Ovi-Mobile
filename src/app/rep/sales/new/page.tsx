import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAccountBalanceCents } from "@/lib/accounts";
import { getRepTraderContactsForSaleForm } from "@/lib/rep-merchants";
import { getOpenCustomerOrdersForRep } from "@/lib/rep-customer-orders";
import { getRepCarSaleProducts } from "@/lib/rep-sales";
import { NewSaleForm, type SaleCustomerOption } from "@/components/reps/NewSaleForm";

interface RepNewSalePageProps {
  /** merchantId: optional deep link from a merchant's own page ("بيع جديد")
   * — see /rep/merchants/[id]/page.tsx. Resolved server-side, scoped to
   * this rep's own assignedRepId, exactly like every other merchant lookup
   * in the rep section; never trusted beyond "which of MY merchants to
   * prefill the form with". */
  searchParams: Promise<{ merchantId?: string }>;
}

export default async function RepNewSalePage({ searchParams }: RepNewSalePageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const { merchantId } = await searchParams;

  const locationId = effectiveRep.carStockLocationId;

  const [options, customers, customerOrders, preselectedMerchant] = await Promise.all([
    getRepCarSaleProducts(locationId),
    // This rep's own trader roster (Merchant.assignedRepId), used to
    // auto-fill the customer fields instead of re-typing them — see
    // createRepSale, which resolves/creates the matching Merchant by phone
    // so repeat sales to the same trader never register a duplicate.
    getRepTraderContactsForSaleForm(effectiveRep.repId),
    getOpenCustomerOrdersForRep(effectiveRep.repId),
    merchantId
      ? prisma.merchant.findFirst({
          where: { id: merchantId, assignedRepId: effectiveRep.repId },
          select: {
            businessName: true,
            contactPhone: true,
            city: true,
            address: true,
            user: { select: { phone: true } },
            account: {
              select: {
                openingBalanceCents: true,
                orders: { select: { status: true, totalCents: true } },
                payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const initialCustomer: SaleCustomerOption | undefined = preselectedMerchant
    ? {
        name: preselectedMerchant.businessName,
        phone: preselectedMerchant.contactPhone ?? preselectedMerchant.user?.phone ?? "",
        city: preselectedMerchant.city,
        address: preselectedMerchant.address,
        // Same getAccountBalanceCents formula as every other balance display
        // in this app — the merchantId deep link (e.g. "بيع جديد" from a
        // merchant's own /rep/merchants/[id] page) already re-verified
        // assignedRepId === this rep above, so this never leaks another
        // rep's trader's debt.
        currentBalanceCents: preselectedMerchant.account ? getAccountBalanceCents(preselectedMerchant.account) : 0,
      }
    : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="بيع مباشر جديد" subtitle="تسجيل عملية بيع من مخزونك الحالي" />
      <NewSaleForm products={options} customers={customers} customerOrders={customerOrders} initialCustomer={initialCustomer} />
    </div>
  );
}
