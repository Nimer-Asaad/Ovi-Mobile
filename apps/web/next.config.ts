import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ovi/api-client", "@ovi/contracts", "@ovi/ui"],
};

export default nextConfig;
