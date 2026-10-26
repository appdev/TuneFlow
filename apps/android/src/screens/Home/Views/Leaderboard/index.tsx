import Vertical from './Vertical'
import Horizontal from './Horizontal'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
// import { AppColors } from '@/theme'

export default () => {
  const { splitLibrary } = useAdaptiveLayout()
  return splitLibrary ? <Horizontal /> : <Vertical />
}
