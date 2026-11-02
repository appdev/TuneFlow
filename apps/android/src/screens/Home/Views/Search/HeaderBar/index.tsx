import { useRef, forwardRef, useImperativeHandle } from 'react'
import { StyleSheet, View } from 'react-native'

// import music from '@/utils/musicSdk'
// import InsetShadow from 'react-native-inset-shadow'
import SourceSelector, {
  type SourceSelectorType as _SourceSelectorType,
  type SourceSelectorProps as _SourceSelectorProps,
} from '@/components/SourceSelector'
import SearchInput, { type SearchInputType, type SearchInputProps } from './SearchInput'
import { useTheme } from '@/store/theme/hook'
import { type Source as MusicSource } from '@/store/search/music/state'
import { type Source as SonglistSource } from '@/store/search/songlist/state'
import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { setNavActiveId } from '@/core/common'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
import { phonePalette } from '@/theme/phone'

type Sources = Readonly<Array<MusicSource | SonglistSource>>
type SourceSelectorProps = _SourceSelectorProps<Sources>
type SourceSelectorType = _SourceSelectorType<Sources>

export interface HeaderBarProps {
  showBack: boolean
  onBack: () => void
  onSourceChange: SourceSelectorProps['onSourceChange']
  onTipSearch: SearchInputProps['onChangeText']
  onSearch: SearchInputProps['onSubmit']
  onHideTipList: SearchInputProps['onBlur']
  onShowTipList: SearchInputProps['onFocusText']
}

export interface HeaderBarType {
  setSourceList: SourceSelectorType['setSourceList']
  setText: SearchInputType['setText']
  focus: SearchInputType['focus']
  blur: SearchInputType['blur']
}


export default forwardRef<HeaderBarType, HeaderBarProps>(({ showBack, onBack, onSourceChange, onTipSearch, onSearch, onHideTipList, onShowTipList }, ref) => {
  const sourceSelectorRef = useRef<SourceSelectorType>(null)
  const searchInputRef = useRef<SearchInputType>(null)
  const theme = useTheme()
  const t = useI18n()
  const { phone } = useAdaptiveLayout()

  useImperativeHandle(ref, () => ({
    setSourceList(list, source) {
      sourceSelectorRef.current?.setSourceList(list, source)
    },
    setText(text) {
      searchInputRef.current?.setText(text)
    },
    focus() {
      searchInputRef.current?.focus()
    },
    blur() {
      searchInputRef.current?.blur()
    },
  }), [])


  return (
    <>
    {phone && !showBack ? <View style={styles.phoneHeading}><Text size={25} style={{ flex: 1, fontWeight: '700' }} color={theme['q-text-primary']}>{t('mobile_discover')}</Text><Button accessibilityLabel={t('nav_setting')} style={styles.settings} onPress={() => { global.lx.settingActiveId = 'basic'; setNavActiveId('nav_setting') }}><Icon name="setting" rawSize={22} color={theme['q-text-primary']} /></Button></View> : null}
    <View style={{ ...styles.searchBar, ...(phone ? { paddingHorizontal: 20, height: 60 } : {}), borderBottomColor: theme['q-outline'] }}>
      {showBack ? <Button accessibilityLabel={t('search_back_home')} style={styles.back} onPress={onBack}>
        <Icon name="chevron-left" rawSize={22} color={theme['q-text-primary']} />
      </Button> : null}
      <View
        style={{
          ...styles.searchControl,
          backgroundColor: theme['q-surface-base'],
          borderColor: theme['q-outline'],
          ...(phone ? { borderRadius: 14, backgroundColor: theme['q-surface-raised'], borderColor: phonePalette[theme.isDark ? 'dark' : 'light'].field, flexDirection: 'row-reverse' as const } : {}),
        }}
      >
        <View style={styles.selector}>
          <SourceSelector ref={sourceSelectorRef} onSourceChange={onSourceChange} fontSize={12} center plain iconOnly={!phone} labelOnly={phone} />
        </View>
        <View style={{ ...styles.divider, backgroundColor: theme['q-outline'] }} />
        <SearchInput
          ref={searchInputRef}
          onChangeText={onTipSearch}
          onSubmit={onSearch}
          onBlur={onHideTipList}
          onFocusText={onShowTipList}
        />
      </View>
      {!showBack && !phone ? <Button accessibilityLabel={t('nav_setting')} style={styles.settings} onPress={() => { setNavActiveId('nav_setting') }}>
        <Icon name="setting" rawSize={22} color={theme['q-text-primary']} />
      </Button> : null}
    </View>
    </>
  )
})

const styles = StyleSheet.create({
  phoneHeading: { minHeight: 64, paddingLeft: 20, paddingRight: 12, flexDirection: 'row', alignItems: 'center' },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  settings: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    flexShrink: 0,
    height: 64,
    alignItems: 'center',
    zIndex: 2,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  searchControl: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  selector: {
    flexShrink: 0,
    height: 48,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
  },
})
