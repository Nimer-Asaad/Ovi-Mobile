import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function getDeploymentId(): string | undefined {
  if (process.env.DEPLOYMENT_VERSION) return process.env.DEPLOYMENT_VERSION;

  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Detect clients that still hold RSC payloads or Server Action references
  // from a previous self-hosted build and force a full navigation.
  deploymentId: getDeploymentId(),
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
