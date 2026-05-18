/**
 * Этап 6.2 — Unified API Client (Expo / React Native).
 *
 * Same contract as `/app/web/src/lib/api.js` but adapted for native:
 *   - Auth via Bearer token from AsyncStorage (NOT cookies — see note
 *     below). Token key: `atlas_token`.
 *   - Standardized errors (`ApiError`).
 *   - Per-request `X-Request-Id` header.
 *   - Retries on safe methods (GET / HEAD) for 502/503/504/network.
 *   - Capability awareness: `getCapabilities()` cached for 60s.
 *
 * BACKWARD COMPAT: the default export `api` is the original axios
 * instance — every existing screen importing `api from '@/api'` keeps
 * working unchanged. New code should prefer the named exports
 * (`apiClient`, `ApiError`, `getCapabilities`) for the standardized
 * helpers.
 *
 * Native networking note (preserved from previous version): platform
 * preview ingress combines `Access-Control-Allow-Origin: *` with
 * `Access-Control-Allow-Credentials: true`. Browsers tolerate this for
 * same-origin web preview, but iOS/Android networking stacks reject the
 * response — so we DO NOT set `withCredentials: true` here. Auth flows
 * exclusively through the Bearer header.
 */
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BASE_URL = `${BACKEND_URL.replace(/\/$/, '')}/api`;

// ─── ERROR SHAPE ──────────────────────────────────────────────────────────

export interface ApiErrorPayload {
  status: number;
  code: string;
  message: string;
  request_id: string | null;
  details: any;
  raw?: any;
}

export class ApiError extends Error {
  status: number;
  code: string;
  request_id: string | null;
  details: any;
  raw: any;

  constructor(p: ApiErrorPayload) {
    super(p.message || p.code || 'Unknown API error');
    this.name = 'ApiError';
    this.status = p.status ?? 0;
    this.code = p.code || 'unknown';
    this.request_id = p.request_id || null;
    this.details = p.details || null;
    this.raw = p.raw;
  }
  isAuth()     { return this.status === 401 || this.status === 403; }
  isNotFound() { return this.status === 404; }
  isServer()   { return this.status >= 500; }
  isNetwork()  { return this.status === 0; }
}

function normalizeError(err: any): ApiError {
  if (err instanceof ApiError) return err;
  const ax = err as AxiosError<any>;
  if (ax && (ax as any).isAxiosError) {
    const status = ax.response?.status ?? 0;
    const data: any = ax.response?.data;
    const headers: any = ax.response?.headers || {};
    const request_id =
      headers['x-request-id'] ||
      (ax.config?.headers as any)?.['X-Request-Id'] ||
      null;

    let code = (ax as any).code || (status ? `http_${status}` : 'network_error');
    let message = ax.message || 'Request failed';
    let details: any = null;

    if (data && typeof data === 'object') {
      code = data.code || code;
      message = data.detail || data.message || data.error || message;
      details = data;
    } else if (typeof data === 'string' && data.trim()) {
      message = data;
    }
    return new ApiError({ status, code, message, request_id, details, raw: ax });
  }
  return new ApiError({
    status: 0,
    code: 'unknown',
    message: err?.message || String(err),
    request_id: null,
    details: null,
    raw: err,
  });
}

// ─── REQUEST ID ───────────────────────────────────────────────────────────

function genRequestId(): string {
  const r = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `req_${r()}_${Date.now().toString(16)}`;
}

// ─── RETRY POLICY ─────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['get', 'head']);
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [200, 500, 1500];

function shouldRetry(method: string, err: AxiosError, attempt: number): boolean {
  if (attempt >= RETRY_DELAYS_MS.length) return false;
  if (!SAFE_METHODS.has((method || '').toLowerCase())) return false;
  if (!err.response) return true;
  return RETRY_STATUSES.has(err.response.status);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── AXIOS INSTANCE (legacy + new) ────────────────────────────────────────

const api: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 20000 });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('atlas_token');
  if (token) {
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  // Etap 6.2 — every outgoing request carries a request id so the
  // backend can echo it back on errors / logs.
  if (!(config.headers as any)['X-Request-Id']) {
    (config.headers as any)['X-Request-Id'] = genRequestId();
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await AsyncStorage.removeItem('atlas_token');
      await AsyncStorage.removeItem('atlas_user');
    }
    return Promise.reject(err);
  }
);

