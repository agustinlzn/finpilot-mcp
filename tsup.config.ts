import { defineConfig } from "tsup"

/**
 * The one place this package breaks from monorepo house style.
 *
 * Every other package here is consumed as raw TypeScript via Node's native type
 * stripping, which works because the *consumer* controls the Node flags. A
 * published `npx` binary has no such luxury: its shebang is plain
 * `#!/usr/bin/env node`, and on Node 20/22 — which `engines` still allows —
 * stripping is either unavailable or flag-gated, so the first type annotation
 * would be a syntax error.
 *
 * Everything is bundled (`noExternal`) so the published package has zero runtime
 * dependencies and `npx @agustinlzn/finpilot-mcp login` is a single small download rather
 * than an install graph. That is the difference between the pitch working and
 * not.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  minify: false, // A CLI people may read before running; keep it inspectable.
  sourcemap: false,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
})
