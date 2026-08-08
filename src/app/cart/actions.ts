"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCartEligibleUser } from "@/lib/auth/guards";
import { STOCK_CHECK_PRODUCT_SELECT, getAvailableStock } from "@/lib/cart";
import { quantitySchema } from "@/lib/validation/cart";

export interface CartActionState {
  error?: string;
  success?: boolean;
}

const OUT_OF_STOCK_MESSAGE = "المنتج غير متوفر حالياً";
const CART_ITEM_NOT_FOUND_MESSAGE = "العنصر غير موجود في سلتك";

function parseQuantity(formData: FormData): { quantity: number } | { error: string } {
  const parsed = quantitySchema.safeParse(formData.get("quantity")?.toString() ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "الكمية غير صحيحة" };
  }
  return { quantity: parsed.data };
}

export async function addToCart(
  productId: string,
  colorId: string | null,
  variantId: string | null,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const user = await requireCartEligibleUser();

  const parsedQuantity = parseQuantity(formData);
  if ("error" in parsedQuantity) {
    return { error: parsedQuantity.error };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { ...STOCK_CHECK_PRODUCT_SELECT, colorOptions: { select: { colorId: true } }, variants: { where: { isActive: true }, select: { id: true } } },
  });

  if (!product || !product.isActive) {
    return { error: OUT_OF_STOCK_MESSAGE };
  }

  // Never trust the client's colorId/variantId — each is validated
  // independently against what this product actually offers. Color is a
  // pure descriptive attribute (never affects stock) and can be picked
  // alongside a variant, on its own, or not at all.
  const usesVariants = product.variantMode === "PHONE_COMPATIBILITY";
  if (usesVariants) {
    if (product.variantAllocationStatus !== "READY") return { error: "مخزون هذا المنتج ما زال قيد المراجعة" };
    if (!variantId || !product.variants.some((variant) => variant.id === variantId)) return { error: "اختر ماركة الهاتف والموديل بشكل صحيح" };
  } else if (variantId) return { error: "هذا المنتج لا يستخدم Variants" };
  const resolvedVariantId = usesVariants ? variantId : null;

  const hasColorOptions = product.colorOptions.length > 0;
  if (hasColorOptions && (!colorId || !product.colorOptions.some((option) => option.colorId === colorId))) {
    return { error: "اختر لوناً متوفراً لهذا المنتج" };
  }
  if (!hasColorOptions && colorId) {
    return { error: "هذا المنتج لا يتوفر بألوان" };
  }
  const resolvedColorId = hasColorOptions ? colorId : null;

  const availableStock = getAvailableStock(product, resolvedVariantId);

  const cart = await prisma.cart.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  // Never the cartId_productId_colorId_variantId-style compound-key
  // shorthand — Prisma's generated type for it disallows `null`, and SQL
  // unique constraints treat NULL as distinct from every other NULL anyway,
  // so uniqueness across every null/non-null combination of colorId and
  // variantId is enforced by four hand-authored partial indexes instead
  // (see the migration) — only a plain filter can query them.
  const itemFilter = { cartId: cart.id, productId, colorId: resolvedColorId, variantId: resolvedVariantId };
  const existingItem = await prisma.cartItem.findFirst({ where: itemFilter });

  const newQuantity = (existingItem?.quantity ?? 0) + parsedQuantity.quantity;

  if (newQuantity > availableStock) {
    return { error: `الكمية المتوفرة في المخزون هي ${availableStock} فقط` };
  }

  if (existingItem) {
    await prisma.cartItem.update({ where: { id: existingItem.id }, data: { quantity: newQuantity } });
  } else {
    try {
      await prisma.cartItem.create({ data: { ...itemFilter, quantity: newQuantity } });
    } catch (err) {
      // Lost a create race to a concurrent request for the same line —
      // fall back to updating the row it just inserted.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        await prisma.cartItem.updateMany({ where: itemFilter, data: { quantity: newQuantity } });
      } else {
        throw err;
      }
    }
  }

  revalidatePath("/cart");
  return { success: true };
}

export async function updateCartItemQuantity(
  cartItemId: string,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const user = await requireCartEligibleUser();

  const parsedQuantity = parseQuantity(formData);
  if ("error" in parsedQuantity) {
    return { error: parsedQuantity.error };
  }

  const item = await prisma.cartItem.findUnique({
    where: { id: cartItemId },
    include: { cart: true, product: { select: STOCK_CHECK_PRODUCT_SELECT } },
  });

  if (!item || item.cart.userId !== user.id) {
    return { error: CART_ITEM_NOT_FOUND_MESSAGE };
  }

  const availableStock = getAvailableStock(item.product, item.variantId);
  if (parsedQuantity.quantity > availableStock) {
    return { error: `الكمية المتوفرة في المخزون هي ${availableStock} فقط` };
  }

  await prisma.cartItem.update({ where: { id: cartItemId }, data: { quantity: parsedQuantity.quantity } });

  revalidatePath("/cart");
  return { success: true };
}

export async function removeCartItem(cartItemId: string): Promise<void> {
  const user = await requireCartEligibleUser();

  const item = await prisma.cartItem.findUnique({ where: { id: cartItemId }, include: { cart: true } });
  if (item && item.cart.userId === user.id) {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
  }

  revalidatePath("/cart");
}

export async function clearCart(): Promise<void> {
  const user = await requireCartEligibleUser();

  const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  revalidatePath("/cart");
}