// ─── PUBLIC HIGH-LEVEL CLIENT ─────────────────────────────────────────────

interface RequestOpts {
  data?: any;
  params?: Record<string, any>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  retry?: { enabled?: boolean };
}

export async function request<T = any>(
  method: string,
  path: string,
  opts: RequestOpts = {}
): Promise<T> {
  const m = (method || 'GET').toLowerCase();
  const url = path.startsWith('/') ? path : `/${path}`;
  const baseRid = genRequestId();
  const cfg: AxiosRequestConfig = {
    method: m,
    url,
    data: opts.data,
    params: opts.params,
    headers: { 'X-Request-Id': baseRid, ...(opts.headers || {}) },
    signal: opts.signal,
    timeout: opts.timeout,
  };

  let lastErr: any;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await api.request<T>(cfg);
      return res.data;
    } catch (err: any) {
      lastErr = err;
      const retryEnabled = opts.retry?.enabled !== false;
      if (retryEnabled && shouldRetry(m, err as AxiosError, attempt)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        (cfg.headers as any)['X-Request-Id'] = `${baseRid}.r${attempt + 1}`;
        continue;
      }
      throw normalizeError(err);
    }
  }
  throw normalizeError(lastErr);
}

export const apiClient = {
  get:    <T = any>(path: string, opts?: RequestOpts)              => request<T>('GET',    path, opts),
  post:   <T = any>(path: string, data?: any, opts?: RequestOpts)  => request<T>('POST',   path, { ...(opts || {}), data }),
  put:    <T = any>(path: string, data?: any, opts?: RequestOpts)  => request<T>('PUT',    path, { ...(opts || {}), data }),
  patch:  <T = any>(path: string, data?: any, opts?: RequestOpts)  => request<T>('PATCH',  path, { ...(opts || {}), data }),
  delete: <T = any>(path: string, opts?: RequestOpts)              => request<T>('DELETE', path, opts),
  raw: api,
  baseURL: BASE_URL,
};

// ─── CAPABILITY AWARENESS ─────────────────────────────────────────────────

interface CapabilityState {
  provider?: string;
  mode: 'live' | 'mock' | 'degraded' | 'unavailable';
  available: boolean;
  reason?: string;
}
interface CapabilitiesResponse {
  capabilities: Record<string, CapabilityState>;
  summary: {
    total: number; live: number; mock: number;
    degraded: number; unavailable: number; all_live: boolean;
  };
  _error?: ApiError;
}

let _capCache: { value: CapabilitiesResponse | null; expires_at: number; in_flight: Promise<CapabilitiesResponse> | null } = {
  value: null, expires_at: 0, in_flight: null,
};
const CAP_TTL_MS = 60_000;

export async function getCapabilities(opts: { force?: boolean } = {}): Promise<CapabilitiesResponse> {
  const now = Date.now();
  if (!opts.force && _capCache.value && _capCache.expires_at > now) {
    return _capCache.value;
  }
  if (_capCache.in_flight) return _capCache.in_flight;

  const p: Promise<CapabilitiesResponse> = (async () => {
    try {
      const data = await request<CapabilitiesResponse>('GET', '/integrations/capabilities');
      _capCache = { value: data, expires_at: Date.now() + CAP_TTL_MS, in_flight: null };
      return data;
    } catch (err: any) {
      const fallback: CapabilitiesResponse = {
        capabilities: {},
        summary: { total: 0, live: 0, mock: 0, degraded: 0, unavailable: 0, all_live: false },
        _error: err,
      };
      _capCache = { value: fallback, expires_at: Date.now() + 5_000, in_flight: null };
      return fallback;
    }
  })();
  _capCache.in_flight = p;
  return p;
}

export function clearCapabilitiesCache() {
  _capCache = { value: null, expires_at: 0, in_flight: null };
}

export async function getCapabilityMode(name: string): Promise<string | null> {
  const caps = await getCapabilities();
  return caps?.capabilities?.[name]?.mode || null;
}

// Default export preserved for backward compat — every existing screen
// `import api from '@/api'` keeps working.
export default api;
