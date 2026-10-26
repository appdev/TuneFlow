import { signQQRequest } from '@common/utils/qqSign'

export async function zzcSign(text) {
  return signQQRequest(text)
}
