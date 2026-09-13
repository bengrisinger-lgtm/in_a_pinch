import { createClient, type CurrentUser, type PlatformClient } from '@securedbackend/sdk';

function gatewayUrl(): string {
  const url = import.meta.env.VITE_API_GATEWAY_URL;
  if (!url) throw new Error('VITE_API_GATEWAY_URL is required');
  return url.replace(/\/$/, '');
}

export function authUrl(): string {
  const url = import.meta.env.VITE_AUTH_URL;
  if (!url) throw new Error('VITE_AUTH_URL is required');
  return url.replace(/\/$/, '');
}

function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch.bind(globalThis)(input, { ...init, cache: 'no-store' });
}

export function kit(): PlatformClient {
  return createClient({ baseUrl: gatewayUrl(), fetch: gatewayFetch });
}

export function redirectToLogin(): void {
  const params = new URLSearchParams({ redirect: window.location.href });
  window.location.href = `${authUrl()}/login?${params.toString()}`;
}

export type { CurrentUser };
