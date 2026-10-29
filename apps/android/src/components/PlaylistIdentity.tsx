import { View } from 'react-native'
import { SOURCE_LOGOS } from './SourceLogo'
import { Icon } from './common/Icon'
import ListText from './common/ListText'
import { useTheme } from '@/store/theme/hook'

export const getPlaylistSource = (list: LX.List.MyListInfo) => 'source' in list ? list.source : undefined
export const getPlaylistLabel = (list: LX.List.MyListInfo) => {
  const source = getPlaylistSource(list)
  return source ? `${list.name}，${SOURCE_LOGOS[source]?.label ?? source}` : list.name
}

export default ({ list, name, subtitle = false, active = false }: {
  list: LX.List.MyListInfo
  name?: string
  subtitle?: boolean
  active?: boolean
}) => {
  const theme = useTheme()
  const source = getPlaylistSource(list)
  const label = list.id === 'service_library' ? '服务器音乐库' : list.id === 'service_history' ? '服务器播放记录' : source ? `${SOURCE_LOGOS[source]?.label ?? source} · 服务器` : '服务器歌单'
  return <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <View style={{ width: 24, alignItems: 'center' }}><Icon name={list.id == 'love' ? 'love' : 'album'} size={20} color={theme['q-text-secondary']} /></View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <ListText numberOfLines={1} active={active}>{name ?? list.name}</ListText>
      {subtitle ? <ListText secondary numberOfLines={1}>{label}</ListText> : null}
    </View>
  </View>
}
