import browser from 'webextension-polyfill'
import { getActiveWindowTab, getTab, getTabs, getUserEmail } from './helpers'
import config from '../config'
import { AWClient, IEvent } from 'aw-client'
import { getBucketId, getClient, sendHeartbeat } from './client'
import { getEnabled, getHeartbeatData, setHeartbeatData } from '../storage'
import deepEqual from 'deep-equal'

async function heartbeat(
  client: AWClient,
  tab: browser.Tabs.Tab | undefined,
  tabCount: number,
  email: string | undefined
) {
  const enabled = await getEnabled()
  if (!enabled) {
    console.warn('Ignoring heartbeat because client has not been enabled')
    return
  }

  if (!tab) {
    console.warn('Ignoring heartbeat because no active tab was found')
    return
  }

  if (!tab.url || !tab.title) {
    console.warn('Ignoring heartbeat because tab is missing URL or title')
    return
  }

  const now = new Date()
  const data: IEvent['data'] = {
    url: tab.url,
    title: tab.title,
    audible: tab.audible ?? false,
    incognito: tab.incognito,
    tabCount: tabCount,
  }
  const previousData = await getHeartbeatData()
  if (previousData && !deepEqual(previousData, data)) {
    console.debug('Sending heartbeat for previous data', previousData)
    await sendHeartbeat(
      client,
      await getBucketId(),
      new Date(now.getTime() - 1),
      previousData,
      config.heartbeat.intervalInSeconds + 20,
      email
    )
  }
  console.debug('Sending heartbeat', data)
  await sendHeartbeat(
    client,
    await getBucketId(),
    now,
    data,
    config.heartbeat.intervalInSeconds + 20,
    email
  )
  await setHeartbeatData(data)
}

export const sendInitialHeartbeat = async (client: AWClient) => {
  const activeWindowTab = await getActiveWindowTab()
  const tabs = await getTabs()
  const email = await getUserEmail()
  console.debug('Sending initial heartbeat', activeWindowTab)
  await heartbeat(client, activeWindowTab, tabs.length, email)
}

export const heartbeatAlarmListener =
  () => async (alarm: browser.Alarms.Alarm) => {
    const client = await getClient();
    if (alarm.name !== config.heartbeat.alarmName) return
    const activeWindowTab = await getActiveWindowTab()
    if (!activeWindowTab) return
    const tabs = await getTabs()
    const email = await getUserEmail()
    console.debug('Sending heartbeat for alarm', activeWindowTab)
    await heartbeat(client, activeWindowTab, tabs.length, email)
  }

export const tabActivatedListener =
  () =>
  async (activeInfo: browser.Tabs.OnActivatedActiveInfoType) => {
    const client = await getClient();
    const tab = await getTab(activeInfo.tabId)
    const tabs = await getTabs()
    const email = await getUserEmail()
    console.debug('Sending heartbeat for tab activation', tab)
    await heartbeat(client, tab, tabs.length, email)
  }
