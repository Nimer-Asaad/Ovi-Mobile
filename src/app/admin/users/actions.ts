"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { changeableRoleSchema } from "@/lib/validation/user";

export interface UserActionState {
  error?: string;
  success?: string;
}

function revalidateUserPaths(userId: string): void {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
}

/** Counts ADMIN users who could still sign in and manage the system if
 * `excludingUserId` were changed/disabled right now — the shared guard
 * behind both "last admin" protections below. */
async function countOtherActiveAdmins(excludingUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: ROLES.ADMIN, isActive: true, id: { not: excludingUserId } },
  });
}

/** Changes a user's role. Requires confirmation client-side (see
 * RoleChangeForm) before this ever runs. Refuses to: leave the system with
 * zero active admins, or let an admin demote themselves away from ADMIN —
 * both checked against real DB state, not just against the request. */
export async function changeUserRole(
  targetUserId: string,
  newRole: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this signature
  _prevState: UserActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- role comes from the bound newRole arg, not the form
  _formData: FormData,
): Promise<UserActionState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = changeableRoleSchema.safeParse(newRole);
  if (!parsed.success) {
    return { error: "دور غير صالح" };
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) {
    return { error: "المستخدم غير موجود" };
  }

  if (target.role === parsed.data) {
    return { error: "المستخدم لديه هذا الدور بالفعل" };
  }

  if (target.role === ROLES.ADMIN && parsed.data !== ROLES.ADMIN) {
    if (targetUserId === admin.id) {
      return { error: "لا يمكنك تغيير دورك الخاص بعيداً عن مدير" };
    }
    const remaining = await countOtherActiveAdmins(targetUserId);
    if (remaining === 0) {
      return { error: "لا يمكن إزالة آخر مدير نشط في النظام" };
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { role: parsed.data } }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        targetUserId,
        action: ADMIN_AUDIT_ACTIONS.ROLE_CHANGED,
        oldValue: { role: target.role },
        newValue: { role: parsed.data },
      },
    }),
  ]);

  revalidateUserPaths(targetUserId);

  return { success: "تم تغيير الدور بنجاح" };
}

/** Toggles a user's active/disabled status. Refuses to let an admin disable
 * their own account, or disable the last active admin. */
export async function toggleUserActive(
  targetUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this signature
  _prevState: UserActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no form fields needed, target comes from the bound arg
  _formData: FormData,
): Promise<UserActionState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) {
    return { error: "المستخدم غير موجود" };
  }

  const willDisable = target.isActive;

  if (willDisable) {
    if (targetUserId === admin.id) {
      return { error: "لا يمكنك إيقاف حسابك الخاص" };
    }
    if (target.role === ROLES.ADMIN) {
      const remaining = await countOtherActiveAdmins(targetUserId);
      if (remaining === 0) {
        return { error: "لا يمكن إيقاف آخر مدير نشط في النظام" };
      }
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { isActive: !target.isActive } }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        targetUserId,
        action: willDisable ? ADMIN_AUDIT_ACTIONS.ACCOUNT_DISABLED : ADMIN_AUDIT_ACTIONS.ACCOUNT_ENABLED,
        oldValue: { isActive: target.isActive },
        newValue: { isActive: !target.isActive },
      },
    }),
    // Kill every existing session immediately on disable — getSession()
    // also rejects isActive:false users as a backstop, but this means a
    // disabled user's very next request is rejected outright rather than
    // relying solely on that lazy check.
    ...(willDisable ? [prisma.session.deleteMany({ where: { userId: targetUserId } })] : []),
  ]);

  revalidateUserPaths(targetUserId);

  return { success: willDisable ? "تم إيقاف الحساب" : "تم تفعيل الحساب" };
}
