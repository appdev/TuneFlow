type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface LyricResponse {
  data?: LX.Music.LyricInfo
  error?: { message?: unknown }
}

export const fetchServiceLyric = async(musicInfo: unknown, fetchImpl: FetchLike = fetch): Promise<LX.Music.LyricInfo> => {
  const source = typeof musicInfo === 'object' && musicInfo != null && 'source' in musicInfo ? musicInfo.source : null
  if (typeof source !== 'string') throw new Error('Invalid lyric music source')
  const response = await fetchImpl('/api/v1/catalog/tracks/lyrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, musicInfo }),
  })
  const body = await response.json() as LyricResponse
  if (!response.ok || body.data == null || typeof body.data.lyric !== 'string') {
    throw new Error(typeof body.error?.message === 'string' ? body.error.message : 'Lyric source request failed')
  }
  return body.data
}

export const fetchServicePicture = async(musicInfo: unknown, fetchImpl: FetchLike = fetch): Promise<string> => {
  const source = typeof musicInfo === 'object' && musicInfo != null && 'source' in musicInfo ? musicInfo.source : null
  if (typeof source !== 'string') throw new Error('Invalid picture music source')
  const response = await fetchImpl('/api/v1/catalog/tracks/picture', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, musicInfo }),
  })
  const body = await response.json() as { data?: { url?: unknown }, error?: { message?: unknown } }
  if (!response.ok || typeof body.data?.url !== 'string') throw new Error(typeof body.error?.message === 'string' ? body.error.message : 'Picture lookup failed')
  return body.data.url
}
