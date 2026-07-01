export interface ApiEnvelope<TData> {
  data: TData;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  message: string;
  statusCode: number;
  error?: string;
}

export interface HealthCheckResponse {
  service: "ovi-mobile-api";
  status: "ok";
  timestamp: string;
}
