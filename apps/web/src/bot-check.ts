const PRODUCTION_HOST = 'app.obiter.si'
const PRODUCTION_SITE_KEY = '0x4AAAAAAFz_hxr02LYE1rwo'

export function botCheckSiteKeyFor(hostname: string): string | undefined {
  return hostname === PRODUCTION_HOST ? PRODUCTION_SITE_KEY : undefined
}
