import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const localAudioExtensions = ['mp3', 'flac', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac']

export const localFolderPlaylist = (filePath: string) => {
  const directory = dirname(resolve(filePath))
  const key = process.platform == 'win32' ? normalize(directory).toLowerCase() : directory
  return { id: `localfolder_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`, name: basename(directory) || directory }
}

// 不跟随目录链接，防止循环与越出所选目录；单个目录不可读不影响其他目录。
export const scanLocalMusicFolders = async(roots: string[], recursive = true) => {
  const files = new Set<string>()
  const visited = new Set<string>()
  let unreadableFolders = 0
  const visit = async(directory: string) => {
    const key = process.platform == 'win32' ? directory.toLowerCase() : directory
    if (visited.has(key)) return
    visited.add(key)
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { unreadableFolders++; return }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && recursive) await visit(path)
      else if (entry.isFile() && localAudioExtensions.includes(extname(entry.name).slice(1).toLowerCase())) files.add(path)
    }
  }
  for (const root of roots) await visit(resolve(root))
  return { files: [...files], unreadableFolders }
}
