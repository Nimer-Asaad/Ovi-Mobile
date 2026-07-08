import { requireApprovedMerchant } from "@/lib/auth/guards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function MerchantDashboardPage() {
  const user = await requireApprovedMerchant();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">لوحة تحكم التاجر</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">مرحباً، {user.name}</p>
        </div>
        <LogoutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>حالة الحساب</CardTitle>
          <Badge variant="success">معتمد</Badge>
        </CardHeader>
        <CardContent>
          أسعار الجملة وإدارة الطلبات ستتوفر في مرحلة قادمة. هذا الحساب معتمد ويمكنه
          الدخول إلى ميزات التجار عند إضافتها.
        </CardContent>
      </Card>
    </div>
  );
}
