import RNFS from 'react-native-fs'
import { needsSharedFileAccess } from '@/utils/nativeModules/utils'
import { requestStoragePermission } from '@/utils/tools'

export const deleteLocalMusicFiles = async(music: LX.Music.MusicInfoLocal) => {
  const file = music.meta.filePath
  if (!/^\//.test(file) || !/\.(mp3|flac|ogg|oga|opus|wav|m4a|aac)$/i.test(file)) throw new Error('Unsupported local audio path')
  if (await needsSharedFileAccess(file) && !await requestStoragePermission()) throw new Error('Storage permission required')
  const stem = file.replace(/\.[^./]+$/, '')
  const files: string[] = []
  // 先核对所有目标都是文件，再删同名歌词和音频；不递归操作目录。
  for (const target of [`${stem}.lrc`, `${stem}.tlrc`, `${stem}.rlrc`, `${file}.lrc`, file]) {
    if (!await RNFS.exists(target)) continue
    if (!(await RNFS.stat(target)).isFile()) throw new Error('Not a regular audio or lyric file')
    files.push(target)
  }
  for (const target of files) await RNFS.unlink(target)
}
