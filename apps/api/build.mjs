// Bundles the API and worker into dist/. Workspace packages (@rf/contracts) are
// bundled in; third-party runtime dependencies stay external and load from node_modules.
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@rf/'));

rmSync(path.join(here, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: { server: path.join(here, 'src/server.ts'), worker: path.join(here, 'src/worker.ts') },
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  external,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __rfCreateRequire } from 'node:module'; const require = __rfCreateRequire(import.meta.url);",
  },
});
