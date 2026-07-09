"use server";

import { revalidatePath } from "next/cache";
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
    select: STOCK_CHECK_PRODUCT_SELECT,
  });

  if (!product || !product.isActive) {
    return { error: OUT_OF_STOCK_MESSAGE };
  }

  const availableStock = getAvailableStock(product);

  const cart = await prisma.cart.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  const existingItem = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
  });

  const newQuantity = (existingItem?.quantity ?? 0) + parsedQuantity.quantity;

  if (newQuantity > availableStock) {
    return { error: `الكمية المتوفرة في المخزون هي ${availableStock} فقط` };
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: newQuantity },
    create: { cartId: cart.id, productId, quantity: newQuantity },
  });

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

  const availableStock = getAvailableStock(item.product);
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
