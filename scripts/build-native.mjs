// Builds the macOS-only native addons (native/icloud); a no-op on other platforms.
import { execFileSync } from 'node:child_process'

if (process.platform === 'darwin') {
  execFileSync('npx', ['node-gyp', 'rebuild', '--directory', 'native/icloud'], { stdio: 'inherit' })
}
