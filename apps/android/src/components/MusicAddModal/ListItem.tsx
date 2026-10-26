import { View } from 'react-native'
import Button from '@/components/common/Button'
import PlaylistIdentity, { getPlaylistLabel } from '@/components/PlaylistIdentity'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useMusicExistsList } from '@/store/list/hook'
import { Q_UI } from '@/theme/ui'

export default ({ listInfo, onPress, musicInfo, disabled = false }: {
  listInfo: LX.List.MyListInfo
  onPress: (listInfo: LX.List.MyListInfo) => void
  musicInfo: LX.Music.MusicInfo
  disabled?: boolean
}) => {
  const theme = useTheme()
  const isExists = useMusicExistsList(listInfo, musicInfo)

  const handlePress = () => {
    if (disabled || isExists) return
    onPress(listInfo)
  }

  return (
    <View>
      <Button
        accessibilityLabel={isExists ? `${getPlaylistLabel(listInfo)}，${global.i18n.t('list_add_tip_exists')}` : getPlaylistLabel(listInfo)}
        disabled={disabled || isExists}
        style={{ ...styles.button, backgroundColor: theme['q-surface-tint'] }}
        onPress={handlePress}
      >
        <PlaylistIdentity list={listInfo} subtitle />
        <Icon accessible={false} name={isExists ? 'check' : 'chevron-right'} rawSize={16} color={theme['q-text-secondary']} />
      </Button>
    </View>
  )
}

export const styles = createStyle({
  button: {
    minHeight: 56,
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: Q_UI.radius.control,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
})
