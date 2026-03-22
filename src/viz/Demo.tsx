/**
 * Live Page — Governance Observation Deck
 *
 * LEFT:  Define rules, configure simulation, view source code
 * RIGHT: Watch agent behavior in real-time (behavioral outcomes, adaptations, patterns)
 *
 * Governance details are hidden — only visible if you drill into them.
 * The value we show is: how agent behavior changes under governance.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ApiKeyInput from "@/components/ApiKeyInput";
import {
  Shield,
  Terminal,
  CheckCircle,
  Copy,
  ChevronDown,
  ChevronRight,
  Plug,
  PlugZap,
  Send,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import GovernanceFlowViz from "@/components/GovernanceFlowViz";

const API_BASE = "http://localhost:3456";

// ============================================
// TYPES
// ============================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type GovernanceEvent = {
  id: number;
  timestamp: string;
  type: string;
  action?: {
    agentId: string;
    type: string;
    description: string;
    magnitude: number;
    context?: Record<string, unknown>;
  };
  verdict?: {
    status: string;
    reason: string;
    rulesFired?: { ruleId: string; description: string }[];
    confidence: number;
    consequence?: { type: string; rounds?: number; description: string };
    reward?: { type: string; rounds?: number; description: string };
  };
  policyText?: string;
};

// ============================================
// BEHAVIORAL INTERPRETATION
// ============================================

function interpretBehavior(event: GovernanceEvent): string {
  const status = event.verdict?.status?.toUpperCase();
  const agent = event.action?.agentId ?? "Agent";
  const actionType = event.action?.type ?? "action";

  switch (status) {
    case "BLOCK":
      return `${agent} attempted to ${actionType.replace(/_/g, " ")} — stopped before it could propagate`;
    case "PENALIZE":
      return `${agent} tried to ${actionType.replace(/_/g, " ")} — influence reduced for ${event.verdict?.consequence?.rounds ?? 1} round(s)`;
    case "MODIFY":
    case "PAUSE":
      return `${agent} wanted to ${actionType.replace(/_/g, " ")} — action adjusted to meet quality standards`;
    case "REWARD":
      return `${agent} produced validated work via ${actionType.replace(/_/g, " ")} — influence boosted`;
    case "ALLOW":
      return `${agent} proceeded with ${actionType.replace(/_/g, " ")}`;
    default:
      return `${agent}: ${actionType.replace(/_/g, " ")}`;
  }
}

function behaviorIcon(status?: string) {
  switch (status?.toUpperCase()) {
    case "BLOCK": case "PENALIZE": return "bg-red-500";
    case "MODIFY": case "PAUSE": return "bg-yellow-500";
    case "REWARD": return "bg-emerald-500";
    case "ALLOW": return "bg-green-500";
    default: return "bg-muted-foreground";
  }
}

// ============================================
// MAIN PAGE
// ============================================

export default function Science() {
  const [searchParams] = useSearchParams();
  const governEngine = searchParams.get("engine");
  const governRules = useMemo(() => {
    const raw = searchParams.get("rules");
    return raw ? decodeURIComponent(raw) : null;
  }, [searchParams]);

  const [serverStatus, setServerStatus] = useState<ConnectionStatus>("disconnected");
  const [sseStatus, setSseStatus] = useState<ConnectionStatus>("disconnected");
  const [policyText, setPolicyText] = useState(governRules ?? "");
  const [policySaved, setPolicySaved] = useState(false);
  const [events, setEvents] = useState<GovernanceEvent[]>([]);
  const [stats, setStats] = useState({ total: 0, allowed: 0, blocked: 0, modified: 0, penalized: 0, rewarded: 0 });

  // Simulation controls
  const [simRunning, setSimRunning] = useState(false);
  const [simAgents, setSimAgents] = useState(50);
  const [simSteps, setSimSteps] = useState(20);
  const [llmOpen, setLlmOpen] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceCode, setSourceCode] = useState<{ name: string; path: string; content: string }[] | null>(null);

  // Manual tester
  const [testerOpen, setTesterOpen] = useState(false);
  const [testAgent, setTestAgent] = useState("agent_alpha");
  const [testAction, setTestAction] = useState("publish_hypothesis");
  const [testDescription, setTestDescription] = useState("Initial hypothesis about material property X");
  const [testMagnitude, setTestMagnitude] = useState("0.6");
  const [testSending, setTestSending] = useState(false);

  const [vizMode, setVizMode] = useState<"flow" | "feed" | "split">("split");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Parse rules into lines for the flow viz
  const vizRules = useMemo(() => {
    return policyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  }, [policyText]);

  // ---- Check server health ----
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/reason/health`);
      if (res.ok) {
        setServerStatus("connected");
        const policyRes = await fetch(`${API_BASE}/api/v1/policy`);
        if (policyRes.ok) {
          const data = await policyRes.json();
          if (data.active && data.policyText) {
            setPolicyText(data.policyText);
            setPolicySaved(true);
          }
        }
      } else {
        setServerStatus("error");
      }
    } catch {
      setServerStatus("disconnected");
    }
  }, []);

  // ---- Connect to SSE ----
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    setSseStatus("connecting");
    const es = new EventSource(`${API_BASE}/api/v1/events`);
    eventSourceRef.current = es;

    es.onopen = () => setSseStatus("connected");

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as GovernanceEvent;
        if (event.type === "connected") return;

        if (event.type === "evaluation") {
          setEvents((prev) => [event, ...prev].slice(0, 200));
          const status = event.verdict?.status?.toUpperCase();
          setStats((prev) => ({
            total: prev.total + 1,
            allowed: prev.allowed + (status === "ALLOW" ? 1 : 0),
            blocked: prev.blocked + (status === "BLOCK" ? 1 : 0),
            modified: prev.modified + (status === "MODIFY" || status === "PAUSE" ? 1 : 0),
            penalized: prev.penalized + (status === "PENALIZE" ? 1 : 0),
            rewarded: prev.rewarded + (status === "REWARD" ? 1 : 0),
          }));
        }

        if (event.type === "simulation_complete" || event.type === "simulation_stopped") {
          setSimRunning(false);
        }

        if (event.type === "policy_updated") {
          setPolicyText(event.policyText ?? "");
          setPolicySaved(true);
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => setSseStatus("error");
  }, []);

  // ---- Save policy ----
  const savePolicy = useCallback(async () => {
    if (!policyText.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyText }),
      });
      if (res.ok) setPolicySaved(true);
    } catch { /* server not reachable */ }
  }, [policyText]);

  // ---- Run simulation ----
  const runSimulation = useCallback(async () => {
    setSimRunning(true);
    setEvents([]);
    setStats({ total: 0, allowed: 0, blocked: 0, modified: 0, penalized: 0, rewarded: 0 });
    try {
      const body: Record<string, unknown> = { agents: simAgents, steps: simSteps, policyText };
      if (llmApiKey) {
        body.llmApiKey = llmApiKey;
        if (llmBaseUrl) body.llmBaseUrl = llmBaseUrl;
        if (llmModel) body.llmModel = llmModel;
      }
      await fetch(`${API_BASE}/api/v1/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* server not reachable */ }
  }, [simAgents, simSteps, policyText, llmApiKey, llmBaseUrl, llmModel]);

  const stopSimulation = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/v1/simulate/stop`, { method: "POST" });
    } catch { /* ignore */ }
    setSimRunning(false);
  }, []);

  const loadSourceCode = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/simulate/source`);
      if (res.ok) {
        const data = await res.json();
        setSourceCode(data.files);
      }
    } catch { /* ignore */ }
  }, []);

  // ---- Send test action ----
  const sendTestAction = useCallback(async () => {
    setTestSending(true);
    try {
      await fetch(`${API_BASE}/api/v1/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: {
            agentId: testAgent,
            type: testAction,
            description: testDescription,
            magnitude: parseFloat(testMagnitude) || 0.5,
          },
        }),
      });
    } catch { /* ignore */ }
    setTestSending(false);
  }, [testAgent, testAction, testDescription, testMagnitude]);

  // ---- Copy helper ----
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  // ---- Init ----
  useEffect(() => {
    checkServer();
    const interval = setInterval(checkServer, 10000);
    return () => clearInterval(interval);
  }, [checkServer]);

  useEffect(() => {
    if (serverStatus === "connected" && sseStatus === "disconnected") {
      connectSSE();
    }
    return () => { eventSourceRef.current?.close(); };
  }, [serverStatus, connectSSE, sseStatus]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            {governEngine && (
              <a href="/govern" className="text-muted-foreground hover:text-foreground transition-colors" title="Back to governance editor">
                <ArrowLeft className="h-4 w-4" />
              </a>
            )}
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">NeuroVerse</span>
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              {governEngine ? governEngine.charAt(0).toUpperCase() + governEngine.slice(1) : "Governance"}
            </Badge>
            {governRules && (
              <Badge variant="secondary" className="text-[10px]">
                {governRules.split("\n").filter(l => l.trim()).length} rules from editor
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {serverStatus === "connected" ? <PlugZap className="h-3.5 w-3.5 text-green-400" /> : <Plug className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className={cn("text-xs", serverStatus === "connected" ? "text-green-400" : "text-muted-foreground")}>
                {serverStatus === "connected" ? "Server connected" : "Server offline"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", sseStatus === "connected" ? "bg-green-500 animate-pulse" : "bg-muted-foreground")} />
              <span className={cn("text-xs", sseStatus === "connected" ? "text-green-400" : "text-muted-foreground")}>
                {sseStatus === "connected" ? "Live" : "Not streaming"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* ================================================ */}
        {/* LEFT — Build Governance */}
        {/* ================================================ */}
        <div className="w-[440px] border-r flex flex-col overflow-y-auto">
          <div className="p-5 space-y-4">

            {/* API Key */}
            <ApiKeyInput />

            {/* Step 1: Start server */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    serverStatus === "connected" ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground",
                  )}>1</div>
                  <CardTitle className="text-sm">Start governance server</CardTitle>
                  {serverStatus === "connected" && <CheckCircle className="h-3.5 w-3.5 text-green-400" />}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted/50 border rounded px-3 py-2 font-mono">
                    npx tsx src/server/index.ts
                  </code>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => copyToClipboard("npx tsx src/server/index.ts")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Write rules */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    policySaved ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground",
                  )}>2</div>
                  <CardTitle className="text-sm">Write your rules</CardTitle>
                  {policySaved && <CheckCircle className="h-3.5 w-3.5 text-green-400" />}
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <textarea
                  className="w-full h-36 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                  placeholder={"Write rules in plain English, one per line.\n\nExamples:\n  Block unvalidated hypotheses from spreading\n  Require independent replication before citation\n  Halt cascade when false positive risk exceeds 70%\n  Penalize self-citation loops"}
                  value={policyText}
                  onChange={(e) => { setPolicyText(e.target.value); setPolicySaved(false); }}
                />
                {policyText.trim().length === 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground/60 self-center">Try:</span>
                    {[
                      { label: "Anti-Misinfo", rules: "Block posts that amplify unverified claims\nBlock sharing content with influence above 0.5 when is_misinfo is true\nPenalize agents that share without verifying sources\nHalt cascade when misinfo_level exceeds 40%\nReward agents that report misinformation" },
                      { label: "Echo Chamber", rules: "Block reposting when echo amplification exceeds 60%\nPenalize agents repeating the same claim more than twice\nRequire independent sources before sharing conclusions\nReward agents that challenge dominant consensus" },
                      { label: "Bot Defense", rules: "Block bot agents from creating posts\nBlock troll agents from sharing content with high influence\nPenalize agents with credibility below 0.2 from posting\nReward fact_checker agents for reporting" },
                      { label: "Science Rules", rules: "Block any hypothesis from spreading until independently replicated\nRequire at least 2 independent confirmations before citation\nHalt cascade when false positive probability exceeds 60%\nPenalize self-citation loops across all agents" },
                    ].map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-0.5 text-[10px] text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
                        onClick={() => { setPolicyText(t.rules); setPolicySaved(false); }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  onClick={savePolicy}
                  disabled={!policyText.trim() || serverStatus !== "connected"}
                >
                  {policySaved ? "Rules active on server" : serverStatus !== "connected" ? "Start server first" : "Save rules"}
                </Button>
              </CardContent>
            </Card>

            {/* Step 3: Run simulation */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    simRunning ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground",
                  )}>3</div>
                  <CardTitle className="text-sm">Run governed simulation</CardTitle>
                  {simRunning && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Launch 50 AI agents on a social network. Your rules control what spreads.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium">Agents</label>
                    <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" type="number" min="10" max="100" value={simAgents} onChange={(e) => setSimAgents(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium">Steps</label>
                    <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" type="number" min="5" max="50" value={simSteps} onChange={(e) => setSimSteps(Number(e.target.value))} />
                  </div>
                </div>

                {/* LLM options (collapsed) */}
                <Collapsible open={llmOpen} onOpenChange={setLlmOpen}>
                  <CollapsibleTrigger className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1">
                    <ChevronRight className={cn("h-3 w-3 transition-transform", llmOpen && "rotate-90")} />
                    Use your own AI API (optional)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">API Key</label>
                      <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" type="password" placeholder="sk-... or 'ollama' for local" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Base URL</label>
                      <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" placeholder="https://api.openai.com/v1" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Model</label>
                      <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" placeholder="gpt-4o-mini" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} />
                    </div>
                    <p className="text-[10px] text-muted-foreground/50">
                      Without an API key, agents use rule-based decisions (free, instant). With a key, agents use your LLM for more realistic behavior.
                    </p>
                  </CollapsibleContent>
                </Collapsible>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={runSimulation}
                  disabled={!policySaved || serverStatus !== "connected" || simRunning}
                >
                  {simRunning ? "Simulation running..." : !policySaved ? "Save rules first" : "Run Simulation"}
                </Button>
                {simRunning && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full"
                    onClick={stopSimulation}
                  >
                    Stop
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* View source code */}
            <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                        <CardTitle className="text-xs text-muted-foreground">View simulation source code</CardTitle>
                      </div>
                      {sourceOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-2">
                    {!sourceCode ? (
                      <Button size="sm" variant="outline" className="w-full" onClick={loadSourceCode}>
                        Load source code
                      </Button>
                    ) : (
                      sourceCode.map((file) => (
                        <div key={file.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono text-muted-foreground">{file.path}</span>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(file.content)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <pre className="text-[10px] bg-muted/50 border rounded p-2 font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre leading-relaxed">
                            {file.content}
                          </pre>
                        </div>
                      ))
                    )}
                    <p className="text-[10px] text-muted-foreground/50">
                      This is the actual code running the simulation. The governance integration is one import and one function call.
                    </p>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Manual tester (collapsed) */}
            <Collapsible open={testerOpen} onOpenChange={setTesterOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Send className="h-3.5 w-3.5 text-muted-foreground" />
                        <CardTitle className="text-xs text-muted-foreground">Test an action manually</CardTitle>
                      </div>
                      {testerOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground font-medium">Agent ID</label>
                        <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" value={testAgent} onChange={(e) => setTestAgent(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground font-medium">Action</label>
                        <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" value={testAction} onChange={(e) => setTestAction(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Description</label>
                      <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" value={testDescription} onChange={(e) => setTestDescription(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Magnitude (0-1)</label>
                      <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono" value={testMagnitude} onChange={(e) => setTestMagnitude(e.target.value)} type="number" min="0" max="1" step="0.1" />
                    </div>
                    <Button size="sm" className="w-full" onClick={sendTestAction} disabled={testSending || serverStatus !== "connected" || !policySaved}>
                      {testSending ? "Sending..." : !policySaved ? "Save rules first" : "Send to governance"}
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

          </div>
        </div>

        {/* ================================================ */}
        {/* RIGHT — Watch Agent Behavior */}
        {/* ================================================ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card/30">
          {/* Stats bar + view toggle */}
          <div className="border-b px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs">
                {stats.total > 0 ? (
                  <>
                    <span className="text-muted-foreground">{stats.total} actions observed</span>
                    <span className="text-green-400">{stats.allowed} proceeded</span>
                    <span className="text-red-400">{stats.blocked} stopped</span>
                    {stats.modified > 0 && <span className="text-yellow-400">{stats.modified} adjusted</span>}
                    {stats.penalized > 0 && <span className="text-orange-400">{stats.penalized} penalized</span>}
                    {stats.rewarded > 0 && <span className="text-emerald-400">{stats.rewarded} rewarded</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">Agent observation deck</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {(["flow", "split", "feed"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setVizMode(mode)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      vizMode === mode
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                  >
                    {mode === "flow" ? "Visual" : mode === "feed" ? "Feed" : "Split"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Flow visualization */}
          {(vizMode === "flow" || vizMode === "split") && (
            <div className={cn(
              "border-b",
              vizMode === "flow" ? "flex-1" : "h-[280px] shrink-0"
            )}>
              <GovernanceFlowViz
                rules={vizRules}
                events={events}
                className="w-full h-full"
              />
            </div>
          )}

          {/* Agent behavior feed */}
          <ScrollArea className={cn("flex-1", vizMode === "flow" && "hidden")}>
            <div className="p-6">
              {events.length === 0 ? (
                <div className="text-center py-20 space-y-4">
                  <Shield className="h-12 w-12 text-muted-foreground/15 mx-auto" />
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      {serverStatus !== "connected"
                        ? "Start the governance server to begin"
                        : !policySaved
                        ? "Write and save your governance rules on the left"
                        : "Waiting for agent activity..."
                      }
                    </div>
                    <div className="text-xs text-muted-foreground/50">
                      {policySaved ? "Run the simulation or send a test action. Every evaluation appears here in real-time." : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <Collapsible key={event.id}>
                      <div className="rounded-lg border bg-card p-3">
                        {/* Behavior summary (always visible) */}
                        <div className="flex items-start gap-3">
                          <div className={cn("w-2.5 h-2.5 rounded-full mt-1.5 shrink-0", behaviorIcon(event.verdict?.status))} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-foreground">
                              {interpretBehavior(event)}
                            </div>
                            {event.action?.description && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {event.action.description}
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground/40 shrink-0 font-mono">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* Governance details (hidden, expandable) */}
                        <CollapsibleTrigger className="mt-2 text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1">
                          <ChevronRight className="h-3 w-3" />
                          governance details
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 ml-5 rounded bg-muted/30 border border-border/40 p-2 text-[10px] space-y-1">
                            <div><span className="text-muted-foreground">Verdict:</span> <span className="font-mono">{event.verdict?.status}</span></div>
                            <div><span className="text-muted-foreground">Reason:</span> {event.verdict?.reason}</div>
                            <div><span className="text-muted-foreground">Confidence:</span> {((event.verdict?.confidence ?? 0) * 100).toFixed(0)}%</div>
                            {event.verdict?.rulesFired && event.verdict.rulesFired.length > 0 && (
                              <div>
                                <span className="text-muted-foreground">Rules fired:</span>
                                {event.verdict.rulesFired.map((r, i) => (
                                  <div key={i} className="ml-2 text-muted-foreground/70">{r.description || r.ruleId}</div>
                                ))}
                              </div>
                            )}
                            {event.verdict?.consequence && (
                              <div><span className="text-muted-foreground">Consequence:</span> {event.verdict.consequence.description}</div>
                            )}
                            {event.verdict?.reward && (
                              <div><span className="text-muted-foreground">Reward:</span> {event.verdict.reward.description}</div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
