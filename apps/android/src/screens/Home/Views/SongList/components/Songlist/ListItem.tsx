import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { type ListInfoItem } from '@/store/songlist/state'
import ListText from '@/components/common/ListText'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import Image from '@/components/common/Image'
import Badge from '@/components/common/Badge'
import Button from '@/components/common/Button'

export const ITEM_HEIGHT = 92

export default memo(({ item, index, showSource, onPress }: {
  item: ListInfoItem
  index: number
  showSource: boolean
  onPress: (item: ListInfoItem, index: number) => void
}) => {
  const theme = useTheme()
  const handlePress = () => {
    onPress(item, index)
  }

  const detail = [item.total, item.play_count, item.time].filter(Boolean).join(' · ')

  return (
    <Button
      accessibilityLabel={item.name}
      style={styles.item}
      onPress={handlePress}
    >
      <View
        style={{
          ...styles.cover,
          backgroundColor: theme['q-surface-tint'],
        }}
      >
        <Image
          url={item.img}
          nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${item.id}`}
          style={styles.coverImage}
        />
      </View>
      <View style={styles.content}>
        <ListText style={styles.title} numberOfLines={2}>
          {item.name}
        </ListText>
        {
          item.author
            ? <ListText style={styles.author} secondary numberOfLines={1}>{item.author}</ListText>
            : null
        }
        <View style={styles.meta}>
          {showSource ? <Badge type="tertiary">{item.source.toUpperCase()}</Badge> : null}
          {
            detail
              ? <ListText style={styles.detail} secondary numberOfLines={1}>{detail}</ListText>
              : null
          }
        </View>
      </View>
    </Button>
  )
})

const styles = StyleSheet.create({
  item: {
    height: ITEM_HEIGHT,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cover: {
    width: 70,
    height: 70,
    flexShrink: 0,
    borderRadius: 12,
    overflow: 'hidden',
  },
  coverImage: {
    width: 70,
    height: 70,
  },
  content: {
    minWidth: 0,
    flex: 1,
    paddingLeft: 14,
    paddingRight: 4,
  },
  title: {
    lineHeight: 18,
    fontWeight: '400',
  },
  author: {
    marginTop: 4,
  },
  meta: {
    minHeight: 16,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  detail: {
    minWidth: 0,
    flexShrink: 1,
  },
})
