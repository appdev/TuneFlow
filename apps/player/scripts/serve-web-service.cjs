// Local integration only: built Web assets + streaming forwarding to a real Service.
// This server has no fixture responses, credential storage or request-body logging.
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream')

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
const copyHeaders = headers => {
  const excluded = new Set([...hopHeaders, ...String(headers.connection || '').split(',').map(h => h.trim().toLowerCase())])
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key.toLowerCase())))
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' }

function createPreview({ webRoot, serviceOrigin }) {
  const root = fs.realpathSync(webRoot)
  const target = new URL(serviceOrigin)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Use a credential-free HTTP(S) Service origin')
  const transport = target.protocol === 'https:' ? https : http
  return http.createServer((request, response) => {
    const requestPath = (request.url || '/').split('?')[0]
    if (requestPath.startsWith('/api/v1/')) {
      const headers = { ...copyHeaders(request.headers), host: target.host }
      const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: request.method, path: request.url, headers }, result => {
        response.writeHead(result.statusCode || 502, copyHeaders(result.headers))
        pipeline(result, response, () => {})
      })
      upstream.setTimeout(120000, () => upstream.destroy(new Error('Service timeout')))
      upstream.on('error', () => {
        if (!response.headersSent) { response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } })) }
        else response.destroy()
      })
      request.on('aborted', () => upstream.destroy())
      response.on('close', () => { if (!response.writableFinished) upstream.destroy() })
      pipeline(request, upstream, () => {})
      return
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
    let file
    try {
      const decoded = decodeURIComponent(requestPath)
      if (decoded.includes('\0') || decoded.includes('\\')) throw new Error('path')
      file = fs.realpathSync(path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded)))
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('path')
    } catch { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    if (request.method === 'HEAD') response.end()
    else pipeline(fs.createReadStream(file), response, () => {})
  })
}
module.exports = { createPreview }
if (require.main === module) {
  const port = Number(process.env.TUNEFLOW_WEB_PREVIEW_PORT || 39745)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port')
  const server = createPreview({ webRoot: process.env.TUNEFLOW_WEB_PREVIEW_ROOT || path.resolve(__dirname, '../dist/web-client'), serviceOrigin: process.env.TUNEFLOW_WEB_SERVICE_ORIGIN || 'http://127.0.0.1:3124' })
  server.listen(port, '127.0.0.1', () => console.log(`Live Web: http://127.0.0.1:${port}/ (real Service; no mock data)`))
  const close = () => { server.closeAllConnections(); server.close(() => process.exit()) }
  process.on('SIGINT', close); process.on('SIGTERM', close)
}
