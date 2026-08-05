import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { ColorInventoryGrid } from "./ColorInventoryGrid";

/** Bulk stocktaking grid — rows are products that have at least one color
 * option, columns are the union of colors those products offer, cells are
 * each product+color's warehouse quantity. Complements the single-product
 * AdjustStockForm for entering many counts at once. */
export default async function AdminColorInventoryPage() {
  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    where: { isActive: true, colorOptions: { some: {} } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      colorOptions: {
        select: { color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const productIds = products.map((product) => product.id);
  const inventory = productIds.length
    ? await prisma.inventoryItem.findMany({
        where: { productId: { in: productIds }, locationId: warehouse.id, colorId: { not: null } },
        select: { productId: true, colorId: true, quantity: true },
      })
    : [];
  const quantityByKey = new Map(inventory.map((item) => [`${item.productId}:${item.colorId}`, item.quantity]));

  const columnsById = new Map<string, { id: string; name: string; nameAr: string | null; hexCode: string | null }>();
  for (const product of products) {
    for (const option of product.colorOptions) {
      columnsById.set(option.color.id, option.color);
    }
  }
  const columns = [...columnsById.values()].sort((a, b) => (a.nameAr ?? a.name).localeCompare(b.nameAr ?? b.name));

  const rows = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    colorIds: product.colorOptions.map((option) => option.color.id),
    quantities: Object.fromEntries(
      product.colorOptions.map((option) => [
        option.color.id,
        quantityByKey.get(`${product.id}:${option.color.id}`) ?? 0,
      ]),
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="جرد الألوان" subtitle={`عدّل كمية كل منتج × لون في ${warehouse.name} دفعة واحدة`} />
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-bg/60">
          لا توجد منتجات لديها ألوان بعد — أضِف ألواناً لمنتج من صفحة تعديل المنتج أولاً.
        </p>
      ) : (
        <ColorInventoryGrid rows={rows} columns={columns} />
      )}
    </div>
  );
}
