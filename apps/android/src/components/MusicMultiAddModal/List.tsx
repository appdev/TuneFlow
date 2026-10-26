import { ScrollView, View } from 'react-native'
import { useMyList } from '@/store/list/hook'
import ListItem from './ListItem'
import CreateUserList from '../MusicAddModal/CreateUserList'
import { styles } from '../MusicAddModal/List'
import { isReadOnlyList } from '@/service/workspace'

export default ({ listId, onPress, disabled = false, onCreating }: {
  listId: string
  onPress: (listInfo: LX.List.MyListInfo) => void
  disabled?: boolean
  onCreating?: (busy: boolean) => void
}) => {
  const allList = useMyList().filter(list => list.id != listId && !isReadOnlyList(list.id))
  return (
    <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      <View style={styles.list}>
        {allList.map(info => <ListItem key={info.id} listInfo={info} onPress={onPress} disabled={disabled} />)}
        <CreateUserList disabled={disabled} onBusyChange={onCreating} />
      </View>
    </ScrollView>
  )
}
