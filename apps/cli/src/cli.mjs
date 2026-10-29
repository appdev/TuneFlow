import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { createWriteStream } from 'node:fs'
import { access, link, rename, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { init, root, endpoint, atomicJson, saveTrack, getTrack, media, ServiceClient, fail, errorValue } from './common.mjs'
import { callDaemon } from './ipc.mjs'

const commands = {
  configure: { args: 0, options: ['server'] },
  search: { min: 1, options: ['source', 'page'] },
  sources: { args: 0 },
  library: { args: 0 },
  playlists: { max: 1 },
  play: { min: 1, options: ['quality'] },
  queue: { min: 1, options: ['quality'] },
  pause: { args: 0 }, resume: { args: 0 }, next: { args: 0 }, previous: { args: 0 },
  stop: { args: 0 }, shutdown: { args: 0 },
  seek: { max: 1, options: ['by'] },
  volume: { args: 1 },
  status: { args: 0, options: ['watch', 'interval', 'count'] },
  download: { args: 1, options: ['quality', 'output', 'replace'] },
  downloads: { args: 0 },
}
const help = {
  name: 'tuneflow', protocolVersion: 1,
  description: 'AI-oriented TuneFlow CLI. stdout is JSON; status --watch is JSONL. No interactive prompts.',
  commands: {
    configure: 'configure --server http://127.0.0.1:3124',
    search: 'search <keywords...> [--source kw|kg|tx|wy|mg] [--page 1]',
    sources: 'sources', library: 'library', playlists: 'playlists [id]',
    play: 'play <ref...> [--quality 128k]', queue: 'queue <ref...> [--quality 128k]',
    pause: 'pause', resume: 'resume', next: 'next', previous: 'previous',
    seek: 'seek <seconds> | seek --by <signed-seconds>', volume: 'volume <0..100>',
    status: 'status [--watch --interval 1000 --count 10]', stop: 'stop', shutdown: 'shutdown',
    download: 'download <ref> [--quality 128k] [--output /path/song.mp3] [--replace]', downloads: 'downloads',
  },
  globalOptions: ['--json (JSON is already the default)', '--server <url>', '--help'],
}
function parse(argv) {
  let parsed
  // parseArgs requires --by=-15; accept the natural AI-facing spelling too.
  argv = [...argv]
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--by' && /^-\d/.test(argv[i + 1])) argv.splice(i, 2, `--by=${argv[i + 1]}`)
  }
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: Object.fromEntries([
      ...['server', 'source', 'page', 'quality', 'output', 'interval', 'count', 'by'].map(name => [name, { type: 'string' }]),
      ...['json', 'watch', 'replace', 'help'].map(name => [name, { type: 'boolean' }]),
    ]) })
  } catch { throw fail('INVALID_ARGUMENT', 'Invalid option. Run tuneflow --help.') }
  const [command = 'help', ...args] = parsed.positionals
  const options = parsed.values
  if (options.help || command === 'help') return { command: 'help', args, options }
  const spec = commands[command]
  if (!spec) throw fail('UNKNOWN_COMMAND', 'Run tuneflow --help for available commands.')
  if ((spec.args !== undefined && args.length !== spec.args) || args.length < (spec.min ?? 0) || args.length > (spec.max ?? Infinity)) throw fail('INVALID_ARGUMENT', help.commands[command])
  for (const option of Object.keys(options)) if (!['json', 'server', ...(spec.options ?? [])].includes(option)) throw fail('INVALID_ARGUMENT', `--${option} is not supported by ${command}.`)
  return { command, args, options }
}
function number(value, min, max, integer = false) {
  if (typeof value !== 'string' || !value.trim()) throw fail('INVALID_ARGUMENT', 'A numeric value is required.')
  const result = Number(value)
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) throw fail('INVALID_ARGUMENT', `Expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`)
  return result
}
async function localDownload(entry, options, signal) {
  const output = path.resolve(options.output)
  if (!options.replace) {
    try { await access(output); throw fail('FILE_EXISTS', 'Use --replace to overwrite this file.') } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const url = await media(entry, options.quality, signal)
  const temp = path.join(path.dirname(output), `.tuneflow-${randomUUID()}.part`)
  const timeout = AbortSignal.timeout(300_000)
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, timeout]) })
    if (!response.ok || !response.body) throw fail('DOWNLOAD_FAILED', 'The Service could not stream this track.')
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal })
    if (options.replace) await rename(temp, output)
    else {
      try { await link(temp, output) } catch (error) { if (error.code === 'EEXIST') throw fail('FILE_EXISTS'); throw error }
    }
    return { status: 'completed', output }
  } catch (error) {
    if (timeout.aborted) throw fail('DOWNLOAD_TIMEOUT')
    throw error
  } finally { await unlink(temp).catch(() => {}) }
}

