import { PageHeader } from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getCompanyInventoryReport } from "@/lib/company-inventory-report";
import { CompanyInventoryReportView } from "@/components/admin/inventory/CompanyInventoryReportView";

/** Printable, read-only company inventory report (WAREHOUSE + every rep's
 * REP_CAR aggregate, one row per Product) — same ADMIN/ADMIN_ASSISTANT
 * access as /admin/inventory/overview, which this is a printable companion
 * to. Never mutates anything: the data comes from one server-side read
 * (getCompanyInventoryReport), handed down as plain props to a client view
 * that only filters/numbers/prints it. */
export default async function AdminCompanyInventoryReportPage() {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const data = await getCompanyInventoryReport();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="كشف مخزون الشركة" subtitle="نسخة قابلة للطباعة — مستودع + سيارات المندوبين، لا تعديل من هذه الصفحة" className="print:hidden" />
      <CompanyInventoryReportView data={data} />
    </div>
  );
}
