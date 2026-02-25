import React, { createContext, useContext, useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

export interface Domain {
    id: string;
    name: string;
    description: string | null;
}

interface GlobalDomainContextType {
    activeDomain: Domain | null;
    setActiveDomain: (domain: Domain | null) => void;
    domains: Domain[];
    refreshDomains: () => Promise<void>;
    isLoading: boolean;
}

const GlobalDomainContext = createContext<GlobalDomainContextType | undefined>(undefined);

export const GlobalDomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeDomain, setActiveDomain] = useState<Domain | null>(null);
    const [domains, setDomains] = useState<Domain[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refreshDomains = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/domains`);
            const data = await res.json();
            setDomains(data);

            // Set default active domain if none selected or current is invalid
            if (data.length > 0) {
                setActiveDomain(current => {
                    if (!current || !data.find((d: Domain) => d.id === current.id)) {
                        return data[0];
                    }
                    return current;
                });
            } else {
                setActiveDomain(null);
            }
        } catch (error) {
            console.error('Failed to fetch domains', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshDomains();
    }, []);

    return (
        <GlobalDomainContext.Provider value={{ activeDomain, setActiveDomain, domains, refreshDomains, isLoading }}>
            {children}
        </GlobalDomainContext.Provider>
    );
};

export const useGlobalDomain = () => {
    const context = useContext(GlobalDomainContext);
    if (context === undefined) {
        throw new Error('useGlobalDomain must be used within a GlobalDomainProvider');
    }
    return context;
};
