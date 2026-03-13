export const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    const baseUrl = import.meta.env.VITE_BASE_URL || '/';
    
    if (envUrl) return envUrl;
    
    // Default fallback for local development if no env var is provided
    if (baseUrl === '/') {
        return `http://${window.location.hostname}:8001`;
    }
    
    // In subpath deployment, default to relative path
    return `${baseUrl}api`;
};

export const getAgentApiUrl = () => {
    const envUrl = import.meta.env.VITE_AGENT_API_URL;
    const baseUrl = import.meta.env.VITE_BASE_URL || '/';
    
    if (envUrl) return envUrl;

    if (baseUrl === '/') {
        return `http://${window.location.hostname}:8002`;
    }
    
    return `${baseUrl}agent`;
};

