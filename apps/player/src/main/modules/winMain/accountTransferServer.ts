import { createServer } from 'node:http'
import { createCipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AccountTransferState } from '@common/types/accountTransfer'

export const isPrivateIPv4 = (host: string) => {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false
  const parts = host.split('.').map(Number)
  if (parts.some((part, index) => part > 255 || String(part) != host.split('.')[index])) return false
  return parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1] >= 16 && parts[1] <= 31)
}

// 密钥只在用户看到的配对码中出现；网络上传 HMAC 证明和 AES-GCM 密文，不发送明文 Cookie。
export const createAccountTransfer = async(readPayload: () => Promise<object>, lifetime = 180_000, bindHost = '0.0.0.0') => {
  const id = randomBytes(16).toString('hex')
  const key = randomBytes(32)
  const expiresAt = Date.now() + lifetime
  let state: AccountTransferState = 'waiting'
  let claiming = false
  let attempts = 0
  let timer: NodeJS.Timeout
  const stop = (next: AccountTransferState) => {
    if (state != 'waiting') return
    state = next
    clearTimeout(timer)
    key.fill(0)
    server.close()
    server.closeIdleConnections?.()
  }
  const server = createServer({ maxHeaderSize: 4096 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Connection', 'close')
    res.setHeader('Content-Type', 'application/json')
    const fail = (code: number) => { res.writeHead(code); res.end('{}') }
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    if (!isPrivateIPv4(remote) && remote != '127.0.0.1') { fail(403); return }
    if (req.method != 'POST' || req.url != `/qmusic-account-transfer/${id}` || req.headers.origin) { fail(404); return }
    if (state != 'waiting' || Date.now() >= expiresAt) { stop('expired'); fail(410); return }
    if (++attempts > 30) { stop('cancelled'); fail(429); return }
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024) req.destroy() })
    req.on('error', () => {})
    req.on('end', () => {
      void (async() => {
        let nonce: string
        try {
          const body = JSON.parse(raw)
          nonce = body.nonce
          if (!/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(body.proof)) { fail(400); return }
          const expected = createHmac('sha256', key).update(`claim:${id}:${nonce}`).digest()
          if (!timingSafeEqual(expected, Buffer.from(body.proof, 'hex'))) { fail(403); return }
        } catch { fail(400); return }
        if (claiming || state != 'waiting') { fail(409); return }
        claiming = true
        try {
          const payload = await readPayload()
          // 读取账号期间可能被取消、退出账号或到期，不能继续发送。
          if (state != 'waiting' || Date.now() >= expiresAt) { stop('expired'); fail(410); return }
          const iv = randomBytes(12)
          const cipher = createCipheriv('aes-256-gcm', key, iv)
          cipher.setAAD(Buffer.from(`${id}:${nonce}`))
          const data = Buffer.concat([cipher.update(JSON.stringify({ v: 1, provider: 'tx', expiresAt, ...payload })), cipher.final(), cipher.getAuthTag()])
          res.end(JSON.stringify({ iv: iv.toString('base64'), data: data.toString('base64') }))
          stop('sent')
        } catch { stop('cancelled'); if (!res.writableEnded) fail(409) }
      })()
    })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.timeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, bindHost, () => { server.off('error', reject); resolve() })
  })
  server.on('error', () => { stop('cancelled') })
  timer = setTimeout(() => { stop('expired') }, lifetime)
  timer.unref()
  const address = server.address()
  if (!address || typeof address == 'string') throw new Error('transfer_unavailable')
  const secret = key.toString('hex')
  return {
    id,
    expiresAt,
    port: address.port,
    link: (host: string) => `qmusic://account-transfer?v=1&host=${host}&port=${address.port}&id=${id}&key=${secret}`,
    status: () => state,
    cancel: () => { stop('cancelled') },
  }
}
