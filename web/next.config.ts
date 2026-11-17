import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully user-specific (RLS, realtime), so we render dynamically and skip Cache Components.
  turbopack: {
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
