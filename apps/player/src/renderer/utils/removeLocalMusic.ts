import { normalize } from 'node:path'
import { trashLocalMusicFile } from '@renderer/utils/ipc'
import { defaultList, loveList, tempList, userLists } from '@renderer/store/list/state'
import { getListMusics, removeListMusics } from '@renderer/store/list/action'

export { trashLocalMusicFile }

export const removeLocalMusicReferences = async(files: string[]) => {
  const key = (file: string) => process.platform == 'win32' ? normalize(file).toLowerCase() : normalize(file)
  const paths = new Set(files.map(key))
  if (!paths.size) return
  for (const list of [defaultList, loveList, tempList, ...userLists]) {
    const songs = await getListMusics(list.id)
    const ids = songs.filter(song => song.source == 'local' && paths.has(key(song.meta.filePath))).map(song => song.id)
    if (ids.length) await removeListMusics({ listId: list.id, ids })
  }
}

export const trashLocalMusic = async(music: LX.Music.MusicInfoLocal) => {
  await trashLocalMusicFile(music.meta.filePath)
  await removeLocalMusicReferences([music.meta.filePath])
}
