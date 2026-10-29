import Text, { type TextProps } from './Text'
import { useTheme } from '@/store/theme/hook'

/** Shared list hierarchy; Text retains the user's font scaling and shadow settings. */
export default ({ secondary = false, active = false, car = false, style, ...props }: Omit<TextProps, 'size' | 'color'> & {
  secondary?: boolean
  active?: boolean
  car?: boolean
}) => {
  const theme = useTheme()
  return <Text
    {...props}
    size={secondary ? (car ? 13 : 12) : (car ? 18 : 14)}
    color={theme[secondary ? 'q-text-secondary' : active ? 'q-accent-text' : 'q-text-primary']}
    style={[{ fontWeight: active && !secondary ? '600' : '400' }, style]}
  />
}
