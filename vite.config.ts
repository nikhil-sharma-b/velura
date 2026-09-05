import { defineConfig } from "vite"
import { readFile } from "node:fs/promises"

export default defineConfig({
  plugins: [
    {
      name: "wgsl-source",
      async load(id) {
        if (id.endsWith(".wgsl"))
          return `export default ${JSON.stringify(await readFile(id, "utf8"))}`
      },
    },
  ],
})
