// `googleapis` is an optional dependency: it is only needed for Google Workspace
// migrations and is installed separately on hosts that run them (see
// imap/providers/gsuite.ts). Declared here so the workers type-check without
// pulling the (very large) package into every deployment.
declare module 'googleapis' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const google: any;
}
