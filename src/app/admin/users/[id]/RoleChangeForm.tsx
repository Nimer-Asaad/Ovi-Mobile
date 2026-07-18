"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { changeUserRole, type UserActionState } from "../actions";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { ROLES } from "@/lib/constants";
import { getRoleLabel } from "@/lib/user-labels";

const initialState: UserActionState = {};

const ROLE_OPTIONS = [ROLES.ADMIN, ROLES.SALES_REPRESENTATIVE, ROLES.WHOLESALE_MERCHANT, ROLES.RETAIL_CUSTOMER];

interface RoleChangeFormProps {
  userId: string;
  currentRole: string;
}

/** Role select + explicit confirmation before anything is submitted — the
 * select alone never changes anything; only confirming the dialog submits
 * the bound server action. Server-side safety rules (last-admin,
 * self-demotion) are enforced again in changeUserRole regardless of what
 * this form allows the admin to select. */
export function RoleChangeForm({ userId, currentRole }: RoleChangeFormProps) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const action = changeUserRole.bind(null, userId, selectedRole);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Re-fetch server-rendered data (role badge, audit log, etc.) the moment
  // the action succeeds — router.refresh() re-runs the page's Server
  // Components without a full reload, so the success message below (client
  // state, untouched by refresh) stays visible. Never fires on error: state
  // is a fresh object per action call, so this only re-runs on a genuine
  // new success, not a stale re-render of the same state.
  useEffect(() => {
    if (state.success) {
      router.refresh();
    }
  }, [state, router]);

  const hasChanged = selectedRole !== currentRole;
  const touchesAdmin = selectedRole === ROLES.ADMIN || currentRole === ROLES.ADMIN;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
          <Select label="الدور" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {getRoleLabel(role)}
              </option>
            ))}
          </Select>
        </div>

        <ConfirmDialog
          title="تأكيد تغيير الدور"
          description={
            <>
              سيتم تغيير دور هذا المستخدم من <strong>{getRoleLabel(currentRole)}</strong> إلى{" "}
              <strong>{getRoleLabel(selectedRole)}</strong>. هل تريد المتابعة؟
            </>
          }
          confirmLabel="تأكيد التغيير"
          variant={touchesAdmin ? "danger" : "default"}
          onConfirm={() => formRef.current?.requestSubmit()}
          trigger={(open) => (
            <Button type="button" disabled={!hasChanged || isPending} onClick={open}>
              {isPending && <Spinner />}
              {isPending ? "جارٍ الحفظ..." : "حفظ الدور"}
            </Button>
          )}
        />
      </div>

      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-600">{state.success}</p>}
    </form>
  );
}
