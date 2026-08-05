import { z } from "zod";

const colorInventoryCellSchema = z.object({
  productId: z.string().min(1),
  colorId: z.string().min(1),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").nonnegative("الكمية لا يمكن أن تكون سالبة"),
});

export const colorInventoryBulkAdjustSchema = z.object({
  cells: z
    .array(colorInventoryCellSchema)
    .min(1, "لم تُعدّل أي كمية")
    .max(300, "عدد كبير جداً من الخلايا في عملية جرد واحدة")
    .refine((cells) => new Set(cells.map((cell) => `${cell.productId}:${cell.colorId}`)).size === cells.length, {
      message: "لا يمكن تكرار نفس المنتج/اللون أكثر من مرة",
    }),
});

export type ColorInventoryBulkAdjustInput = z.infer<typeof colorInventoryBulkAdjustSchema>;
