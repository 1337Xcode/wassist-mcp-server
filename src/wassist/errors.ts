/** Stable failure codes that tools show the model. Each one suggests a different next step. */
export type WassistErrorKind =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response'
  | 'network_error'
  | 'timeout'
  | 'cancelled';

/** Facts about a failure that are safe to show. */
export interface WassistErrorDetails {
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  /** True when a write may or may not have been applied, so the caller must not blindly retry. */
  outcomeUnknown?: boolean;
}

/** A failure from the Wassist API. The message never holds the API key or a raw upstream body. */
export class WassistApiError extends Error {
  readonly kind: WassistErrorKind;
  readonly details: WassistErrorDetails;

  constructor(kind: WassistErrorKind, message: string, details: WassistErrorDetails = {}) {
    super(message);
    this.name = 'WassistApiError';
    this.kind = kind;
    this.details = details;
  }
}
