// Writes the app version into the logo's tracker row ("C-0 01 05" for 0.1.5) and re-renders
// every icon from it. The logo's text is outlines, so rendering needs no fonts and matches
// on any machine. Run by the release workflows: node scripts/stamp-version.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const SVG_PATH = 'public/favicon.svg'

/** Raster icons and their sizes, all rendered from the SVG. */
const PNG_TARGETS = {
  'public/pwa-192x192.png': 192,
  'public/pwa-512x512.png': 512,
  'public/pwa-maskable-512x512.png': 512,
  'public/apple-touch-icon-180x180.png': 180,
  ...Object.fromEntries([16, 32, 64, 128, 180, 192, 256, 512, 1024].map((n) => [`public/icons/icon-${n}x${n}.png`, n])),
  'build/icon.png': 1024,
}

/** ICNS entry types and their pixel sizes (PNG payloads), retina variants included. */
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
  ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024],
]

/** The row's digits: major (the octave, 0–9), then minor and patch as two digits each. */
export function versionDigits(version) {
  const m = /^(?:deploy-)?v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) throw new Error(`Not a version: "${version}"`)
  const [major, minor, patch] = m.slice(1).map(Number)
  if (major > 9 || minor > 99 || patch > 99) throw new Error(`${version} doesn't fit the logo's C-M mm pp row`)
  const two = (n) => String(n).padStart(2, '0')
  return { major: String(major), minor: two(minor), patch: two(patch) }
}

/** The row as it reads, e.g. "C-0 01 05". */
export function versionRow(version) {
  const { major, minor, patch } = versionDigits(version)
  return `C-${major} ${minor} ${patch}`
}

/** Points the SVG's v-* digit slots at the version's digits. */
export function stampSvg(svg, version) {
  const { major, minor, patch } = versionDigits(version)
  const slots = { 'v-major': major, 'v-minor-1': minor[0], 'v-minor-2': minor[1], 'v-patch-1': patch[0], 'v-patch-2': patch[1] }
  return Object.entries(slots).reduce((out, [id, digit]) => {
    const re = new RegExp(`(<use id="${id}" href="#digit-)\\d(")`)
    if (!re.test(out)) throw new Error(`${SVG_PATH} has no #${id} digit slot`)
    return out.replace(re, `$1${digit}$2`)
  }, svg)
}

/** An .icns file holding the given PNGs. */
export function icns(pngsBySize) {
  const entries = ICNS_TYPES.map(([type, size]) => {
    const png = pngsBySize.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4)
  return Buffer.concat([head, ...entries])
}

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng()
}

function main(version) {
  const svg = stampSvg(readFileSync(SVG_PATH, 'utf8'), version)
  writeFileSync(SVG_PATH, svg)
  const pngs = new Map()
  const png = (size) => pngs.get(size) ?? pngs.set(size, render(svg, size)).get(size)
  for (const [file, size] of Object.entries(PNG_TARGETS)) writeFileSync(file, png(size))
  writeFileSync('build/icon.icns', icns(new Map(ICNS_TYPES.map(([, size]) => [size, png(size)]))))
  console.log(`Logo stamped ${versionRow(version)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: node scripts/stamp-version.mjs <version>')
    process.exit(1)
  }
  main(process.argv[2])
}
