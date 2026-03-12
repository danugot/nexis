import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Upload, Archive, RefreshCw, FileText, AlertTriangle, FolderOpen, Layers, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react';
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

import { getApiBaseUrl } from '../config';
const API_BASE_URL = getApiBaseUrl();

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

interface ProjectRecord {
    id: string;
    name: string;
    version: string;
    jiraId: string | null;
    status: string;
    createdAt: string;
    documentCount: number;
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
    const [projects, setProjects] = useState<ProjectRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    // Project Documents View State
    const [viewProjectOpen, setViewProjectOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
    const [projectDocuments, setProjectDocuments] = useState<DocumentRecord[]>([]);
    const [docsLoading, setDocsLoading] = useState(false);

    // Conflict Review State
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewFile, setReviewFile] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
    const [resolving, setResolving] = useState(false);

    // Traceability Sheet State
    const [traceOpen, setTraceOpen] = useState(false);
    const [traceDoc, setTraceDoc] = useState<DocumentRecord | null>(null);

    const { register, handleSubmit, reset } = useForm();

    const fetchProjects = async () => {
        setLoading(true);
        try {
            const url = activeDomain ? `${API_BASE_URL}/projects?domainId=${activeDomain.id}` : `${API_BASE_URL}/projects`;
            const res = await fetch(url);
            const data = await res.json();
            setProjects(data);
        } catch (error) {
            console.error('Failed to fetch projects', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchProjectDocuments = async (projectId: string) => {
        setDocsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/projects/${projectId}/documents`);
            const data = await res.json();
            setProjectDocuments(data);
        } catch (error) {
            console.error('Failed to fetch project docs', error);
        } finally {
            setDocsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, [activeDomain]);

    const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to permanently delete this project and all its documents? This action cannot be undone.')) return;
        
        try {
            const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.status === 'success') {
                setProjects(prev => prev.filter(p => p.id !== projectId));
                if (selectedProject?.id === projectId) {
                    setViewProjectOpen(false);
                    setSelectedProject(null);
                }
            } else {
                alert('Failed to delete project: ' + data.detail);
            }
        } catch (error) {
            console.error('Failed to delete project', error);
            alert('Error deleting project');
        }
    };

    const moveFileUp = (index: number) => {
        if (index === 0) return;
        const newFiles = [...selectedFiles];
        [newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]];
        setSelectedFiles(newFiles);
    };

    const moveFileDown = (index: number) => {
        if (index === selectedFiles.length - 1) return;
        const newFiles = [...selectedFiles];
        [newFiles[index + 1], newFiles[index]] = [newFiles[index], newFiles[index + 1]];
        setSelectedFiles(newFiles);
    };

    const removeSelectedFile = (index: number) => {
        const newFiles = [...selectedFiles];
        newFiles.splice(index, 1);
        setSelectedFiles(newFiles);
    };

    const handleUpload = async (data: any) => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }
        if (!data.projectName) {
            alert("Project Name is mandatory to create a Knowledge Set.");
            return;
        }

        setUploading(true);
        try {
            // 1. Create Project
            const projRes = await fetch(`${API_BASE_URL}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.projectName,
                    version: data.version,
                    jiraId: data.jiraId,
                    domainId: activeDomain?.id
                })
            });
            const projData = await projRes.json();
            if (projData.status !== 'success') throw new Error("Failed to create project");
            const projectId = projData.id;

            // 2. Upload multiple files bound to the project
            const formData = new FormData();
            formData.append('projectId', projectId);
            if (activeDomain) formData.append('domainId', activeDomain.id);
            formData.append('projectName', data.projectName);
            formData.append('version', data.version);
            if (data.jiraId) formData.append('jiraId', data.jiraId);

            selectedFiles.forEach((file: File) => {
                formData.append('files', file);
            });

