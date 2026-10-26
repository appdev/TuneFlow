import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureAccountAccessStorage } from '../../../../packages/service-client/src/client'
export * from '../../../../packages/service-client/src/client'
const key = (endpoint: string) => `@tuneflow_device_v1:${encodeURIComponent(endpoint)}`
configureAccountAccessStorage({ get: async endpoint => AsyncStorage.getItem(key(endpoint)), set: async(endpoint, token) => AsyncStorage.setItem(key(endpoint), token), remove: async endpoint => AsyncStorage.removeItem(key(endpoint)) })