async function execute(command, args, options, signal) {
  if (command === 'help') return help
  await init()
  if (['status', 'pause', 'resume', 'next', 'previous', 'stop', 'shutdown', 'volume', 'seek'].includes(command)) {
    let payload = {}
    if (command === 'volume') payload = { value: number(args[0], 0, 100) }
    if (command === 'seek') {
      if ((options.by !== undefined) === (args.length > 0)) throw fail('INVALID_ARGUMENT', help.commands.seek)
      payload = { seconds: number(options.by ?? args[0], options.by !== undefined ? -Infinity : 0, Infinity), relative: options.by !== undefined }
    }
    return callDaemon(command, payload, false, signal)
  }
  const server = await endpoint(options.server)
  const client = new ServiceClient(server, (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, init.signal].filter(Boolean)) }))
  if (command === 'configure') {
    if (!options.server) throw fail('INVALID_ARGUMENT', help.commands.configure)
    await client.connect(signal)
    await atomicJson(path.join(root, 'config.json'), { server })
    return { server }
  }
  if (command === 'sources') return { providers: await client.connect(signal), sources: await client.sources() }
  if (command === 'search') {
    const page = number(options.page ?? '1', 1, 10000, true)
    const source = options.source ?? (await client.connect(signal)).find(item => item.searchKinds.includes('track'))?.id
    if (!source) throw fail('NO_SEARCH_PROVIDER')
    const result = await client.search(source, args.join(' '), page, 'tracks', signal)
    return { ...result, source, server, list: await Promise.all(result.list.map(item => saveTrack(server, item))) }
  }
  if (command === 'library') return { server, list: await Promise.all((await client.library()).map(item => saveTrack(server, item, 'library'))) }
  if (command === 'playlists') {
    if (!args.length) return { server, list: await client.playlists() }
    const result = await client.playlist(args[0])
    return { ...result, server, tracks: await Promise.all(result.tracks.map(item => saveTrack(server, item, item.source === 'local' ? 'library' : 'online'))) }
  }
  if (command === 'downloads') return { server, list: (await client.downloads()).map(({ id, status, quality, progress, error, musicInfo }) => ({ id, status, quality, progress, ...(error ? { error } : {}), track: { id: musicInfo.id, name: musicInfo.name, singer: musicInfo.singer } })) }
  if (command === 'play' || command === 'queue') {
    for (const ref of args) await getTrack(ref, server)
    return callDaemon(command, { refs: args, server, quality: options.quality ?? '128k' }, true, signal)
  }
  if (command === 'download') {
    const entry = await getTrack(args[0], server)
    if (options.output) return localDownload(entry, options, signal)
    if (entry.kind === 'library') throw fail('ALREADY_IN_LIBRARY', 'Use --output to save this library track to the CLI computer.')
    const task = await client.download(entry.track, options.quality ?? '128k', options.replace ? 'replace' : 'error')
    return { server, id: task.id, status: task.status, quality: task.quality, progress: task.progress }
  }
  throw fail('UNKNOWN_COMMAND')
}

export async function main(argv = process.argv.slice(2)) {
  const controller = new AbortController()
  const interrupt = () => { process.exitCode = 130; controller.abort() }
  const terminate = () => { process.exitCode = 143; controller.abort() }
  const pipeError = error => { if (error.code === 'EPIPE') controller.abort(); else process.exitCode = 1 }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  process.stdout.on('error', pipeError)
  const emit = async value => {
    if (controller.signal.aborted) return
    await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => {
      if (error?.code === 'EPIPE') { controller.abort(); resolve() }
      else if (error) reject(error)
      else resolve()
    }))
  }
  try {
    const { command, args, options } = parse(argv)
    if (command === 'status' && (options.interval !== undefined || options.count !== undefined) && !options.watch) throw fail('INVALID_ARGUMENT', '--interval and --count require --watch.')
    const interval = options.watch ? number(options.interval ?? '1000', 100, 60000, true) : 1000
    const count = options.count !== undefined ? number(options.count, 1, 1000000, true) : Infinity
    let emitted = 0
    do {
      if (controller.signal.aborted) break
      const data = await execute(command, args, options, controller.signal)
      await emit({ ok: true, data: command === 'status' ? { ...data, observedAt: new Date().toISOString() } : data })
      emitted++
      if (!options.watch || emitted >= count) break
      await delay(interval, undefined, { signal: controller.signal })
    } while (!controller.signal.aborted)
  } catch (error) {
    if (!controller.signal.aborted) { await emit({ ok: false, error: errorValue(error) }); process.exitCode = 1 }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    process.stdout.removeListener('error', pipeError)
  }
}
