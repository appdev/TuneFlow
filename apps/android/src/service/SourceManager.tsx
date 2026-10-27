import { StyleSheet, TextInput, View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { splitSourceChain } from './sourceChain'
import type { SourceDto } from './client'

interface Props {
  sources: SourceDto[]
  busy: boolean
  sourceUrl: string
  onSourceUrl: (value: string) => void
  onImport: () => void
  onFile: () => void
  onRefresh: () => void
  onEnable: (id: string, value: boolean) => void
  onMove: (id: string, position: number) => void
  onRemove: (id: string) => void
}

export default (props: Props) => {
  const theme = useTheme()
  const chain = splitSourceChain(props.sources)
  const card = [styles.card, { borderColor: theme['q-outline'], backgroundColor: theme['q-surface-base'] }]
  const button = (label: string, onPress: () => void, disabled = false, accessibilityLabel = label) => <Button accessibilityLabel={accessibilityLabel} disabled={props.busy || disabled} onPress={onPress} style={[styles.button, { opacity: props.busy || disabled ? 0.4 : 1 }]}><Text size={12} color={theme['q-accent-text']}>{label}</Text></Button>
  return <View style={styles.manager}>
    <Text size={20} style={styles.heading}>音源与自动切换</Text>
    <Text size={13} color={theme['q-text-secondary']}>按优先级依次尝试已启用的音源，顺序会在所有设备间同步。</Text>
    <View style={card}>
      <Text size={15} style={styles.heading}>导入音源</Text>
      <TextInput accessibilityLabel="音源脚本地址" placeholder="https://example.com/source.js" placeholderTextColor={theme['q-text-secondary']} value={props.sourceUrl} onChangeText={props.onSourceUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!props.busy} style={[styles.input, { color: theme['q-text-primary'], borderColor: theme['q-outline'] }]} />
      <View style={styles.importActions}>
        {button('从地址导入', props.onImport, !props.sourceUrl.trim())}
        {button('选择脚本文件', props.onFile)}
      </View>
      <Text size={12} color={theme['q-text-secondary']}>支持 .js、.txt 文件，最大 1 MiB。导入后需手动启用。</Text>
    </View>
    <View style={card}>
      <View style={styles.listHeader}><Text size={15} style={styles.heading}>已导入音源 · {props.sources.length}</Text>{button('刷新', props.onRefresh)}</View>
      {!props.sources.length ? <Text size={13} color={theme['q-text-secondary']} style={styles.empty}>{props.busy ? '正在加载音源…' : '暂无音源，可从地址或脚本文件导入。'}</Text> : null}
      {[{ enabled: true, items: chain.enabled }, { enabled: false, items: chain.disabled }].map(group => group.items.length ? <View key={String(group.enabled)}>
        <Text size={13} style={styles.groupTitle}>{group.enabled ? '已启用 · 播放优先级' : '未启用'}</Text>
        <Text size={11} color={theme['q-text-secondary']}>{group.enabled ? '使用上移 / 下移调整，自动保存到所有设备' : '启用后加入优先级末尾'}</Text>
        {group.items.map((source, index) => <View key={source.id} style={[styles.source, { borderBottomColor: theme['q-outline'] }]}>
          <View style={styles.sourceHeading}>
            <Text size={13} style={styles.position} color={theme['q-text-secondary']}>{group.enabled ? index + 1 : '—'}</Text>
            <View style={styles.identity}><Text numberOfLines={1} size={14} style={styles.heading}>{source.name}</Text><Text size={11} color={theme['q-text-secondary']}>版本 {source.version || '未知'}</Text></View>
            <Text size={11} color={theme[group.enabled ? 'q-accent-text' : 'q-text-secondary']}>{group.enabled ? '已启用' : '未启用'}</Text>
          </View>
          <View style={styles.actions}>
            {group.enabled ? <>
              {button('上移', () => { props.onMove(source.id, index - 1) }, index === 0, `上移：${source.name}`)}
              {button('下移', () => { props.onMove(source.id, index + 1) }, index === group.items.length - 1, `下移：${source.name}`)}
              {button('置顶', () => { props.onMove(source.id, 0) }, index === 0, `置顶：${source.name}`)}
            </> : null}
            {button(group.enabled ? '停用' : '启用', () => { props.onEnable(source.id, !source.enabled) }, false, `${group.enabled ? '停用' : '启用'}：${source.name}`)}
            {button('移除', () => { props.onRemove(source.id) }, false, `移除：${source.name}`)}
          </View>
        </View>)}
      </View> : null)}
      {props.sources.length && !chain.enabled.length ? <Text size={12} color={theme['q-text-secondary']} style={styles.empty}>尚未启用音源，启用后才会用于播放与自动切换。</Text> : null}
    </View>
    <Text size={12} color={theme['q-text-secondary']}>可恢复的解析失败会继续尝试其他平台；安全拦截和取消操作不会被重试绕过。</Text>
  </View>
}

const styles = StyleSheet.create({
  manager: { gap: 12 },
  heading: { fontWeight: '600' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, gap: 8 },
  input: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, fontSize: 14 },
  importActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 8 },
  groupTitle: { marginTop: 12, marginBottom: 4, fontWeight: '500' },
  source: { paddingTop: 14, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  sourceHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  position: { width: 22, textAlign: 'center', fontVariant: ['tabular-nums'] },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 2, marginTop: 4 },
  empty: { textAlign: 'center', paddingVertical: 18 },
})
