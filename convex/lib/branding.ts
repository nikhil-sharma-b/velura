// Duplicated from lib/constants.ts on purpose: the Convex bundle has its own
// module graph and must not reach into the Next application's path aliases.
// APP_DISPLAY_NAME is set per Convex deployment (e.g. "Velura Dev" on dev and
// staging); production leaves it unset.
export const APP_NAME = process.env.APP_DISPLAY_NAME ?? "Velura"