            await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData,
            });

            setUploadOpen(false);
            setSelectedFiles([]);
            reset();
            fetchProjects();
        } catch (error) {
            console.error('Upload failed', error);
            alert("Upload failed. Check console for details.");
        } finally {
            setUploading(false);
        }
    };

    const handleArchiveDoc = async (id: string) => {
        if (!confirm('Are you sure you want to archive this document? It will no longer be used for AI responses.')) return;
        try {
            await fetch(`${API_BASE_URL}/documents/${id}/archive`, {
                method: 'PUT',
            });
            if (selectedProject) fetchProjectDocuments(selectedProject.id);
            fetchProjects(); // refresh doc count
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
                    if (selectedProject) fetchProjectDocuments(selectedProject.id);
                } else {
                    setConflicts(prev => prev.filter(c => c !== conflict));
                }
            }
        } catch (error) {
            console.error('Failed to resolve single conflict', error);
        } finally {
            setResolving(false);
        }
    };

    const getStatusBadge = (status: string, errorMsg?: string) => {
        switch (status) {
            case 'EFFECTIVE': return <Badge className="bg-emerald-500">Effective</Badge>;
            case 'NEEDS_REVIEW': return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle size={12} /> Needs Review</Badge>;
            case 'PROCESSING': return <Badge variant="secondary" className="bg-amber-500 text-white">Processing</Badge>;
            case 'QUEUED': return <Badge variant="outline">Queued</Badge>;
            case 'DRAFT': return <Badge variant="outline">Draft</Badge>;
            case 'ARCHIVED': return <Badge variant="secondary">Archived</Badge>;
            case 'ERROR': return <Badge variant="destructive" title={errorMsg || 'Unknown Error'} className="cursor-help flex items-center gap-1"><AlertTriangle size={12} /> Error</Badge>;
            default: return <Badge variant="secondary">{status}</Badge>;
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Project Knowledge Sets</h1>
                    <p className="text-muted-foreground mt-1">Manage project containers grouping multiple requirements and specification documents.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchProjects} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>

                    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                                <Upload size={16} /> Create Project & Upload Files
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>New Knowledge Set (Project)</DialogTitle>
                                <DialogDescription>
                                    Create a project container and upload all related specification files (PRD, API docs, schemas) at once.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSubmit(handleUpload)} className="space-y-4 pt-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2 col-span-2">
                                        <Label htmlFor="projectName">Project Name (Bundle Identifier)</Label>
                                        <Input id="projectName" placeholder="e.g. 票据融合一期" {...register('projectName', { required: true })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="version">Version</Label>
                                        <Input id="version" defaultValue="v1.0" {...register('version')} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="jiraId">JIRA ID (Optional)</Label>
                                        <Input id="jiraId" placeholder="e.g. NEXIS-101" {...register('jiraId')} />
                                    </div>
                                </div>
                                <div className="space-y-2 border-t pt-4">
                                    <Label htmlFor="files">Select Files (Markdown, Docx, PDF, etc.)</Label>
                                    <Input 
                                        id="files" 
                                        type="file" 
                                        multiple 
                                        onChange={(e) => {
                                            if (e.target.files) {
                                                // Append newly selected files to the list
                                                setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                                // Reset input so the same files can be selected again if needed
                                                e.target.value = '';
                                            }
                                        }} 
                                    />
                                    <p className="text-xs text-muted-foreground">The order of these files dictates their processing priority. Order carefully!</p>
                                    
                                    {selectedFiles.length > 0 && (
                                        <div className="mt-3 border rounded-md divide-y max-h-48 overflow-y-auto">
                                            {selectedFiles.map((file, idx) => (
                                                <div key={`${file.name}-${idx}`} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900/50 text-sm">
                                                    <div className="flex items-center gap-2 truncate pr-4">
                                                        <span className="text-muted-foreground font-mono text-xs">{idx + 1}.</span>
                                                        <FileText size={14} className="text-indigo-400 shrink-0" />
                                                        <span className="truncate">{file.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => moveFileUp(idx)}>
                                                            <ArrowUp size={14} />
                                                        </Button>
                                                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={idx === selectedFiles.length - 1} onClick={() => moveFileDown(idx)}>
                                                            <ArrowDown size={14} />
                                                        </Button>
                                                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeSelectedFile(idx)}>
                                                            <X size={14} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Target Domain</Label>
                                    <div className="text-sm font-medium bg-slate-50 border px-3 py-2 rounded-md">
                                        {activeDomain ? activeDomain.name : 'Unknown Domain'}
                                    </div>
                                </div>
                                <div className="pt-4 flex justify-end gap-2">
                                    <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={uploading}>
                                        {uploading ? 'Creating & Uploading...' : 'Submit Knowledge Set'}
                                    </Button>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="border rounded-lg bg-card overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                        <TableRow>
                            <TableHead>Project Name</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Jira ID</TableHead>
                            <TableHead>Documents</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created At</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {projects.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                                    <div className="flex flex-col items-center justify-center space-y-3">
                                        <Layers size={32} className="text-slate-300" />
                                        <p>No project knowledge sets found. Create one to get started.</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            projects.map((proj) => (
                                <TableRow key={proj.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <FolderOpen size={16} className="text-indigo-400" />
                                        {proj.name}
                                    </TableCell>
                                    <TableCell>{proj.version}</TableCell>
                                    <TableCell>{proj.jiraId || '-'}</TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-mono">
                                            {proj.documentCount} files
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{getStatusBadge(proj.status)}</TableCell>
                                    <TableCell>{new Date(proj.createdAt).toLocaleDateString()}</TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                setSelectedProject(proj);
                                                fetchProjectDocuments(proj.id);
                                                setViewProjectOpen(true);
                                            }}
                                            className="text-xs mr-2"
                                        >
                                            View Content
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(e) => handleDeleteProject(proj.id, e)}
                                            className="text-slate-500 hover:text-red-500 hover:bg-red-50"
                                            title="Delete Project"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Project Documents Dialog */}
            <Dialog open={viewProjectOpen} onOpenChange={setViewProjectOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FolderOpen size={18} className="text-indigo-500" />
                            {selectedProject?.name} <span className="text-muted-foreground font-normal text-sm">({selectedProject?.version})</span>
                        </DialogTitle>
                        <DialogDescription>
                            Documents bounded to this project knowledge set.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto mt-4 border rounded-md">
                        <Table>
                            <TableHeader className="bg-slate-50 sticky top-0 z-10">
                                <TableRow>
                                    <TableHead>Filename</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Uploaded At</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {docsLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground animate-pulse">Loading documents...</TableCell>
                                    </TableRow>
                                ) : projectDocuments.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No active documents in this project.</TableCell>
                                    </TableRow>
                                ) : (
                                    projectDocuments.map((doc) => (
                                        <TableRow key={doc.id}>
                                            <TableCell className="font-medium flex items-center gap-2 shrink-0 max-w-[300px] truncate" title={doc.filename}>
                                                <FileText size={16} className="text-slate-400 shrink-0" />
                                                <span className="truncate">{doc.filename}</span>
                                            </TableCell>
                                            <TableCell>{getStatusBadge(doc.status, doc.errorMessage)}</TableCell>
                                            <TableCell className="text-muted-foreground text-sm">{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
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
                                                    onClick={() => { setTraceDoc(doc as any); setTraceOpen(true); }}
                                                    className="text-slate-500 hover:text-indigo-600 mr-2"
                                                    title="View Processing Trace"
                                                >
                                                    <FileText size={16} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleArchiveDoc(doc.id)}
                                                    className="text-slate-500 hover:text-red-500"
                                                    title="Archive from AI"
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
                </DialogContent>
            </Dialog>

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
                document={traceDoc as any}
            />
        </div>
    );
}
