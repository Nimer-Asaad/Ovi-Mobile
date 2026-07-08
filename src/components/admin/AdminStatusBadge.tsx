import { Badge } from "@/components/ui/Badge";

export function AdminStatusBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "success" : "neutral"}>{isActive ? "مفعّل" : "متوقف"}</Badge>;
}
