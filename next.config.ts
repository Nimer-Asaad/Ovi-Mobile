import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Server Actions default to a 1MB request body cap, which rejects real
  // product media uploads before src/lib/validation/productMedia.ts ever
  // runs. Raised to match nginx's client_max_body_size (50M) and the app's
  // own MAX_VIDEO_BYTES — does not change the 5MB image / 50MB video limits
  // enforced there.
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
