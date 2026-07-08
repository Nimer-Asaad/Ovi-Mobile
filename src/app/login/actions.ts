"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getPostLoginRedirect } from "@/lib/auth/redirects";
import { loginSchema } from "@/lib/validation/auth";
import type { Role } from "@/types";

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { merchantProfile: true },
  });

  if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }

  if (!user.isActive) {
    return { error: "هذا الحساب غير مفعّل" };
  }

  await createSession(user.id);

  redirect(
    getPostLoginRedirect({
      role: user.role as Role,
      merchantStatus: user.merchantProfile?.status ?? null,
    }),
  );
}
