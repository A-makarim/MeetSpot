/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      { source: "/m/:id", destination: "/index.html" },
      { source: "/r/:id", destination: "/index.html" }
    ];
  }
};

export default nextConfig;
