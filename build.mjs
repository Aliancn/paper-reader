import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const generated = join(root, 'src', 'generated')
const lib = join(root, 'lib')
mkdirSync(generated, { recursive: true })
mkdirSync(lib, { recursive: true })

function filesIn(directory) {
  return readdirSync(directory)
    .filter(name => statSync(join(directory, name)).isFile())
    .sort()
}

const worker = readFileSync(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8')
writeFileSync(join(generated, 'pdf-worker-source.ts'), `export const workerSource = ${JSON.stringify(worker)} as string\n`)

const assetDirs = {
  cMapUrl: join(root, 'node_modules/pdfjs-dist/cmaps'),
  standardFontDataUrl: join(root, 'node_modules/pdfjs-dist/standard_fonts'),
  wasmUrl: join(root, 'node_modules/pdfjs-dist/wasm'),
}
const assets = {}
for (const [kind, directory] of Object.entries(assetDirs)) {
  assets[kind] = {}
  for (const name of filesIn(directory)) {
    assets[kind][name] = gzipSync(readFileSync(join(directory, name)), { level: 9 }).toString('base64')
  }
}
writeFileSync(join(generated, 'pdf-assets.ts'), `export const pdfAssets = ${JSON.stringify(assets)} as const\n`)

const externals = [
  'react', 'react/jsx-runtime', 'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
]
const common = {
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120', 'safari17'],
  external: externals,
  jsx: 'automatic',
  define: { 'import.meta.url': 'self.location.href' },
  supported: { 'import-meta': false },
  minify: true,
  // Preserve function names so DevTools performance profiles stay readable.
  keepNames: true,
  legalComments: 'none',
  logLevel: 'warning',
  sourcemap: false,
}

await build({ ...common, entryPoints: [join(root, 'src/client/index.tsx')], outfile: join(lib, '.client.cjs') })
await build({ ...common, entryPoints: [join(root, 'src/client/pdf-reader.tsx')], outfile: join(lib, '.reader.cjs') })

function wrap(code, id, chunk) {
  const body = code.split('\n').map(line => line === '' ? '' : `\t\t${line}`).join('\n')
  return `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n${chunk === undefined ? '' : `\tchunk: ${JSON.stringify(chunk)},\n`}\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${body}\n\t\treturn module.exports;\n\t}\n});\n`
}

const mainCode = readFileSync(join(lib, '.client.cjs'), 'utf8')
const readerCode = readFileSync(join(lib, '.reader.cjs'), 'utf8')
if (!mainCode.includes('require.async') || !mainCode.includes('client.reader.js')) {
  console.error('The main bundle no longer contains the expected lazy reader chunk reference.')
  process.exitCode = 1
}
writeFileSync(join(lib, 'client.js'), wrap(mainCode, 'dsh-paper-reader'))
writeFileSync(join(lib, 'client.reader.js'), wrap(readerCode, 'dsh-paper-reader', 'client.reader.js'))
rmSync(join(lib, '.client.cjs'))
rmSync(join(lib, '.reader.cjs'))

// Host companion: the bounded translation route over the Host translator service.
await build({
  ...common,
  entryPoints: [join(root, 'src/host/index.js')],
  outfile: join(lib, 'index.js'),
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  minify: false,
})

console.log('built', {
  client: statSync(join(lib, 'client.js')).size,
  reader: statSync(join(lib, 'client.reader.js')).size,
  host: statSync(join(lib, 'index.js')).size,
})
