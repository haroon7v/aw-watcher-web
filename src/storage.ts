import { IEvent } from 'aw-client'
import browser from 'webextension-polyfill'

function watchKey<T>(key: string, cb: (value: T) => void | Promise<void>) {
  const listener = (
    changes: browser.Storage.StorageAreaOnChangedChangesType,
  ) => {
    if (!(key in changes)) return
    cb(changes[key].newValue as T)
  }
  browser.storage.local.onChanged.addListener(listener)
  return () => browser.storage.local.onChanged.removeListener(listener)
}

async function waitForKey<T>(key: string, desiredValue: T) {
  const value = await browser.storage.local.get(key).then((_) => _[key])
  if (value === desiredValue) return
  return new Promise<void>((resolve) => {
    const unsubscribe = watchKey<T>(key, (value) => {
      if (value !== desiredValue) return
      resolve()
      unsubscribe()
    })
  })
}

type SyncStatus = { success?: boolean; date?: string }
export const getSyncStatus = (): Promise<SyncStatus> =>
  browser.storage.local
    .get(['lastSyncSuccess', 'lastSync'])
    .then(({ lastSyncSuccess, lastSync }) => ({
      success:
        lastSyncSuccess === undefined
          ? lastSyncSuccess
          : Boolean(lastSyncSuccess),
      date: lastSync === undefined ? lastSync : String(lastSync),
    }))
export const setSyncStatus = (lastSyncSuccess: boolean) =>
  browser.storage.local.set({
    lastSyncSuccess,
    lastSync: new Date().toISOString(),
  })
export const watchSyncSuccess = (
  cb: (success: boolean | undefined) => void | Promise<void>,
) => watchKey('lastSyncSuccess', cb)
export const watchSyncDate = (
  cb: (date: string | undefined) => void | Promise<void>,
) => watchKey('lastSync', cb)

type ConsentStatus = { consent?: boolean; required?: boolean }
export const getConsentStatus = async (): Promise<ConsentStatus> =>
  browser.storage.local
    .get(['consentRequired', 'consent'])
    .then(({ consent, consentRequired }) => ({
      consent: typeof consent === 'boolean' ? consent : undefined,
      required:
        typeof consentRequired === 'boolean' ? consentRequired : undefined,
    }))
export const setConsentStatus = async (status: ConsentStatus): Promise<void> =>
  browser.storage.local.set({
    consentRequired: status.required,
    consent: status.consent,
  })

type Enabled = boolean
export const waitForEnabled = () => waitForKey('enabled', true)
export const getEnabled = (): Promise<Enabled> =>
  browser.storage.local.get('enabled').then((_) => Boolean(_.enabled))
export const setEnabled = (enabled: Enabled) =>
  browser.storage.local.set({ enabled })

type BaseUrl = string
export const getBaseUrl = (): Promise<BaseUrl | undefined> =>
  browser.storage.local
    .get('baseUrl')
    .then((_) => _.baseUrl as string | undefined)
export const setBaseUrl = (baseUrl: BaseUrl) =>
  browser.storage.local.set({ baseUrl })

type HeartbeatData = IEvent['data']
export const getHeartbeatData = (): Promise<HeartbeatData | undefined> =>
  browser.storage.local
    .get('heartbeatData')
    .then((_) => _.heartbeatData as HeartbeatData | undefined)
export const setHeartbeatData = (heartbeatData: HeartbeatData) =>
  browser.storage.local.set({ heartbeatData })

type BrowserName = string
type StorageData = { [key: string]: any }
export const getBrowserName = (): Promise<BrowserName | undefined> =>
  browser.storage.local
    .get('browserName')
    .then((data: StorageData) => data.browserName as string | undefined)
export const setBrowserName = (browserName: BrowserName) =>
  browser.storage.local.set({ browserName })

type Hostname = string
export const getHostname = (): Promise<Hostname | undefined> =>
  browser.storage.local
    .get('hostname')
    .then((data: StorageData) => data.hostname as string | undefined)
export const setHostname = (hostname: Hostname) =>
  browser.storage.local.set({ hostname })

type Domain = { id: string, domain: string, matchType: string }
export const getDomains = (): Promise<Domain[] | undefined> =>
  browser.storage.local
    .get('domains')
    .then((data: StorageData) => {
      const domains = data.domains as Domain[] | undefined
      if (!Array.isArray(domains)) return undefined
      return domains.map(domain => ({
        id: domain.id as string,
        domain: domain.domain as string,
        matchType: domain.matchType as string
      }))
    })

export const setDomains = (domains: Domain[]): Promise<void> =>
  browser.storage.local.set({ domains })

// Chrome extension policy for CLOUD_SYNC
export const getCloudSyncPolicy = async (): Promise<boolean> => {
  try {
    // Try to read from managed storage (policy)
    const result = await browser.storage.managed.get('CLOUD_SYNC')
    return Boolean(result.CLOUD_SYNC)
  } catch (error) {
    // If managed storage is not available (e.g., in Firefox), default to false
    console.debug('Managed storage not available, defaulting CLOUD_SYNC to false:', error)
    return false
  }
}

