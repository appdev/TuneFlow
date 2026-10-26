import { useSettingValue } from '@/store/setting/hook'
import OriginalPlayBg from './OriginalPlayBg'
import ImmersivePlayBg from './ImmersivePlayBg'

export default ({ lyricActive }: { lyricActive: boolean }) => {
  const layout = useSettingValue('playDetail.style.layout')
  return layout == 'immersive' ? <ImmersivePlayBg lyricActive={lyricActive} /> : <OriginalPlayBg lyricActive={lyricActive} />
}
