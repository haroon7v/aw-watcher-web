import browser from 'webextension-polyfill'
import config from '../config'
import { assetsonarServerUrl, getBrowserNameForEvent } from './helpers'


export const blockedDomainsAlarmListener = () => async (alarm: browser.Alarms.Alarm) => {
  if (alarm.name !== config.blockedDomains.alarmName) return

  try {
    const response = await fetchBlockedDomains()
    if (!Array.isArray(response?.domains)) {
      console.debug('Invalid response: domains array not found')
      return
    }
    await updateDynamicRules(response.domains)
  } catch (error) {
    console.debug('Failed to fetch blocked domains:', error)
  }
}

export const updateDynamicRules = async (domains: Array<{ id: string, domain: string, match_type: string }>) => {
  const existingRules = await browser.declarativeNetRequest.getDynamicRules()
  const domainIds = new Set(domains.map(domain => domain.id))
  const removeRuleIds = existingRules
    .map(rule => rule.id)
    .filter(id => !domainIds.has(id.toString()))

    const rules = domains.map(domain => ({
    id: Number(domain.id),
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: buildUrlFilter(domain.domain, domain.match_type),
      resourceTypes: ["main_frame"]
    }
  } as browser.DeclarativeNetRequest.Rule))
  if (rules.length > 0) {
    await browser.declarativeNetRequest.updateDynamicRules({ addRules: rules, removeRuleIds })
  }
}

function buildUrlFilter(domain: string, matchType: string): string {
  switch (matchType) {
    case 'starts_with':
      return `^(https?://)?(www\\.)?${domain}(\\.[^/?#]+)*([/?#]|$)`
    case 'ends_with':
      return `^(https?://)?(www\\.)?[^/?#]*${domain}([/?#]|$)`
    default:
      return `^(https?://)?(www\\.)?${domain}([/?#]|$)`
  }
}

const fetchBlockedDomains = async () => {
  let managed: { SUBDOMAIN?: string; TAG?: string }
  try {
    managed = await browser.storage.managed.get(['SUBDOMAIN', 'TAG'])
  } catch (error) {
    console.debug('Managed storage not available:', error)
    throw new Error('Managed storage not available')
  }
  
  const subdomain = managed.SUBDOMAIN
  const itamAccessToken = managed.TAG
  if (!subdomain || !itamAccessToken) {
    throw new Error('SUBDOMAIN or TAG not found in managed storage')
  }

  const browserName = await getBrowserNameForEvent()
  const url = `${assetsonarServerUrl(subdomain)}/api/api_integration/blocked_web_domains.api?token=${encodeURIComponent(itamAccessToken)}&browser=${encodeURIComponent(browserName)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch blocked domains: ${response.statusText}`)
  }
  return response.json()
}
