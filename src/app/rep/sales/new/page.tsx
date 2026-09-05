import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
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
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { merchantId } = await searchParams;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const [options, customers, customerOrders, preselectedMerchant] = await Promise.all([
    getRepCarSaleProducts(locationId),
    // This rep's own trader roster (Merchant.assignedRepId), used to
    // auto-fill the customer fields instead of re-typing them — see
    // createRepSale, which resolves/creates the matching Merchant by phone
    // so repeat sales to the same trader never register a duplicate.
    rep ? getRepTraderContactsForSaleForm(rep.id) : Promise.resolve([]),
    rep ? getOpenCustomerOrdersForRep(rep.id) : Promise.resolve([]),
    rep && merchantId
      ? prisma.merchant.findFirst({
          where: { id: merchantId, assignedRepId: rep.id },
          select: { businessName: true, contactPhone: true, city: true, address: true, user: { select: { phone: true } } },
        })
      : Promise.resolve(null),
  ]);

  const initialCustomer: SaleCustomerOption | undefined = preselectedMerchant
    ? {
        name: preselectedMerchant.businessName,
        phone: preselectedMerchant.contactPhone ?? preselectedMerchant.user?.phone ?? "",
        city: preselectedMerchant.city,
        address: preselectedMerchant.address,
      }
    : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="بيع مباشر جديد" subtitle="تسجيل عملية بيع من مخزونك الحالي" />
      <NewSaleForm products={options} customers={customers} customerOrders={customerOrders} initialCustomer={initialCustomer} />
    </div>
  );
}
