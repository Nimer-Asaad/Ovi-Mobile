import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";

export interface StatCardProps {
  label: string;
  value: string;
  badge?: { text: string; variant: BadgeVariant };
}

/** Standardized stat tile used across the admin, rep, and merchant
 * dashboards — label + value, with an optional status badge. */
export function StatCard({ label, value, badge }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
      </CardHeader>
      <CardContent>
        <span className="text-2xl font-semibold text-neutral-bg">{value}</span>
      </CardContent>
    </Card>
  );
}
