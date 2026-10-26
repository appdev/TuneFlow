import { View } from 'react-native'
import SourceLogo, { SOURCE_LOGOS } from './SourceLogo'
import { Icon } from './common/Icon'
import Text from './common/Text'
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
    {source ? <SourceLogo source={source} size={24} /> : <View style={{ width: 24, alignItems: 'center' }}><Icon name={list.id == 'love' ? 'love' : 'album'} size={20} color={theme['q-text-secondary']} /></View>}
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text numberOfLines={1} size={14} color={theme[active ? 'q-accent-text' : 'q-text-primary']} style={{ fontWeight: active ? '600' : '400' }}>{name ?? list.name}</Text>
      {subtitle ? <Text numberOfLines={1} size={11} color={theme['q-text-secondary']}>{label}</Text> : null}
    </View>
  </View>
}
