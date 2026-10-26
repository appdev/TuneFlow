import { memo, useCallback, useMemo } from 'react'
import { Linking, StyleSheet, Text } from 'react-native'
import Markdown, { MarkdownIt, type RenderRules } from 'react-native-markdown-display'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { setSpText } from '@/utils/pixelRatio'
import { toast } from '@/utils/tools'

const parser = MarkdownIt({ html: false, linkify: true, typographer: false })
const rules: RenderRules = {
  // 使用原生 Text 继承行内加粗、链接等样式，并保留更新说明的长按复制。
  textgroup: (node, children, _parents, styles) => <Text key={node.key} selectable style={styles.textgroup}>{children}</Text>,
  image: node => node.content ? <Text key={node.key}>{node.content}</Text> : null,
}

export default memo(({ children }: { children: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const styles = useMemo(() => {
    const heading = { color: theme['q-text-primary'], fontWeight: '600' as const, marginTop: 12, marginBottom: 6 }
    const code = { color: theme['q-text-primary'], backgroundColor: theme['q-surface-tint'], borderColor: theme['q-outline'], fontSize: setSpText(12) }
    return StyleSheet.create({
      body: { color: theme['q-text-primary'], fontSize: setSpText(13), lineHeight: setSpText(21) },
      heading1: { ...heading, fontSize: setSpText(19), lineHeight: setSpText(27) },
      heading2: { ...heading, fontSize: setSpText(17), lineHeight: setSpText(25) },
      heading3: { ...heading, fontSize: setSpText(15), lineHeight: setSpText(23) },
      heading4: { ...heading, fontSize: setSpText(14) },
      heading5: { ...heading, fontSize: setSpText(13) },
      heading6: { ...heading, fontSize: setSpText(13) },
      paragraph: { marginTop: 3, marginBottom: 9 },
      list_item: { marginBottom: 4 },
      bullet_list_icon: { marginLeft: 2, marginRight: 8 },
      ordered_list_icon: { marginLeft: 2, marginRight: 8 },
      strong: { fontWeight: '600' },
      link: { color: theme['q-accent-text'], textDecorationLine: 'underline' },
      blockquote: { backgroundColor: theme['q-surface-tint'], borderColor: theme['q-accent'], borderLeftWidth: 3, paddingHorizontal: 10, marginLeft: 0, marginVertical: 6 },
      code_inline: { ...code, borderWidth: 0, padding: 0 },
      code_block: code,
      fence: code,
      hr: { backgroundColor: theme['q-outline'], height: StyleSheet.hairlineWidth, marginVertical: 10 },
      table: { borderColor: theme['q-outline'] },
      tr: { borderColor: theme['q-outline'] },
    })
  }, [theme])
  const onLinkPress = useCallback((url: string) => {
    // 更新说明只打开网页，不执行安装、文件或应用深链。
    if (/^https?:\/\/[^\s]+$/i.test(url)) void Linking.openURL(url).catch(() => { toast(t('version_link_open_failed')) })
    return false
  }, [t])
  // GitHub 发布标记属于 HTML 注释，不应作为正文显示。
  const content = useMemo(() => children.replace(/<!--[\s\S]*?-->/g, '').trim(), [children])
  return <Markdown markdownit={parser} style={styles} rules={rules} onLinkPress={onLinkPress}>{content}</Markdown>
})
