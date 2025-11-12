const config = {
  isDevelopment: import.meta.env.DEV,
  requireConsent: false,
  assetsonarServer: {
    protocol: import.meta.env.DEV ? 'http' : 'https',
    host: import.meta.env.DEV ? 'lvh.me:3000' : 'assetsonar.com',
  },
  heartbeat: {
    alarmName: 'heartbeat',
    intervalInSeconds: 60,
  },
  blockedDomains: {
    alarmName: 'blockedDomains',
    intervalInSeconds: 1800, // every 30 minutes
  },
  cloudSync: {
    alarmName: 'cloudSync',
    intervalInSeconds: 86400, // every 24 hours
  },
}

export default config
