import { describe, expect, it, vi } from 'vitest'
import { applyBuiltInTheme, getBuiltInThemeInfo, resolveBuiltInTheme } from './builtInThemes'

describe('built-in Web themes', () => {
  it('exposes the upstream theme IDs without custom themes', () => {
    const info = getBuiltInThemeInfo()

    expect(info.themes.map(theme => theme.id)).toEqual(expect.arrayContaining(['green', 'black']))
    expect(info.userThemes).toEqual([])
    expect(info.dataPath).toBe('')
  })

  it('resolves auto and invalid IDs to upstream fallbacks', () => {
    expect(resolveBuiltInTheme('auto', 'green', 'black', false).id).toBe('green')
    expect(resolveBuiltInTheme('auto', 'green', 'black', true).id).toBe('black')
    expect(resolveBuiltInTheme('missing', 'green', 'black', false).id).toBe('green')
  })

  it('applies CSS variables and records the resolved ID before mount', () => {
    const setTheme = vi.fn()
    const root: Pick<HTMLElement, 'dataset'> = { dataset: {} }

    const id = applyBuiltInTheme({
      id: 'black',
      lightId: 'green',
      darkId: 'black',
      prefersDark: false,
      setTheme,
      root,
    })

    expect(id).toBe('black')
    expect(root.dataset.themeId).toBe('black')
    expect(setTheme).toHaveBeenCalledWith(expect.objectContaining({ '--color-theme': expect.any(String) }))
  })
})
