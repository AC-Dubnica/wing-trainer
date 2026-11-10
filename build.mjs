import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

const common = { bundle: true, sourcemap: true, logLevel: 'info' }

await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', platform: 'browser', format: 'iife', loader: { '.json': 'json' } }),
])

mkdirSync('dist/renderer', { recursive: true })
for (const f of ['index.html', 'gate-worklet.js', 'comp-worklet.js']) cpSync(`src/renderer/${f}`, `dist/renderer/${f}`)
