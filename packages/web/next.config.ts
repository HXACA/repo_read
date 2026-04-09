import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@reporead/core"],
  devIndicators: false,
};

export default nextConfig;
