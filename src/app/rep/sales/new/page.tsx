import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRepTraderContactsForSaleForm } from "@/lib/rep-merchants";
import { getOpenCustomerOrdersForRep } from "@/lib/rep-customer-orders";
import { getRepCarSaleProducts } from "@/lib/rep-sales";
import { NewSaleForm } from "@/components/reps/NewSaleForm";

export default async function RepNewSalePage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const [options, customers, customerOrders] = await Promise.all([
    getRepCarSaleProducts(locationId),
    // This rep's own trader roster (Merchant.assignedRepId), used to
    // auto-fill the customer fields instead of re-typing them — see
    // createRepSale, which resolves/creates the matching Merchant by phone
    // so repeat sales to the same trader never register a duplicate.
    rep ? getRepTraderContactsForSaleForm(rep.id) : Promise.resolve([]),
    rep ? getOpenCustomerOrdersForRep(rep.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="بيع مباشر جديد" subtitle="تسجيل عملية بيع من مخزونك الحالي" />
      <NewSaleForm products={options} customers={customers} customerOrders={customerOrders} />
    </div>
  );
}
