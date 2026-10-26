import path from 'node:path'
import { readFileSync } from 'node:fs'
import { emitKeypressEvents } from 'node:readline'
import { AccountVault } from './vault'

const hiddenPassword = async(label: string): Promise<string> => {
  process.stdout.write(label)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true); process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error?: Error) => {
      process.stdin.removeListener('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n')
      if (error) reject(error); else resolve(value)
      value = ''
    }
    const onKey = (text: string | undefined, key: { name?: string, ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(new Error('Cancelled')); return }
      if (key.name === 'return') { finish(); return }
      if (key.name === 'backspace') { value = value.slice(0, -1); return }
      if (text && Array.from(text).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && value.length + text.length <= 128) value += text
    }
    process.stdin.on('keypress', onKey)
  })
}
const main = async() => {
  const args = process.argv.slice(2); const index = args.indexOf('--config-root')
  if (index < 0 || !args[index + 1] || !args.includes('--confirm-server-stopped')) throw new Error('Stop the service first. Usage: node recover-account-access.cjs --config-root /config --confirm-server-stopped [--password-stdin]')
  let password: string
  if (args.includes('--password-stdin')) password = readFileSync(0, 'utf8').replace(/\r?\n$/, '')
  else {
    if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or --password-stdin; never pass a password as an argument')
    password = await hiddenPassword('Access password (8–128 characters): ')
    if (password !== await hiddenPassword('Confirm password: ')) throw new Error('Passwords do not match')
  }
  const vault = new AccountVault(path.resolve(args[index + 1]))
  await vault.setPassword(password)
  password = ''
  console.log('Access password saved. Previous app sessions revoked; platform accounts and music retained. Restart the service and unlock with this password.')
}
void main().catch(() => { console.error('Password setup failed. Check the command, stopped service and password confirmation (8–128 characters). No account data was removed.'); process.exitCode = 1 })
