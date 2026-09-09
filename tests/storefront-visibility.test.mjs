import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(resolve(root, path), "utf8");
const realModules = new Set(["@/lib/storefront-products", "@/lib/catalog-filters", "@/lib/product-filter-url", "@/lib/constants"]);

// Run the real exported functions with explicit DB/framework boundaries.
// No Prisma connection, environment file, or external service is used.
function load(path, mocks = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loadedModule = { exports: {} };
  const dependency = (id) => {
    if (id in mocks) return mocks[id];
    if (realModules.has(id)) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id === "@/lib/prisma") throw new Error("A test must mock Prisma");
    if (id === "server-only") return {};
    if (id.startsWith("@/") || id.startsWith("./")) return {};
    return require(id);
  };
  new Function("require", "module", "exports", code)(dependency, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const hidden = { id: "p1", sku: "SKU1", name: "Product", nameAr: null, isActive: true, isStorefrontVisible: false,
  retailPriceCents: 100, variantMode: "NONE", inventoryTrackingMode: "TOTAL_STOCK", colorOptions: [], variants: [],
  deviceColorVariants: [], images: [], inventoryItems: [{ quantity: 10, variantId: null, deviceColorVariantId: null }] };
const visible = { ...hidden, id: "p2", isStorefrontVisible: true };
const policy = load("src/lib/storefront-products.ts");
const filters = load("src/lib/catalog-filters.ts");
const matches = (product, where) => (!where.isActive || product.isActive) && (!where.isStorefrontVisible || product.isStorefrontVisible);
const base = "0a611e53c55f893c05fc27e1ed139c870e1e238a";
function unchanged(path) {
  assert.equal(read(path).replaceAll("\r\n", "\n"), execFileSync("git", ["show", `${base}:${path}`], { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n"));
}

test("1: schema and additive migration default existing/new products to visible", () => {
  assert.match(read("prisma/schema.prisma"), /isStorefrontVisible\s+Boolean\s+@default\(true\)/);
  assert.match(read("prisma/migrations/20260909120000_add_product_storefront_visibility/migration.sql"), /ADD COLUMN "isStorefrontVisible" BOOLEAN NOT NULL DEFAULT true;/);
});
for (const [number, product, price, expected] of [[2, visible, "retailPriceCents", true], [3, hidden, "retailPriceCents", false], [4, hidden, "wholesalePriceCents", false]]) {
  test(`${number}: ${price} listing visibility = ${expected}`, () => {
    const where = filters.buildProductWhere(filters.parseCatalogSearchParams({}), price);
    assert.equal(matches(product, where), expected);
  });
}
test("5: direct SKU route invokes notFound for both price modes", async () => {
  for (const mode of ["retail", "wholesale"]) {
    const page = load("src/app/products/[sku]/page.tsx", {
      "@/lib/prisma": { prisma: { product: { findFirst: async ({ where }) => matches(hidden, where) ? hidden : null } } },
      "@/lib/auth/session": { getSession: async () => ({}) },
      "@/lib/catalog-queries": { getPriceModeForUser: () => mode },
      "@/lib/cart": { getCartEligibility: () => "eligible" },
      "next/navigation": { notFound: () => { throw Error("NOT_FOUND"); } },
    });
    await assert.rejects(page.default({ params: Promise.resolve({ sku: hidden.sku }) }), /NOT_FOUND/);
  }
});
test("6: admin management returns hidden product", async () => {
  const page = load("src/app/admin/products/page.tsx", {
    "@/lib/prisma": { prisma: { product: { findMany: async (args) => {
      assert.equal(args.where, undefined);
      return [{ ...hidden, inventoryItems: [], _count: { orderItems: 1, stockMovements: 0, stockRequestItems: 0, stockReturnItems: 0 } }];
    } } } },
    "./actions": { removeProduct() {}, toggleProductActive() {}, setProductStorefrontVisibility() {} },
  });
  const tree = await page.default();
  assert.equal(tree.props.children[1].props.products[0].isStorefrontVisible, false);
});
test("7: admin manual sale queries and validation unchanged", () => {
  unchanged("src/app/admin/orders/new/page.tsx");
  unchanged("src/app/admin/orders/new/actions.ts");
});
test("8–9: real REP picker includes hidden product with REP_CAR quantity 10", async () => {
  const rep = load("src/lib/rep-sales.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/prisma": { prisma: { inventoryItem: { findMany: async ({ where }) => {
      assert.deepEqual(where, { locationId: "car", quantity: { gt: 0 } });
      return [{ quantity: 10, product: hidden }];
    } } } },
  });
  const products = await rep.getRepCarSaleProducts("car");
  assert.equal(products[0].id, hidden.id);
  assert.equal(products[0].repStock, 10);
});
test("10: real REP sale core sells hidden product and requests normal car decrement", async () => {
  let decrement;
  let orderData;
  const tx = { order: { create: async ({ data }) => { orderData = data; return { id: "order" }; } } };
  const rep = load("src/lib/rep-sales.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/prisma": { prisma: {
      product: { findMany: async ({ where }) => { assert.deepEqual(where, { id: { in: [hidden.id] } }); return [hidden]; } },
      inventoryItem: { findMany: async () => [{ productId: hidden.id, quantity: 10, variantId: null, deviceColorVariantId: null }] },
      $transaction: async (run) => run(tx),
    } },
    "@/lib/rep-merchants": { resolveOrCreateRepMerchant: async () => ({ id: "merchant", status: "APPROVED", userId: null }) },
    "@/lib/accounts": { getOrCreateMerchantAccount: async () => "account" },
    "@/lib/order-number": { generateDailyOrderNumber: async () => "OVI-TEST" },
    "@/lib/inventory-transactions": { decrementInventoryAtomic: async (_tx, bucket, quantity) => {
      decrement = { bucket, quantity }; return { previousQuantity: 10, newQuantity: 8 };
    }, recordStockMovement: async () => {} },
  });
  const result = await rep.createRepSaleCore({ items: [{ productId: hidden.id, quantity: 2, unitPriceCents: 100 }],
    customerName: "Buyer", customerPhone: "0599999999", city: "City", address: "Address", paidNowCents: 0 },
  { salesRepId: "rep", carStockLocationId: "car", actorUserId: "user" });
  assert.equal(result.ok, true);
  assert.equal(decrement.quantity, 2);
  assert.equal(decrement.bucket.locationId, "car");
  assert.equal(orderData.items.create[0].productId, hidden.id);
});
test("11: historical order/invoice implementations unchanged", () => {
  for (const path of ["src/app/orders", "src/app/admin/orders", "src/app/rep/sales"]) {
    for (const file of readdirSync(resolve(root, path), { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(file))) unchanged(`${path}/${file.replaceAll("\\", "/")}`);
  }
});

function adminFixture(role = "ADMIN") {
  const product = { ...hidden };
  const updates = [];
  const paths = [];
  const action = load("src/app/admin/products/actions.ts", {
    "@/lib/auth/guards": { requireRole: async (roles) => { if (!roles.includes(role)) throw Error("FORBIDDEN"); } },
    "next/cache": { revalidatePath: (...args) => paths.push(args) },
    "next/navigation": {},
    "@/lib/prisma": { prisma: { product: {
      findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, product.id); return product; },
      update: async ({ data }) => { updates.push(data); Object.assign(product, data); },
    } } },
  });
  return { ...action, product, updates, paths };
}
for (const [number, target] of [[12, true], [13, false]]) {
  test(`${number}: explicit visibility setter ${!target} → ${target}`, async () => {
    const fixture = adminFixture();
    fixture.product.isStorefrontVisible = !target;
    await fixture.setProductStorefrontVisibility(hidden.id, target);
    assert.equal(fixture.product.isStorefrontVisible, target);
    assert.deepEqual(fixture.updates, [{ isStorefrontVisible: target }]);
    assert.ok(fixture.paths.some(([path, type]) => path === "/products/[sku]" && type === "page"));
  });
}
for (const [number, quantity] of [[14, 0], [15, 100]]) {
  test(`${number}: stock ${quantity} is independent of storefront availability`, () => {
    assert.equal(policy.isStorefrontProductAvailable({ ...visible, quantity }), true);
    assert.equal(policy.isStorefrontProductAvailable({ ...hidden, quantity }), false);
    unchanged("src/lib/inventory-transactions.ts");
    unchanged("src/app/admin/inventory/actions.ts");
  });
}
test("16: toggling never changes isActive, including inactive products", async () => {
  const fixture = adminFixture();
  fixture.product.isActive = false;
  await fixture.setProductStorefrontVisibility(hidden.id, true);
  assert.equal(fixture.product.isActive, false);
  assert.equal(policy.isStorefrontProductAvailable(fixture.product), false);
});
test("17: customer checkout rejects a product hidden since cart render, before writes", async () => {
  const checkout = load("src/app/checkout/actions.ts", {
    "next/navigation": {},
    "@/lib/auth/guards": { requireCartEligibleUser: async () => ({ id: "buyer" }) },
    "@/lib/validation/checkout": { checkoutSchema: { safeParse: () => ({ success: true, data: {} }) } },
    "@/lib/cart": { getCurrentUserCart: async () => ({ id: "cart", items: [{ product: hidden, quantity: 1 }] }) },
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw Error("Unexpected DB write"); } }) },
  });
  assert.match((await checkout.placeOrder({}, new FormData())).error, /لم يعد متوفراً/);
});
test("18: recent products excludes hidden items for retail and wholesale", async () => {
  for (const mode of ["retail", "wholesale"]) {
    const route = load("src/app/api/products/recent/route.ts", {
      "@/lib/auth/session": { getSession: async () => ({}) },
      "@/lib/catalog-queries": { getPriceModeForUser: () => mode },
      "@/lib/prisma": { prisma: { product: { findMany: async ({ where }) => [hidden, visible].filter((product) => matches(product, where)) } } },
    });
    const response = await route.POST(new Request("http://localhost/api/products/recent", { method: "POST", body: JSON.stringify({ ids: [hidden.id, visible.id] }) }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).products.map((product) => product.id), [visible.id]);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
for (const [number, path] of [[19, "src/app/admin/inventory"], [20, "src/app/rep"]]) {
  test(`${number}: internal query scope ${path} unchanged`, () => {
    for (const file of readdirSync(resolve(root, path), { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(file))) unchanged(`${path}/${file.replaceAll("\\", "/")}`);
    unchanged("src/lib/inventory.ts");
    unchanged("src/lib/company-inventory-report.ts");
    unchanged("src/lib/rep-sales.ts");
  });
}
test("authorization rejects all non-admin roles and malformed inputs", async () => {
  for (const role of ["ADMIN_ASSISTANT", "SALES_REP", "WHOLESALE_MERCHANT", "RETAIL_CUSTOMER", null]) {
    const fixture = adminFixture(role);
    await assert.rejects(fixture.setProductStorefrontVisibility(hidden.id, true), /FORBIDDEN/);
    assert.equal(fixture.updates.length, 0);
  }
  const fixture = adminFixture();
  await assert.rejects(fixture.setProductStorefrontVisibility("", true));
  await assert.rejects(fixture.setProductStorefrontVisibility(hidden.id, "false"));
  assert.equal(fixture.updates.length, 0);
});
test("wishlist excludes hidden products without deleting saved rows", async () => {
  const wishlist = load("src/lib/wishlist.ts", {
    "@/lib/prisma": { prisma: {
      product: { findFirst: async ({ where }) => matches(hidden, where) ? hidden : null },
      wishlistItem: { findMany: async ({ where }) => matches(hidden, where.product) ? [{ product: hidden }] : [] },
    } },
  });
  assert.equal((await wishlist.addToWishlist("buyer", hidden.id)).ok, false);
  assert.deepEqual(await wishlist.getWishlistPage("buyer", "retail"), []);
  assert.deepEqual(await wishlist.getWishlistPage("buyer", "wholesale"), []);
});

test("checkout rechecks a newly hidden product inside transaction before creating order", async () => {
  let locked = false;
  const checkout = load("src/app/checkout/actions.ts", {
    "next/navigation": {},
    "@/lib/auth/guards": { requireCartEligibleUser: async () => ({ id: "buyer" }) },
    "@/lib/validation/checkout": { checkoutSchema: { safeParse: () => ({ success: true, data: {} }) } },
    "@/lib/catalog-queries": { getPriceModeForUser: () => "retail", readCatalogPriceCents: () => 100 },
    "@/lib/inventory": { getMainWarehouse: async () => ({ id: "warehouse" }) },
    "@/lib/cart": {
      getCurrentUserCart: async () => ({ id: "cart", items: [{ product: visible, quantity: 1, variantId: null, deviceColorVariantId: null }] }),
      getAvailableStock: () => 10,
    },
    "@/lib/prisma": { prisma: { $transaction: async (run) => run({
      $queryRaw: async (strings) => {
        assert.match(strings.join("?"), /ORDER BY "id" FOR SHARE/);
        locked = true;
        return [hidden];
      },
      order: { create: () => { throw Error("Must not create an order"); } },
    }) } },
  });
  assert.match((await checkout.placeOrder({}, new FormData())).error, /لم يعد متوفراً/);
  assert.equal(locked, true);
});

test("cart add and quantity update reject hidden products before writes", async () => {
  const actions = load("src/app/cart/actions.ts", {
    "next/cache": {},
    "@/lib/auth/guards": { requireCartEligibleUser: async () => ({ id: "buyer" }) },
    "@/lib/validation/cart": { quantitySchema: { safeParse: () => ({ success: true, data: 1 }) } },
    "@/lib/prisma": { prisma: {
      product: { findUnique: async () => hidden },
      cartItem: { findUnique: async () => ({ product: hidden, cart: { userId: "buyer" } }) },
    } },
  });
  assert.ok((await actions.addToCart(hidden.id, null, null, null, {}, new FormData())).error);
  assert.ok((await actions.updateCartItemQuantity("item", {}, new FormData())).error);
});
