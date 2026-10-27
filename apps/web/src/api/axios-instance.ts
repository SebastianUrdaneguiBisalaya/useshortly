import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

import type { ErrorResponse } from "./model";

// Empty in development: Vite proxies /api to the backend (see vite.config.ts), so the browser
// stays on one origin and the backend needs no CORS.
const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ""}/api/v1`,
});

let accessToken: string | null = null;

/** Sets the JWT (or API key) sent as `Authorization: Bearer`; null signs requests out. */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

/** The mutator Orval calls for every generated request. It returns the body, not the axios response. */
export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => apiClient({ ...config, ...options }).then(({ data }) => data as T);

/** Failures carry the API's {"error": {code, message, details}} body in `error.response.data`. */
export type ErrorType<E = ErrorResponse> = AxiosError<E>;
export type BodyType<B> = B;
