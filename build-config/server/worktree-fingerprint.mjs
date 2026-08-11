import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hash = value => createHash('sha256').update(value).digest('hex')

export const createWorktreeManifest = (root = process.cwd()) => {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  return files.flatMap(relativePath => {
    const absolutePath = path.join(root, relativePath)
    let stat
    try {
      stat = lstatSync(absolutePath)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolutePath)) : readFileSync(absolutePath)
    const type = stat.isSymbolicLink() ? 'symlink' : 'file'
    return [`${hash(bytes)}\t${type}\t${(stat.mode & 0o777).toString(8).padStart(3, '0')}\t${bytes.byteLength}\t${JSON.stringify(relativePath)}`]
  }).join('\n') + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(createWorktreeManifest())
