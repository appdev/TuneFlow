import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import ServerSettings from '@/service/ServerSettings'
import MusicAccountEntry from './settings/Basic/MusicAccountEntry'

import Basic from './settings/Basic'
import Player from './settings/Player'
import LyricDesktop from './settings/LyricDesktop'
import Search from './settings/Search'
import List from './settings/List'
import Other from './settings/Other'
import Version from './settings/Version'
import About from './settings/About'

export const SETTING_SCREENS = [
  'service',
  'accounts',
  'sources',
  'downloads',
  'basic',
  'player',
  'lyric_desktop',
  'search',
  'list',
  'compatibility',
  'other',
  'version',
  'about',
] as const

export type SettingScreenIds = typeof SETTING_SCREENS[number]
export const settingTitle = (id: string, translate: (key: any) => string) => ({ service: '服务器连接', accounts: '音乐平台账号', sources: '音源与解析', downloads: '下载 · 服务器', compatibility: '同步与备份说明', basic: '基本 · 当前设备', player: '播放 · 当前设备' }[id] ?? translate(`setting_${id}`))

// interface MainProps {
//   onUpdateActiveId: (id: string) => void
// }
export interface MainType {
  setActiveId: (id: SettingScreenIds) => void
}

const Main = forwardRef<MainType, {}>((props, ref) => {
  const [id, setId] = useState(global.lx.settingActiveId)
  useEffect(() => {
    const onNavigation = (nav: string) => { if (nav === 'nav_setting') setId(global.lx.settingActiveId) }
    global.state_event.on('navActiveIdUpdated', onNavigation)
    return () => { global.state_event.off('navActiveIdUpdated', onNavigation) }
  }, [])

  useImperativeHandle(ref, () => ({
    setActiveId(id) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setId(id)
        })
      })
    },
  }))

  const component = useMemo(() => {
    switch (id) {
      case 'service': return <ServerSettings />
      case 'accounts': return <MusicAccountEntry />
      case 'sources': return <ServerSettings section="sources" />
      case 'downloads': return <ServerSettings section="downloads" />
      case 'compatibility': return <ServerSettings section="compatibility" />
      case 'player': return <Player />
      case 'lyric_desktop': return <LyricDesktop />
      case 'search': return <Search />
      case 'list': return <List />
      case 'other': return <Other />
      case 'version': return <Version />
      case 'about': return <About />
      case 'basic':
      default: return <Basic />
    }
  }, [id])

  return component
})


export default Main

