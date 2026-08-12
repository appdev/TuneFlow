import { createServer } from './app'
import { loadServerOptions } from './config'

const help = [
  'TuneFlow (音流) Service',
  '',
  'Environment variables:',
  '  TUNEFLOW_STORAGE_ROOT  Storage directory (default: ./data)',
  '  TUNEFLOW_WEB_ROOT      Web assets directory (default: ./dist/web)',
  '  TUNEFLOW_HOST          Bind host (default: 127.0.0.1)',
  '  TUNEFLOW_PORT          Bind port (default: 3124)',
].join('\n')

const main = async() => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(help)
    return
  }
  const options = loadServerOptions()
  const app = await createServer(options)
  await app.listen({ host: options.host, port: options.port })
  let closing = false
  const shutdown = async() => {
    if (closing) return
    closing = true
    const timeout = setTimeout(() => process.exit(1), 10_000)
    timeout.unref()
    try {
      await app.close()
      process.exitCode = 0
    } finally {
      clearTimeout(timeout)
    }
  }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
