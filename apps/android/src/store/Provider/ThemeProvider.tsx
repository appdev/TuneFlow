import { memo, useEffect, useMemo, useState } from 'react'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
import { adaptPhoneTheme } from '@/theme/phone'

import themeState, { ThemeContext } from '../theme/state'


export default memo(({ children }: {
  children: React.ReactNode
}) => {
  const [theme, setTheme] = useState(themeState.theme)
  const { phone } = useAdaptiveLayout()
  const activeTheme = useMemo(() => phone ? adaptPhoneTheme(theme) : theme, [phone, theme])

  useEffect(() => {
    const handleUpdateTheme = (theme: LX.ActiveTheme) => {
      requestAnimationFrame(() => {
        setTheme(theme)
      })
    }
    global.state_event.on('themeUpdated', handleUpdateTheme)
    return () => {
      global.state_event.off('themeUpdated', handleUpdateTheme)
    }
  }, [])

  return (
    <ThemeContext.Provider value={activeTheme}>
      {children}
    </ThemeContext.Provider>
  )
})
