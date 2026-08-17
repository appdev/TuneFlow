import { migrateLegacyStorage, type MigrationPhase } from './migrateLegacyStorage'

interface HelpArguments { help: true }
interface RunArguments { help: false, legacyRoot: string, configRoot: string, mediaRoot: string }
export type MigrationArguments = HelpArguments | RunArguments

const help = `TuneFlow storage migration

Usage:
  node dist/server/migrate-storage.cjs --from <legacy-root> --config-root <config-root> --media-root <media-root>

The legacy source must be stopped and mounted read-only. Both targets must be empty.
`

export const parseMigrationArguments = (args: string[]): MigrationArguments => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true }
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    if (!['--from', '--config-root', '--media-root'].includes(name)) throw new Error(`Unknown migration argument: ${name}`)
    const value = args[index + 1]
    if (value == null || value === '' || value.startsWith('--')) throw new Error(`Missing value for migration argument: ${name}`)
    if (values.has(name)) throw new Error(`Duplicate migration argument: ${name}`)
    values.set(name, value)
  }
  const missing = ['--from', '--config-root', '--media-root'].filter(name => !values.has(name))
  if (missing.length > 0) throw new Error(`Missing migration arguments: ${missing.join(', ')}`)
  return {
    help: false,
    legacyRoot: values.get('--from')!,
    configRoot: values.get('--config-root')!,
    mediaRoot: values.get('--media-root')!,
  }
}

const main = async(): Promise<void> => {
  const args = parseMigrationArguments(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(help)
    return
  }
  const phases: MigrationPhase[] = []
  const result = await migrateLegacyStorage({
    ...args,
    onPhase: phase => {
      phases.push(phase)
      process.stdout.write(`phase=${phase}\n`)
    },
  })
  process.stdout.write(`${JSON.stringify({
    layoutVersion: result.layoutVersion,
    mediaFiles: result.mediaFiles,
    mediaBytes: result.mediaBytes,
    sourceFiles: result.sourceFiles,
    phases,
    configRoot: args.configRoot,
    mediaRoot: args.mediaRoot,
  })}\n`)
}

if (process.env.NODE_ENV !== 'test') {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
