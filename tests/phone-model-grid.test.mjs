import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

// Same load-the-real-module pattern as tests/storefront-visibility.test.mjs —
// no Prisma/DB/React involved, phone-model-grouping.ts has zero imports.
function load(path) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(() => ({}), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const grouping = load("src/lib/phone-model-grouping.ts");

const model = (id, name) => ({ id, name, nameAr: null });

test("1: Samsung A-prefixed models group under سلسلة A", () => {
  const groups = grouping.groupAndSortModels([model("1", "A05S"), model("2", "A54"), model("3", "S23 FE")]);
  const aGroup = groups.find((g) => g.label === "سلسلة A");
  assert.ok(aGroup);
  assert.deepEqual(aGroup.models.map((m) => m.id).sort(), ["1", "2"]);
});

test("2: Samsung S-prefixed models group under سلسلة S", () => {
  const groups = grouping.groupAndSortModels([model("1", "S21 Ultra"), model("2", "S25 ultra"), model("3", "A13")]);
  const sGroup = groups.find((g) => g.label === "سلسلة S");
  assert.ok(sGroup);
  assert.deepEqual(sGroup.models.map((m) => m.id).sort(), ["1", "2"]);
});

test("3: an unclassifiable model name falls into أخرى, never invented/renamed", () => {
  const groups = grouping.groupAndSortModels([model("1", "Ultra Range Pro")]);
  const otherGroup = groups.find((g) => g.label === "أخرى");
  assert.ok(otherGroup);
  assert.equal(otherGroup.models[0].name, "Ultra Range Pro");
});

test("4: natural sort orders A1, A2, A10, A11 numerically, not lexically", () => {
  const groups = grouping.groupAndSortModels([model("10", "A10"), model("1", "A1"), model("11", "A11"), model("2", "A2")]);
  const aGroup = groups.find((g) => g.label === "سلسلة A");
  assert.deepEqual(aGroup.models.map((m) => m.name), ["A1", "A2", "A10", "A11"]);
});

test("5: searching A26 matches a compound stored label A17/A26", () => {
  assert.ok(grouping.modelLabelMatchesQuery("A17/A26", "A26"));
  assert.ok(grouping.modelLabelMatchesQuery("A17/A26", "a26"));
});

test("6: search normalization ignores case, spaces, and hyphens", () => {
  for (const query of ["A26", "a26", "A 26", "A-26"]) {
    assert.ok(grouping.modelLabelMatchesQuery("A26", query), `expected query "${query}" to match label "A26"`);
  }
  assert.ok(grouping.modelLabelMatchesQuery("iPhone 17 Pro Max", "iphone17promax"));
  assert.ok(grouping.modelLabelMatchesQuery("iPhone17ProMax", "iphone 17 pro max"));
  assert.ok(grouping.modelLabelMatchesQuery("S23Ultra", "s23 ultra"));
});

test("7: grouping/sorting preserves every model's original id untouched", () => {
  const input = [model("real-id-1", "A05S"), model("real-id-2", "S23 FE")];
  const groups = grouping.groupAndSortModels(input);
  const ids = groups.flatMap((g) => g.models.map((m) => m.id));
  assert.deepEqual(ids.sort(), ["real-id-1", "real-id-2"]);
});

test("8: grouping never mutates the input model objects or their ids", () => {
  const input = [model("real-id-1", "A05S")];
  grouping.groupAndSortModels(input);
  assert.equal(input[0].id, "real-id-1");
  assert.equal(input[0].name, "A05S");
});

test("9: a query with no matches yields no visible models for any group", () => {
  const groups = grouping.groupAndSortModels([model("1", "A05S"), model("2", "S23 FE")]);
  const filtered = groups
    .map((g) => ({ ...g, models: g.models.filter((m) => grouping.modelLabelMatchesQuery(m.name, "ZZZ999")) }))
    .filter((g) => g.models.length > 0);
  assert.deepEqual(filtered, []);
});

test("10: storefront business logic (cart/checkout/visibility/pricing) is untouched by this UI-only change", () => {
  const base = "7e1dd58d9d0fe2a07e8558c1023467d60b97db0f";
  const unchangedFiles = [
    "src/lib/storefront-products.ts",
    "src/lib/catalog-filters.ts",
    "src/lib/cart.ts",
    "src/app/cart/actions.ts",
    "src/app/checkout/actions.ts",
    "src/app/admin/products/actions.ts",
    "src/app/admin/orders/new/page.tsx",
    "src/app/admin/orders/new/actions.ts",
    "prisma/schema.prisma",
  ];
  for (const path of unchangedFiles) {
    const current = read(path).replaceAll("\r\n", "\n");
    const atBase = execFileSync("git", ["show", `${base}:${path}`], { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n");
    assert.equal(current, atBase, `${path} must be unchanged by the phone-model-selector UI update`);
  }
});