// Chrome extension policies for authentication and cloud configuration
export const getTagPolicy = async (): Promise<string> => {
  try {
    const result = await browser.storage.managed.get('TAG')
    return (result.TAG as string) || ''
  } catch (error) {
    console.debug('Managed storage not available, defaulting TAG to empty string:', error)
    return ''
  }
}

export const getSubdomainPolicy = async (): Promise<string> => {
  try {
    const result = await browser.storage.managed.get('SUBDOMAIN')
    return (result.SUBDOMAIN as string) || ''
  } catch (error) {
    console.debug('Managed storage not available, defaulting SUBDOMAIN to empty string:', error)
    return ''
  }
}

export const getRegionPolicy = async (): Promise<string> => {
  try {
    const result = await browser.storage.managed.get('REGION')
    return (result.REGION as string) || ''
  } catch (error) {
    console.debug('Managed storage not available, defaulting REGION to empty string:', error)
    return ''
  }
}

// Storage functions for asHeartbeats array
type ASHeartbeat = {
  timestamp: Date
  duration: number // Duration in milliseconds
  data: IEvent['data']
  email?: string
}

// Internal storage type with string timestamp for serialization
type ASHeartbeatStorage = {
  timestamp: string
  duration: number // Duration in milliseconds
  data: IEvent['data']
  email?: string
}

// Helper functions to convert between storage and working formats
const toStorageFormat = (heartbeat: ASHeartbeat): ASHeartbeatStorage => ({
  ...heartbeat,
  timestamp: heartbeat.timestamp.toISOString()
})

const fromStorageFormat = (heartbeat: ASHeartbeatStorage): ASHeartbeat => ({
  ...heartbeat,
  timestamp: new Date(heartbeat.timestamp)
})

// Heartbeat merging logic based on server implementation
const heartbeatMerge = (
  lastHeartbeat: ASHeartbeat,
  newHeartbeat: ASHeartbeat,
  pulsetime: number
): ASHeartbeat | null => {
  // Only merge if data is identical
  if (lastHeartbeat.data.url !== newHeartbeat.data.url) {
    return null
  }

  // Calculate pulse window end time (last heartbeat start + duration + pulsetime)
  const lastEndTime = new Date(lastHeartbeat.timestamp.getTime() + lastHeartbeat.duration + pulsetime * 1000)
  
  // Check if new heartbeat is within pulse window
  const withinPulseWindow = newHeartbeat.timestamp <= lastEndTime

  if (withinPulseWindow) {
    // Calculate new duration: time from last heartbeat start to new heartbeat timestamp
    const newDuration = newHeartbeat.timestamp.getTime() - lastHeartbeat.timestamp.getTime()
    
    // Use max duration to prevent shortening (like server implementation)
    const extendedDuration = Math.max(lastHeartbeat.duration, newDuration)
    
    // Return the last heartbeat with extended duration
    // Keep original timestamp (start time) and only update duration (like server)
    return {
      ...lastHeartbeat,
      duration: extendedDuration,
      email: newHeartbeat.email || lastHeartbeat.email
    }
  }

  return null
}

export const getASHeartbeats = (): Promise<ASHeartbeat[]> =>
  browser.storage.local
    .get('asHeartbeats')
    .then((data: StorageData) => {
      const heartbeats = data.asHeartbeats as ASHeartbeatStorage[] | undefined
      if (!Array.isArray(heartbeats)) return []
      return heartbeats.map(fromStorageFormat)
    })

export const addASHeartbeat = async (heartbeat: ASHeartbeat, pulsetime: number = 30): Promise<void> => {
  const existingHeartbeats = await getASHeartbeats()
  
  if (existingHeartbeats.length === 0) {
    // No existing heartbeats, just add the new one
    return browser.storage.local.set({ asHeartbeats: [toStorageFormat(heartbeat)] })
  }

  // Get the last heartbeat
  const lastHeartbeat = existingHeartbeats[existingHeartbeats.length - 1]
  
  // Try to merge with the last heartbeat
  const mergedHeartbeat = heartbeatMerge(lastHeartbeat, heartbeat, pulsetime)
  
  if (mergedHeartbeat) {
    // Replace the last heartbeat with the merged one
    const updatedHeartbeats = [...existingHeartbeats.slice(0, -1), mergedHeartbeat]
    return browser.storage.local.set({ asHeartbeats: updatedHeartbeats.map(toStorageFormat) })
  } else {
    // Cannot merge, add as new heartbeat
    const updatedHeartbeats = [...existingHeartbeats, heartbeat]
    return browser.storage.local.set({ asHeartbeats: updatedHeartbeats.map(toStorageFormat) })
  }
}

export const clearASHeartbeats = (): Promise<void> =>
  browser.storage.local.set({ asHeartbeats: [] })
