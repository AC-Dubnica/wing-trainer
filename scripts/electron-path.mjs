// Electron has no install script: its CLI downloads the binary the first time it runs. `import 'electron'` alone throws
// on a fresh checkout (and in CI) until that has happened, so trigger the download first, then return the path.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

export async function ensureElectron() {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('electron/cli.js')
  const r = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 600_000 })
  if (r.status !== 0) throw new Error(`Could not obtain the Electron binary: ${r.stderr || r.stdout}`)
  return require('electron') // the path to the binary
}
