"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  /** Shown instead of children while the parent <form> is submitting. */
  pendingText?: string;
}

/** Drop-in replacement for `<Button type="submit">` inside a plain
 * `<form action={...}>` (no useActionState) — reads the nearest form's
 * pending state via useFormStatus, so it adds a spinner + disabled state
 * with zero changes to the form's server action. For forms that already
 * use useActionState, prefer passing their own `isPending` to Button
 * directly — useFormStatus does not see state from useActionState's
 * pending flag in the same component that calls it. */
export function SubmitButton({ children, pendingText, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Spinner />}
      {pending ? (pendingText ?? children) : children}
    </Button>
  );
}
