/**
 * NeuroVerse Governance Observation Deck
 *
 * Minimal React app that reuses GovernanceFlowViz directly.
 * No shadcn/ui, no router, no heavy deps — just the viz + controls.
 *
 * Connects to the demo server SSE stream at /api/v1/events.
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GovernanceFlowViz from './GovernanceFlowViz';

type GovernanceEvent = {
  id: number;
  timestamp: string;
  type: string;
  action?: { agentId: string; type: string; description: string; magnitude: number };
  verdict?: {
    status: string; reason: string;
    rulesFired?: { ruleId: string; description: string }[];
    consequence?: { type: string; rounds?: number; description: string };
    reward?: { type: string; rounds?: number; description: string };
  };
  policyText?: string;
};

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const PRESETS: Record<string, string> = {
  'Anti-Misinfo': 'Block posts that amplify unverified claims\nBlock sharing content with influence above 0.5 when is_misinfo is true\nPenalize agents that share without verifying sources\nHalt cascade when misinfo_level exceeds 40%\nReward agents that report misinformation',
  'Echo Chamber': 'Block reposting when echo amplification exceeds 60%\nPenalize agents repeating the same claim more than twice\nRequire independent sources before sharing conclusions\nReward agents that challenge dominant consensus',
  'Bot Defense': 'Block bot agents from creating posts\nBlock troll agents from sharing content with high influence\nPenalize agents with credibility below 0.2 from posting\nReward fact_checker agents for reporting',
  'Science Rules': 'Block any hypothesis from spreading until independently replicated\nRequire at least 2 independent confirmations before citation\nHalt cascade when false positive probability exceeds 60%\nPenalize self-citation loops across all agents',
};

function statusColor(status?: string): string {
  switch (status?.toUpperCase()) {
    case 'BLOCK': return 'var(--red)';
    case 'PENALIZE': return 'var(--orange)';
    case 'MODIFY': case 'PAUSE': return 'var(--yellow)';
    case 'REWARD': return 'var(--emerald)';
    case 'ALLOW': return 'var(--green)';
    default: return 'var(--muted)';
  }
}

function interpretBehavior(event: GovernanceEvent): string {
  const status = event.verdict?.status?.toUpperCase();
  const agent = event.action?.agentId ?? 'Agent';
  const action = event.action?.type?.replace(/_/g, ' ') ?? 'action';
  switch (status) {
    case 'BLOCK': return `${agent} attempted to ${action} — stopped`;
    case 'PENALIZE': return `${agent} tried to ${action} — influence reduced`;
    case 'MODIFY': case 'PAUSE': return `${agent} wanted to ${action} — adjusted`;
    case 'REWARD': return `${agent} produced validated ${action} — boosted`;
    case 'ALLOW': return `${agent} proceeded with ${action}`;
    default: return `${agent}: ${action}`;
  }
}

function App() {
  const [serverStatus, setServerStatus] = useState<ConnectionStatus>('disconnected');
  const [policyText, setPolicyText] = useState('');
  const [policySaved, setPolicySaved] = useState(false);
  const [events, setEvents] = useState<GovernanceEvent[]>([]);
  const [stats, setStats] = useState({ total: 0, allowed: 0, blocked: 0, modified: 0, penalized: 0, rewarded: 0 });
  const [simRunning, setSimRunning] = useState(false);
  const [simAgents, setSimAgents] = useState(50);
  const [simSteps, setSimSteps] = useState(20);
  const [vizMode, setVizMode] = useState<'flow' | 'split' | 'feed'>('split');
  const [testAgent, setTestAgent] = useState('agent_alpha');
  const [testAction, setTestAction] = useState('publish_hypothesis');
  const [testDesc, setTestDesc] = useState('Initial hypothesis about material property X');
  const [testOpen, setTestOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const vizRules = useMemo(() => policyText.split('\n').map(l => l.trim()).filter(Boolean), [policyText]);

  // Health check
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/reason/health');
      if (res.ok) {
        setServerStatus('connected');
        const pRes = await fetch('/api/v1/policy');
        if (pRes.ok) {
          const data = await pRes.json();
          if (data.active && data.policyText) { setPolicyText(data.policyText); setPolicySaved(true); }
        }
      } else { setServerStatus('error'); }
    } catch { setServerStatus('disconnected'); }
  }, []);

  // SSE
  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource('/api/v1/events');
    esRef.current = es;
    es.onopen = () => setServerStatus('connected');
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as GovernanceEvent;
        if (event.type === 'connected') return;
        if (event.type === 'evaluation') {
          setEvents(prev => [event, ...prev].slice(0, 200));
          const s = event.verdict?.status?.toUpperCase();
          setStats(p => ({
            total: p.total + 1, allowed: p.allowed + (s === 'ALLOW' ? 1 : 0),
            blocked: p.blocked + (s === 'BLOCK' ? 1 : 0),
            modified: p.modified + (s === 'MODIFY' || s === 'PAUSE' ? 1 : 0),
            penalized: p.penalized + (s === 'PENALIZE' ? 1 : 0),
            rewarded: p.rewarded + (s === 'REWARD' ? 1 : 0),
          }));
        }
        if (event.type === 'simulation_complete' || event.type === 'simulation_stopped') setSimRunning(false);
        if (event.type === 'policy_updated') { setPolicyText(event.policyText ?? ''); setPolicySaved(true); }
      } catch { /* ignore */ }
    };
    es.onerror = () => setServerStatus('error');
  }, []);

  useEffect(() => { checkServer(); const i = setInterval(checkServer, 10000); return () => clearInterval(i); }, [checkServer]);
  useEffect(() => { if (serverStatus === 'connected') connectSSE(); return () => { esRef.current?.close(); }; }, [serverStatus, connectSSE]);

  const savePolicy = async () => {
    if (!policyText.trim()) return;
    try { const r = await fetch('/api/v1/policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policyText }) }); if (r.ok) setPolicySaved(true); } catch {}
  };

  const runSim = async () => {
    setSimRunning(true); setEvents([]); setStats({ total: 0, allowed: 0, blocked: 0, modified: 0, penalized: 0, rewarded: 0 });
    try { await fetch('/api/v1/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agents: simAgents, steps: simSteps, policyText }) }); } catch {}
  };

  const stopSim = async () => { try { await fetch('/api/v1/simulate/stop', { method: 'POST' }); } catch {} setSimRunning(false); };

  const sendTest = async () => {
    try { await fetch('/api/v1/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: { agentId: testAgent, type: testAction, description: testDesc, magnitude: 0.6 } }) }); } catch {}
  };

  return (
    <>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>NeuroVerse</span>
          <span style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--primary)', borderRadius: 4, color: 'var(--primary)' }}>Governance</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: serverStatus === 'connected' ? 'var(--green)' : 'var(--muted)', display: 'inline-block' }} />
            {serverStatus === 'connected' ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT PANEL */}
        <div style={{ width: 400, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Rules */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Write your rules</div>
            <textarea
              style={{ width: '100%', height: 140, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, resize: 'none' }}
              placeholder="Write rules in plain English, one per line..."
              value={policyText}
              onChange={e => { setPolicyText(e.target.value); setPolicySaved(false); }}
            />
            {!policyText && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {Object.entries(PRESETS).map(([label, rules]) => (
                  <button key={label} onClick={() => { setPolicyText(rules); setPolicySaved(false); }}
                    style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '2px 10px', fontSize: 10, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={savePolicy} disabled={!policyText.trim() || serverStatus !== 'connected'}
              style={{ width: '100%', marginTop: 8, padding: '8px 0', borderRadius: 6, border: 'none', background: policySaved ? 'var(--dim)' : 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, opacity: !policyText.trim() || serverStatus !== 'connected' ? 0.4 : 1 }}>
              {policySaved ? 'Rules active' : serverStatus !== 'connected' ? 'Start server first' : 'Save rules'}
            </button>
          </div>

          {/* Simulation */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Run governed simulation</div>
            <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>Launch AI agents on a social network. Your rules control what spreads.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)' }}>Agents
                <input type="number" min={10} max={100} value={simAgents} onChange={e => setSimAgents(+e.target.value)}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, marginTop: 2 }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--muted)' }}>Steps
                <input type="number" min={5} max={50} value={simSteps} onChange={e => setSimSteps(+e.target.value)}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, marginTop: 2 }} />
              </label>
            </div>
            <button onClick={simRunning ? stopSim : runSim} disabled={!policySaved || serverStatus !== 'connected'}
              style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', background: simRunning ? 'var(--red)' : 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, opacity: !policySaved || serverStatus !== 'connected' ? 0.4 : 1 }}>
              {simRunning ? 'Stop' : !policySaved ? 'Save rules first' : 'Run Simulation'}
            </button>
          </div>

          {/* Manual tester */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div onClick={() => setTestOpen(!testOpen)} style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
              {testOpen ? '▾' : '▸'} Test an action manually
            </div>
            {testOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label style={{ fontSize: 10, color: 'var(--muted)' }}>Agent ID
                    <input value={testAgent} onChange={e => setTestAgent(e.target.value)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, marginTop: 2 }} />
                  </label>
                  <label style={{ fontSize: 10, color: 'var(--muted)' }}>Action
                    <input value={testAction} onChange={e => setTestAction(e.target.value)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, marginTop: 2 }} />
                  </label>
                </div>
                <label style={{ fontSize: 10, color: 'var(--muted)' }}>Description
                  <input value={testDesc} onChange={e => setTestDesc(e.target.value)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, marginTop: 2 }} />
                </label>
                <button onClick={sendTest} disabled={serverStatus !== 'connected' || !policySaved}
                  style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, opacity: serverStatus !== 'connected' || !policySaved ? 0.4 : 1 }}>
                  Send to governance
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Stats bar */}
          <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
              {stats.total > 0 ? (<>
                <span style={{ color: 'var(--muted)' }}>{stats.total} actions</span>
                <span style={{ color: 'var(--green)' }}>{stats.allowed} allowed</span>
                <span style={{ color: 'var(--red)' }}>{stats.blocked} blocked</span>
                {stats.modified > 0 && <span style={{ color: 'var(--yellow)' }}>{stats.modified} modified</span>}
                {stats.penalized > 0 && <span style={{ color: 'var(--orange)' }}>{stats.penalized} penalized</span>}
                {stats.rewarded > 0 && <span style={{ color: 'var(--emerald)' }}>{stats.rewarded} rewarded</span>}
              </>) : <span style={{ color: 'var(--muted)' }}>Governance Observation Deck</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['flow', 'split', 'feed'] as const).map(m => (
                <button key={m} onClick={() => setVizMode(m)}
                  style={{ padding: '2px 8px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: vizMode === m ? 'rgba(139,92,246,0.2)' : 'transparent', color: vizMode === m ? 'var(--primary)' : 'var(--muted)' }}>
                  {m === 'flow' ? 'Visual' : m === 'feed' ? 'Feed' : 'Split'}
                </button>
              ))}
            </div>
          </div>

          {/* Viz canvas */}
          {(vizMode === 'flow' || vizMode === 'split') && (
            <div style={{ height: vizMode === 'flow' ? '100%' : 300, flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <GovernanceFlowViz rules={vizRules} events={events} className="" />
            </div>
          )}

          {/* Event feed */}
          {vizMode !== 'flow' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {events.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
                  {serverStatus !== 'connected' ? 'Start the governance server to begin' : !policySaved ? 'Write and save your governance rules' : 'Waiting for agent activity...'}
                </div>
              ) : events.map(event => (
                <div key={event.id} style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', padding: 10, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(event.verdict?.status), marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{interpretBehavior(event)}</div>
                      {event.action?.description && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{event.action.description}</div>}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--dim)', flexShrink: 0 }}>{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
