import pkg from '../package.json' with { type: 'json' }

export const APP_VERSION: string = pkg.version
export const APP_LABEL = `v${APP_VERSION}`
export const STL_HEADER = `BorderBuilder v${APP_VERSION}`
