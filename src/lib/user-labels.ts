import { ROLES, REGISTRATION_METHODS, USER_ACTIVITY_EVENT_TYPES, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

const ROLE_LABELS: Record<string, string> = {
  [ROLES.ADMIN]: "مدير",
  [ROLES.SALES_REPRESENTATIVE]: "مندوب مبيعات",
  [ROLES.WHOLESALE_MERCHANT]: "تاجر جملة",
  [ROLES.RETAIL_CUSTOMER]: "عميل تجزئة",
};

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function getRoleBadgeVariant(role: string): BadgeVariant {
  switch (role) {
    case ROLES.ADMIN:
      return "gold";
    case ROLES.SALES_REPRESENTATIVE:
      return "success";
    case ROLES.WHOLESALE_MERCHANT:
      return "warning";
    case ROLES.RETAIL_CUSTOMER:
    default:
      return "neutral";
  }
}

const REGISTRATION_METHOD_LABELS: Record<string, string> = {
  [REGISTRATION_METHODS.GOOGLE]: "Google",
  [REGISTRATION_METHODS.EMAIL_PASSWORD]: "بريد إلكتروني وكلمة مرور",
};

export function getRegistrationMethodLabel(method: string): string {
  return REGISTRATION_METHOD_LABELS[method] ?? method;
}

/** Google-authenticated accounts are always created with passwordHash: null
 * (see src/app/auth/google/callback/route.ts) — no separate column needed. */
export function getRegistrationMethod(passwordHash: string | null): string {
  return passwordHash ? REGISTRATION_METHODS.EMAIL_PASSWORD : REGISTRATION_METHODS.GOOGLE;
}

const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  [USER_ACTIVITY_EVENT_TYPES.LOGIN]: "تسجيل دخول",
  [USER_ACTIVITY_EVENT_TYPES.LOGOUT]: "تسجيل خروج",
  [USER_ACTIVITY_EVENT_TYPES.PRODUCT_VIEWED]: "مشاهدة منتج",
  [USER_ACTIVITY_EVENT_TYPES.ADDED_TO_CART]: "إضافة للسلة",
  [USER_ACTIVITY_EVENT_TYPES.REMOVED_FROM_CART]: "إزالة من السلة",
  [USER_ACTIVITY_EVENT_TYPES.CHECKOUT_STARTED]: "بدء الدفع",
  [USER_ACTIVITY_EVENT_TYPES.ORDER_CREATED]: "إنشاء طلب",
  [USER_ACTIVITY_EVENT_TYPES.ORDER_CANCELLED]: "إلغاء طلب",
  [USER_ACTIVITY_EVENT_TYPES.SEARCH_QUERY]: "بحث",
  [USER_ACTIVITY_EVENT_TYPES.ADMIN_ACTION]: "إجراء إداري",
};

export function getActivityEventLabel(type: string): string {
  return ACTIVITY_EVENT_LABELS[type] ?? type;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  [ADMIN_AUDIT_ACTIONS.ROLE_CHANGED]: "تغيير الدور",
  [ADMIN_AUDIT_ACTIONS.ACCOUNT_DISABLED]: "إيقاف الحساب",
  [ADMIN_AUDIT_ACTIONS.ACCOUNT_ENABLED]: "تفعيل الحساب",
  [ADMIN_AUDIT_ACTIONS.MERCHANT_APPROVED]: "اعتماد التاجر",
  [ADMIN_AUDIT_ACTIONS.MERCHANT_REJECTED]: "رفض التاجر",
  [ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPENDED]: "إيقاف التاجر",
  [ADMIN_AUDIT_ACTIONS.MERCHANT_STATUS_RESET]: "إعادة التاجر لقيد المراجعة",
};

export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
