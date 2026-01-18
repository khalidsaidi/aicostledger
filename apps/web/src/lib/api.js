import { useCallback } from "react";
import { useAuth } from "./auth";
async function handleResponse(response) {
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
    }
    return (await response.json());
}
export function useApi() {
    const { getIdToken } = useAuth();
    const apiFetch = useCallback(async (path, options = {}) => {
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
        return handleResponse(response);
    }, [getIdToken]);
    const apiDownload = useCallback(async (path) => {
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
    }, [getIdToken]);
    return { apiFetch, apiDownload };
}
