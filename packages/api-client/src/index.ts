import type { ApiErrorResponse } from "@ovi/contracts";

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface ApiClientConfig {
  baseUrl: string;
  fetcher?: typeof fetch;
  headers?: HeadersInit;
}

export interface RequestOptions<TBody = unknown> {
  body?: TBody;
  headers?: HeadersInit;
  method?: HttpMethod;
  signal?: AbortSignal;
}

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly payload?: ApiErrorResponse | unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly headers?: HeadersInit;

  constructor(config: ApiClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.fetcher = config.fetcher ?? fetch;
    this.headers = config.headers;
  }

  async request<TResponse, TBody = unknown>(
    path: string,
    options: RequestOptions<TBody> = {},
  ): Promise<TResponse> {
    const response = await this.fetcher(createUrl(this.baseUrl, path), {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
        ...options.headers,
      },
      method: options.method ?? "GET",
      signal: options.signal,
    });

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      throw new ApiClientError(
        response.status,
        response.statusText || "API request failed",
        payload,
      );
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function createUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), baseUrl).toString();
}

async function readErrorPayload(
  response: Response,
): Promise<ApiErrorResponse | unknown> {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}
