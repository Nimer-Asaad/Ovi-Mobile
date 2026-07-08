import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function RepDashboardPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">لوحة تحكم المندوب</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">مرحباً، {user.name}</p>
        </div>
        <LogoutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>مخزون السيارة والطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          إدارة طلبات المخزون والمرتجعات وتسجيل مبيعات المندوبين ستتوفر في مرحلة قادمة.
        </CardContent>
      </Card>
    </div>
  );
}
