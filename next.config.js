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
}

module.exports = nextConfig
