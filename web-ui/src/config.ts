export const getApiBaseUrl = () => {
    // If explicitly overridden via env to a real server URL, use it
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        return envUrl;
    }
    // Otherwise, default to the host serving the web UI on port 8001
    return `http://${window.location.hostname}:8001`;
};

export const getAgentApiUrl = () => {
    const envUrl = import.meta.env.VITE_AGENT_API_URL;
    if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        return envUrl;
    }
    return `http://${window.location.hostname}:8002`;
};
