import { useState, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Search, Trash2, Plus, MessageSquare, Paperclip, Loader2, Send, Activity } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useGlobalDomain } from '../contexts/GlobalDomainContext'
import { getAgentApiUrl, getApiBaseUrl } from '../config';
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ArchitectReport from './ArchitectReport'

export default function Chat() {
    const { activeDomain } = useGlobalDomain();
    const [messages, setMessages] = useState<any[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sessions, setSessions] = useState<any[]>([])
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [projectSuggestions, setProjectSuggestions] = useState<any[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [suggestionsLoading, setSuggestionsLoading] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const [uploading, setUploading] = useState(false)

    // Ensure we are talking to the Agent API
    const agentUrl = getAgentApiUrl();

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        const formData = new FormData()
        formData.append('file', file)
        if (activeDomain) formData.append('domainId', activeDomain.id)

        // Try to extract project name from current input if user tagged it with @
        const projectMatch = input.match(/@(\S+)/);
        if (projectMatch) formData.append('projectName', projectMatch[1]);

        formData.append('status', 'SANDBOX'); // Always upload chat PRDs as SANDBOX to prevent QA/Vault pollution

        try {
            // Upload to RAG API directly for extraction
            const ragUrl = getApiBaseUrl();
            const res = await fetch(`${ragUrl}/upload`, {
                method: 'POST',
                body: formData
            })
            const data = await res.json()

            if (data.status === 'success') {
                // Auto-fill chat with a command to audit this file
                setInput(`帮我审计一下这份需求文档: ${file.name}\n\n[FileId: ${data.file_id}]`)
            }
        } catch (err) {
            console.error("Upload failed", err)
        } finally {
            setUploading(false)
        }
    }

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    // Load Sessions when Domain changes
    useEffect(() => {
        fetchSessions()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDomain])

    const fetchSessions = async () => {
        try {
            const url = new URL(`${agentUrl}/sessions`, window.location.origin)
            if (activeDomain) url.searchParams.append('domainId', activeDomain.id)

            const res = await fetch(url.toString())
            const data = await res.json()
            setSessions(data)
            if (data.length > 0 && !currentSessionId) {
                loadSession(data[0].id)
            } else if (data.length === 0) {
                createNewSession()
            }
        } catch (e) {
            console.error("Failed to load sessions", e)
        }
    }

    const createNewSession = async () => {
        try {
            const res = await fetch(`${agentUrl}/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domainId: activeDomain?.id })
            })
            const data = await res.json()
            setSessions([data, ...sessions])
            setCurrentSessionId(data.id)
            setMessages([])
        } catch (e) {
            console.error("Failed to create session", e)
        }
    }

    const loadSession = async (id: string) => {
        try {
            setCurrentSessionId(id)
            const res = await fetch(`${agentUrl}/sessions/${id}/messages`)
            const data = await res.json()
            setMessages(data)
        } catch (e) {
            console.error("Failed to load messages", e)
        }
    }

    const deleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            await fetch(`${agentUrl}/sessions/${id}`, { method: 'DELETE' })
            const remaining = sessions.filter(s => s.id !== id);
            setSessions(remaining);
            if (currentSessionId === id) {
                if (remaining.length > 0) {
                    loadSession(remaining[0].id)
                } else {
                    createNewSession()
                }
            }
        } catch (e) {
            console.error("Failed to delete session", e)
        }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setInput(val);

        const match = val.match(/@(\S*)$/);
        if (match) {
            setShowSuggestions(true);
            fetchProjectSuggestions(match[1]);
        } else {
            setShowSuggestions(false);
        }
    }

    const fetchProjectSuggestions = async (query: string) => {
        setSuggestionsLoading(true);
        try {
            const url = new URL(`${agentUrl}/projects`, window.location.origin);
            if (query) url.searchParams.append('query', query);
            const res = await fetch(url.toString());
            const data = await res.json();
            setProjectSuggestions(data);
        } catch (e) {
            console.error("Failed to fetch project suggestions", e);
        } finally {
            setSuggestionsLoading(false);
        }
    }

    const selectProject = (projectName: string) => {
        const newVal = input.replace(/@(\S*)$/, `@${projectName} `);
        setInput(newVal);
        setShowSuggestions(false);
    }

    const sendMessage = async () => {
        if (!input.trim() || !currentSessionId) return

        let currentInput = input
        let extractedProjectName = undefined

        // Parse @mention
        const mentionMatch = currentInput.match(/@(\S+)/);
        if (mentionMatch) {
            extractedProjectName = mentionMatch[1];
            currentInput = currentInput.replace(mentionMatch[0], '').trim();
        }

        if (!currentInput && !extractedProjectName) return;

        // Visual message relies on the cleaned input, but displays the extracted project name separately as a badge
        const userMsg = { role: 'user', content: currentInput, projectName: extractedProjectName }
        // Extend assistant message to potentially store an array of tool traces and their results
        const aiMsg = { role: 'assistant', content: '', tools: [] as any[], toolResults: {} as Record<string, any> }

        setMessages(prev => [...prev, userMsg, aiMsg])
        setInput('')
        setLoading(true)

        try {
            // Point to the new Node.js ReAct Agent API on 8002
            const response = await fetch(`${agentUrl}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: currentInput,
                    sessionId: currentSessionId,
                    domainId: activeDomain?.id,
                    projectName: extractedProjectName
                })
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let done = false;
            let currentAiText = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.substring(6).trim();
                            if (dataStr === '[DONE]') {
                                done = true;
                                break;
                            }
                            if (!dataStr) continue;

                            try {
                                const data = JSON.parse(dataStr);

                                // Perform accumulation OUTSIDE of the React setter to avoid StrictMode double-fire mutations
                                if (data.type === 'text') {
                                    currentAiText += data.text;
                                } else if (data.type === 'error') {
                                    currentAiText += `\n\nError: ${data.error}`;
                                } else if (data.type === 'done') {
                                    fetchSessions();
                                }

                                setMessages(prev => {
                                    const newMessages = [...prev] as any[];
                                    const lastIndex = newMessages.length - 1;

                                    // Deep copy the last message to avoid mutating the previous state directly
                                    const lastMsg = { ...newMessages[lastIndex] };
                                    lastMsg.tools = lastMsg.tools ? [...lastMsg.tools] : [];
                                    lastMsg.toolResults = lastMsg.toolResults ? { ...lastMsg.toolResults } : {};

                                    if (data.type === 'audit_progress') {
                                        lastMsg.tools.push({ name: 'System', args: { message: data.message, step: data.step } });
                                    } else if (data.type === 'tool') {
                                        lastMsg.tools.push({ name: data.name, args: data.args });
                                    } else if (data.type === 'tool_result') {
                                        lastMsg.toolResults[data.name] = data.result;
                                    } else if (data.type === 'text' || data.type === 'error') {
                                        lastMsg.content = currentAiText;
                                    }

                                    newMessages[lastIndex] = lastMsg;
                                    return newMessages;
                                });
                            } catch (e) {
                                console.error("Failed to parse chunk", e, dataStr);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error(error)
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1].content = 'Layer 8 Error: Could not reach brain.';
                return newMessages;
            })
        } finally {
            setLoading(false)
        }
    }

    // Find the last architectural report in the message history to display on the right
    const getLastArchitectReport = () => {
        for (let i = messages.length - 1; i >= 0; i--) {
            // Check live session state
            if (messages[i].toolResults?.['analyze_requirement']) {
                return messages[i].toolResults['analyze_requirement'];
            }
            // Check persisted state from database where role is 'tool' and content is JSON
            if (messages[i].role === 'tool' && typeof messages[i].content === 'string') {
                try {
                    const parsed = JSON.parse(messages[i].content);
                    if (parsed && parsed.type === 'architect_report' && parsed.data) {
                        return parsed.data;
                    }
                } catch (e) {
                    // Ignore non-JSON content
                }
            }
        }
        return null;
    };
    const lastArchitectReport = getLastArchitectReport();

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            {/* Sidebar for Sessions */}
            <div className="w-64 border-r bg-muted/10 flex flex-col hidden md:flex">
                <div className="p-4 border-b">
                    <Button onClick={createNewSession} className="w-full flex items-center gap-2">
                        <Plus size={16} /> New Chat
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {sessions.map(s => (
                        <div
                            key={s.id}
                            onClick={() => loadSession(s.id)}
                            className={`p-3 rounded-lg cursor-pointer flex justify-between items-center group transition-colors ${currentSessionId === s.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <MessageSquare size={16} className="flex-shrink-0 opacity-70" />
                                <span className="truncate text-sm">{s.title || "New Chat"}</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => deleteSession(e, s.id)}
                            >
                                <Trash2 size={14} className="text-muted-foreground hover:text-destructive" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Area - Occupies the middle */}
            <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                <Card className="flex-1 m-4 mb-0 overflow-hidden border-none shadow-none rounded-none bg-transparent flex flex-col">
                    <CardContent className="flex-1 overflow-y-auto p-4 space-y-6 lg:px-12 custom-scrollbar">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                                <MessageSquare size={48} className="mb-4" />
                                <p>Start a conversation with Nexis</p>
                            </div>
                        )}
                        {messages.map((m: any, i) => {
                            // Do not render raw backend database records of tools in the chat stream
                            if (m.role === 'tool') return null;

                            return (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`rounded-2xl p-4 max-w-[85%] shadow-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground ml-12' : 'bg-card border border-border/50 mr-12'}`}>
                                        {/* User Project Context Badge */}
                                        {m.role === 'user' && m.projectName && (
                                            <div className="flex items-center gap-1 mb-2 pb-2 text-xs font-medium border-b border-primary-foreground/20 opacity-90">
                                                <Search size={12} className="opacity-80" />
                                                <span>检索范围: {m.projectName}</span>
                                            </div>
                                        )}
                                        {/* Tool Calls Rendering */}
                                        {m.role === 'assistant' && m.tools && m.tools.length > 0 && (
                                            <div className="mb-3 space-y-1 border-l-2 border-primary/20 pl-3">
                                                {m.tools.map((t: any, idx: number) => {
                                                    if (t.name === 'analyze_requirement') {
                                                        return (
                                                            <div key={idx} className="mt-2 mb-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md shadow-sm">
                                                                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                                                                    <span className="text-lg">📝</span> 架构评估通过，报告已生成至右侧看板...
                                                                </div>
                                                            </div>
                                                        )
                                                    }
                                                    // Handle SSE audit progress events mapped to 'System' tool
                                                    if (t.name === 'System' && t.args && t.args.message) {
                                                        return (
                                                            <div key={idx} className="mt-1 mb-1 p-2 bg-blue-500/5 border border-blue-500/10 rounded-md shadow-sm">
                                                                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium text-xs">
                                                                    <Loader2 size={14} className="animate-spin" />
                                                                    {t.args.message}
                                                                </div>
                                                            </div>
                                                        )
                                                    }
                                                    return (
                                                        <div key={idx} className="text-[11px] text-muted-foreground bg-background/50 p-1 rounded font-mono">
                                                            <span className="text-purple-500/80">Call:</span> {t.name}(<span className="text-green-600/70">{typeof t.args === 'object' ? JSON.stringify(t.args) : String(t.args)}</span>)
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {m.content ? (
                                            <div className={`prose prose-sm dark:prose-invert max-w-none ${m.role === 'user' ? 'prose-p:text-primary-foreground prose-headings:text-primary-foreground text-primary-foreground' : 'text-foreground'}`}>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {m.content}
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            m.role === 'assistant' && <div className="text-sm text-muted-foreground animate-pulse italic">Formulating response...</div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {loading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                            <div className="text-sm text-muted-foreground animate-pulse mt-2 ml-2">Connecting to Nexis...</div>
                        )}
                        <div ref={messagesEndRef} />
                    </CardContent>
                </Card>

                <div className="p-4 bg-background lg:px-12 pb-8 border-t relative">
                    {showSuggestions && (
                        <div className="absolute bottom-full left-4 lg:left-12 mb-2 w-64 bg-popover text-popover-foreground border bg-white dark:bg-zinc-950 rounded-md shadow-lg overflow-hidden z-50">
                            {suggestionsLoading ? (
                                <div className="p-3 text-sm text-muted-foreground animate-pulse">Loading...</div>
                            ) : projectSuggestions.length > 0 ? (
                                <ul className="max-h-48 overflow-y-auto py-1">
                                    {projectSuggestions.map(p => (
                                        <li key={p.id}
                                            className="px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                                            onClick={() => selectProject(p.name)}
                                        >
                                            {p.name}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="p-3 text-sm text-muted-foreground">No projects found.</div>
                            )}
                        </div>
                    )}

                    <input
                        type="file"
                        onChange={(e) => {
                            console.log("File picker event fired");
                            handleFileUpload(e);
                        }}
                        className="hidden"
                        accept=".pdf,.docx,.txt"
                        id="prd-upload-input"
                    />

                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            sendMessage()
                        }}
                        className="flex gap-2 relative max-w-4xl mx-auto items-center"
                    >
                        <label
                            htmlFor="prd-upload-input"
                            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 w-10 flex-shrink-0 cursor-pointer shadow-sm ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                            title="Upload PRD Document"
                        >
                            {uploading ? <Loader2 className="animate-spin" /> : <Paperclip size={20} />}
                        </label>
                        <Input
                            value={input}
                            onChange={handleInputChange}
                            placeholder="Ask me anything..."
                            className="flex-1 shadow-sm h-10"
                            disabled={loading || !currentSessionId}
                        />
                        <Button type="submit" disabled={loading || !input.trim() || !currentSessionId} className="shadow-sm h-10 px-4">
                            <Send size={18} className="mr-2" />
                            Send
                        </Button>
                    </form>
                </div>
            </div>

            {/* Right Side Panel - Specialized Architect Dashboard */}
            {lastArchitectReport && (
                <div className="w-[450px] border-l bg-muted/5 flex flex-col hidden lg:flex animate-in slide-in-from-right duration-500 overflow-y-auto p-4 custom-scrollbar">
                    <div className="flex items-center justify-between mb-4 px-2">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Architect Insights</h2>
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 capitalize">
                            Live Analysis
                        </Badge>
                    </div>
                    <ArchitectReport data={lastArchitectReport} />

                    <div className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/10">
                        <h4 className="text-xs font-bold text-primary mb-2 flex items-center gap-2">
                            <Activity size={14} /> 实时追溯建议
                        </h4>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            检测到当前需求与已有知识图谱中的<b>“计息规则”</b>模块存在3处边缘冲突点，建议在实施阶段细化对冲逻辑。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

