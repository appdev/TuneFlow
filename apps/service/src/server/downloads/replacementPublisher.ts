import { closeSync, existsSync, fsyncSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { DownloadFileIntegrity, DownloadReplacementState } from './types'

export class ReplacementConflictError extends Error {
  readonly code = 'DOWNLOAD_REPLACEMENT_CONFLICT'
  constructor() { super('DOWNLOAD_REPLACEMENT_CONFLICT') }
}

export interface ReplacementPublicationInput {
  originalPath: string
  stagedPath: string
  finalPath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
  stagedLyricPath?: string
  finalLyricPath?: string
  phase: DownloadReplacementState['phase']
  onPhase: (phase: DownloadReplacementState['phase']) => void
}

export class ReplacementPublisher {
  publish(input: ReplacementPublicationInput): DownloadReplacementState['phase'] {
    if (input.phase === 'retired') return 'retired'
    if (input.phase === 'downloading') throw new Error('Replacement is not prepared')
    if (input.phase === 'published') return this.retire(input)
    if (!matches(input.originalPath, input.originalIntegrity)) throw new ReplacementConflictError()
    if (!matches(input.stagedPath, input.replacementIntegrity)) throw new Error('DOWNLOAD_REPLACEMENT_FAILED')
    const samePath = path.resolve(input.originalPath) === path.resolve(input.finalPath)
    if (!samePath && existsSync(input.finalPath)) throw new ReplacementConflictError()
    renameSync(input.stagedPath, input.finalPath)
    if (input.stagedLyricPath != null && input.finalLyricPath != null && existsSync(input.stagedLyricPath)) {
      renameSync(input.stagedLyricPath, input.finalLyricPath)
    }
    fsyncDirectory(path.dirname(input.finalPath))
    input.onPhase('published')
    return samePath ? this.finish(input) : this.retire({ ...input, phase: 'published' })
  }

  recover(input: ReplacementPublicationInput): DownloadReplacementState['phase'] {
    if (input.phase === 'retired') return 'retired'
    if (input.phase === 'prepared' && matches(input.stagedPath, input.replacementIntegrity)) return this.publish(input)
    if (matches(input.finalPath, input.replacementIntegrity)) {
      this.publishLyric(input)
      return this.retire({ ...input, phase: 'published' })
    }
    throw new ReplacementConflictError()
  }

  private retire(input: ReplacementPublicationInput): DownloadReplacementState['phase'] {
    if (!matches(input.finalPath, input.replacementIntegrity)) throw new ReplacementConflictError()
    if (path.resolve(input.originalPath) !== path.resolve(input.finalPath) && existsSync(input.originalPath)) {
      if (!matches(input.originalPath, input.originalIntegrity)) throw new ReplacementConflictError()
      rmSync(input.originalPath, { force: true })
      const oldLyric = sidecar(input.originalPath)
      if (oldLyric !== input.finalLyricPath) rmSync(oldLyric, { force: true })
      fsyncDirectory(path.dirname(input.originalPath))
    }
    return this.finish(input)
  }

  private finish(input: ReplacementPublicationInput): DownloadReplacementState['phase'] {
    input.onPhase('retired')
    return 'retired'
  }

  private publishLyric(input: ReplacementPublicationInput): void {
    if (input.stagedLyricPath == null || input.finalLyricPath == null || !existsSync(input.stagedLyricPath)) return
    renameSync(input.stagedLyricPath, input.finalLyricPath)
    fsyncDirectory(path.dirname(input.finalLyricPath))
  }
}

const sidecar = (filePath: string): string => filePath.slice(0, -path.extname(filePath).length) + '.lrc'

const matches = (filePath: string, expected: DownloadFileIntegrity): boolean => {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size !== expected.size) return false
  const descriptor = openSync(filePath, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let length = 0
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length))
  } finally { closeSync(descriptor) }
  return hash.digest('hex') === expected.sha256
}

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
