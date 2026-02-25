import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Folder, Network, Building2, ChevronRight, ChevronDown, Edit2, Check } from 'lucide-react';
import { useGlobalDomain, type Domain } from '../contexts/GlobalDomainContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface TaxonomyNode {
    id: string;
    domainId: string;
    name: string;
    level: string;
    parentId: string | null;
}

export default function AdminPage() {
    const { domains, refreshDomains, activeDomain: globalActiveDomain } = useGlobalDomain();
    const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
    const [taxonomy, setTaxonomy] = useState<TaxonomyNode[]>([]);
    const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);

    const [newDomainName, setNewDomainName] = useState('');
    const [newRootNodeName, setNewRootNodeName] = useState('');

    useEffect(() => {
        if (!selectedDomain && domains.length > 0) {
            setSelectedDomain(globalActiveDomain || domains[0]);
        }
    }, [domains, selectedDomain, globalActiveDomain]);

    useEffect(() => {
        if (selectedDomain) {
            fetchTaxonomy(selectedDomain.id);
        } else {
            setTaxonomy([]);
        }
    }, [selectedDomain]);

    const fetchTaxonomy = async (domainId: string, silent = false) => {
        if (!silent) setLoadingTaxonomy(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/domains/${domainId}/taxonomy`);
            const data = await res.json();
            setTaxonomy(data);
        } catch (e) {
            console.error("Failed to fetch taxonomy", e);
        } finally {
            if (!silent) setLoadingTaxonomy(false);
        }
    };

    const handleCreateDomain = async () => {
        if (!newDomainName.trim()) return;
        try {
            await fetch(`${API_BASE_URL}/api/domains`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newDomainName, description: '' })
            });
            setNewDomainName('');
            await refreshDomains();
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteDomain = async (id: string) => {
        if (!confirm('Are you sure you want to delete this Business Line? All associated knowledge metadata will be orphaned.')) return;
        try {
            await fetch(`${API_BASE_URL}/api/domains/${id}`, { method: 'DELETE' });
            if (selectedDomain?.id === id) setSelectedDomain(null);
            await refreshDomains();
        } catch (e) {
            console.error(e);
        }
    };

    const handleCreateNode = async (name: string, level: string, parentId: string | null = null) => {
        if (!name.trim() || !selectedDomain) return;
        try {
            await fetch(`${API_BASE_URL}/api/domains/${selectedDomain.id}/taxonomy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, level, parentId })
            });
            if (!parentId) {
                setNewRootNodeName('');
            }
            fetchTaxonomy(selectedDomain.id, true); // Silent refresh
        } catch (e) {
            console.error(e);
        }
    };

    const handleUpdateNode = async (nodeId: string, newName: string) => {
        if (!newName.trim() || !selectedDomain) return;
        try {
            await fetch(`${API_BASE_URL}/api/domains/${selectedDomain.id}/taxonomy/${nodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            fetchTaxonomy(selectedDomain.id, true); // Silent refresh
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteNode = async (nodeId: string) => {
        if (!selectedDomain) return;
        try {
            await fetch(`${API_BASE_URL}/api/domains/${selectedDomain.id}/taxonomy/${nodeId}`, { method: 'DELETE' });
            fetchTaxonomy(selectedDomain.id, true); // Silent refresh
        } catch (e) {
            console.error(e);
        }
    };

    const rootNodes = taxonomy.filter(n => !n.parentId);

    return (
        <div className="p-6 max-w-7xl mx-auto h-full flex flex-col">
            <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight">System Administration</h2>
                <p className="text-muted-foreground">Manage Business Lines (Domains) and their Knowledge Taxonomies.</p>
            </div>

            <div className="flex gap-6 flex-1 min-h-0 pb-10">
                {/* Domains Column */}
                <Card className="w-1/3 flex flex-col min-h-0 shadow-sm border-slate-200 dark:border-slate-800">
                    <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-primary" />
                            Business Lines
                        </CardTitle>
                        <CardDescription>Knowledge boundaries for RAG isolation.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 flex-1 overflow-y-auto flex flex-col gap-4 bg-slate-50/20 dark:bg-slate-950">
                        <div className="flex gap-2">
                            <Input
                                placeholder="New Domain Name..."
                                value={newDomainName}
                                onChange={(e) => setNewDomainName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreateDomain()}
                            />
                            <Button onClick={handleCreateDomain} size="icon"><Plus className="w-4 h-4" /></Button>
                        </div>

                        <div className="space-y-2">
                            {domains.map(domain => (
                                <div
                                    key={domain.id}
                                    onClick={() => setSelectedDomain(domain)}
                                    className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition-colors ${selectedDomain?.id === domain.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-slate-50 dark:hover:bg-slate-900 border-slate-200 dark:border-slate-800 bg-background'}`}
                                >
                                    <span className="font-medium text-sm">{domain.name}</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteDomain(domain.id); }}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                            {domains.length === 0 && (
                                <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-md border-slate-200 dark:border-slate-800">
                                    No Business Lines configured.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Taxonomy Column */}
                <Card className="w-2/3 flex flex-col min-h-0 shadow-sm border-slate-200 dark:border-slate-800">
                    <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/50">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Network className="w-5 h-5 text-emerald-500" />
                            Taxonomy Vault
                        </CardTitle>
                        <CardDescription>
                            {selectedDomain ? `Managing categories for: ${selectedDomain.name}` : 'Select a domain to manage taxonomy'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 flex-1 overflow-y-auto bg-slate-50/30 dark:bg-slate-950">
                        {!selectedDomain ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Select a Business Line from the left panel.
                            </div>
                        ) : loadingTaxonomy ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground animate-pulse">
                                Loading taxonomy tree...
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Add Root Node */}
                                <div className="flex gap-2 max-w-sm">
                                    <Input
                                        placeholder="Add Root Category (e.g. 票据理财)"
                                        value={newRootNodeName}
                                        onChange={(e) => setNewRootNodeName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleCreateNode(newRootNodeName, 'CATEGORY')}
                                    />
                                    <Button onClick={() => handleCreateNode(newRootNodeName, 'CATEGORY')} variant="secondary">Add Root</Button>
                                </div>

                                <div className="space-y-2">
                                    {rootNodes.map(node => (
                                        <TaxonomyTreeItem
                                            key={node.id}
                                            node={node}
                                            allNodes={taxonomy}
                                            onUpdate={handleUpdateNode}
                                            onDelete={handleDeleteNode}
                                            onCreateChild={(name, parentId) => handleCreateNode(name, 'CATEGORY', parentId)}
                                        />
                                    ))}

                                    {rootNodes.length === 0 && (
                                        <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                                            No categories defined for this domain. <br /> Add a new Root Category to start building the taxonomy tree.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

function TaxonomyTreeItem({
    node,
    allNodes,
    onUpdate,
    onDelete,
    onCreateChild
}: {
    node: TaxonomyNode;
    allNodes: TaxonomyNode[];
    onUpdate: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onCreateChild: (name: string, parentId: string) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(node.name);
    const [newChildName, setNewChildName] = useState('');
    const children = allNodes.filter(n => n.parentId === node.id);

    const handleSaveEdit = () => {
        if (editName.trim() && editName !== node.name) {
            onUpdate(node.id, editName);
        }
        setIsEditing(false);
    };

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-sm shadow-sm group">
                <div className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1" onClick={() => {
                    if (!isEditing) setIsExpanded(!isExpanded);
                }}>
                    {children.length > 0 ? (
                        isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground mr-1" /> : <ChevronRight className="w-4 h-4 text-muted-foreground mr-1" />
                    ) : (
                        <div className="w-4 h-4 mr-1" /> // Spacer
                    )}
                    <Folder className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" fillOpacity={isExpanded ? 0.8 : 0.2} />

                    {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 mr-2" onClick={e => e.stopPropagation()}>
                            <Input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                className="h-7 text-sm py-1"
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveEdit();
                                    if (e.key === 'Escape') {
                                        setEditName(node.name);
                                        setIsEditing(false);
                                    }
                                }}
                            />
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600" onClick={handleSaveEdit}>
                                <Check className="w-4 h-4" />
                            </Button>
                        </div>
                    ) : (
                        <>
                            <span className="truncate font-medium">{node.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-2 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                                {children.length} branch{children.length !== 1 ? 'es' : ''}
                            </span>
                        </>
                    )}
                </div>

                {!isEditing && (
                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={(e) => {
                            e.stopPropagation();
                            setIsEditing(true);
                            setEditName(node.name);
                        }}>
                            <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(e) => {
                            e.stopPropagation();
                            onDelete(node.id);
                        }}>
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </div>

            {isExpanded && (
                <div className="pl-6 border-l-2 border-slate-200 dark:border-slate-800 ml-3 mt-2 space-y-2">
                    {children.map(child => (
                        <TaxonomyTreeItem
                            key={child.id}
                            node={child}
                            allNodes={allNodes}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                            onCreateChild={onCreateChild}
                        />
                    ))}
                    <div className="flex gap-2 max-w-sm mt-2 items-center">
                        <Input
                            className="h-8 text-xs"
                            placeholder="Add sub-category..."
                            value={newChildName}
                            onChange={(e) => setNewChildName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newChildName.trim()) {
                                    onCreateChild(newChildName, node.id);
                                    setNewChildName('');
                                }
                            }}
                        />
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                                if (newChildName.trim()) {
                                    onCreateChild(newChildName, node.id);
                                    setNewChildName('');
                                }
                            }}
                        >
                            <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
