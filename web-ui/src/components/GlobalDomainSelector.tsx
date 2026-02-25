import { useGlobalDomain } from '../contexts/GlobalDomainContext';

export function GlobalDomainSelector() {
    const { activeDomain, setActiveDomain, domains, isLoading } = useGlobalDomain();

    if (isLoading) {
        return <div className="text-sm p-4 border-b text-muted-foreground animate-pulse">Loading domains...</div>;
    }

    if (domains.length === 0) {
        return <div className="text-sm p-4 border-b text-muted-foreground">No domains configured</div>;
    }

    return (
        <div className="p-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
            <label className="text-[10px] font-bold text-slate-500 mb-1.5 block uppercase tracking-wider">
                Active Business Line
            </label>
            <select
                className="w-full text-sm rounded-md bg-white border border-slate-200 px-2 py-1.5 focus:ring-2 focus:ring-primary/20 focus:border-primary dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 outline-none transition-all cursor-pointer shadow-sm"
                value={activeDomain?.id || ''}
                onChange={(e) => {
                    const sel = domains.find(d => d.id === e.target.value);
                    if (sel) setActiveDomain(sel);
                }}
            >
                {domains.map(d => (
                    <option key={d.id} value={d.id}>
                        {d.name}
                    </option>
                ))}
            </select>
        </div>
    );
}
