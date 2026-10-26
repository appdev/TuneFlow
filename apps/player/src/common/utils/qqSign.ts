import { createHash } from 'node:crypto'

const part1Indexes = [23, 14, 6, 36, 16, 7, 19]
const part2Indexes = [16, 1, 32, 12, 19, 27, 8, 5]
const scrambleValues = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

// 签名必须基于实际发送的同一份 UTF-8 JSON，不能签名后再次序列化请求体。
export const signQQRequest = (body: string): string => {
  const hash = createHash('sha1').update(body, 'utf8').digest('hex')
  const part1 = part1Indexes.map(index => hash[index]).join('')
  const part2 = part2Indexes.map(index => hash[index]).join('')
  const scrambled = scrambleValues.map((value, index) => value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16))
  const part3 = Buffer.from(scrambled).toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${part1}${part3}${part2}`.toLowerCase()
}
