import type { NextConfig } from "next";
import os from "os";

// Collect all non-loopback IPv4 addresses on this machine so phones and other
// devices on the same network can load dev resources (fonts, HMR) without
// Next.js blocking them as cross-origin during development.
const localIPs: string[] = [];
if (process.env.NODE_ENV === "development") {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        localIPs.push(addr.address);
      }
    }
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow devices on the local network to load dev resources and HMR.
  allowedDevOrigins: localIPs,
  async headers() {
    return [
      {
        // The PWA service worker must never be cached, so a new deploy's worker
        // is picked up on the next visit rather than served stale.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
