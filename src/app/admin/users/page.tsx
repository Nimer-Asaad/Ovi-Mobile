import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { UserAvatar } from "@/components/admin/users/UserAvatar";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ROLES, REGISTRATION_METHODS, MERCHANT_STATUSES } from "@/lib/constants";
import {
  getRoleLabel,
  getRoleBadgeVariant,
  getRegistrationMethodLabel,
  getRegistrationMethod,
} from "@/lib/user-labels";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";

const PAGE_SIZE = 20;

const SORT_OPTIONS = {
  newest: { label: "الأحدث تسجيلاً", orderBy: { createdAt: "desc" as const } },
  name: { label: "الاسم", orderBy: { name: "asc" as const } },
  lastLogin: { label: "آخر تسجيل دخول", orderBy: { lastLoginAt: { sort: "desc" as const, nulls: "last" as const } } },
};

type SortKey = keyof typeof SORT_OPTIONS;

interface AdminUsersPageProps {
  searchParams: Promise<{
    q?: string;
    role?: string;
    regMethod?: string;
    merchantStatus?: string;
    accountStatus?: string;
    sort?: string;
    page?: string;
  }>;
}

const ALLOWED_ROLES: readonly string[] = Object.values(ROLES);
const ALLOWED_MERCHANT_STATUSES: readonly string[] = Object.values(MERCHANT_STATUSES);
const ALLOWED_ACCOUNT_STATUSES = ["active", "inactive"] as const;
const ALLOWED_REGISTRATION_METHODS: readonly string[] = Object.values(REGISTRATION_METHODS);

/** Every filter value from the URL is checked against a fixed allowlist
 * before it ever reaches a Prisma `where` clause — an unrecognized value is
 * treated as "no filter" rather than passed through, even though Prisma
 * itself always parameterizes values (so this isn't an injection vector),
 * matching this admin page's own validated-input standard. */
