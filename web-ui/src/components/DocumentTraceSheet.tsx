import { useEffect, useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Share2, Layers, AlertCircle } from "lucide-react";
import axios from "axios";
import { getApiBaseUrl } from "../config";

interface TraceData {
    markdown_content: string | null;
    vector_chunk_count: number;
    vector_chunks?: { id: string; text: string }[];
    graph_entities: { name: string; type: string; extracted_by?: string }[];
}

interface DocumentTraceSheetProps {
    isOpen: boolean;
    onClose: () => void;
    document: any | null; // The document row from the table
}

export function DocumentTraceSheet({ isOpen, onClose, document }: DocumentTraceSheetProps) {
    const [traceData, setTraceData] = useState<TraceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && document?.filename) {
            loadTraceData(document.filename);
        } else {
            setTraceData(null);
            setError(null);
        }
    }, [isOpen, document]);

    const loadTraceData = async (filename: string) => {
        setLoading(true);
        setError(null);
        try {
            const encodedFilename = encodeURIComponent(filename);
            const response = await axios.get(`${getApiBaseUrl()}/documents/${encodedFilename}/trace`);
            setTraceData(response.data);
        } catch (err: any) {
            console.error("Failed to load trace data:", err);
            setError(err.response?.data?.detail || err.message || "Failed to load trace data.");
        } finally {
            setLoading(false);
        }
    };

    if (!document) return null;

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-[400px] sm:w-[540px] md:w-[700px] lg:w-[800px] sm:max-w-none flex flex-col p-0">
                <div className="p-6 pb-2 border-b">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2 text-xl">
                            <FileText className="h-5 w-5 text-emerald-600" />
                            Document Traceability
                        </SheetTitle>
                        <SheetDescription>
                            Detailed view of exactly how Nexis AI processed <b className="text-slate-900 dark:text-slate-100">{document.filename}</b> into the Knowledge Base.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="flex gap-2 mt-4 text-sm font-medium">
                        <Badge variant="outline" className="text-slate-500">Version: {document.version}</Badge>
                        <Badge variant="outline" className="text-slate-500">Status: {document.status}</Badge>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                            <span className="animate-spin text-2xl">⏳</span>
                            <p>Fetching AI processing records...</p>
                        </div>
                    ) : error ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-rose-500 gap-2 p-6 text-center">
                            <AlertCircle className="h-8 w-8" />
                            <p>{error}</p>
                        </div>
                    ) : traceData ? (
                        <Tabs defaultValue="overview" className="flex-1 flex flex-col w-full h-full">
                            <div className="px-6 border-b">
                                <TabsList className="w-full justify-start bg-transparent h-12 p-0 space-x-6">
                                    <TabsTrigger
                                        value="overview"
                                        className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-full"
                                    >
                                        Processing Overview
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="markdown"
                                        className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-full"
                                    >
                                        Parsed Text (Markdown)
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="vectors"
                                        className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-full"
                                    >
                                        Vector Retrieval ({traceData.vector_chunk_count})
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="graph"
                                        className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-full"
                                    >
                                        Graph Output ({traceData.graph_entities.length})
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            {/* OVERVIEW TAB */}
                            <TabsContent value="overview" className="flex-[1_1_0%] overflow-hidden m-0 p-0 border-none data-[state=active]:flex flex-col">
                                <ScrollArea className="h-full w-full">
                                    <div className="p-6 space-y-6">
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Metadata</h3>
                                            <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border">
                                                <div><span className="text-muted-foreground">Internal ID:</span><br /><span className="font-mono text-xs">{document.id}</span></div>
                                                <div><span className="text-muted-foreground">Original File:</span><br />{document.filename}</div>
                                                <div><span className="text-muted-foreground">Project:</span><br />{document.projectName || '—'}</div>
                                                <div><span className="text-muted-foreground">Jira Ticket:</span><br />{document.jiraId || '—'}</div>
                                                <div><span className="text-muted-foreground">Created:</span><br />{new Date(document.createdAt).toLocaleString()}</div>
                                                <div><span className="text-muted-foreground">Updated:</span><br />{new Date(document.updatedAt).toLocaleString()}</div>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between items-center mb-4">
                                                <h3 className="text-lg font-semibold">Processing Timeline</h3>
                                                {document.status !== 'QUEUED' && document.createdAt && document.updatedAt && (() => {
                                                    const start = new Date(document.createdAt).getTime();
                                                    const end = new Date(document.updatedAt).getTime();
                                                    const diffMs = Math.max(0, end - start);
                                                    const diffMins = Math.floor(diffMs / 60000);
                                                    const diffSecs = Math.floor((diffMs % 60000) / 1000);
                                                    let timeStr = "";
                                                    if (diffMins > 0) timeStr += `${diffMins}m `;
                                                    timeStr += `${diffSecs}s`;
                                                    if (diffMs < 1000) timeStr = "< 1s";

                                                    return (
                                                        <Badge variant="outline" className="text-slate-500 bg-slate-50">
                                                            Duration: {timeStr}
                                                        </Badge>
                                                    );
                                                })()}
                                            </div>
                                            <div className="relative border-l ml-3 pl-6 space-y-6 text-sm text-slate-600 dark:text-slate-400">
                                                <div className="relative">
                                                    <div className="absolute -left-[31px] bg-emerald-100 text-emerald-600 rounded-full p-1 border border-emerald-200">
                                                        <FileText className="w-3 h-3" />
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <p className="font-medium text-slate-900 dark:text-slate-100">Step 1: Document Uploaded</p>
                                                        <span className="text-xs text-muted-foreground">{new Date(document.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                    <p>File acquired and saved to `raw_docs/`.</p>
                                                </div>
                                                <div className="relative">
                                                    <div className="absolute -left-[31px] bg-emerald-100 text-emerald-600 rounded-full p-1 border border-emerald-200">
                                                        <Layers className="w-3 h-3" />
                                                    </div>
                                                    <p className="font-medium text-slate-900 dark:text-slate-100">Step 2: Markdown Parsing</p>
                                                    <p>MarkItDown converted Office/PDF formats to structured text. <br />Length: {traceData.markdown_content?.length || 0} characters.</p>
                                                </div>
                                                <div className="relative">
                                                    <div className="absolute -left-[31px] bg-emerald-100 text-emerald-600 rounded-full p-1 border border-emerald-200">
                                                        <Search className="w-3 h-3" />
                                                    </div>
                                                    <p className="font-medium text-slate-900 dark:text-slate-100">Step 3: Vector Embeddings</p>
                                                    <p>Split into semantic chunks and embedded into ChromaDB.<br />Total chunks generated: {traceData.vector_chunk_count}</p>
                                                </div>
                                                <div className="relative">
                                                    <div className="absolute -left-[31px] bg-emerald-100 text-emerald-600 rounded-full p-1 border border-emerald-200">
                                                        <Share2 className="w-3 h-3" />
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <p className="font-medium text-slate-900 dark:text-slate-100">Step 4: LLM Graph Extraction</p>
                                                        {['EFFECTIVE', 'ERROR', 'NEEDS_REVIEW'].includes(document.status) && (
                                                            <span className="text-xs text-muted-foreground">{new Date(document.updatedAt || document.createdAt).toLocaleTimeString()}</span>
                                                        )}
                                                    </div>
                                                    <p>Gemini analysed the semantic meaning and extracted graph entities. <br />Total entities extracted: {traceData.graph_entities.length}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            {/* MARKDOWN TAB */}
                            <TabsContent value="markdown" className="flex-[1_1_0%] overflow-hidden m-0 p-0 border-none data-[state=active]:flex flex-col relative w-full h-full">
                                <ScrollArea className="h-full w-full bg-slate-50 dark:bg-slate-950">
                                    <div className="p-6">
                                        {traceData.markdown_content ? (
                                            <pre className="text-xs sm:text-sm font-mono whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                                                {traceData.markdown_content}
                                            </pre>
                                        ) : (
                                            <p className="text-muted-foreground text-center mt-10">No parsed text available.</p>
                                        )}
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            {/* VECTORS TAB */}
                            <TabsContent value="vectors" className="flex-[1_1_0%] overflow-hidden m-0 p-0 border-none data-[state=active]:flex flex-col relative w-full h-full">
                                <ScrollArea className="h-full w-full bg-slate-50 dark:bg-slate-950 p-6">
                                    <div className="flex items-center gap-3 mb-6 p-4 bg-white dark:bg-slate-900 rounded-lg border shadow-sm">
                                        <Search className="h-6 w-6 text-indigo-500" />
                                        <div>
                                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">Semantic Search Index</h4>
                                            <p className="text-sm text-muted-foreground">This document has been divided into <b>{traceData.vector_chunk_count}</b> searchable fragments in ChromaDB.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-4 pb-6">
                                        {traceData.vector_chunks?.map((chunk, idx) => (
                                            <div key={idx} className="p-4 bg-white dark:bg-slate-900 border rounded-lg shadow-sm">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge variant="outline" className="text-indigo-600 bg-indigo-50 border-indigo-200">Chunk {idx + 1}</Badge>
                                                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={chunk.id}>{chunk.id}</span>
                                                </div>
                                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{chunk.text}</p>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            {/* GRAPH TAB */}
                            <TabsContent value="graph" className="flex-[1_1_0%] overflow-hidden m-0 p-0 border-none data-[state=active]:flex flex-col relative w-full h-full">
                                <ScrollArea className="h-full w-full p-6">
                                    <div className="flex items-center gap-3 mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border">
                                        <Share2 className="h-6 w-6 text-purple-500" />
                                        <div>
                                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">Extracted Graph Entities</h4>
                                            <p className="text-sm text-muted-foreground">The AI found <b>{traceData.graph_entities.length}</b> distinct entities (Concepts, Systems, Rules) in this document.</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {traceData.graph_entities.map((entity, i) => {
                                            let colorClass = "bg-slate-100 text-slate-700 border-slate-200";
                                            if (entity.type.includes("Module")) colorClass = "bg-rose-50 text-rose-700 border-rose-200";
                                            else if (entity.type.includes("Component")) colorClass = "bg-blue-50 text-blue-700 border-blue-200";
                                            else if (entity.type.includes("Concept")) colorClass = "bg-pink-50 text-pink-700 border-pink-200";
                                            else if (entity.type.includes("Identifier")) colorClass = "bg-cyan-50 text-cyan-700 border-cyan-200";

                                            return (
                                                <div key={i} className={`p-3 rounded-md border text-sm flex flex-col gap-2 ${colorClass}`}>
                                                    <div className="flex items-start justify-between">
                                                        <span className="font-semibold font-mono truncate" title={entity.name}>{entity.name}</span>
                                                        {entity.extracted_by && (
                                                            <Badge variant="outline" className={`text-[10px] leading-tight px-1.5 py-0 uppercase ${entity.extracted_by.includes('qwen') ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>
                                                                {entity.extracted_by.includes('qwen') ? 'Qwen' : 'Gemini'}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <span className="text-xs opacity-70 uppercase tracking-wider">{entity.type}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    {traceData.graph_entities.length === 0 && (
                                        <p className="text-center text-muted-foreground mt-10">No graph entities were extracted for this document.</p>
                                    )}
                                </ScrollArea>
                            </TabsContent>

                        </Tabs>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
