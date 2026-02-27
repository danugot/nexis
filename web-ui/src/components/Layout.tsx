import { Link, useLocation } from 'react-router-dom';
import { MessageSquare, Share2, Settings, FileText, Database, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { GlobalDomainSelector } from './GlobalDomainSelector';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface LayoutProps {
    children: React.ReactNode;
}

const NavItem = ({ to, icon: Icon, label }: { to: string; icon: any; label: string }) => {
    const location = useLocation();
    const isActive = location.pathname === to;

    return (
        <Link
            to={to}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                isActive
                    ? "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-50"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
            )}
        >
            <Icon className="h-4 w-4" />
            {label}
        </Link>
    );
};

export default function Layout({ children }: LayoutProps) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [provider, setProvider] = useState<string>('gemini');

    useEffect(() => {
        fetch(`${API_BASE_URL}/settings`)
            .then(res => res.json())
            .then(data => {
                if (data.llm_provider) setProvider(data.llm_provider);
            })
            .catch(console.error);
    }, [settingsOpen]);

    const handleSaveSettings = async (selected: string) => {
        setProvider(selected);
        try {
            await fetch(`${API_BASE_URL}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ llm_provider: selected })
            });
            setTimeout(() => setSettingsOpen(false), 300);
        } catch (e) {
            console.error('Failed to save settings', e);
        }
    };

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            {/* Sidebar */}
            <div className="w-64 border-r bg-card flex flex-col">
                <div className="p-6">
                    <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                        <Database className="h-6 w-6 text-primary" />
                        Nexis
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">Knowledge Lifecycle System</p>
                </div>

                <GlobalDomainSelector />

                <nav className="flex-1 px-4 py-4 space-y-1">
                    <NavItem to="/" icon={MessageSquare} label="Smart Chat" />
                    <NavItem to="/graph" icon={Share2} label="Graph Explorer" />
                    <NavItem to="/kb" icon={Database} label="Knowledge Base" />
                    <NavItem to="/admin" icon={FileText} label="Admin" />
                </nav>

                <div className="p-4 border-t">
                    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                        <DialogTrigger asChild>
                            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                                <Settings className="h-3 w-3" />
                                <span>v1.0.0 (Global Settings)</span>
                            </button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Global AI Settings</DialogTitle>
                                <DialogDescription>
                                    Select the underlying Large Language Model engine. This affects conflict detection, graph extraction, and smart chat.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-3 py-4">
                                <button
                                    onClick={() => handleSaveSettings('gemini')}
                                    className={cn("flex items-center justify-between p-4 border rounded-lg transition-colors text-left", provider === 'gemini' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:bg-slate-50 dark:hover:bg-slate-900')}
                                >
                                    <div>
                                        <h4 className="font-semibold text-sm">Google Gemini</h4>
                                        <p className="text-xs text-muted-foreground mt-1">gemini-3-flash-preview. Fast, multi-modal. Default.</p>
                                    </div>
                                    {provider === 'gemini' && <Check className="h-4 w-4 text-primary" />}
                                </button>

                                <button
                                    onClick={() => handleSaveSettings('qwen-plus')}
                                    className={cn("flex items-center justify-between p-4 border rounded-lg transition-colors text-left", provider === 'qwen-plus' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:bg-slate-50 dark:hover:bg-slate-900')}
                                >
                                    <div>
                                        <h4 className="font-semibold text-sm">Qwen 3.5 Plus</h4>
                                        <p className="text-xs text-muted-foreground mt-1">qwen3.5-plus. Highly capable reasoning model.</p>
                                    </div>
                                    {provider === 'qwen-plus' && <Check className="h-4 w-4 text-primary" />}
                                </button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-950">
                {children}
            </main>
        </div>
    );
}
