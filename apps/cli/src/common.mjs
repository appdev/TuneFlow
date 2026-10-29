import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { ServiceClient, normalizeEndpoint } from '../dist/client.mjs'

export { ServiceClient, normalizeEndpoint }
export const root = path.resolve(process.env.TUNEFLOW_CONFIG_DIR || path.join(homedir(), '.config', 'tuneflow-cli'))
const hash = value => createHash('sha256').update(value).digest('hex')
export const runtimeFor = directory => path.join(tmpdir() === '/tmp' || process.platform === 'darwin' ? '/tmp' : tmpdir(), `tfcli-${process.getuid?.() ?? 'user'}-${hash(directory).slice(0, 16)}`)
export const runtime = runtimeFor(root)
export const daemonSocket = path.join(runtime, 'daemon.sock')
export const fail = (code, message = code) => Object.assign(new Error(message), { code })
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function init() {
  if (process.platform === 'win32') throw fail('UNSUPPORTED_PLATFORM', 'Background playback currently supports macOS and Linux.')
  await mkdir(root, { recursive: true, mode: 0o700 })
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  // IPC is local-user-only; reject a pre-created or shared runtime directory.
  const stat = await lstat(runtime)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw fail('UNSAFE_RUNTIME_DIRECTORY')
  await mkdir(path.join(root, 'refs'), { recursive: true, mode: 0o700 })
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw fail('INVALID_STATE', 'Stored CLI state is invalid.')
  }
}
export async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await rename(temp, file)
  } finally { await unlink(temp).catch(() => {}) }
}
export async function endpoint(option) {
  const config = await readJson(path.join(root, 'config.json'), {})
  return normalizeEndpoint(option || process.env.TUNEFLOW_SERVER || config.server || 'http://127.0.0.1:3124')
}
// Only retain the Service's public track DTO. Never cache resolved stream URLs.
export async function saveTrack(server, item, kind = 'online') {
  const track = item.musicInfo ?? item
  if (!track || typeof track.id !== 'string' || !track.id) throw fail('INVALID_TRACK')
  const ref = hash(JSON.stringify([server, kind, track.source, track.id])).slice(0, 32)
  await atomicJson(path.join(root, 'refs', `${ref}.json`), { server, kind, track, ...(kind === 'library' ? { libraryId: item.id } : {}) })
  return { ref, id: track.id, name: track.name ?? '', singer: track.singer ?? '', source: track.source, albumName: track.albumName ?? track.meta?.albumName ?? '', interval: track.interval ?? null }
}
export async function getTrack(ref, server) {
  if (!/^[a-f0-9]{32}$/.test(ref ?? '')) throw fail('INVALID_REF', 'Use a ref returned by search, library or playlists.')
  const entry = await readJson(path.join(root, 'refs', `${ref}.json`), null)
  if (!entry) throw fail('REF_NOT_FOUND', 'Search or list the library again.')
  if (server && entry.server !== server) throw fail('REF_SERVER_MISMATCH', 'This ref belongs to another Service.')
  return entry
}
export async function media(entry, quality = '128k', signal) {
  const client = new ServiceClient(entry.server)
  const resource = entry.kind === 'library'
    ? `/api/v1/library/tracks/${encodeURIComponent(entry.libraryId)}/stream`
    : (await client.resolve(entry.track, quality, undefined, signal)).url
  return client.resourceUrl(resource)
}
export function errorValue(error) {
  const known = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code)
  return { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Operation failed.', ...(error.status ? { status: error.status } : {}) }
}
