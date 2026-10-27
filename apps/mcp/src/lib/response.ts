export type ApiResponse<T = unknown> = {
  data: T | null;
  error: string | null;
  errorMessage: string | null;
  errorCode: number | null;
  timestamp: string;
};

export function success<T>(data: T): ApiResponse<T> {
  return {
    data,
    error: null,
    errorCode: null,
    errorMessage: null,
    timestamp: new Date().toISOString(),
  };
}

export function failure(
  error: string,
  errorMessage: string,
  errorCode: number,
): ApiResponse<null> {
  return {
    data: null,
    error,
    errorCode,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
}