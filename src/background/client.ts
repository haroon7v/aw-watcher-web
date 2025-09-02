import config from '../config'

import { AWClient, IEvent } from 'aw-client'
import retry from 'p-retry'
import { emitNotification, getBrowser, logHttpError } from './helpers'
import { getHostname, getSyncStatus, setSyncStatus, getCloudSyncPolicy, addASHeartbeat } from '../storage'

export const getClient = async () => {
  const cloudSyncEnabled = await getCloudSyncPolicy()
  const mode = cloudSyncEnabled ? 'cloud' : 'default'
  return new AWClient('aw-client-web', { testing: config.isDevelopment, mode })
}

// TODO: We might want to get the hostname somehow, maybe like this:
// https://stackoverflow.com/questions/28223087/how-can-i-allow-firefox-or-chrome-to-read-a-pcs-hostname-or-other-assignable
export async function ensureBucket(
  client: AWClient,
  bucketId: string,
  hostname: string,
) {
  return retry(
    () =>
      client
        .ensureBucket(bucketId, 'web.tab.current', hostname)
        .catch((err) => {
          console.error('Failed to create bucket, retrying...')
          logHttpError(err)
          return Promise.reject(err)
        }),
    { forever: true, minTimeout: 500 },
  )
}

export async function detectHostname(client: AWClient) {
  const cloudSyncEnabled = await getCloudSyncPolicy()
  if (cloudSyncEnabled) {
    console.debug('CLOUD_SYNC policy enabled, skipping hostname detection from ActivityWatch server')
    return undefined
  }

  console.debug('Attempting to detect hostname from server...')
  return retry(
    () => {
      console.debug('Making request to server for hostname...')
      return client.getInfo()
    },
    {
      retries: 3,
      onFailedAttempt: (error) => {
        console.warn(
          `Failed to detect hostname (attempt ${error.attemptNumber}/${error.retriesLeft + error.attemptNumber}):`,
          error.message,
        )
      },
    },
  )
    .then((info) => {
      console.info('Successfully detected hostname:', info.hostname)
      return info.hostname
    })
    .catch((err) => {
      console.error('All attempts to detect hostname failed:', err)
      return undefined
    })
}

export async function sendHeartbeat(
  client: AWClient,
  bucketId: string,
  timestamp: Date,
  data: IEvent['data'],
  pulsetime: number,
  email: string | undefined
) {
  const hostname = (await getHostname()) ?? 'unknown'
  const syncStatus = await getSyncStatus()
  const cloudSyncEnabled = await getCloudSyncPolicy()
  
  // If cloud sync is enabled, store heartbeat data in browser storage instead of sending to server
  if (cloudSyncEnabled) {
    try {
      await addASHeartbeat({
        timestamp,
        duration: 0, // Initial duration is 0 for new heartbeats
        data,
        email
      }, pulsetime)
      console.debug('Heartbeat data stored in browser storage for cloud sync')
      return Promise.resolve()
    } catch (err) {
      console.error('Failed to store heartbeat data in browser storage:', err)
      return Promise.reject(err)
    }
  }
  
  // Original functionality for when cloud sync is disabled
  return retry(
    () =>
      client.heartbeat(bucketId, pulsetime, {
        data,
        duration: 0,
        timestamp,
      }, email),
    {
      retries: 3,
      onFailedAttempt: () => {
        if (!cloudSyncEnabled) {
          ensureBucket(client, bucketId, hostname).then(() => {})
        }
      },
    },
  )
    .then(() => {
      if (syncStatus.success === false) {
        emitNotification(
          'Now connected again',
          'Connection to ActivityWatch server established again',
        )
      }
      setSyncStatus(true)
    })
    .catch((err) => {
      if (syncStatus.success) {
        emitNotification(
          'Unable to send event to server',
          'Please ensure that ActivityWatch is running',
        )
      }
      setSyncStatus(false)
      return logHttpError(err)
    })
}

export const getBucketId = async (): Promise<string> => {
  const browser = await getBrowser()
  const hostname = await getHostname()
  if (hostname !== undefined) {
    return `aw-watcher-web-${browser}_${hostname}`
  } else {
    return `aw-watcher-web-${browser}`
  }
}
