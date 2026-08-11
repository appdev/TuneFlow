import { SourceServiceError, type SourceInfo } from './types'

const fields = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
} as const

export const parseSourceScript = (script: string): Omit<SourceInfo, 'id'> => {
  if (typeof script !== 'string') throw new SourceServiceError('SOURCE_INVALID_METADATA')
  const header = /^\/\*[\s\S]*?\*\//.exec(script)?.[0]
  if (header == null) throw new SourceServiceError('SOURCE_INVALID_METADATA')
  const metadata: Partial<Record<keyof typeof fields, string>> = {}
  for (const line of header.split(/\r?\n/)) {
    const match = /^\s?\*\s?@(\w+)(?:\s+(.*))?$/.exec(line)
    if (match == null || !(match[1] in fields)) continue
    const key = match[1] as keyof typeof fields
    metadata[key] = (match[2] ?? '').trim().slice(0, fields[key])
  }
  if (!metadata.name || !metadata.version) throw new SourceServiceError('SOURCE_INVALID_METADATA')
  return {
    name: metadata.name,
    description: metadata.description ?? '',
    version: metadata.version,
    author: metadata.author ?? '',
    homepage: metadata.homepage ?? '',
  }
}
