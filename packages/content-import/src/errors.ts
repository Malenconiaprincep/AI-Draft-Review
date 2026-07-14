import type { ConnectorProvider } from "./types.ts";

export type ConnectorErrorCode =
  | "invalid_source"
  | "authorization_failed"
  | "token_refresh_failed"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "unsupported_resource"
  | "provider_error"
  | "invalid_provider_response";

export class ConnectorError extends Error {
  readonly provider: ConnectorProvider;
  readonly code: ConnectorErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: {
    provider: ConnectorProvider;
    code: ConnectorErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ConnectorError";
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

export function errorCodeForStatus(status: number): ConnectorErrorCode {
  if (status === 401 || status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

export async function readErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }
  return response.text().catch(() => undefined);
}
