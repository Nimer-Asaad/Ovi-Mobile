"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { registerMerchantSchema } from "@/lib/validation/auth";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";

export interface RegisterMerchantState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function registerMerchant(
  _prevState: RegisterMerchantState,
  formData: FormData,
): Promise<RegisterMerchantState> {
  const parsed = registerMerchantSchema.safeParse({
    name: formData.get("name")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    phone: formData.get("phone")?.toString().trim() || undefined,
    businessName: formData.get("businessName")?.toString() ?? "",
    taxId: formData.get("taxId")?.toString().trim() || undefined,
    password: formData.get("password")?.toString() ?? "",
    confirmPassword: formData.get("confirmPassword")?.toString() ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: "هذا البريد الإلكتروني مستخدم بالفعل" };
  }

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        passwordHash: hashPassword(parsed.data.password),
        role: ROLES.WHOLESALE_MERCHANT,
        merchantProfile: {
          create: {
            businessName: parsed.data.businessName,
            taxId: parsed.data.taxId,
            status: MERCHANT_STATUSES.PENDING,
          },
        },
      },
    });
    userId = user.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "هذا البريد الإلكتروني مستخدم بالفعل" };
    }
    throw err;
  }

  await createSession(userId);
  redirect("/merchant/pending");
}
