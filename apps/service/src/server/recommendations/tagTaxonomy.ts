import type { RecommendationTagKind } from './types'
import { normalizeLabel } from './identity'

export const tagTaxonomy = {
  genre: {
    pop: ['pop', '流行', '華語流行'],
    rock: ['rock', '摇滚', '搖滾'],
    'alternative-rock': ['alternative rock', '另类摇滚', '另類搖滾'],
    folk: ['folk', '民谣', '民謠'],
    electronic: ['electronic', '电子', '電子'],
    'hip-hop': ['hip-hop', 'hip hop', '说唱', '嘻哈'],
    jazz: ['jazz', '爵士'],
    classical: ['classical', '古典'],
    soundtrack: ['soundtrack', '原声', '原聲'],
    acg: ['acg', '动漫', '動畫'],
  },
  mood: {
    relaxing: ['relax', '轻松', '放鬆'],
    healing: ['healing', '治愈', '療癒'],
    sad: ['sad', '伤感', '悲傷'],
    energetic: ['energetic', '热血', '高能'],
    romantic: ['romantic', '浪漫'],
  },
  scene: {
    workout: ['workout', '运动', '健身'],
    study: ['study', '学习', '讀書'],
    commute: ['commute', '通勤'],
    sleep: ['sleep', '睡眠'],
    cafe: ['cafe', '咖啡馆', '咖啡廳'],
  },
} as const

export interface TaxonomyMatch { kind: RecommendationTagKind, value: string }

export const matchTaxonomy = (values: readonly string[]): TaxonomyMatch[] => {
  const corpus = normalizeLabel(values.join(' '))
  const result: TaxonomyMatch[] = []
  for (const [kind, entries] of Object.entries(tagTaxonomy) as Array<[RecommendationTagKind, Record<string, readonly string[]>]>) {
    for (const [value, aliases] of Object.entries(entries)) {
      if (aliases.some(alias => corpus.includes(normalizeLabel(alias)))) result.push({ kind, value })
    }
  }
  return result
}
