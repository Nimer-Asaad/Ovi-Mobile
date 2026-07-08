import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";

export interface AdminTopbarProps {
  title: string;
}

/** Admin dashboard topbar. Notifications land in a later phase. */
export function AdminTopbar({ title }: AdminTopbarProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-navy-soft bg-navy-deep px-6">
      <h1 className="text-lg font-semibold text-neutral-bg">{title}</h1>

      <div className="flex items-center gap-3">
        <Badge variant="gold">مدير النظام</Badge>
        <LogoutButton />
      </div>
    </header>
  );
}
