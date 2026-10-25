import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const client = path.resolve(process.argv[2] || path.join(root, '../MusicFree/qmusic-desktop'))
if (!existsSync(path.join(client, 'package.json')) || JSON.parse(readFileSync(path.join(client, 'package.json'))).name !== 'q-music') throw Error('Pass the current Q-music desktop project path')
mkdirSync(path.join(root, 'dist'), { recursive: true })
const stage = mkdtempSync(path.join(root, 'dist/web-qmusic-stage-'))
// Build only in staging. Existing Web, Flutter, native outputs and data stay intact.
execFileSync('npm', ['run', 'build:web'], { cwd: client, stdio: 'inherit', env: { ...process.env, Q_WEB_OUTPUT: stage } })
execFileSync('npm', ['run', 'build:web'], { cwd: root, stdio: 'inherit', env: { ...process.env, TUNEFLOW_LEGACY_WEB_OUTPUT: path.join(stage, 'V2'), TUNEFLOW_LEGACY_WEB_BASE: '/V2/' } })
writeFileSync(path.join(stage, 'qmusic-web.json'), JSON.stringify({ client: 'Q-music Web', version: '0.4.23-service.6-web', legacy: '/V2/', api: '/api/v1/', platformLogin: 'native-clients-only' }, null, 2) + '\n')
const destination = path.join(root, 'dist/web-qmusic')
if (existsSync(destination)) renameSync(destination, `${destination}-backup-${Date.now()}`)
renameSync(stage, destination)
console.log(`Q-music Web: ${destination}\nDefault: /\nPrevious Vue Web: /V2/\nNo container was changed.`)
