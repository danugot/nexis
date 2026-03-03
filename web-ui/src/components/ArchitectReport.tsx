import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Activity, Layout, ShieldCheck, FileText, ChevronRight } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ArchitectReportProps {
    data: {
        verdict: string;
        projectName: string;
        summary: string;
        sections: {
            compliance: any;
            dependencies: any;
            gaps: any;
            impact: any;
        }
    }
}

export default function ArchitectReport({ data }: ArchitectReportProps) {
    const { projectName, summary, sections } = data;

    // Simple feasibility score heuristic from impact report if available
    const confidence = sections.impact?.confidence || 0.85;
    const score = Math.round(confidence * 100);

    return (
        <Card className="w-full mt-6 border border-primary/20 bg-background/60 backdrop-blur-xl overflow-hidden shadow-2xl rounded-2xl animate-in fade-in zoom-in-95 duration-700">
            <CardHeader className="bg-gradient-to-br from-primary/10 via-transparent to-transparent border-b border-primary/10 pb-6 pt-6 px-8">
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle className="text-xl font-bold flex items-center gap-2">
                            <ShieldCheck className="text-primary" /> 专业架构评审报告
                        </CardTitle>
                        <CardDescription className="text-sm">
                            项目范围: <span className="font-semibold text-foreground">{projectName}</span>
                        </CardDescription>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="relative h-16 w-16 flex items-center justify-center">
                            <svg className="h-full w-full" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="16" fill="none" className="stroke-muted" strokeWidth="3" />
                                <circle cx="18" cy="18" r="16" fill="none" className="stroke-primary" strokeWidth="3" strokeDasharray={`${score} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
                            </svg>
                            <span className="absolute text-sm font-bold">{score}%</span>
                        </div>
                        <span className="text-[10px] uppercase font-bold text-muted-foreground mt-1">可行性评分</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0">
                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="w-full justify-start rounded-none border-b border-border/40 bg-transparent px-8 h-14 space-x-2">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-t-lg border-b-2 border-transparent data-[state=active]:border-primary px-4">概览</TabsTrigger>
                        <TabsTrigger value="impact" className="data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-500 rounded-t-lg border-b-2 border-transparent data-[state=active]:border-blue-500 px-4">影响</TabsTrigger>
                        <TabsTrigger value="compliance" className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-500 rounded-t-lg border-b-2 border-transparent data-[state=active]:border-emerald-500 px-4">合规</TabsTrigger>
                        <TabsTrigger value="dependencies" className="data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-500 rounded-t-lg border-b-2 border-transparent data-[state=active]:border-purple-500 px-4">依赖</TabsTrigger>
                        <TabsTrigger value="gaps" className="data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-500 rounded-t-lg border-b-2 border-transparent data-[state=active]:border-orange-500 px-4">盲区</TabsTrigger>
                    </TabsList>

                    <div className="p-8 min-h-[400px] bg-background/40">
                        {/* Overview Tab */}
                        <TabsContent value="overview" className="mt-0">
                            <div className="space-y-6">
                                <div className="p-5 bg-primary/5 rounded-xl border border-primary/10 hover:border-primary/20 transition-colors">
                                    <h4 className="text-base font-bold flex items-center gap-2 mb-3 text-primary">
                                        <FileText size={18} /> 核心摘要
                                    </h4>
                                    <p className="text-sm text-foreground/80 leading-relaxed">{summary}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-5 rounded-xl bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/20 hover:border-orange-500/30 transition-all shadow-sm">
                                        <div className="text-xs font-bold text-orange-600 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                                            <AlertCircle size={16} /> 核心风险
                                        </div>
                                        <div className="text-sm font-medium line-clamp-3 text-orange-950 dark:text-orange-200" title={sections.impact?.broken_rules?.[0] || sections.gaps?.gaps?.[0]?.area || "未发现重大风险"}>
                                            {sections.impact?.broken_rules?.[0] || sections.gaps?.gaps?.[0]?.area || "未发现重大风险"}
                                        </div>
                                    </div>
                                    <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 hover:border-emerald-500/30 transition-all shadow-sm">
                                        <div className="text-xs font-bold text-emerald-600 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                                            <CheckCircle size={16} /> 建议方案
                                        </div>
                                        <div className="text-sm font-medium line-clamp-3 text-emerald-950 dark:text-emerald-200" title={sections.impact?.suggestions || sections.gaps?.suggestions || "无需特殊建议"}>
                                            {sections.impact?.suggestions || sections.gaps?.suggestions || "无需特殊建议"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Impact Tab */}
                        <TabsContent value="impact" className="mt-0">
                            <div className="space-y-6">
                                <div className="flex items-center gap-2 pb-3 border-b border-border/50">
                                    <Activity size={20} className="text-blue-500" />
                                    <h4 className="font-bold text-base text-blue-600 dark:text-blue-400">影响面分析 (Blast Radius)</h4>
                                </div>
                                <div className="space-y-5">
                                    <div>
                                        <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 mb-3">
                                            <div className="w-2 h-2 rounded-full bg-blue-500"></div> 受影响模块
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                            {Array.isArray(sections.impact?.affected_modules) ? sections.impact.affected_modules.map((m: any, i: number) => (
                                                <Badge key={i} variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 px-3 py-1 text-xs shadow-sm hover:bg-blue-500/20 transition-colors">
                                                    {typeof m === 'string' ? m : JSON.stringify(m)}
                                                </Badge>
                                            )) : (
                                                <span className="text-sm text-muted-foreground italic">解析受影响模块为空或格式异常。</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-sm text-foreground/80 bg-blue-500/5 p-4 rounded-xl italic border-l-4 border-blue-500 shadow-inner">
                                        "{sections.impact?.suggestions}"
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Compliance Tab */}
                        <TabsContent value="compliance" className="mt-0">
                            <div className="space-y-6">
                                <h4 className="font-bold text-base flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                                    <ShieldCheck size={20} /> 合规审计结果
                                </h4>
                                <div className="space-y-3">
                                    {Array.isArray(sections.compliance?.violations) && sections.compliance.violations.length > 0 ? (
                                        sections.compliance.violations.map((v: any, i: number) => (
                                            <div key={i} className="p-4 bg-red-500/5 border border-red-500/20 hover:border-red-500/40 transition-colors rounded-xl flex items-start gap-3 shadow-sm">
                                                <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                                                <div className="space-y-1">
                                                    <div className="text-sm font-bold text-red-700 dark:text-red-400">{typeof v === 'string' ? "合规冲突" : v.rule_name || "合规冲突"}</div>
                                                    <div className="text-sm text-foreground/80 leading-relaxed">{typeof v === 'string' ? v : v.description || JSON.stringify(v)}</div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center gap-3 p-8 justify-center text-emerald-600 bg-emerald-500/5 rounded-xl border border-emerald-500/20 border-dashed">
                                            <CheckCircle size={32} className="opacity-80" />
                                            <span className="font-bold text-emerald-700 dark:text-emerald-400">未检测到重大合规风险或结果解析为空。</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>

                        {/* Dependencies Tab */}
                        <TabsContent value="dependencies" className="mt-0">
                            <div className="space-y-5">
                                <h4 className="font-bold text-base flex items-center gap-2 text-purple-600 dark:text-purple-400">
                                    <Activity size={20} /> 图谱依赖路径
                                </h4>
                                <div className="text-sm space-y-2">
                                    {Array.isArray(sections.dependencies?.direct_dependencies) ? sections.dependencies.direct_dependencies.map((d: any, i: number) => (
                                        <div key={i} className="flex items-center gap-3 p-3 bg-purple-500/5 hover:bg-purple-500/10 transition-colors rounded-xl border border-purple-500/20 shadow-sm text-foreground/80">
                                            <ChevronRight size={14} className="text-purple-500" />
                                            <span className="font-medium">{typeof d === 'string' ? d : JSON.stringify(d)}</span>
                                        </div>
                                    )) : (
                                        <div className="text-muted-foreground p-3 italic">解析依赖模块列表为空或格式异常。</div>
                                    )}
                                </div>
                                <div className="mt-4 p-4 bg-primary/5 rounded-xl border border-primary/20 border-dashed text-sm font-medium text-primary text-center opacity-80 backdrop-blur-sm">
                                    架构拓扑细节已同步至 Graph Explorer
                                </div>
                            </div>
                        </TabsContent>

                        {/* Gaps Tab */}
                        <TabsContent value="gaps" className="mt-0">
                            <div className="space-y-5">
                                <h4 className="font-bold text-base flex items-center gap-2 text-orange-600 dark:text-orange-400">
                                    <AlertCircle size={20} /> 逻辑盲区与边界补丁
                                </h4>
                                <div className="prose prose-sm dark:prose-invert max-w-none bg-orange-500/5 p-6 rounded-xl border border-orange-500/20 shadow-inner">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {sections.gaps?.report || "未发现明显逻辑漏洞。"}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </TabsContent>
                    </div>
                </Tabs>
            </CardContent>

            <div className="p-3 bg-muted/20 border-t flex justify-between items-center px-6">
                <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <Layout size={12} /> Architect AI Final Outcome
                </span>
                <Button variant="ghost" size="sm" className="h-8 text-[11px] font-bold text-primary hover:bg-primary/10">
                    导出 PDF 报告
                </Button>
            </div>
        </Card>
    );
}
