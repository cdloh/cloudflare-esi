import path from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  await build({
    bundle: true,
    sourcemap: true,
    format: "esm",
    target: "esnext",
    entryPoints: [path.join(__dirname, "worker.ts")],
    outdir: path.join(__dirname, "..", "worker-dist"),
    outExtension: { ".js": ".mjs" },
  });
} catch {
  process.exitCode = 1;
}
