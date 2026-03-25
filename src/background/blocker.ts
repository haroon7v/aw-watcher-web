import browser from 'webextension-polyfill'
import config from '../config'
import { assetsonarServerUrl, getBrowserNameForEvent } from './helpers'
import { getManagedPolicies } from '../managed-policy'


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
  const browserTarget = import.meta.env.VITE_TARGET_BROWSER

  if (browserTarget === 'safari') { return domain.trim() }

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
  const managed = await getManagedPolicies(['SUBDOMAIN', 'TAG'])
  const subdomain = managed.SUBDOMAIN as string | undefined
  const tag = managed.TAG as string | undefined
  if (!subdomain || !tag) {
    throw new Error('SUBDOMAIN or TAG not found in managed config')
  }

  const browserName = await getBrowserNameForEvent()
  const url = `${assetsonarServerUrl(subdomain)}/api/api_integration/blocked_web_domains.api?token=${encodeURIComponent(tag)}&browser=${encodeURIComponent(browserName)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch blocked domains: ${response.statusText}`)
  }
  return response.json()
}
