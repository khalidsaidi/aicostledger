import { useCallback } from "react";
import { useAuth } from "./auth";

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}

export function useApi() {
  const { getIdToken } = useAuth();

  const apiFetch = useCallback(
    async <T>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Missing auth token");
      }
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`
        }
      });
      return handleResponse<T>(response);
    },
    [getIdToken]
  );

  const apiDownload = useCallback(
    async (path: string): Promise<Blob> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Missing auth token");
      }
      const response = await fetch(path, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }
      return response.blob();
    },
    [getIdToken]
  );

  return { apiFetch, apiDownload };
}
