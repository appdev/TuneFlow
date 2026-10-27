import { selectFile, readFile, stat, mkdir, unlink, temporaryDirectoryPath } from '@/utils/fs'

export const importSourceFile = async(install: (script: string) => Promise<unknown>) => {
  const cache = `${temporaryDirectoryPath}/tuneflow-source-${Date.now()}`
  try {
    await mkdir(cache)
    const file = await selectFile({ extTypes: ['js', 'txt'], toPath: cache })
    if (!file) return false
    if (!/\.(js|txt)$/i.test(file.name)) throw new Error('请选择 .js 或 .txt 脚本文件')
    if (!file.data.startsWith(cache + '/')) throw new Error('无法读取所选脚本文件')
    if ((await stat(file.data)).size > 1024 * 1024) throw new Error('脚本文件超过 1 MiB 限制')
    await install(await readFile(file.data, 'utf8'))
    return true
  } finally { await unlink(cache).catch(() => {}) }
}
