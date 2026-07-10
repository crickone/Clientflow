/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image
  // (.next/standalone). Native deps (better-sqlite3, ffmpeg-static) stay
  // external — see serverComponentsExternalPackages below.
  output: "standalone",
  images: { unoptimized: true },
  // Types are validated locally (tsc --noEmit + a full `next build`) before every
  // deploy. Skip the in-Docker type-check, which is redundant and has flaked
  // (OOM on Railway's builder) — keeping production builds reliable.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // better-sqlite3 ships native bindings — keep it server-only.
    serverComponentsExternalPackages: [
      "better-sqlite3",
      "ffmpeg-static",
      "ffprobe-static",
    ],
  },
};

export default nextConfig;
