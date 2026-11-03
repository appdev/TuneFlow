import { configDefaults, defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // Bound parallel workers so background artwork checks are not starved in CI.
    maxWorkers: 2,
    exclude: [...configDefaults.exclude, 'tests/**', 'build-config/server/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '@common/rendererIpc': path.join(__dirname, 'src/server/tuneFlowSdk/rendererIpcShim.ts'),
      '@common': path.join(__dirname, 'src/common'),
    },
  },
})
