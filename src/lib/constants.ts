/**
 * STUB: authentication is out of scope for the slice. Every order belongs to
 * this fixed demo provider; the provider_id column exists so the dashboard
 * query has an owner and real auth can slot in later.
 */
export const PROVIDER_ID = "provider_demo";

/** Orders created by this slice are always in-house (vs third-party marketplace). */
export const CHANNEL_IN_HOUSE = "in_house";
