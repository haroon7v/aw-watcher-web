import browser from 'webextension-polyfill'
import config from '../config'
import { getCloudSyncPolicy, getTagPolicy, getSubdomainPolicy, getASHeartbeats, clearASHeartbeats } from '../storage'
import { assetSonarLambdaUrl, processInBatches } from './helpers'

interface SyncConfig {
  tag: string
  subdomain: string
  url: string
}

const validateSyncPrerequisites = async (): Promise<SyncConfig | null> => {
  const tag = await getTagPolicy()
  const subdomain = await getSubdomainPolicy()
  if (!subdomain || !tag || subdomain.trim() === '' || tag.trim() === '') {
    console.error('Subdomain or tag not set or blank, skipping cloud sync')
    return null
  }
  return { tag, subdomain, url: assetSonarLambdaUrl() }
}

const syncBatch = async (batch: any[], config: SyncConfig): Promise<boolean> => {
  // Skip posting if subdomain or token are blank
  if (!config.subdomain || !config.tag || config.subdomain.trim() === '' || config.tag.trim() === '') {
    console.warn('Skipping batch sync - subdomain or token is blank')
    return false
  }

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        subdomain: config.subdomain,
        token: config.tag,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activity: batch }),
    });
    
    if (response.ok) {
      console.debug(`Successfully synced batch of ${batch.length} items`);
      return true;
    } else {
      console.error("Failed to post data:", response.statusText);
      return false;
    }
  } catch (error) {
    console.error("Error posting batch data:", error);
    return false;
  }
}

const clearHeartbeats = async (success: boolean): Promise<void> => {
  if (success) {
    try {
      await clearASHeartbeats();
    } catch (error) {
      console.error('Failed to clear stored heartbeats:', error);
    }
  } else {
    console.warn('Some batches failed to sync, keeping stored heartbeats for retry');
  }
}

interface ParsedUrl {
  scheme: string
  host: string
}

const parseUrl = (url: string): ParsedUrl => {
  let scheme = ''
  let host = ''
  
  try {
    const parsedUrl = new URL(url)
    scheme = parsedUrl.protocol.replace(':', '') // Remove the colon from protocol
    host = parsedUrl.hostname
  } catch (error) {
    console.warn('Invalid URL:', url, error)
  }
  
  return { scheme, host }
}

interface MappedHeartbeat {
  timestamp: string
  duration: number
  url: string
  title: string
  protocol: string
  domain: string
  email?: string
}

const mapHeartbeatData = (asHeartbeats: any[]): MappedHeartbeat[] => {
  return asHeartbeats.map(heartbeat => {
    // Extract scheme and host from URL
    const { scheme, host } = heartbeat.data.url && typeof heartbeat.data.url === 'string' 
      ? parseUrl(heartbeat.data.url)
      : { scheme: '', host: '' }
    
    return {
      url: heartbeat.data.url,
      title: heartbeat.data.title,
      timestamp: heartbeat.timestamp.toISOString(),
      duration: heartbeat.duration / 1000, // Convert milliseconds to seconds
      protocol: scheme,
      domain: host,
      email: heartbeat.email
    }
  })
}

const isValidHeartbeat = (heartbeat: MappedHeartbeat): boolean => {
  const isValidScheme = heartbeat.protocol === 'http' || heartbeat.protocol === 'https'
  const hasValidHost = Boolean(heartbeat.domain && heartbeat.domain.length > 0)
  
  if (!isValidScheme || !hasValidHost) {
    console.debug('Filtering out heartbeat with invalid URL:', {
      scheme: heartbeat.protocol,
      host: heartbeat.domain
    })
  }
  
  return isValidScheme && hasValidHost
}

const filterValidHeartbeats = (mappedHeartbeats: MappedHeartbeat[]): MappedHeartbeat[] => {
  return mappedHeartbeats.filter(isValidHeartbeat)
}

export const cloudSyncAlarmListener = () => async (alarm: browser.Alarms.Alarm) => {
  if (alarm.name !== config.cloudSync.alarmName) return

  const cloudSyncEnabled = await getCloudSyncPolicy()
  if (!cloudSyncEnabled) {
    console.debug('CLOUD_SYNC policy disabled, skipping cloud sync alarm')
    return
  }

  try {
    const syncConfig = await validateSyncPrerequisites()
    if (!syncConfig) return

    const asHeartbeats = await getASHeartbeats()
    if (!asHeartbeats || asHeartbeats.length === 0) {
      console.debug('No data to sync')
      return
    }

    // Convert ASHeartbeats to the format expected by the sync API
    const mappedHeartbeats = mapHeartbeatData(asHeartbeats)
    const data = filterValidHeartbeats(mappedHeartbeats)

    // Check if we have any data to sync
    if (data.length === 0) {
      console.debug('No valid data to sync after filtering')
      return
    }

    let allBatchesSuccessful = true
    let anyBatchAttempted = false
    
    await processInBatches(data, 100, async (batch) => {
      const success = await syncBatch(batch, syncConfig)
      anyBatchAttempted = true
      if (!success) allBatchesSuccessful = false
    })
    
    // Only clear heartbeats if at least one batch was attempted and all were successful
    if (anyBatchAttempted) {
      await clearHeartbeats(allBatchesSuccessful)
    } else {
      console.debug('No batches were attempted due to invalid credentials, keeping stored heartbeats')
    }
    
    console.debug('Cloud sync completed successfully', syncConfig)
  } catch (error) {
    console.error('Cloud sync failed:', error)
  }
}
