import { PrismaClient } from "@prisma/client";
import { ROLES, STOCK_LOCATION_TYPES, MERCHANT_STATUSES } from "../src/lib/constants";
import { hashPassword } from "../src/lib/auth/password";
import { slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

/** Branded placehold.co URL matching the app's light teal/navy palette —
 * stable, dependency-free, no API key. */
function placeholderImage(label: string): string {
  return `https://placehold.co/600x600/eef8fb/0f172a?text=${encodeURIComponent(label)}`;
}

/**
 * Phase 3 seed: Phase 2's accounts, plus a sample catalog (categories,
 * brands, suppliers, products) and demo on-hand stock so the admin product
 * list / low-stock dashboard aren't all zeros. This is seed/demo stock only
 * — no StockMovement rows, no inventory workflow (that's Phase 6).
 *
 * Phase 4 seed: adds ProductImage rows (branded placeholders) per product.
 * Image seeding is idempotent — each run deletes and recreates a product's
 * images rather than appending, so re-running db:seed never duplicates them.
 *
 * Planned seed additions (by phase):
 * - Phase 6 (inventory): opening stock movements, additional locations
 * - Phase 7 (orders): sample retail/wholesale/rep-sale orders
 */
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@ovimobile.ps" },
    update: { passwordHash: hashPassword("Admin12345!") },
    create: {
      email: "admin@ovimobile.ps",
      name: "Ovi Mobile Admin",
      role: ROLES.ADMIN,
      passwordHash: hashPassword("Admin12345!"),
    },
  });

  const mainWarehouse = await prisma.stockLocation.upsert({
    where: { id: "main-warehouse" },
    update: {},
    create: {
      id: "main-warehouse",
      type: STOCK_LOCATION_TYPES.WAREHOUSE,
      name: "Main Warehouse",
      isDefault: true,
    },
  });

  const approvedMerchant = await prisma.user.upsert({
    where: { email: "merchant.approved@ovimobile.ps" },
    update: { passwordHash: hashPassword("Merchant12345!") },
    create: {
      email: "merchant.approved@ovimobile.ps",
      name: "تاجر معتمد",
      role: ROLES.WHOLESALE_MERCHANT,
      passwordHash: hashPassword("Merchant12345!"),
      merchantProfile: {
        create: {
          businessName: "متجر الأمل للإكسسوارات",
          status: MERCHANT_STATUSES.APPROVED,
          approvedAt: new Date(),
        },
      },
    },
  });

  const pendingMerchant = await prisma.user.upsert({
    where: { email: "merchant.pending@ovimobile.ps" },
    update: { passwordHash: hashPassword("Merchant12345!") },
    create: {
      email: "merchant.pending@ovimobile.ps",
      name: "تاجر قيد المراجعة",
      role: ROLES.WHOLESALE_MERCHANT,
      passwordHash: hashPassword("Merchant12345!"),
      merchantProfile: {
        create: {
          businessName: "متجر النور",
          status: MERCHANT_STATUSES.PENDING,
        },
      },
    },
  });

  const salesRep = await prisma.user.upsert({
    where: { email: "rep@ovimobile.ps" },
    update: { passwordHash: hashPassword("Rep12345!") },
    create: {
      email: "rep@ovimobile.ps",
      name: "مندوب المبيعات",
      role: ROLES.SALES_REPRESENTATIVE,
      passwordHash: hashPassword("Rep12345!"),
      salesRepresentativeProfile: {
        create: {
          employeeCode: "REP-001",
        },
      },
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: "customer@ovimobile.ps" },
    update: { passwordHash: hashPassword("Customer12345!") },
    create: {
      email: "customer@ovimobile.ps",
      name: "عميل تجريبي",
      role: ROLES.RETAIL_CUSTOMER,
      passwordHash: hashPassword("Customer12345!"),
    },
  });

  // ---------------------------------------------------------------------
  // Catalog: categories, brands, suppliers
  // ---------------------------------------------------------------------

  const categoryDefs = [
    { name: "Headphones", nameAr: "سماعات" },
    { name: "Chargers", nameAr: "شواحن" },
    { name: "Phone Cases", nameAr: "كفرات" },
    { name: "Cables", nameAr: "كابلات" },
    { name: "Smart Watches", nameAr: "ساعات ذكية" },
  ];

  const categories: Record<string, Awaited<ReturnType<typeof prisma.category.upsert>>> = {};
  for (const def of categoryDefs) {
    const slug = slugify(def.name);
    categories[def.name] = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name: def.name, nameAr: def.nameAr, slug },
    });
  }

  const brandDefs = ["Anker", "Baseus", "Ugreen", "Spigen", "Remax"];
  const brands: Record<string, Awaited<ReturnType<typeof prisma.brand.upsert>>> = {};
  for (const name of brandDefs) {
    brands[name] = await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
  }

  const supplierDefs = [
    {
      name: "مؤسسة الشرق للاستيراد",
      contactName: "محمد عودة",
      phone: "0599123456",
      email: "sales@alsharq-import.ps",
      address: "رام الله، فلسطين",
      notes: "مورد رئيسي للسماعات والشواحن",
    },
    {
      name: "شركة النجمة للإلكترونيات",
      contactName: "سامر خليل",
      phone: "0598765432",
      email: "info@najma-electronics.ps",
      address: "نابلس، فلسطين",
      notes: "توريد كابلات وإكسسوارات متنوعة",
    },
    {
      name: "مصنع الأمانة للإكسسوارات",
      contactName: "ليلى حمدان",
      phone: "0597654321",
      address: "الخليل، فلسطين",
      notes: null,
    },
  ];

  const suppliers: Record<string, Awaited<ReturnType<typeof prisma.supplier.upsert>>> = {};
  for (const def of supplierDefs) {
    let supplier = await prisma.supplier.findFirst({ where: { name: def.name } });
    supplier ??= await prisma.supplier.create({ data: def });
    suppliers[def.name] = supplier;
  }

  const supplierNames = supplierDefs.map((s) => s.name);

  // ---------------------------------------------------------------------
  // Products (+ demo on-hand stock at the main warehouse)
  // ---------------------------------------------------------------------

  const productDefs = [
    {
      sku: "AK-Q20-BLK",
      name: "Anker Soundcore Life Q20",
      nameAr: "سماعة أنكر ساوندكور لايف Q20",
      description: "Wireless over-ear headphones with clear sound quality and long battery life, ideal for everyday use.",
      descriptionAr: "سماعة رأس لاسلكية بجودة صوت واضحة وعمر بطارية طويل، مناسبة للاستخدام اليومي والاستماع المريح.",
      category: "Headphones",
      brand: "Anker",
      supplier: supplierNames[0],
      retailPriceCents: 24900,
      wholesalePriceCents: 18500,
      costCents: 14000,
      isFeatured: true,
      stock: 25,
      images: [placeholderImage("Anker Q20"), placeholderImage("Anker Q20 2")],
    },
    {
      sku: "BS-GAN65",
      name: "Baseus GaN 65W Charger",
      nameAr: "شاحن باسيوس GaN بقدرة 65 واط",
      description: "Compact 65W fast charger suitable for efficiently and safely charging phones and laptops.",
      descriptionAr: "شاحن سريع بقدرة 65 واط بتصميم مدمج، مناسب لشحن الهواتف واللابتوب بكفاءة وأمان.",
      category: "Chargers",
      brand: "Baseus",
      supplier: supplierNames[0],
      retailPriceCents: 18900,
      wholesalePriceCents: 13500,
      costCents: 9500,
      isFeatured: true,
      stock: 40,
      images: [placeholderImage("Baseus GaN 65W"), placeholderImage("Baseus GaN 65W 2")],
    },
    {
      sku: "UG-CBL-1M",
      name: "Ugreen USB-C to Lightning Cable 1m",
      nameAr: "كابل يوجرين USB-C إلى لايتننج 1 متر",
      description: "Durable everyday cable that supports charging and data transfer depending on device compatibility.",
      descriptionAr: "كابل متين للاستخدام اليومي يدعم الشحن ونقل البيانات حسب توافق الجهاز.",
      category: "Cables",
      brand: "Ugreen",
      supplier: supplierNames[1],
      retailPriceCents: 5900,
      wholesalePriceCents: 3900,
      costCents: 2200,
      isFeatured: false,
      stock: 60,
      images: [placeholderImage("Ugreen Cable 1m")],
    },
    {
      sku: "SP-RA-IP15",
      name: "Spigen Rugged Armor Case iPhone 15",
      nameAr: "كفر سبيجن راجد أرمور لآيفون 15",
      description: "Rugged protective case that shields the phone from drops and scratches while staying easy to use daily.",
      descriptionAr: "كفر حماية بتصميم متين يحافظ على الهاتف من الصدمات والخدوش مع سهولة الاستخدام اليومي.",
      category: "Phone Cases",
      brand: "Spigen",
      supplier: supplierNames[2],
      retailPriceCents: 8900,
      wholesalePriceCents: 6200,
      costCents: 4000,
      isFeatured: true,
      stock: 3,
      images: [placeholderImage("Spigen Case iP15"), placeholderImage("Spigen Case iP15 2")],
    },
    {
      sku: "RX-SW01",
      name: "Remax Smart Watch RW-01",
      nameAr: "ساعة ريماكس الذكية RW-01",
      description: "Practical smart watch with a sleek design that supports notifications and daily activity tracking.",
      descriptionAr: "ساعة ذكية عملية بتصميم أنيق، تدعم متابعة الإشعارات والأنشطة اليومية.",
      category: "Smart Watches",
      brand: "Remax",
      supplier: supplierNames[1],
      retailPriceCents: 34900,
      wholesalePriceCents: 26500,
      costCents: 19000,
      isFeatured: true,
      stock: 12,
      images: [placeholderImage("Remax Watch RW01"), placeholderImage("Remax Watch RW01 2")],
    },
    {
      sku: "AK-PC10K",
      name: "Anker PowerCore 10000",
      nameAr: "باور بانك أنكر باوركور 10000",
      description: "Portable power bank with practical capacity, offering extra charging on the go with a safe, easy-to-carry design.",
      descriptionAr: "باور بانك بسعة عملية يوفر شحناً إضافياً للهاتف أثناء التنقل، بتصميم آمن وسهل الحمل.",
      category: "Chargers",
      brand: "Anker",
      supplier: undefined,
      retailPriceCents: 15900,
      wholesalePriceCents: 11500,
      costCents: 8000,
      isFeatured: false,
      stock: 4,
      images: [placeholderImage("Anker PowerCore 10K")],
    },
    {
      sku: "BS-EB-W1",
      name: "Baseus Bluetooth Earbuds W1",
      nameAr: "سماعات باسيوس بلوتوث W1",
      description: "Lightweight wireless Bluetooth earbuds suitable for everyday use with stable connectivity.",
      descriptionAr: "سماعات بلوتوث لاسلكية خفيفة الوزن، مناسبة للاستخدام اليومي مع اتصال مستقر.",
      category: "Headphones",
      brand: "Baseus",
      supplier: supplierNames[0],
      retailPriceCents: 12900,
      wholesalePriceCents: 9200,
      costCents: 6000,
      isFeatured: false,
      stock: 18,
      images: [placeholderImage("Baseus Earbuds W1"), placeholderImage("Baseus Earbuds W1 2")],
    },
    {
      sku: "UG-HDMI-2M",
      name: "Ugreen HDMI Cable 2m",
      nameAr: "كابل يوجرين HDMI طول 2 متر",
      description: "HDMI cable with a practical length for transmitting high-quality video and audio between devices.",
      descriptionAr: "كابل HDMI بطول عملي لنقل الصورة والصوت بجودة عالية بين الأجهزة.",
      category: "Cables",
      brand: "Ugreen",
      supplier: supplierNames[1],
      retailPriceCents: 6900,
      wholesalePriceCents: 4700,
      costCents: 2800,
      isFeatured: false,
      stock: 30,
      images: [placeholderImage("Ugreen HDMI 2m")],
    },
    {
      sku: "SP-GLASS-IP15",
      name: "Spigen Tempered Glass Screen Protector",
      nameAr: "واقي شاشة زجاجي سبيجن",
      description: "Practical screen protection with a clear design that preserves display clarity.",
      descriptionAr: "حماية عملية للشاشة بتصميم شفاف يحافظ على وضوح العرض.",
      category: "Phone Cases",
      brand: "Spigen",
      supplier: undefined,
      retailPriceCents: 3900,
      wholesalePriceCents: 2500,
      costCents: 1200,
      isFeatured: false,
      stock: 50,
      images: [placeholderImage("Spigen Glass IP15")],
    },
    {
      sku: "RX-CBL-LT",
      name: "Remax Braided Lightning Cable",
      nameAr: "كابل ريماكس لايتننج مجدول",
      description: "Durable braided charging cable built for intensive daily use compared to standard cables.",
      descriptionAr: "كابل شحن مجدول متين يدعم الاستخدام اليومي المكثف مقارنة بالكابلات التقليدية.",
      category: "Cables",
      brand: "Remax",
      supplier: supplierNames[2],
      retailPriceCents: 4900,
      wholesalePriceCents: 3200,
      costCents: 1800,
      isFeatured: false,
      stock: 22,
      images: [placeholderImage("Remax Cable LT")],
    },
  ];

  for (const def of productDefs) {
    const product = await prisma.product.upsert({
      where: { sku: def.sku },
      update: {
        description: def.description,
        descriptionAr: def.descriptionAr,
      },
      create: {
        sku: def.sku,
        name: def.name,
        nameAr: def.nameAr,
        description: def.description,
        descriptionAr: def.descriptionAr,
        categoryId: categories[def.category]?.id,
        brandId: brands[def.brand]?.id,
        supplierId: def.supplier ? suppliers[def.supplier]?.id : undefined,
        retailPriceCents: def.retailPriceCents,
        wholesalePriceCents: def.wholesalePriceCents,
        costCents: def.costCents,
        isFeatured: def.isFeatured,
      },
    });

    await prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId: product.id, locationId: mainWarehouse.id } },
      update: { quantity: def.stock },
      create: { productId: product.id, locationId: mainWarehouse.id, quantity: def.stock },
    });

    // Idempotent: delete-then-recreate rather than append, so re-running
    // db:seed never duplicates images.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    if (def.images.length > 0) {
      await prisma.productImage.createMany({
        data: def.images.map((url, index) => ({
          productId: product.id,
          url,
          altText: def.name,
          isMain: index === 0,
          sortOrder: index,
        })),
      });
    }
  }

  console.log("Seeded admin user:", admin.email);
  console.log("Seeded default stock location:", mainWarehouse.name);
  console.log("Seeded approved merchant:", approvedMerchant.email);
  console.log("Seeded pending merchant:", pendingMerchant.email);
  console.log("Seeded sales rep:", salesRep.email);
  console.log("Seeded customer:", customer.email);
  const featuredCount = productDefs.filter((p) => p.isFeatured).length;
  const imageCount = productDefs.reduce((sum, p) => sum + p.images.length, 0);
  console.log(
    `Seeded ${categoryDefs.length} categories, ${brandDefs.length} brands, ${supplierDefs.length} suppliers, ${productDefs.length} products (${featuredCount} featured, ${imageCount} images)`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
