import { useEffect, useState } from 'react'
import { serviceStatus, subscribeService } from './session'

export const useServiceStatus = () => {
  const [status, setStatus] = useState({ ...serviceStatus })
  useEffect(() => subscribeService(() => { setStatus({ ...serviceStatus }) }), [])
  return status
}
