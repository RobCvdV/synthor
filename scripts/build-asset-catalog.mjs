// Compiles the app icon into an asset catalog (build/Assets.car, CFBundleIconName "AppIcon").
// Recent macOS prefers it over the .icns, e.g. for the app's iCloud Drive folder. Needs Xcode.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** macOS app icon slots: point size and scale, filled from the stamped PNGs in public/icons. */
const SLOTS = [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]

export function appIconContents() {
  return {
    images: SLOTS.map(([size, scale]) => ({
      idiom: 'mac',
      size: `${size}x${size}`,
      scale: `${scale}x`,
      filename: `icon-${size * scale}x${size * scale}.png`,
    })),
    info: { author: 'xcode', version: 1 },
  }
}

function main() {
  const work = mkdtempSync(path.join(tmpdir(), 'synthor-icon-'))
  try {
    const set = path.join(work, 'Assets.xcassets', 'AppIcon.appiconset')
    mkdirSync(set, { recursive: true })
    writeFileSync(path.join(work, 'Assets.xcassets', 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }))
    const contents = appIconContents()
    writeFileSync(path.join(set, 'Contents.json'), JSON.stringify(contents, null, 2))
    for (const { filename } of contents.images) copyFileSync(path.join('public', 'icons', filename), path.join(set, filename))
    const out = path.join(work, 'out')
    mkdirSync(out)
    execFileSync('xcrun', ['actool', '--compile', out, '--platform', 'macosx', '--minimum-deployment-target', '11.0',
      '--app-icon', 'AppIcon', '--output-partial-info-plist', path.join(work, 'partial.plist'),
      path.join(work, 'Assets.xcassets')], { stdio: ['ignore', 'ignore', 'inherit'] })
    copyFileSync(path.join(out, 'Assets.car'), path.join('build', 'Assets.car'))
    console.log('Asset catalog written to build/Assets.car')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.platform === 'darwin' && import.meta.url === `file://${process.argv[1]}`) main()
