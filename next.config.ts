import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@neondatabase/serverless"],
};

export default nextConfig;
