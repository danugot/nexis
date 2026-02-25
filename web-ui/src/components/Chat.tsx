
import { useState, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { MessageSquare, Plus, Trash2 } from "lucide-react"
import { useGlobalDomain } from '../contexts/GlobalDomainContext'

export default function Chat() {
    const { activeDomain } = useGlobalDomain();
    const [messages, setMessages] = useState<any[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sessions, setSessions] = useState<any[]>([])
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Ensure we are talking to the Agent API
    const agentUrl = '/agent';

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

    const sendMessage = async () => {
        if (!input.trim() || !currentSessionId) return

        const currentInput = input

        const userMsg = { role: 'user', content: currentInput }
        // Extend assistant message to potentially store an array of tool traces
        const aiMsg = { role: 'assistant', content: '', tools: [] as any[] }

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
                    domainId: activeDomain?.id
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

                                setMessages(prev => {
                                    const newMessages = [...prev] as any[];
                                    const lastMsg = newMessages[newMessages.length - 1];

                                    if (data.type === 'done') {
                                        // Once the server has finished writing the response to the DB,
                                        // Refresh the session list in the background so the title might update
                                        fetchSessions();
                                    }

                                    if (data.type === 'tool') {
                                        lastMsg.tools = lastMsg.tools || [];
                                        lastMsg.tools.push({ name: data.name, args: data.args });
                                    } else if (data.type === 'text') {
                                        currentAiText += data.text;
                                        lastMsg.content = currentAiText;
                                    } else if (data.type === 'error') {
                                        currentAiText += `\n\nError: ${data.error}`;
                                        lastMsg.content = currentAiText;
                                    }
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

    return (
        <div className="flex h-screen max-w-6xl mx-auto overflow-hidden">
            {/* Sidebar for Sessions */}
            <div className="w-64 border-r bg-muted/20 flex flex-col hidden md:flex">
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

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full relative">
                <Card className="flex-1 m-4 mb-0 overflow-auto border-none shadow-none rounded-none">
                    <CardContent className="p-4 space-y-6 lg:px-12">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                                <MessageSquare size={48} className="mb-4" />
                                <p>Start a conversation with Nexis</p>
                            </div>
                        )}
                        {messages.map((m: any, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`rounded-lg p-3 max-w-[80%] ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border/50'
                                    }`}>
                                    {/* Render Tool Calls as internal thoughts */}
                                    {m.role === 'assistant' && m.tools && m.tools.length > 0 && (
                                        <div className="mb-2 pl-2 border-l-2 border-blue-400/50 space-y-1">
                                            <div className="text-xs font-semibold text-blue-500/80 flex items-center gap-1">
                                                <span className="flex-shrink-0 animate-pulse">⚡</span> Thinking Process
                                            </div>
                                            {m.tools.map((t: any, idx: number) => (
                                                <div key={idx} className="text-[11px] text-muted-foreground bg-background/50 p-1 rounded font-mono">
                                                    <span className="text-purple-500/80">Call:</span> {t.name}(<span className="text-green-600/70">{JSON.stringify(t.args)}</span>)
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {m.content ? (
                                        <div className="whitespace-pre-wrap">{m.content}</div>
                                    ) : (
                                        m.role === 'assistant' && <div className="text-sm text-muted-foreground animate-pulse italic">Formulating response...</div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                            <div className="text-sm text-muted-foreground animate-pulse mt-2 ml-2">Connecting to Nexis...</div>
                        )}
                        <div ref={messagesEndRef} />
                    </CardContent>
                </Card>

                <div className="p-4 bg-background lg:px-12 pb-8 border-t">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            sendMessage()
                        }}
                        className="flex gap-2"
                    >
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask me anything..."
                            className="flex-1 shadow-sm"
                            disabled={loading || !currentSessionId}
                        />
                        <Button type="submit" disabled={loading || !input.trim() || !currentSessionId} className="shadow-sm">
                            Send
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    )
}

