#!/usr/bin/env node
try {
  const { main } = await import('../src/cli.mjs')
  await main()
} catch (error) {
  const code = error.code === 'ERR_MODULE_NOT_FOUND' ? 'CLI_NOT_BUILT' : 'INTERNAL_ERROR'
  console.log(JSON.stringify({ ok: false, error: { code, message: code === 'CLI_NOT_BUILT' ? 'Run npm --prefix apps/cli install and npm --prefix apps/cli run build.' : 'CLI startup failed.' } }))
  process.exitCode = 1
}
