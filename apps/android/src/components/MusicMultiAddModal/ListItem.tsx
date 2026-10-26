import { View } from 'react-native'
import Button from '@/components/common/Button'
import PlaylistIdentity, { getPlaylistLabel } from '@/components/PlaylistIdentity'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { styles } from '../MusicAddModal/ListItem'

export default ({ listInfo, onPress, disabled = false }: {
  listInfo: LX.List.MyListInfo
  onPress: (listInfo: LX.List.MyListInfo) => void
  disabled?: boolean
}) => {
  const theme = useTheme()

  const handlePress = () => {
    if (!disabled) onPress(listInfo)
  }

  return (
    <View>
      <Button
        accessibilityLabel={getPlaylistLabel(listInfo)}
        disabled={disabled}
        style={{ ...styles.button, backgroundColor: theme['q-surface-tint'] }}
        onPress={handlePress}
      >
        <PlaylistIdentity list={listInfo} subtitle />
        <Icon accessible={false} name="chevron-right" rawSize={16} color={theme['q-text-secondary']} />
      </Button>
    </View>
  )
}
