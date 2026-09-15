import { PageHeader } from "@/components/ui/PageHeader";
import { OnlineCommissionCalculator } from "@/components/admin/online/OnlineCommissionCalculator";

/** أون لاين — a standalone commission calculator for the owner's online
 * sales. Pure client-side arithmetic, no persistence: nothing here reads or
 * writes Orders/Payments/Accounts/Inventory, so it carries no per-request DB
 * work and needs no server action. ADMIN-only (see this route's own
 * layout.tsx narrowing the outer /admin gate). */
export default function AdminOnlinePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="أون لاين" subtitle="حساب نسبة المبيعات" />
      <OnlineCommissionCalculator />
    </div>
  );
}
