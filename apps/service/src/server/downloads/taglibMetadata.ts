import { parseFile } from 'music-metadata'
import { TagLib } from 'taglib-wasm'
import { createHash } from 'node:crypto'

export interface AudioMetadata {
  title: string
  artist?: string | null
  album?: string | null
  picture?: Uint8Array
  pictureMimeType?: string
  lyrics?: string | null
}

const SUPPORTED_PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
let taglibPromise: Promise<TagLib> | undefined

const getTagLib = async(): Promise<TagLib> => {
  taglibPromise ??= TagLib.initialize().catch(error => {
    taglibPromise = undefined
    throw error
  })
  return taglibPromise
}

const hasLyrics = (parsed: Awaited<ReturnType<typeof parseFile>>, expected: string): boolean => {
  if (parsed.common.lyrics?.some(value => typeof value === 'string' ? value === expected : value.text === expected)) return true
  return Object.values(parsed.native).flat().some(tag => {
    if (tag.id === 'LYRICS') return tag.value === expected
    if (tag.id !== 'USLT' || typeof tag.value !== 'object' || tag.value == null || !('text' in tag.value)) return false
    return tag.value.text === expected
  })
}

const lyricTexts = (parsed: Awaited<ReturnType<typeof parseFile>>): string[] => {
  const values = new Set<string>()
  for (const value of parsed.common.lyrics ?? []) {
    const text = typeof value === 'string' ? value : value.text
    if (typeof text === 'string' && text.trim() !== '') values.add(text)
  }
  for (const tag of Object.values(parsed.native).flat()) {
    if (tag.id === 'LYRICS' && typeof tag.value === 'string' && tag.value.trim() !== '') values.add(tag.value)
    if (tag.id === 'USLT' && typeof tag.value === 'object' && tag.value != null && 'text' in tag.value && typeof tag.value.text === 'string' && tag.value.text.trim() !== '') values.add(tag.value.text)
  }
  return [...values]
}

const pictureHashes = (parsed: Awaited<ReturnType<typeof parseFile>>): string[] => (parsed.common.picture ?? [])
  .filter(picture => SUPPORTED_PICTURE_TYPES.has(picture.format.toLowerCase()) && picture.data.byteLength > 0)
  .map(picture => createHash('sha256').update(picture.data).digest('hex'))

export interface MissingAudioMetadata {
  picture?: Uint8Array
  pictureMimeType?: string
  lyrics?: string
}

export const addMissingAudioMetadata = async(filePath: string, metadata: MissingAudioMetadata): Promise<ReadonlyArray<'lyrics' | 'picture'>> => {
  const before = await parseFile(filePath, { duration: false })
  const existingLyrics = lyricTexts(before)
  const existingPictures = pictureHashes(before)
  const addLyrics = existingLyrics.length === 0 && typeof metadata.lyrics === 'string' && metadata.lyrics.trim() !== ''
  const addPicture = existingPictures.length === 0 && metadata.picture != null
  if (!addLyrics && !addPicture) return []
  const pictureMimeType = metadata.pictureMimeType?.toLowerCase()
  if (addPicture && (pictureMimeType == null || !SUPPORTED_PICTURE_TYPES.has(pictureMimeType))) {
    throw new Error(`Unsupported audio picture MIME type: ${metadata.pictureMimeType ?? 'missing'}`)
  }
  const taglib = await getTagLib()
  await taglib.edit(filePath, file => {
    if (addPicture && metadata.picture != null && pictureMimeType != null) {
      file.setPictures([{ type: 'FrontCover', mimeType: pictureMimeType, data: metadata.picture, description: 'Cover' }])
    }
    if (addLyrics && metadata.lyrics != null) file.setLyrics([{ text: metadata.lyrics, language: 'zho' }])
  })
  const after = await parseFile(filePath, { duration: false })
  const afterLyrics = lyricTexts(after)
  const afterPictures = pictureHashes(after)
  if (addLyrics && metadata.lyrics != null && !afterLyrics.includes(metadata.lyrics)) throw new Error('Audio metadata verification failed: lyrics')
  if (addPicture && metadata.picture != null) {
    const expected = createHash('sha256').update(metadata.picture).digest('hex')
    if (!afterPictures.includes(expected)) throw new Error('Audio metadata verification failed: picture')
  }
  if (!existingLyrics.every(value => afterLyrics.includes(value))) throw new Error('Audio metadata verification failed: preserved lyrics')
  if (!existingPictures.every(value => afterPictures.includes(value))) throw new Error('Audio metadata verification failed: preserved picture')
  return [...(addLyrics ? ['lyrics' as const] : []), ...(addPicture ? ['picture' as const] : [])]
}

export const writeAudioMetadata = async(filePath: string, metadata: AudioMetadata): Promise<void> => {
  const pictureMimeType = metadata.pictureMimeType?.toLowerCase()
  if (metadata.picture != null && (pictureMimeType == null || !SUPPORTED_PICTURE_TYPES.has(pictureMimeType))) {
    throw new Error(`Unsupported audio picture MIME type: ${metadata.pictureMimeType ?? 'missing'}`)
  }

  const taglib = await getTagLib()
  await taglib.edit(filePath, file => {
    const tag = file.tag().setTitle(metadata.title)
    if (metadata.artist) tag.setArtist(metadata.artist)
    if (metadata.album) tag.setAlbum(metadata.album)
    if (metadata.picture != null && pictureMimeType != null) {
      file.setPictures([{
        type: 'FrontCover',
        mimeType: pictureMimeType,
        data: metadata.picture,
        description: 'Cover',
      }])
    }
    if (metadata.lyrics) file.setLyrics([{ text: metadata.lyrics, language: 'zho' }])
  })

  const parsed = await parseFile(filePath, { duration: false })
  const missing: string[] = []
  if (parsed.common.title !== metadata.title) missing.push('title')
  if (metadata.artist && parsed.common.artist !== metadata.artist) missing.push('artist')
  if (metadata.album && parsed.common.album !== metadata.album) missing.push('album')
  if (metadata.picture != null && !parsed.common.picture?.some(picture => picture.format.toLowerCase() === pictureMimeType)) missing.push('picture')
  if (metadata.lyrics && !hasLyrics(parsed, metadata.lyrics)) missing.push('lyrics')
  if (missing.length > 0) throw new Error(`Audio metadata verification failed: ${missing.join(', ')}`)
}
