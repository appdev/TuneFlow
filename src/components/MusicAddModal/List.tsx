import { ScrollView, View } from 'react-native'
import { useMyList } from '@/store/list/hook'
import ListItem from './ListItem'
import CreateUserList from './CreateUserList'
import { createStyle } from '@/utils/tools'
import { isReadOnlyList } from '@/service/workspace'

export const styles = createStyle({
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
})

export default ({ musicInfo, onPress, disabled = false, onCreating, children }: {
  musicInfo: LX.Music.MusicInfo
  onPress: (listInfo: LX.List.MyListInfo) => void
  disabled?: boolean
  onCreating?: (busy: boolean) => void
  children?: React.ReactNode
}) => {
  const allList = useMyList()
  return (
    <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      {children}
      <View style={styles.list}>
        {allList.filter(info => !isReadOnlyList(info.id)).map(info => <ListItem key={info.id} listInfo={info} musicInfo={musicInfo} onPress={onPress} disabled={disabled} />)}
        <CreateUserList disabled={disabled} onBusyChange={onCreating} />
      </View>
    </ScrollView>
  )
}
