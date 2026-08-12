import { configDefaults, defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/**', 'build-config/server/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '@web-runtime': path.join(__dirname, 'src/web-runtime'),
      '@renderer/store': path.join(__dirname, 'src/server/tuneFlowSdk/rendererStoreShim.ts'),
      '@renderer/utils/musicSdk/kg/vendors/infSign.min': path.join(__dirname, 'src/renderer/utils/musicSdk/kg/vendors/infSign.min.js'),
      '@renderer/utils': path.join(__dirname, 'src/server/tuneFlowSdk/rendererUtilsShim.ts'),
      '@common/rendererIpc': path.join(__dirname, 'src/server/tuneFlowSdk/rendererIpcShim.ts'),
      '@common': path.join(__dirname, 'src/common'),
      '@renderer': path.join(__dirname, 'src/renderer'),
    },
  },
  plugins: [{
    name: 'service-provider-utils',
    resolveId(source, importer) {
      if (source === '../../index' && importer?.includes('/src/renderer/utils/musicSdk/')) return path.join(__dirname, 'src/server/tuneFlowSdk/rendererUtilsShim.ts')
      return null
    },
  }],
})
