import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--enable-unsafe-webgpu",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        // Linux CI has no GPU. Without Vulkan-backed SwiftShader, headless
        // Chromium cannot back a WebGPU canvas swap chain, and the device is
        // lost on the first present.
        ...(process.platform === "linux"
          ? [
              "--enable-features=Vulkan",
              "--use-vulkan=swiftshader",
              "--use-webgpu-adapter=swiftshader",
            ]
          : []),
      ],
    },
  },
  webServer: [
    {
      // CI serves the build it has already made: on a two-core runner that is
      // also rasterizing WebGPU in software, a dev server compiling each page
      // on first visit starves the tests into timeouts.
      command: process.env.CI
        ? "bun run start --hostname localhost --port 3000"
        : "bun run dev --hostname localhost --port 3000",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bunx vite --host 127.0.0.1 --port 3101 --strictPort",
      url: "http://127.0.0.1:3101/tests/harness/",
      reuseExistingServer: !process.env.CI,
    },
  ],
})
