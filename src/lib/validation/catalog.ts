import { z } from "zod";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  name: z.string().min(2, "اسم القسم يجب أن يكون حرفين على الأقل"),
  nameAr: z.string().optional(),
});

export type CategoryInput = z.infer<typeof categorySchema>;

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export const brandSchema = z.object({
  name: z.string().min(2, "اسم العلامة التجارية يجب أن يكون حرفين على الأقل"),
  logoUrl: z.string().optional().refine((v) => !v || /^https?:\/\//.test(v), {
    message: "رابط الشعار يجب أن يبدأ بـ http:// أو https://",
  }),
});

export type BrandInput = z.infer<typeof brandSchema>;

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const supplierSchema = z.object({
  name: z.string().min(2, "اسم المورد يجب أن يكون حرفين على الأقل"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional().refine((v) => !v || z.string().email().safeParse(v).success, {
    message: "صيغة البريد الإلكتروني غير صحيحة",
  }),
  address: z.string().optional(),
  notes: z.string().optional(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Admin types plain NIS amounts (e.g. "89.90"); this converts to integer
 * agorot cents for storage, matching the Int-cents money convention used
 * throughout the schema. */
const requiredMoney = (label: string) =>
  z
    .string()
    .min(1, `${label} مطلوب`)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
      message: `${label} يجب أن يكون رقماً موجباً أو صفر`,
    })
    .transform((v) => Math.round(Number(v) * 100));

const optionalMoney = (label: string) =>
  z
    .string()
    .optional()
    .refine((v) => !v || (Number.isFinite(Number(v)) && Number(v) >= 0), {
      message: `${label} يجب أن يكون رقماً موجباً أو صفر`,
    })
    .transform((v) => (v && v.trim() !== "" ? Math.round(Number(v) * 100) : undefined));

export const productSchema = z
  .object({
    name: z.string().min(2, "اسم المنتج يجب أن يكون حرفين على الأقل"),
    nameAr: z.string().optional(),
    description: z.string().optional(),
    sku: z
      .string()
      .min(2, "رمز المنتج (SKU) مطلوب")
      .transform((v) => v.trim().toUpperCase()),
    categoryId: z.string().min(1, "القسم مطلوب"),
    brandId: z.string().min(1, "العلامة التجارية مطلوبة"),
    supplierId: z.string().optional(),
    retailPriceCents: requiredMoney("سعر التجزئة"),
    wholesalePriceCents: requiredMoney("سعر الجملة"),
    costCents: optionalMoney("سعر التكلفة"),
  })
  .refine((data) => data.retailPriceCents >= data.wholesalePriceCents, {
    message: "سعر التجزئة يجب أن يكون أكبر من أو يساوي سعر الجملة",
    path: ["retailPriceCents"],
  })
  .refine((data) => data.costCents === undefined || data.wholesalePriceCents >= data.costCents, {
    message: "سعر الجملة يجب أن يكون أكبر من أو يساوي سعر التكلفة",
    path: ["wholesalePriceCents"],
  });

export type ProductInput = z.infer<typeof productSchema>;
