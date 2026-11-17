import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tech.qigai.lumi',
  appName: '栖语',
  webDir: 'dist',
  android: { allowMixedContent: true },
  plugins: { StatusBar: { overlaysWebView: true, style: 'LIGHT' } },
}
export default config
