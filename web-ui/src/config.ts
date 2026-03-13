// Helper to clean and normalize base paths
const normalizePath = (path: string) => {
    if (!path) return '/';
    return (path.startsWith('/') ? '' : '/') + path + (path.endsWith('/') ? '' : '/');
};

export const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    const rawBaseUrl = import.meta.env.VITE_BASE_URL || '/';
    const baseUrl = normalizePath(rawBaseUrl);
    
    if (envUrl) return envUrl;
    
    // Default fallback for local development
    if (baseUrl === '/') {
        return `http://${window.location.hostname}:8001`;
    }
    
    // In subpath deployment, use relative-to-root path
    // This ensures we always have /nexis/api
    return `${baseUrl}api`;
};

export const getAgentApiUrl = () => {
    const envUrl = import.meta.env.VITE_AGENT_API_URL;
    const rawBaseUrl = import.meta.env.VITE_BASE_URL || '/';
    const baseUrl = normalizePath(rawBaseUrl);
    
    if (envUrl) return envUrl;

    if (baseUrl === '/') {
        return `http://${window.location.hostname}:8002`;
    }
    
    return `${baseUrl}agent`;
};


