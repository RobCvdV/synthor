// electron-builder afterPack: ad-hoc sign the macOS app when there's no Developer
// ID (forks, local builds). An unsigned arm64 bundle (packaging breaks Electron's
// own signature) is reported as "damaged" by Gatekeeper once downloaded.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  // A Developer ID signs the app properly right after this hook.
  if (process.env.CSC_LINK || process.env.SYNTHOR_DEVELOPER_ID) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
