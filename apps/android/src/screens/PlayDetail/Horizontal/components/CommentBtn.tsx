import Btn from './Btn'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { usePlayMusicInfo } from '@/store/player/hook'
import { getServiceProvenance } from '@/service/tracks'


export default () => {
  const track = usePlayMusicInfo().musicInfo
  if (track && getServiceProvenance(track)) return null
  const handleShowCommentScreen = () => {
    navigations.pushCommentScreen(commonState.componentIds.playDetail!)
  }

  return <Btn icon="comment" accessibilityLabel={global.i18n.t('comment_show_text')} onPress={handleShowCommentScreen} />
}