function pickAllowed<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const trimmedQuery = params.q?.trim();
  const sortKey: SortKey = params.sort && params.sort in SORT_OPTIONS ? (params.sort as SortKey) : "newest";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const role = pickAllowed(params.role, ALLOWED_ROLES);
  const accountStatus = pickAllowed(params.accountStatus, ALLOWED_ACCOUNT_STATUSES);
  const regMethod = pickAllowed(params.regMethod, ALLOWED_REGISTRATION_METHODS);
  const merchantStatus = pickAllowed(params.merchantStatus, ALLOWED_MERCHANT_STATUSES);

  const where = {
    ...(role ? { role } : {}),
    ...(accountStatus === "active" ? { isActive: true } : {}),
    ...(accountStatus === "inactive" ? { isActive: false } : {}),
    ...(regMethod === REGISTRATION_METHODS.GOOGLE ? { passwordHash: null } : {}),
    ...(regMethod === REGISTRATION_METHODS.EMAIL_PASSWORD ? { passwordHash: { not: null } } : {}),
    ...(merchantStatus ? { merchantProfile: { status: merchantStatus } } : {}),
    ...(trimmedQuery
      ? {
          OR: [
            { name: { contains: trimmedQuery, mode: "insensitive" as const } },
            { email: { contains: trimmedQuery, mode: "insensitive" as const } },
            { phone: { contains: trimmedQuery, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: SORT_OPTIONS[sortKey].orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        role: true,
        passwordHash: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        merchantProfile: { select: { status: true } },
      },
    }),
  ]);

  // One grouped aggregate for this page's users only — never one query per
  // row — so this stays flat regardless of total user count.
  const userIds = users.map((user) => user.id);
  const orderAggregates =
    userIds.length > 0
      ? await prisma.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: userIds } },
          _count: { _all: true },
          _sum: { totalCents: true },
        })
      : [];
  const aggregateByUserId = new Map(
    orderAggregates.map((row) => [row.customerId, { count: row._count._all, totalCents: row._sum.totalCents ?? 0 }]),
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    const current = { ...params, ...overrides };
    for (const [key, value] of Object.entries(current)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="المستخدمون" subtitle={`إدارة حسابات المستخدمين — ${totalCount} مستخدم`} />

      <form method="GET" className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Input name="q" label="بحث بالاسم أو البريد أو الهاتف" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="role" label="الدور" defaultValue={params.role ?? ""}>
          <option value="">كل الأدوار</option>
          <option value={ROLES.ADMIN}>{getRoleLabel(ROLES.ADMIN)}</option>
          <option value={ROLES.SALES_REPRESENTATIVE}>{getRoleLabel(ROLES.SALES_REPRESENTATIVE)}</option>
          <option value={ROLES.WHOLESALE_MERCHANT}>{getRoleLabel(ROLES.WHOLESALE_MERCHANT)}</option>
          <option value={ROLES.RETAIL_CUSTOMER}>{getRoleLabel(ROLES.RETAIL_CUSTOMER)}</option>
        </Select>

        <Select name="regMethod" label="طريقة التسجيل" defaultValue={params.regMethod ?? ""}>
          <option value="">الكل</option>
          <option value={REGISTRATION_METHODS.GOOGLE}>{getRegistrationMethodLabel(REGISTRATION_METHODS.GOOGLE)}</option>
          <option value={REGISTRATION_METHODS.EMAIL_PASSWORD}>
            {getRegistrationMethodLabel(REGISTRATION_METHODS.EMAIL_PASSWORD)}
          </option>
        </Select>

        <Select name="accountStatus" label="حالة الحساب" defaultValue={params.accountStatus ?? ""}>
          <option value="">الكل</option>
          <option value="active">مفعّل</option>
          <option value="inactive">متوقف</option>
        </Select>

        <Select name="merchantStatus" label="حالة التاجر" defaultValue={params.merchantStatus ?? ""}>
          <option value="">الكل</option>
          <option value={MERCHANT_STATUSES.PENDING}>{getMerchantStatusLabel(MERCHANT_STATUSES.PENDING)}</option>
          <option value={MERCHANT_STATUSES.APPROVED}>{getMerchantStatusLabel(MERCHANT_STATUSES.APPROVED)}</option>
          <option value={MERCHANT_STATUSES.REJECTED}>{getMerchantStatusLabel(MERCHANT_STATUSES.REJECTED)}</option>
          <option value={MERCHANT_STATUSES.SUSPENDED}>{getMerchantStatusLabel(MERCHANT_STATUSES.SUSPENDED)}</option>
        </Select>

        <Select name="sort" label="الترتيب" defaultValue={sortKey}>
          {Object.entries(SORT_OPTIONS).map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </Select>

        <div className="flex items-end lg:col-span-2">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start"></th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">البريد الإلكتروني</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">طريقة التسجيل</th>
          <th className="px-4 py-3 text-start">الدور</th>
          <th className="px-4 py-3 text-start">حالة التاجر</th>
          <th className="px-4 py-3 text-start">حالة الحساب</th>
          <th className="px-4 py-3 text-start">تاريخ التسجيل</th>
          <th className="px-4 py-3 text-start">آخر تسجيل دخول</th>
          <th className="px-4 py-3 text-start">الطلبات</th>
          <th className="px-4 py-3 text-start">إجمالي الإنفاق</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {users.map((user) => {
            const registrationMethod = getRegistrationMethod(user.passwordHash);
            const aggregate = aggregateByUserId.get(user.id) ?? { count: 0, totalCents: 0 };
            return (
              <tr key={user.id}>
                <td className="px-4 py-3">
                  <UserAvatar name={user.name} avatarUrl={user.avatarUrl} />
                </td>
                <td className="px-4 py-3 text-neutral-bg">{user.name}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{user.email}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{user.phone ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{getRegistrationMethodLabel(registrationMethod)}</td>
                <td className="px-4 py-3">
                  <Badge variant={getRoleBadgeVariant(user.role)}>{getRoleLabel(user.role)}</Badge>
                </td>
                <td className="px-4 py-3">
                  {user.merchantProfile ? (
                    <Badge variant={getMerchantStatusBadgeVariant(user.merchantProfile.status)}>
                      {getMerchantStatusLabel(user.merchantProfile.status)}
                    </Badge>
                  ) : (
                    <span className="text-neutral-bg/40">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AdminStatusBadge isActive={user.isActive} />
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{new Date(user.createdAt).toLocaleDateString("ar")}</td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString("ar") : "لم يسجل الدخول بعد"}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{aggregate.count}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(aggregate.totalCents)}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${user.id}`} className="text-sm text-gold-champagne hover:underline">
                    التفاصيل
                  </Link>
                </td>
              </tr>
            );
          })}
          {users.length === 0 && <AdminEmptyRow colSpan={13} message="لا يوجد مستخدمون مطابقون" />}
        </AdminTableBody>
      </AdminTable>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 text-sm text-neutral-bg/70">
          <span>
            صفحة {page} من {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildUrl({ page: String(page - 1) })}>
                <Button variant="outline" size="sm" type="button">
                  السابق
                </Button>
              </Link>
            )}
            {page < totalPages && (
              <Link href={buildUrl({ page: String(page + 1) })}>
                <Button variant="outline" size="sm" type="button">
                  التالي
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
