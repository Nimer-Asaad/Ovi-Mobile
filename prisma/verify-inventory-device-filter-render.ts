/**
 * Helper for verify-inventory-device-filter.ts — NOT a stand-alone check and
 * it never touches a database. React's server renderer refuses to load under
 * the `react-server` condition the verify scripts run with, so the verify
 * script writes the loaded overview data to a JSON file and spawns this file
 * in a plain Node process (no condition) to render the REAL
 * CompanyInventoryOverview component to static markup for several initial
 * device filters.
 *
 * Usage: node --import tsx prisma/verify-inventory-device-filter-render.ts <data.json> <modelId> <otherModelId>
 * Prints one JSON object { on, off, empty, noBrands }.
 */

import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyInventoryOverview } from "../src/components/admin/inventory/CompanyInventoryOverview";

// tsx compiles the project's tsconfig `jsx: preserve` TSX with the classic runtime here.
(globalThis as { React?: unknown }).React = React;

const [dataFile, modelId, emptyModelId] = process.argv.slice(2);
if (!dataFile || !modelId || !emptyModelId) throw new Error("usage: <data.json> <modelId> <emptyModelId>");
const data = JSON.parse(readFileSync(dataFile, "utf8"));
const props = { locations: data.locations, categories: data.categories, products: data.products, deviceBrands: data.deviceBrands };

console.log(
  JSON.stringify({
    on: renderToStaticMarkup(createElement(CompanyInventoryOverview, { ...props, initialDeviceModelId: modelId })),
    off: renderToStaticMarkup(createElement(CompanyInventoryOverview, { ...props, initialDeviceModelId: "" })),
    empty: renderToStaticMarkup(createElement(CompanyInventoryOverview, { ...props, initialDeviceModelId: emptyModelId })),
    noBrands: renderToStaticMarkup(createElement(CompanyInventoryOverview, { ...props, deviceBrands: [], initialDeviceModelId: "" })),
  }),
);
