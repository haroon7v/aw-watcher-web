import browser from 'webextension-polyfill'

export type ManagedPolicyKey = 'CLOUD_SYNC' | 'SUBDOMAIN' | 'REGION' | 'TAG'
type ManagedPolicyMap = Partial<Record<ManagedPolicyKey, unknown>>

const SAFARI_NATIVE_HOST =
  'com.yourCompany.AssetSonar-SaaS-Discovery-and-Usage-Monitor'

const getManagedFromSafariNative = async (
  keys: ManagedPolicyKey[],
): Promise<ManagedPolicyMap> => {
  try {
    const response = (await browser.runtime.sendNativeMessage(
      SAFARI_NATIVE_HOST,
      {
        type: 'getManagedConfig',
        keys,
      },
    )) as { values?: ManagedPolicyMap } | undefined
    return response?.values ?? {}
  } catch (error) {
    console.debug('Safari native config not available:', error)
    return {}
  }
}

export const getManagedPolicies = async (
  keys: ManagedPolicyKey[],
): Promise<ManagedPolicyMap> => {
  if (import.meta.env.VITE_TARGET_BROWSER === 'safari') {
    return getManagedFromSafariNative(keys)
  }

  try {
    return (await browser.storage.managed.get(keys)) as ManagedPolicyMap
  } catch (error) {
    console.debug('Managed storage not available:', error)
    return {}
  }
}

export const getManagedPolicyValue = async (
  key: ManagedPolicyKey,
): Promise<unknown | undefined> => {
  const managed = await getManagedPolicies([key])
  const value = managed[key]
  return value === null ? undefined : value
}
