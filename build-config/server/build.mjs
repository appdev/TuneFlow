import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const serverRoot = path.join(root, 'dist/server')
await mkdir(serverRoot, { recursive: true })
await writeFile(path.join(serverRoot, 'package.json'), `${JSON.stringify({
  private: true,
  dependencies: {
    '@fastify/static': '^10.1.3',
    '@fastify/swagger': '^9.8.1',
    '@fastify/type-provider-typebox': '^6.1.0',
    'better-sqlite3': '^12.9.0',
    'crypto-js': '^4.2.0',
    fastify: '^5.11.3',
    needle: '^3.5.0',
    tunnel: '^0.0.6',
    'iconv-lite': '^0.7.2',
    'image-size': '^1.1.0',
    he: '1.2.0',
    'music-metadata': '^11.12.3',
    'pako': '^1.0.11',
    'node-id3': '^0.2.9',
    'qrc-decoder': '1.0.2',
    undici: '^7.22.0',
    typebox: '^1.3.12',
  },
}, null, 2)}\n`)
await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(root, 'dist/server/index.cjs'),
  packages: 'external',
  alias: {
    '@common': path.join(root, 'src/common'),
    '@web-runtime': path.join(root, 'src/web-runtime'),
    '@renderer/store': path.join(root, 'src/server/tuneFlowSdk/rendererStoreShim.ts'),
    '@renderer/utils/musicSdk/kg/vendors/infSign.min': path.join(root, 'src/renderer/utils/musicSdk/kg/vendors/infSign.min.js'),
    '@renderer/utils': path.join(root, 'src/server/tuneFlowSdk/rendererUtilsShim.ts'),
    '@common/rendererIpc': path.join(root, 'src/server/tuneFlowSdk/rendererIpcShim.ts'),
  },
  plugins: [{
    name: 'service-provider-utils',
    setup(build) {
      build.onResolve({ filter: /^\.\.\/\.\.\/index$/ }, args => args.importer.includes(`${path.sep}renderer${path.sep}utils${path.sep}musicSdk${path.sep}`)
        ? { path: path.join(root, 'src/server/tuneFlowSdk/rendererUtilsShim.ts') }
        : undefined)
    },
  }],
})
await build({
  entryPoints: [path.join(root, 'src/server/sources/worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(root, 'dist/server/worker.js'),
})
await build({
  entryPoints: [path.join(root, 'src/server/api/generateOpenApi.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(root, 'dist/server/generate-openapi.cjs'),
  packages: 'external',
  alias: {
    '@common': path.join(root, 'src/common'),
    '@web-runtime': path.join(root, 'src/web-runtime'),
    '@renderer/store': path.join(root, 'src/server/tuneFlowSdk/rendererStoreShim.ts'),
    '@renderer/utils/musicSdk/kg/vendors/infSign.min': path.join(root, 'src/renderer/utils/musicSdk/kg/vendors/infSign.min.js'),
    '@renderer/utils': path.join(root, 'src/server/tuneFlowSdk/rendererUtilsShim.ts'),
    '@common/rendererIpc': path.join(root, 'src/server/tuneFlowSdk/rendererIpcShim.ts'),
  },
})
