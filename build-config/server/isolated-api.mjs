export const activateSource = async(origin, sourceId) => {
  const response = await fetch(`${origin}/api/v1/sources/active`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceId }),
  })
  const result = await response.json()
  if (!response.ok || result?.data?.active !== true) {
    throw new Error(`isolated worker activation failed: ${response.status} ${JSON.stringify(result)}`)
  }
  return result.data
}

export const requestLyric = async(origin, source, musicInfo) => {
  const response = await fetch(`${origin}/api/v1/catalog/tracks/lyrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, musicInfo }),
  })
  const result = await response.json()
  if (!response.ok || typeof result?.data?.lyric !== 'string') {
    throw new Error(`isolated worker action failed: ${response.status} ${JSON.stringify(result)}`)
  }
  return result.data.lyric
}
