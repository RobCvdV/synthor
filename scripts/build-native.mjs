// Builds the macOS-only parts: the native addons (native/icloud) and the icon asset catalog.
import { execFileSync } from 'node:child_process'

if (process.platform === 'darwin') {
  execFileSync('npx', ['node-gyp', 'rebuild', '--directory', 'native/icloud'], { stdio: 'inherit' })
  execFileSync('node', ['scripts/build-asset-catalog.mjs'], { stdio: 'inherit' })
}
