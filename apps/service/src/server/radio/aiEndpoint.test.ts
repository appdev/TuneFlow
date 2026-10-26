import { describe, expect, it } from 'vitest'
import { aiResponsesUrl, isSameAIOrigin, normalizeAIBaseUrl } from './aiEndpoint'

describe('AI endpoint', () => {
  it('normalizes a safe base URL and constructs the Responses path', () => {
    expect(normalizeAIBaseUrl('https://ai.example.test/v1')).toBe('https://ai.example.test/v1/')
    expect(aiResponsesUrl('https://ai.example.test/v1').toString()).toBe('https://ai.example.test/v1/responses')
  })

  it.each(['ftp://ai.example.test/v1', 'https://user:pass@ai.example.test/v1', 'https://ai.example.test/v1#secret', 'not a url'])(
    'rejects unsafe endpoint %s',
    value => { expect(() => normalizeAIBaseUrl(value)).toThrow() },
  )

  it('allows only exact redirect origins', () => {
    const base = new URL('https://ai.example.test:8443/v1/responses')
    expect(isSameAIOrigin(base, new URL('https://ai.example.test:8443/v2/responses'))).toBe(true)
    expect(isSameAIOrigin(base, new URL('http://ai.example.test:8443/v2/responses'))).toBe(false)
    expect(isSameAIOrigin(base, new URL('https://other.example.test:8443/v2/responses'))).toBe(false)
  })
})
