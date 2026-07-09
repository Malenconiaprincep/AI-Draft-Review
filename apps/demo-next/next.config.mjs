/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  eslint: {
    ignoreDuringBuilds: true
  },
  experimental: {
    devtoolSegmentExplorer: false
  },
  transpilePackages: [
    "@tutti/draft-doc",
    "@tutti/editor-highlight-sdk",
    "@tutti/ai-assistant-service",
    "@tutti/ai-assistant-react"
  ]
};

export default nextConfig;
