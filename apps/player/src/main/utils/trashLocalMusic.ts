import { shell } from 'electron'
import { lstat } from 'node:fs/promises'
import { isAbsolute, extname } from 'node:path'
import { localAudioExtensions } from '@common/utils/localMusicFiles'

// Windows 的回收站操作依赖主进程的 COM 环境，不能从渲染进程直接调用。
export const trashLocalMusicFile = async(file: string) => {
  const extension = extname(file)
  const format = extension.slice(1).toLowerCase()
  if (!isAbsolute(file) || (!localAudioExtensions.includes(format) && format != 'ape')) throw new Error('Invalid local audio path')
  const stem = file.slice(0, -extension.length)
  const files: string[] = []
  // 仅处理所选音频及同名歌词，不递归删除目录，也不跟随链接。
  for (const target of [`${stem}.lrc`, `${stem}.tlrc`, `${stem}.rlrc`, `${file}.lrc`, file]) {
    let stat
    try { stat = await lstat(target) } catch (err: any) { if (err.code == 'ENOENT') continue; throw err }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular audio or lyric file')
    files.push(target)
  }
  for (const target of files) await shell.trashItem(target)
}
