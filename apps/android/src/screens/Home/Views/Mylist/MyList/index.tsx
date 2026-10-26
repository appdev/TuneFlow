import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'

import ListMenu, { type ListMenuType } from './ListMenu'
import ListNameEdit, { type ListNameEditType } from './ListNameEdit'
import List from './List'
import ListImportExport, { type ListImportExportType } from './ListImportExport'
import { handleRemove, handleSync } from './listAction'
import { refreshServiceLists } from '@/service/session'
import { toast } from '@/utils/tools'
import ListMusicSort, { type ListMusicSortType } from './ListMusicSort'
import DuplicateMusic, { type DuplicateMusicType } from './DuplicateMusic'


export default ({ embedded = false }: { embedded?: boolean }) => {
  const theme = useTheme()
  const t = useI18n()
  const [visible, setVisible] = useState(embedded)
  const listMenuRef = useRef<ListMenuType>(null)
  const listNameEditRef = useRef<ListNameEditType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const duplicateMusicRef = useRef<DuplicateMusicType>(null)
  const listImportExportRef = useRef<ListImportExportType>(null)

  useEffect(() => {
    let isInited = false
    const changeVisible = (visibleList: boolean) => {
      if (visibleList && !isInited) {
        requestAnimationFrame(() => {
          setVisible(true)
        })
        isInited = true
      }
    }
    global.app_event.on('changeLoveListVisible', changeVisible)

    return () => {
      global.app_event.off('changeLoveListVisible', changeVisible)
    }
  }, [])

  return (
    (visible || embedded)
      ? <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 8, borderBottomWidth: 0.5, borderColor: theme['q-outline'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text size={16} numberOfLines={1} style={{ flex: 1, fontWeight: '700' }}>{t('mobile_playlists')}</Text>
              <Button accessibilityLabel={t('list_create')} onPress={() => listNameEditRef.current?.showCreate(0)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="add" size={20} color={theme['q-accent-text']} /></Button>
              {!embedded ? <Button accessibilityLabel={t('close')} onPress={() => { global.app_event.changeLoveListVisible(false) }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={20} color={theme['q-text-secondary']} /></Button> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button onPress={() => { void refreshServiceLists().catch(() => { toast('歌单刷新失败，请检查服务器连接') }) }} style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme['q-surface-tint'] }}><Text size={12} color={theme['q-accent-text']}>刷新歌单</Text></Button>
            </View>
          </View>
          <List onShowMenu={(info, position) => listMenuRef.current?.show(info, position)} />
          <ListNameEdit ref={listNameEditRef} />
          <ListMusicSort ref={listMusicSortRef} />
          <DuplicateMusic ref={duplicateMusicRef} />
          <ListImportExport ref={listImportExportRef} />
          <ListMenu
            ref={listMenuRef}
            onNew={index => listNameEditRef.current?.showCreate(index)}
            onRename={info => listNameEditRef.current?.show(info)}
            onSort={info => listMusicSortRef.current?.show(info)}
            onDuplicateMusic={info => duplicateMusicRef.current?.show(info)}
            onImport={(info, position) => listImportExportRef.current?.import(info, position)}
            onExport={(info, position) => listImportExportRef.current?.export(info, position)}
            onRemove={info => { handleRemove(info) }}
            onSync={info => { handleSync(info) }}
            onSelectLocalFile={(info, position) => listImportExportRef.current?.selectFile(info, position)}
          />
          {/* <ImportExport actionType={actionType} visible={isShowChoosePath} hide={() => setShowChoosePath(false)} selectedListRef={selectedListRef} /> */}
        </View>
      : null
  )
}
