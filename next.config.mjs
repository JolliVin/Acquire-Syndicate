/** @type {import('next').NextConfig} */
const nextConfig = {
  /* We disable Strict Mode because PeerJS often tries to connect twice 
     during development/build in Strict Mode, which causes "ID already taken" errors.
  */
  reactStrictMode: false,
};

export default nextConfig;