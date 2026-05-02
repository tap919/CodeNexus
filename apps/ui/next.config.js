/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@codenexus/shared-types',
    '@codenexus/review-components',
    '@codenexus/vibe-coder-tools',
    '@codenexus/evidence-store',
    '@codenexus/policy-engine',
  ],
};

module.exports = nextConfig;
