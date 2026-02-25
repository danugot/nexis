import { useEffect, useState, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ZoomIn, ZoomOut, Maximize, Search } from 'lucide-react';
import { Input } from "@/components/ui/input";
import axios from 'axios';
import { useGlobalDomain } from '../contexts/GlobalDomainContext';

interface Node {
    id: string;
    name: string;
    label: string;
    entity_type?: string;
    color: string;
    val: number;
}

interface Link {
    source: string;
    target: string;
    type: string;
}

interface GraphData {
    nodes: Node[];
    links: Link[];
}



export default function GraphExplorer() {
    const { activeDomain } = useGlobalDomain();
    const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const [containerDimensions, setContainerDimensions] = useState({ width: 800, height: 600 });
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<any>(null);

    // UI State
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [showPersons, setShowPersons] = useState<boolean>(false);

    const fetchGraph = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: '500' });
            if (searchQuery.trim()) {
                params.append('search_query', searchQuery.trim());
            }
            if (activeDomain) {
                params.append('domain_id', activeDomain.id);
            }
            if (!showPersons) {
                params.append('exclude_types', 'Person/Role');
            }

            const response = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/graph/visualize?${params.toString()}`);
            setData(response.data);

            // Auto fit after a short delay to allow graph placement
            setTimeout(() => {
                if (graphRef.current) {
                    graphRef.current.zoomToFit(400, 20);
                }
            }, 500);
        } catch (error) {
            console.error("Failed to fetch graph data:", error);
        } finally {
            setLoading(false);
        }
    };

    // Auto-fetch when component mounts and mostly when "showPersons" or "activeDomain" toggles
    useEffect(() => {
        fetchGraph();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showPersons, activeDomain]);

    // Responsive graph sizing
    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                setContainerDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', updateDimensions);
        updateDimensions();

        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    const handleZoomIn = () => {
        if (graphRef.current) {
            graphRef.current.zoom(graphRef.current.zoom() * 1.2, 400);
        }
    }

    const handleZoomOut = () => {
        if (graphRef.current) {
            graphRef.current.zoom(graphRef.current.zoom() / 1.2, 400);
        }
    }

    const handleFitView = () => {
        if (graphRef.current) {
            graphRef.current.zoomToFit(400, 20);
        }
    }

    return (
        <div className="h-full flex flex-col p-4 w-full">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Graph Explorer</h2>
                    <p className="text-muted-foreground">Visualize connections in the Knowledge Base.</p>
                </div>

                <div className="flex gap-2 items-center flex-wrap">
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="Search nodes (hit Enter)..."
                            className="pl-8 bg-background"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') fetchGraph() }}
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm font-medium border rounded-md px-3 h-9 bg-background hover:bg-muted cursor-pointer">
                        <input
                            type="checkbox"
                            className="rounded border-slate-300 w-4 h-4 accent-slate-900"
                            checked={showPersons}
                            onChange={(e) => setShowPersons(e.target.checked)}
                        />
                        Show Persons
                    </label>

                    <div className="h-6 border-l mx-1 border-slate-200 dark:border-slate-800"></div>

                    <Button variant="outline" size="icon" onClick={handleZoomIn} title="Zoom In" className="h-9 w-9">
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleZoomOut} title="Zoom Out" className="h-9 w-9">
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleFitView} title="Fit View" className="h-9 w-9">
                        <Maximize className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={fetchGraph} disabled={loading} className="h-9">
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            <Card className="flex-1 overflow-hidden border-slate-200 dark:border-slate-800 shadow-sm relative">
                {loading && (
                    <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center backdrop-blur-sm">
                        <div className="flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
                            <RefreshCw className="h-5 w-5 animate-spin" />
                            Loading graph...
                        </div>
                    </div>
                )}
                <CardContent className="p-0 h-full relative bg-slate-50 dark:bg-slate-900" ref={containerRef}>
                    {data.nodes.length > 0 ? (
                        <ForceGraph2D
                            ref={graphRef}
                            width={containerDimensions.width}
                            height={containerDimensions.height}
                            graphData={data}
                            nodeLabel="name"
                            nodeRelSize={6}
                            linkDirectionalArrowLength={3.5}
                            linkDirectionalArrowRelPos={1}
                            linkCurvature={0.25}
                            enableNodeDrag={true}
                            onNodeClick={async (node: any) => {
                                try {
                                    const params = new URLSearchParams({ limit: '100', expand_node_id: node.id });
                                    if (activeDomain) params.append('domain_id', activeDomain.id);
                                    if (!showPersons) {
                                        params.append('exclude_types', 'Person/Role');
                                    }
                                    const response = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/graph/visualize?${params.toString()}`);
                                    const newData = response.data;

                                    setData(prev => {
                                        const newNodes = [...prev.nodes];
                                        const newLinks = [...prev.links];

                                        const existingNodeIds = new Set(newNodes.map(n => n.id));

                                        // Links from react-force-graph will get source/target converted to object references,
                                        // so we compare based on id logic.
                                        const getLinkId = (item: any) => typeof item === 'object' ? item.id : item;
                                        const existingLinkIds = new Set(newLinks.map(l => `${getLinkId(l.source)}-${getLinkId(l.target)}-${l.type}`));

                                        newData.nodes.forEach((n: any) => {
                                            if (!existingNodeIds.has(n.id)) {
                                                // Initialize position near clicked node for smooth animation
                                                n.x = node.x + (Math.random() * 20 - 10);
                                                n.y = node.y + (Math.random() * 20 - 10);
                                                newNodes.push(n);
                                                existingNodeIds.add(n.id);
                                            }
                                        });

                                        newData.links.forEach((l: any) => {
                                            const linkId = `${l.source}-${l.target}-${l.type}`;
                                            if (!existingLinkIds.has(linkId)) {
                                                newLinks.push(l);
                                                existingLinkIds.add(linkId);
                                            }
                                        });

                                        return { nodes: newNodes, links: newLinks };
                                    });
                                } catch (error) {
                                    console.error("Failed to expand node:", error);
                                }
                            }}

                            // Node Styling
                            nodeCanvasObject={(node: any, ctx, globalScale) => {
                                const label = node.name;
                                const fontSize = 12 / globalScale;
                                ctx.font = `${fontSize}px Sans-Serif`;
                                const textWidth = ctx.measureText(label).width;
                                const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

                                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                                if (node.val > 10) { // Highlight big nodes (Modules)
                                    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                                }

                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillStyle = node.color;

                                // Draw shape
                                ctx.beginPath();
                                ctx.arc(node.x, node.y, node.val, 0, 2 * Math.PI, false);
                                ctx.fill();

                                // Draw Text
                                ctx.fillStyle = '#333';
                                ctx.fillText(label, node.x, node.y + node.val + 2);
                            }}
                        />
                    ) : (
                        !loading && (
                            <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2">
                                <Search className="h-8 w-8 opacity-20" />
                                <p>No nodes found for the given criteria.</p>
                            </div>
                        )
                    )}
                </CardContent>
            </Card>

            <div className="mt-4 flex flex-wrap gap-4 px-2">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#f43f5e]"></div>
                    <span className="text-sm font-medium">Module</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#f59e0b]"></div>
                    <span className="text-sm font-medium">SubModule</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#10b981]"></div>
                    <span className="text-sm font-medium">Document</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#3b82f6]"></div>
                    <span className="text-sm font-medium text-slate-600">System/Components</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#ec4899]"></div>
                    <span className="text-sm font-medium text-slate-600">Business Concept</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#06b6d4]"></div>
                    <span className="text-sm font-medium text-slate-600">Tech Identifier</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#8b5cf6]"></div>
                    <span className="text-sm font-medium text-slate-600">Organization</span>
                </div>
                {showPersons && (
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-[#94a3b8]"></div>
                        <span className="text-sm font-medium text-slate-600">Person/Role</span>
                    </div>
                )}
            </div>
            <p className="text-xs text-muted-foreground px-2 pt-2 pb-1 text-center border-t mt-2">
                💡 提示: You can click on any node to dynamically expand its connections (1-hop traversal).
            </p>
        </div>
    );
}
