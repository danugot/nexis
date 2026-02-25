import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Upload, Archive, RefreshCw, FileText, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { DocumentTraceSheet } from '@/components/DocumentTraceSheet';
import { useGlobalDomain } from '../contexts/GlobalDomainContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface DocumentRecord {
    id: string;
    filename: string;
    version: string;
    projectName: string | null;
    jiraId: string | null;
    status: string;
    errorMessage?: string;
    createdAt: string;
}
export interface ConflictRecord {
    new_rule: string;
    old_rule: string;
    old_source: string;
    new_context?: string;
    old_context?: string;
    reason: string;
    suggestion?: string;
    entity_type: string;
}

export default function KnowledgeBase() {
    const { activeDomain } = useGlobalDomain();
    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Conflict Review State
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewFile, setReviewFile] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
    const [resolving, setResolving] = useState(false);

    // Traceability Sheet State
    const [traceOpen, setTraceOpen] = useState(false);
    const [traceDoc, setTraceDoc] = useState<DocumentRecord | null>(null);

    const { register, handleSubmit, reset } = useForm();

    const fetchDocuments = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/documents`);
            const data = await res.json();
            if (activeDomain) {
                setDocuments(data.filter((d: any) => d.domainId === activeDomain.id));
            } else {
                setDocuments(data);
            }
        } catch (error) {
            console.error('Failed to fetch documents', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, [activeDomain]);

    const handleUpload = async (data: any) => {
        if (!data.file || data.file.length === 0) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', data.file[0]);
        if (activeDomain) formData.append('domainId', activeDomain.id);
        if (data.jiraId) formData.append('jiraId', data.jiraId);
        if (data.version) formData.append('version', data.version);

        try {
            await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData,
            });
            setUploadOpen(false);
            reset();
            fetchDocuments();
        } catch (error) {
            console.error('Upload failed', error);
        } finally {
            setUploading(false);
        }
    };

    const handleArchive = async (id: string) => {
        if (!confirm('Are you sure you want to archive this document? It will no longer be used for AI responses.')) return;
        try {
            await fetch(`${API_BASE_URL}/documents/${id}/archive`, {
                method: 'PUT',
            });
            fetchDocuments();
        } catch (error) {
            console.error('Archive failed', error);
        }
    };

    const openReview = async (filename: string) => {
        setReviewFile(filename);
        setReviewOpen(true);
        try {
            const res = await fetch(`${API_BASE_URL}/documents/${filename}/conflicts`);
            const data = await res.json();
            setConflicts(data);
        } catch (error) {
            console.error('Failed to fetch conflicts', error);
            setConflicts([]);
        }
    };

    const handleResolveSingleConflict = async (conflict: ConflictRecord, action: 'accept_new' | 'keep_old') => {
        if (!reviewFile) return;
        setResolving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/documents/${reviewFile}/resolve-conflict`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    new_rule: conflict.new_rule,
                    old_rule: conflict.old_rule,
                    action: action
                })
            });
            const data = await res.json();

            if (data.status === 'success') {
                if (data.remaining === 0) {
                    setReviewOpen(false);
                    setReviewFile(null);
                    fetchDocuments();
                } else {
                    // remove locally
                    setConflicts(prev => prev.filter(c => c !== conflict));
                }
            }
        } catch (error) {
            console.error('Failed to resolve single conflict', error);
        } finally {
            setResolving(false);
        }
    };

    const getStatusBadge = (doc: DocumentRecord) => {
        switch (doc.status) {
            case 'EFFECTIVE': return <Badge className="bg-emerald-500">Effective</Badge>;
            case 'NEEDS_REVIEW': return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle size={12} /> Needs Review</Badge>;
            case 'PROCESSING': return <Badge variant="secondary" className="bg-amber-500 text-white">Processing</Badge>;
            case 'QUEUED': return <Badge variant="outline">Queued</Badge>;
            case 'ARCHIVED': return <Badge variant="secondary">Archived</Badge>;
            case 'ERROR': return <Badge variant="destructive" title={doc.errorMessage || 'Unknown Error'} className="cursor-help flex items-center gap-1"><AlertTriangle size={12} /> Error</Badge>;
            default: return <Badge variant="secondary">{doc.status}</Badge>;
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
                    <p className="text-muted-foreground mt-1">Manage documents, versions, and validation statuses.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchDocuments} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>

                    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2">
                                <Upload size={16} /> Upload Document
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Upload New Knowledge</DialogTitle>
                                <DialogDescription>
                                    Upload specifications or requirements to integrate into the intelligent graph.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSubmit(handleUpload)} className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <Label htmlFor="file">File (Markdown, Docx, PDF)</Label>
                                    <Input id="file" type="file" {...register('file', { required: true })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="version">Version</Label>
                                        <Input id="version" defaultValue="v1.0" {...register('version')} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="jiraId">JIRA ID (Optional)</Label>
                                        <Input id="jiraId" placeholder="e.g. NEXIS-101" {...register('jiraId')} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Target Domain</Label>
                                    <div className="text-sm font-medium bg-slate-50 border px-3 py-2 rounded-md">
                                        {activeDomain ? activeDomain.name : 'Unknown Domain'}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">To upload to a different domain, please change it in the left sidebar.</p>
                                </div>
                                <div className="pt-4 flex justify-end gap-2">
                                    <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={uploading}>
                                        {uploading ? 'Uploading...' : 'Ingest Document'}
                                    </Button>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="border rounded-lg bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Filename</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Jira ID</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Uploaded At</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {documents.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                                    No documents found. Upload one to get started.
                                </TableCell>
                            </TableRow>
                        ) : (
                            documents.map((doc) => (
                                <TableRow key={doc.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <FileText size={16} className="text-slate-400" />
                                        {doc.filename}
                                    </TableCell>
                                    <TableCell>{doc.version}</TableCell>
                                    <TableCell>{doc.projectName || '-'}</TableCell>
                                    <TableCell>{doc.jiraId || '-'}</TableCell>
                                    <TableCell>{getStatusBadge(doc)}</TableCell>
                                    <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                                    <TableCell className="text-right">
                                        {doc.status === 'NEEDS_REVIEW' && (
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                className="mr-2"
                                                onClick={() => openReview(doc.filename)}
                                            >
                                                Review Conflicts
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => { setTraceDoc(doc); setTraceOpen(true); }}
                                            className="text-slate-500 hover:text-indigo-600 mr-2"
                                            title="View Processing Trace"
                                        >
                                            <FileText size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleArchive(doc.id)}
                                            className="text-slate-500 hover:text-red-500"
                                        >
                                            <Archive size={16} />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Conflict Review Dialog */}
            <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Review Conceptual Conflicts - {reviewFile}</DialogTitle>
                        <DialogDescription>
                            The intelligent extractor detected contradictions between the new document and existing knowledge base rules.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                        {conflicts.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No conflicts detected or failed to load.</p>
                        ) : (
                            <div className="space-y-6">
                                {conflicts.map((c, i) => (
                                    <div key={i} className="border border-red-200 dark:border-red-900 rounded-lg overflow-hidden bg-white dark:bg-slate-950 shadow-sm">
                                        <div className="bg-red-50 dark:bg-red-950/40 p-3 border-b border-red-100 dark:border-red-900 flex items-center gap-2">
                                            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                                            <h4 className="font-semibold text-red-700 dark:text-red-400 text-sm">
                                                Concept Conflict Detected
                                            </h4>
                                            <span className="ml-auto text-xs text-muted-foreground bg-white/50 dark:bg-black/50 px-2 py-0.5 rounded-full border border-red-100 dark:border-red-900 line-clamp-1 max-w-[200px]" title={c.old_source || 'Previous Rule'}>
                                                {c.old_source || 'Previous Knowledge'}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800">
                                            <div className="bg-white dark:bg-slate-950 p-4 space-y-2">
                                                <h5 className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                    New Context (Current Doc)
                                                </h5>
                                                <div className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded border font-mono">
                                                    {c.new_context || c.new_rule}
                                                </div>
                                            </div>
                                            <div className="bg-white dark:bg-slate-950 p-4 space-y-2">
                                                <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                                                    Existing Context
                                                </h5>
                                                <div className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-3 rounded border font-mono opacity-80">
                                                    {c.old_context || c.old_rule}
                                                </div>
                                            </div>
                                        </div>

                                        {(c.reason || !c.new_context) && (
                                            <div className="p-4 bg-orange-50/50 dark:bg-orange-950/20 border-t border-orange-100 dark:border-orange-900">
                                                <h5 className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400 mb-1">AI Reasoning</h5>
                                                <p className="text-sm text-orange-800 dark:text-orange-300">
                                                    {c.reason || 'Legacy conflict format: direct entity name collision detected without deeper context extraction.'}
                                                </p>
                                                {c.suggestion && (
                                                    <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
                                                        💡 Suggestion: {c.suggestion}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        <div className="bg-slate-50 dark:bg-slate-900 p-3 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                                            <Button variant="outline" size="sm" onClick={() => handleResolveSingleConflict(c, 'keep_old')} disabled={resolving}>
                                                ✕ Keep Existing
                                            </Button>
                                            <Button variant="default" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleResolveSingleConflict(c, 'accept_new')} disabled={resolving}>
                                                ✓ Accept New Rule
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {conflicts.length > 0 && (
                            <div className="bg-muted p-4 rounded-md text-sm mt-4">
                                <p><strong>Granular Resolution:</strong> Handle each conflict individually. The document will automatically become 'EFFECTIVE' once all conflicts are resolved.</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button variant="outline" onClick={() => setReviewOpen(false)}>Close</Button>
                    </div>
                </DialogContent>
            </Dialog>

            <DocumentTraceSheet
                isOpen={traceOpen}
                onClose={() => { setTraceOpen(false); setTraceDoc(null); }}
                document={traceDoc}
            />
        </div>
    );
}
