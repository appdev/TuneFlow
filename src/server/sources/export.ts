import { closeSync, openSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { SourceServiceError, type SourceExportSource } from './types'

export interface SourceExportEntry {
  sourceId: string
  archiveName: string
  scriptPath: string
  size: number
}

const portablePart = (value: string): string => Array.from(value.normalize('NFKC')
  .replace(/[\p{Cc}<>:"/\\|?*]/gu, '_')
  .replace(/^[ .]+|[ .]+$/g, ''))
  .slice(0, 120)
  .join('')

const archiveEntryName = (source: SourceExportSource): string => {
  const name = portablePart(source.name) || 'source'
  const version = portablePart(source.version)
  return `${name}${version ? `-${version}` : ''}.js`
}

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export const sourceExportArchiveName = (now = new Date()): string => {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `tuneflow-sources-${stamp}.zip`
}

export const prepareSourceExport = (
  sources: readonly SourceExportSource[],
  sourceRoot: string,
): SourceExportEntry[] => {
  if (sources.length === 0) throw new SourceServiceError('SOURCE_EXPORT_EMPTY', 'No installed sources to export')
  try {
    const canonicalRoot = realpathSync(sourceRoot)
    const names = new Set<string>()
    return sources.map(source => {
      const canonicalScript = realpathSync(source.scriptPath)
      if (!isInside(canonicalRoot, canonicalScript)) throw new Error('Source path escaped source root')
      const stat = statSync(canonicalScript)
      if (!stat.isFile()) throw new Error('Source path is not a file')
      const descriptor = openSync(canonicalScript, 'r')
      closeSync(descriptor)

      const preferredName = archiveEntryName(source)
      let archiveName = preferredName
      const hash = source.id.slice('user_api_'.length)
      let suffixLength = 8
      let duplicateIndex = 2
      while (names.has(archiveName.toLocaleLowerCase('en-US'))) {
        const suffix = suffixLength <= hash.length ? hash.slice(0, suffixLength) : `${hash}-${duplicateIndex++}`
        archiveName = `${preferredName.slice(0, -3)}-${suffix}.js`
        suffixLength += 4
      }
      names.add(archiveName.toLocaleLowerCase('en-US'))
      return { sourceId: source.id, archiveName, scriptPath: canonicalScript, size: stat.size }
    })
  } catch (error) {
    if (error instanceof SourceServiceError) throw error
    throw new SourceServiceError('SOURCE_EXPORT_FAILED', 'Unable to export installed sources')
  }
}
