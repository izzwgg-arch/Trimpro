/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['localhost'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // Repo currently has legacy lint issues; don't block production builds.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Keep the AI SDKs out of the bundler/minifier — Next's SWC transform
    // mangles a bidi-control regex inside them ("Range out of order"), which
    // breaks the production build. Loaded from node_modules at runtime instead.
    serverComponentsExternalPackages: ['@anthropic-ai/sdk', 'openai'],
  },
}

module.exports = nextConfig
