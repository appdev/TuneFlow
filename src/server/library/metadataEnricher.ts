import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, linkSync, openSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import iconv from 'iconv-lite'
import { buildLyrics } from '@common/utils/musicMeta/buildLyrics'
import { isPathInside } from '../config'
import { addMissingAudioMetadata } from '../downloads/taglibMetadata'
import type { DownloadFileIntegrity } from '../downloads/types'
import type { ValidatedTrackResources } from '../resources/trackResources'

export interface MetadataPatchPublication {
  targetPath: string
  stagedPath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
}

export interface MetadataEnrichmentResult {
  changed: ReadonlyArray<'lyrics' | 'picture' | 'sidecar'>
  integrity?: DownloadFileIntegrity
}

interface LibraryMetadataEnricherOptions {
  publish?: (input: MetadataPatchPublication) => Promise<boolean> | boolean
  syncDirectory?: (directory: string) => void
}

const integrity = (filePath: string): DownloadFileIntegrity => {
  const hash = createHash('sha256')
  const descriptor = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let size = 0
    while ((size = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size))
  } finally {
    closeSync(descriptor)
  }
  return { size: statSync(filePath).size, sha256: hash.digest('hex') }
}

const sameIntegrity = (left: DownloadFileIntegrity, right: DownloadFileIntegrity): boolean =>
  left.size === right.size && left.sha256 === right.sha256

const fsyncFile = (filePath: string): void => {
  const descriptor = openSync(filePath, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export class LibraryMetadataEnricher {
  private readonly audioRoot: string

  constructor(audioRoot: string, private readonly options: LibraryMetadataEnricherOptions = {}) {
    this.audioRoot = realpathSync(audioRoot)
  }

  async enrich(filePath: string, resources: ValidatedTrackResources, settings: TuneFlow.AppSetting): Promise<MetadataEnrichmentResult> {
    const target = realpathSync(filePath)
    if (!isPathInside(this.audioRoot, target) || !statSync(target).isFile()) throw new Error('Metadata target escaped audio root')
    const originalIntegrity = integrity(target)
    const stagedPath = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tuneflowtmp`)
    const finalSidecar = target.slice(0, -path.extname(target).length) + '.lrc'
    const stagedSidecar = `${stagedPath}.lrc`
    const rollbackPath = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.rollback.tuneflowtmp`)
    const changed: Array<'lyrics' | 'picture' | 'sidecar'> = []
    let sidecarPublished = false
    let preserveRollback = false
    try {
      copyFileSync(target, stagedPath)
      const embeddedLyrics = settings['download.isEmbedLyric'] && resources.lyrics != null
        ? buildLyrics(resources.lyrics, settings['download.isEmbedVerbatimLyric'], settings['download.isEmbedLyricT'], settings['download.isEmbedLyricR'])
        : undefined
      const embedded = await addMissingAudioMetadata(stagedPath, {
        ...(settings['download.isEmbedPic'] && resources.picture != null
          ? { picture: resources.picture.bytes, pictureMimeType: resources.picture.mimeType }
          : {}),
        ...(embeddedLyrics == null ? {} : { lyrics: embeddedLyrics }),
      })
      changed.push(...embedded)
      if (settings['download.isDownloadLrc'] && resources.lyrics?.lyric && !existsSync(finalSidecar)) {
        const lrc = buildLyrics(resources.lyrics, settings['download.isDownloadVerbatimLyric'], settings['download.isDownloadTLrc'], settings['download.isDownloadRLrc'])
        writeFileSync(stagedSidecar, iconv.encode(lrc, settings['download.lrcFormat'] === 'gbk' ? 'gbk' : 'utf8', { addBOM: true }))
        fsyncFile(stagedSidecar)
        changed.push('sidecar')
      }
      if (changed.length === 0) return { changed: [] }
      fsyncFile(stagedPath)
      const replacementIntegrity = integrity(stagedPath)
      if (!sameIntegrity(integrity(target), originalIntegrity)) throw new Error('Metadata target changed during enrichment')
      copyFileSync(target, rollbackPath)
      fsyncFile(rollbackPath)
      try {
        if (existsSync(stagedSidecar)) {
          if (existsSync(finalSidecar)) throw new Error('Lyrics sidecar appeared during enrichment')
          linkSync(stagedSidecar, finalSidecar)
          sidecarPublished = true
          rmSync(stagedSidecar)
          this.syncDirectory(path.dirname(finalSidecar))
        }
        const published = await this.options.publish?.({ targetPath: target, stagedPath, originalIntegrity, replacementIntegrity }) ?? false
        if (!published) {
          renameSync(stagedPath, target)
          this.syncDirectory(path.dirname(target))
        }
      } catch (error) {
        let cleanupError: unknown
        if (sidecarPublished) {
          try {
            rmSync(finalSidecar, { force: true })
            this.syncDirectory(path.dirname(finalSidecar))
            sidecarPublished = false
          } catch (failure) {
            cleanupError = failure
          }
        }
        try {
          const currentIntegrity = integrity(target)
          if (sameIntegrity(currentIntegrity, replacementIntegrity)) {
            try {
              const rolledBack = await this.options.publish?.({
                targetPath: target,
                stagedPath: rollbackPath,
                originalIntegrity: replacementIntegrity,
                replacementIntegrity: originalIntegrity,
              }) ?? false
              if (!rolledBack) {
                renameSync(rollbackPath, target)
                this.syncDirectory(path.dirname(target))
              }
            } catch (managedRollbackError) {
              if (!sameIntegrity(integrity(target), originalIntegrity)) {
                if (!existsSync(rollbackPath)) throw managedRollbackError
                renameSync(rollbackPath, target)
                this.syncDirectory(path.dirname(target))
              }
            }
          } else if (!sameIntegrity(currentIntegrity, originalIntegrity)) {
            throw new Error('Metadata target has an unexpected integrity during rollback')
          }
          if (!sameIntegrity(integrity(target), originalIntegrity)) throw new Error('Metadata target rollback verification failed')
        } catch (rollbackError) {
          preserveRollback = true
          throw new AggregateError(
            cleanupError == null ? [error, rollbackError] : [error, cleanupError, rollbackError],
            'Metadata publication failed and the target could not be rolled back',
          )
        }
        if (cleanupError != null) throw new AggregateError([error, cleanupError], 'Metadata publication cleanup failed')
        throw error
      }
      return { changed, integrity: replacementIntegrity }
    } finally {
      rmSync(stagedPath, { force: true })
      rmSync(stagedSidecar, { force: true })
      if (!preserveRollback) rmSync(rollbackPath, { force: true })
    }
  }

  private syncDirectory(directory: string): void {
    if (this.options.syncDirectory == null) fsyncDirectory(directory)
    else this.options.syncDirectory(directory)
  }
}
