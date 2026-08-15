import { parseFile } from 'music-metadata'
import { TagLib } from 'taglib-wasm'

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
