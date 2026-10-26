import { createHash } from 'node:crypto'
import { lstatSync, realpathSync, readdirSync } from 'node:fs'
import path from 'node:path'

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm'])

export interface LibraryEntry { id: string, filePath: string }

export class LibraryRegistry {
  private readonly entries = new Map<string, LibraryEntry>()
  readonly root: string

  constructor(root: string) {
    this.root = realpathSync(root)
    this.scan(this.root)
  }

  get(id: string): LibraryEntry | undefined { return this.entries.get(id) }
  list(): Array<{ id: string, name: string }> { return [...this.entries.values()].map(entry => ({ id: entry.id, name: path.basename(entry.filePath) })) }

  private scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) this.scan(candidate)
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const filePath = realpathSync(candidate)
        if (filePath.startsWith(`${this.root}${path.sep}`) && lstatSync(filePath).isFile()) {
          const stat = lstatSync(filePath)
          const identity = `${path.relative(this.root, filePath).split(path.sep).join('/')}\0${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`
          const id = createHash('sha256').update(identity).digest('hex')
          this.entries.set(id, { id, filePath })
        }
      }
    }
  }
}
