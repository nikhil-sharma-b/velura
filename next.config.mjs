/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      "*.wgsl": { loaders: ["./tooling/wgsl-loader.cjs"], as: "*.js" },
    },
  },
  allowedDevOrigins: ["192.168.1.100"],
};

export default nextConfig;
