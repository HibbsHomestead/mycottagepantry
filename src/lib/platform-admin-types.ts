// Heterogeneous metadata is constrained by explicit SQL projections in the API.
// Customer business JSON and provider payloads never enter this response type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminMetadata = Record<string, any>
