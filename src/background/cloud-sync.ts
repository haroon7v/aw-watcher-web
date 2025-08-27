import browser from 'webextension-polyfill'
import { AWClient } from 'aw-client'
import config from '../config'
import { getCloudSyncPolicy, getTagPolicy, getSubdomainPolicy } from '../storage'
import { assetSonarLambdaUrl, processInBatches } from './helpers'

interface SyncConfig {
  tag: string
  subdomain: string
  url: string
}

const validateSyncPrerequisites = async (): Promise<SyncConfig | null> => {
  const tag = await getTagPolicy()
  const subdomain = await getSubdomainPolicy()
  if (!subdomain || !tag) {
    console.error('Subdomain or tag not set, skipping cloud sync')
    return null
  }
  return { tag, subdomain, url: assetSonarLambdaUrl() }
}

const syncBatch = async (batch: any[], config: SyncConfig): Promise<boolean> => {
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

const clearHeartbeats = async (client: AWClient, success: boolean): Promise<void> => {
  if (success) {
    try {
      await client.clearStoredHeartbeats();
    } catch (error) {
      console.error('Failed to clear stored heartbeats:', error);
    }
  } else {
    console.warn('Some batches failed to sync, keeping stored heartbeats for retry');
  }
}

export const cloudSyncAlarmListener = (client: AWClient) => async (alarm: browser.Alarms.Alarm) => {
  if (alarm.name !== config.cloudSync.alarmName) return

  const cloudSyncEnabled = await getCloudSyncPolicy()
  if (!cloudSyncEnabled) {
    console.debug('CLOUD_SYNC policy disabled, skipping cloud sync alarm')
    return
  }

  try {
    const syncConfig = await validateSyncPrerequisites()
    if (!syncConfig) return

    const data = await client.getStoredHeartbeats()
    if (!data || data.length === 0) {
      console.debug('No data to sync')
      return
    }

    let allBatchesSuccessful = true
    await processInBatches(data, 100, async (batch) => {
      const success = await syncBatch(batch, syncConfig)
      if (!success) allBatchesSuccessful = false
    })
    
    await clearHeartbeats(client, allBatchesSuccessful)
    console.debug('Cloud sync completed successfully', syncConfig)
  } catch (error) {
    console.error('Cloud sync failed:', error)
  }
}
