import { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { stop } from '@/core/player/player'
import { getWorkspace, connectService, checkService } from './session'
import { downloadSettingLabels } from './workspace'
import { type SourceDto } from './client'
import { useServiceStatus } from './useSession'

export default ({ section = 'connection' }: { section?: 'connection' | 'sources' | 'downloads' | 'compatibility' }) => {
  const status = useServiceStatus()
  const theme = useTheme()
  const [address, setAddress] = useState(getWorkspace().client.endpoint)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sources, setSources] = useState<SourceDto[]>([])
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = getWorkspace().client
  const run = async(action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  const load = async() => {
    if (section === 'sources') setSources(await client.sources())
    if (section === 'downloads') { setSettings(await client.settings()); setDrafts({}) }
  }
  useEffect(() => { void run(load) }, [section, status.endpoint]) // eslint-disable-line react-hooks/exhaustive-deps
  const action = (label: string, onPress: () => void) => <Button key={label} accessibilityLabel={label} disabled={busy} onPress={onPress} style={{ padding: 10, minHeight: 44, borderWidth: 1, borderColor: theme['q-outline'], borderRadius: 10, marginVertical: 4 }}><Text size={13}>{label}</Text></Button>
  const input = (label: string, value: string, onChange: (value: string) => void, numeric = false) => <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={theme['q-text-secondary']} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? 'numeric' : 'default'} editable={!busy} style={{ color: theme['q-text-primary'], borderColor: theme['q-outline'], borderWidth: 1, padding: 10, minHeight: 44, borderRadius: 8 }} />
  const ordered = [...sources].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  const enabled = ordered.filter(item => item.enabled).map(item => item.id)
  return <View style={{ gap: 12, paddingBottom: 20 }}>
    {section === 'connection' ? <>
      <Text size={18}>服务器连接</Text>
      <Text size={13}>曲库、歌单、收藏、历史和下载由服务器统一保存。更换服务器不会迁移或删除数据。</Text>
      {input('服务器地址', address, setAddress)}
      {action('连接并使用', () => { void run(async() => { await connectService(address, stop); setAddress(getWorkspace().client.endpoint) }) })}
      {action('重新连接 / 刷新', () => { void run(async() => checkService(true)) })}
      <Text size={12}>{status.connected ? '已连接' : '连接不可用'} · {status.endpoint}</Text>
      <Text size={14}>设置归属</Text>
      <Text size={13}>音源和下载设置对所有客户端共同生效。外观、播放音质、音频输出、后台播放和歌词显示仅影响当前设备。</Text>
    </> : section === 'sources' ? <>
      <Text size={18}>音源与解析 · 服务器</Text>
      <Text size={13}>按启用顺序尝试音源；可恢复的解析失败继续尝试其他平台。安全拦截和取消不会被重试绕过。</Text>
      {input('音源脚本地址', sourceUrl, setSourceUrl)}
      {action('从地址导入音源', () => { void run(async() => { await client.importSource(sourceUrl); await load() }) })}
      {action('刷新音源', () => { void run(load) })}
      {!sources.length ? <Text>暂无音源，请导入后启用。</Text> : null}
      {ordered.map(source => <View key={source.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: theme['q-outline'] }}>
        <Text>{source.name} {source.version}</Text><Text size={12}>{source.enabled ? `已启用 · 第 ${(source.priority ?? 0) + 1} 位` : '未启用'}</Text>
        {action(source.enabled ? '停用' : '启用', () => { void run(async() => { setSources(await client.enableSources(source.enabled ? enabled.filter(id => id !== source.id) : [...enabled, source.id])) }) })}
        {source.enabled && source.priority !== 0 ? action('移至首位', () => { void run(async() => { setSources(await client.enableSources([source.id, ...enabled.filter(id => id !== source.id)])) }) }) : null}
        {action('移除此音源', () => { Alert.alert('移除服务器音源？', '所有客户端都会使用更新后的音源链。', [{ text: '取消', style: 'cancel' }, { text: '移除', style: 'destructive', onPress: () => { void run(async() => { await client.request(`/api/v1/sources/${encodeURIComponent(source.id)}`, 'DELETE'); await load() }) } }]) })}
      </View>)}
    </> : section === 'downloads' ? <>
      <Text size={18}>下载设置 · 服务器</Text>
      <Text size={13}>下载在 Docker 中执行，完成后进入“我的音乐 → 音乐库”。保存目录属于服务器。</Text>
      <Text size={13}>边听边存在在线歌曲开始播放后触发，按最高可用音质自动保存到服务器，跳过已有音频；它独立于手动下载的“启用下载”开关，对连接这台服务器的客户端共同生效。</Text>
      {action('刷新设置', () => { void run(load) })}
      {Object.entries(downloadSettingLabels).filter(([key]) => key in settings).map(([key, label]) => <View key={key} style={{ gap: 6 }}>
        <Text size={13}>{label}</Text>
        {typeof settings[key] === 'boolean' ? action(settings[key] ? '已开启 · 点击关闭' : '已关闭 · 点击开启', () => { void run(async() => { setSettings(await client.patchSettings({ [key]: !settings[key] })) }) }) : key === 'download.savePath' ? <Text size={12}>{String(settings[key])}</Text> : <>
          {input(label, drafts[key] ?? String(settings[key]), value => { setDrafts({ ...drafts, [key]: value }) }, typeof settings[key] === 'number')}
          {action(`保存${label}`, () => { void run(async() => { setSettings(await client.patchSettings({ [key]: typeof settings[key] === 'number' ? Number(drafts[key] ?? settings[key]) : drafts[key] ?? settings[key] })) }) })}
        </>}
      </View>)}
    </> : <>
      <Text size={18}>同步与备份说明</Text>
      <Text size={13}>平台登录在“音乐平台账号”中管理，凭证仅保存在当前设备。账号歌单可显式导入服务器；个人推荐在首页选择。旧版点对点同步、云盘和远程备份不会覆盖现有数据。</Text>
      <Text size={13}>已有本机数据仍保留。共享曲库、收藏、歌单与历史直接使用服务器，无需另开同步。</Text>
    </>}
    {error || status.error ? <Text accessibilityRole="alert" size={13}>{error || status.error}</Text> : null}
  </View>
}
