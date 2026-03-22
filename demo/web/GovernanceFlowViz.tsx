import { useEffect, useRef, useCallback, useState } from "react";

/**
 * GovernanceFlowViz — Visual proof that governance is real.
 *
 * Agents flow left-to-right as particles.
 * Rules sit as horizontal gates in the middle.
 * Agents that don't trigger any rule flow straight through (most agents).
 * Agents that hit a rule bounce, redirect, or get absorbed.
 *
 * Each particle carries its verdict:
 *   ALLOW  → passes through freely (green trail)
 *   BLOCK  → bounces back / absorbed by rule gate (red flash)
 *   MODIFY → passes through but changes color/size (yellow squeeze)
 *   REWARD → accelerates through with glow (emerald boost)
 *   PENALIZE → slows down, shrinks (orange drag)
 */

interface FlowParticle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  status: "flowing" | "allowed" | "blocked" | "modified" | "rewarded" | "penalized";
  agentId: string;
  archetype: string;
  originalAction: string;
  executedAction: string;
  ruleHit: string | null;
  ifThenRule: string | null; // IF condition that was checked
  thenOutcome: string | null; // THEN what happened instead
  opacity: number;
  trail: { x: number; y: number }[];
  age: number;
  targetGateY: number | null;
  phase: "approaching" | "deciding" | "resolved"; // tracks if/then decision state
  decisionX: number; // where the fork diamond appears
}

interface RuleGate {
  y: number;
  height: number;
  text: string;
  hits: number;
  flash: number; // 0-1, decays after hit
  color: string;
}

interface GovernanceFlowVizProps {
  rules: string[];
  events: Array<{
    action?: { agentId?: string; type?: string; description?: string };
    verdict?: { status?: string; reason?: string; rulesFired?: Array<{ description?: string }> };
  }>;
  className?: string;
}

const COLORS = {
  allow: "#22c55e",
  block: "#ef4444",
  modify: "#eab308",
  reward: "#10b981",
  penalize: "#f97316",
  flowing: "#64748b",
  rule: "#334155",
  ruleFlash: "#ef4444",
  bg: "#0a0a0a",
  passThrough: "#1e293b",
  text: "#94a3b8",
  decisionDiamond: "#8b5cf6",
  ifBranch: "#f59e0b",
  thenLabel: "#c084fc",
  freeFlow: "#22d3ee",
};

const ARCHETYPE_COLORS: Record<string, string> = {
  journalist: "#3b82f6",
  activist: "#a855f7",
  scientist: "#06b6d4",
  influencer: "#f59e0b",
  skeptic: "#6366f1",
  bot: "#ef4444",
  casual_user: "#64748b",
  news_aggregator: "#8b5cf6",
  troll: "#dc2626",
  fact_checker: "#10b981",
};

export default function GovernanceFlowViz({ rules, events, className }: GovernanceFlowVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<FlowParticle[]>([]);
  const gatesRef = useRef<RuleGate[]>([]);
  const animFrameRef = useRef<number>(0);
  const eventQueueRef = useRef<typeof events>([]);
  const processedCountRef = useRef(0);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Build rule gates when rules change
  useEffect(() => {
    if (!rules.length) {
      gatesRef.current = [];
      return;
    }

    const gateHeight = 28;
    const totalHeight = dimensions.height;
    const usableHeight = totalHeight - 80; // padding top/bottom
    const spacing = usableHeight / (rules.length + 1);

    gatesRef.current = rules.map((text, i) => ({
      y: 40 + spacing * (i + 1),
      height: gateHeight,
      text: text.length > 40 ? text.slice(0, 37) + "..." : text,
      hits: 0,
      flash: 0,
      color: COLORS.rule,
    }));
  }, [rules, dimensions.height]);

  // Queue incoming events
  useEffect(() => {
    if (events.length > processedCountRef.current) {
      const newEvents = events.slice(0, events.length - processedCountRef.current);
      eventQueueRef.current.push(...newEvents);
      processedCountRef.current = events.length;
    }
  }, [events]);

  // Process queued events into particles
  const processEventQueue = useCallback(() => {
    const queue = eventQueueRef.current;
    if (queue.length === 0) return;

    // Process up to 3 events per frame to avoid flooding
    const batch = queue.splice(0, 3);

    for (const event of batch) {
      if (!event.verdict?.status) continue;

      const status = event.verdict.status.toLowerCase() as FlowParticle["status"];
      const agentId = event.action?.agentId ?? "unknown";
      const archetype = agentId.replace(/_\d+$/, "");
      const actionType = event.action?.type ?? "action";
      const ruleDesc = event.verdict.rulesFired?.[0]?.description ?? event.verdict.reason ?? null;

      // Find which gate this rule matches (if any)
      let targetGateY: number | null = null;
      if (ruleDesc && status !== "allowed" && status !== "flowing") {
        const matchedGate = gatesRef.current.find((g) => {
          const gateText = g.text.toLowerCase();
          const ruleText = (ruleDesc ?? "").toLowerCase();
          // Check for keyword overlap
          const gateWords = gateText.split(/\s+/);
          return gateWords.some((w) => w.length > 3 && ruleText.includes(w));
        });
        if (matchedGate) {
          targetGateY = matchedGate.y;
          matchedGate.hits++;
          matchedGate.flash = 1.0;
        }
      }

      // Build if/then labels from rule info
      let ifThenRule: string | null = null;
      let thenOutcome: string | null = null;
      const resolvedStatus = status === "allow" ? "allowed" : status === "block" ? "blocked" : status === "modify" ? "modified" : status === "reward" ? "rewarded" : status === "penalize" ? "penalized" : "allowed";

      if (ruleDesc && resolvedStatus !== "allowed") {
        ifThenRule = ruleDesc.length > 35 ? ruleDesc.slice(0, 32) + "..." : ruleDesc;
        if (resolvedStatus === "blocked") thenOutcome = "→ blocked, goes idle";
        else if (resolvedStatus === "modified") thenOutcome = "→ action adjusted";
        else if (resolvedStatus === "penalized") thenOutcome = "→ influence reduced";
        else if (resolvedStatus === "rewarded") thenOutcome = "→ influence boosted";
      }

      // Spawn particle on the left
      const spawnY = targetGateY ?? 40 + Math.random() * (dimensions.height - 80);
      const hasRule = !!targetGateY;

      const particle: FlowParticle = {
        id: `${agentId}-${Date.now()}-${Math.random()}`,
        x: -10,
        y: spawnY + (Math.random() - 0.5) * 20,
        vx: 2.5 + Math.random() * 1.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: status === "block" ? 5 : status === "reward" ? 7 : 4,
        status: resolvedStatus,
        agentId,
        archetype,
        originalAction: actionType,
        executedAction: status === "block" ? "idle" : actionType,
        ruleHit: ruleDesc,
        ifThenRule,
        thenOutcome,
        opacity: 1,
        trail: [],
        age: 0,
        targetGateY,
        phase: hasRule ? "approaching" : "resolved", // no-rule agents skip decision
        decisionX: 0, // set dynamically based on canvas width
      };

      particlesRef.current.push(particle);
    }
  }, [dimensions.height]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(canvas.parentElement!);
    return () => observer.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = dimensions.width * 2; // retina
    canvas.height = dimensions.height * 2;
    ctx.scale(2, 2);

    const gateX = dimensions.width * 0.45; // where rule gates sit
    const gateWidth = dimensions.width * 0.30;
    const passThroughLane = dimensions.height - 30; // bottom lane for clean pass-throughs

    function draw() {
      if (!ctx) return;
      const { width, height } = dimensions;

      // Clear
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, width, height);

      // ── Zone labels ──
      ctx.fillStyle = COLORS.text;
      ctx.font = "9px monospace";
      ctx.globalAlpha = 0.4;
      ctx.textAlign = "center";
      ctx.fillText("INTENDED", width * 0.15, 16);
      ctx.fillText("RULES", width * 0.6, 16);
      ctx.fillText("EXECUTED", width * 0.88, 16);
      ctx.globalAlpha = 1;

      // ── Free-flow lane (bottom, more prominent) ──
      const laneTop = passThroughLane - 18;
      const laneBottom = passThroughLane + 18;
      // Lane background
      ctx.fillStyle = "rgba(34, 211, 238, 0.03)";
      ctx.fillRect(0, laneTop, width, laneBottom - laneTop);
      // Top border
      ctx.strokeStyle = COLORS.freeFlow;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, laneTop);
      ctx.lineTo(width, laneTop);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Lane label
      ctx.fillStyle = COLORS.freeFlow;
      ctx.globalAlpha = 0.35;
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText("FREE FLOW — no rules triggered", 10, passThroughLane + 4);
      // Arrow indicators along the lane
      ctx.font = "10px monospace";
      for (let ax = 200; ax < width - 100; ax += 120) {
        ctx.fillText("→", ax, passThroughLane + 4);
      }
      ctx.globalAlpha = 1;

      // ── IF/THEN decision zone marker ──
      const decisionZoneX = gateX - 40;
      ctx.strokeStyle = COLORS.decisionDiamond;
      ctx.globalAlpha = 0.08;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(decisionZoneX, 25);
      ctx.lineTo(decisionZoneX, laneTop);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = COLORS.decisionDiamond;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("IF rule applies?", decisionZoneX, 24);
      ctx.globalAlpha = 1;

      // ── Rule gates ──
      const gates = gatesRef.current;
      for (const gate of gates) {
        // Gate flash decay
        gate.flash *= 0.95;

        // Gate background
        const flashIntensity = gate.flash;
        ctx.fillStyle = flashIntensity > 0.1
          ? `rgba(239, 68, 68, ${0.15 + flashIntensity * 0.3})`
          : "rgba(30, 41, 59, 0.6)";
        ctx.fillRect(gateX, gate.y - gate.height / 2, gateWidth, gate.height);

        // Gate border
        ctx.strokeStyle = flashIntensity > 0.1
          ? `rgba(239, 68, 68, ${0.5 + flashIntensity * 0.5})`
          : "rgba(71, 85, 105, 0.4)";
        ctx.lineWidth = flashIntensity > 0.1 ? 2 : 1;
        ctx.strokeRect(gateX, gate.y - gate.height / 2, gateWidth, gate.height);

        // Gate text
        ctx.fillStyle = flashIntensity > 0.1 ? "#fca5a5" : COLORS.text;
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(gate.text, gateX + 8, gate.y + 3);

        // Hit counter
        if (gate.hits > 0) {
          ctx.fillStyle = COLORS.block;
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "right";
          ctx.fillText(`${gate.hits}`, gateX + gateWidth - 6, gate.y + 3);
        }
      }

      // ── Process event queue ──
      processEventQueue();

      // ── Update and draw particles ──
      const particles = particlesRef.current;
      const alive: FlowParticle[] = [];

      for (const p of particles) {
        p.age++;

        // Trail
        if (p.age % 2 === 0) {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 20) p.trail.shift();
        }

        const atGate = p.x >= gateX - 5 && p.x <= gateX + gateWidth + 5;

        // ── Phase transitions for if/then ──
        if (p.decisionX === 0) p.decisionX = decisionZoneX;
        if (p.phase === "approaching" && p.x >= decisionZoneX - 5) {
          p.phase = "deciding";
        }
        if (p.phase === "deciding" && p.x >= decisionZoneX + 20) {
          p.phase = "resolved";
        }

        // ── Movement based on status ──
        if (p.status === "allowed" || p.status === "rewarded") {
          // If this particle has no rule to hit, drift to pass-through lane
          if (!p.targetGateY && p.x < gateX) {
            p.vy += (passThroughLane - p.y) * 0.01;
          }
          p.x += p.vx;
          p.y += p.vy;
          p.vy *= 0.95;
          if (p.status === "rewarded" && atGate) {
            p.vx = Math.min(p.vx * 1.05, 6); // accelerate through
          }
        } else if (p.status === "blocked") {
          if (p.x < gateX + 10) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy *= 0.95;
            // Steer toward the gate
            if (p.targetGateY) {
              p.vy += (p.targetGateY - p.y) * 0.03;
            }
          } else {
            // Hit the gate — bounce back
            p.vx = -Math.abs(p.vx) * 0.3;
            p.x += p.vx;
            p.opacity -= 0.02;
          }
        } else if (p.status === "modified") {
          p.x += p.vx * 0.7; // slower through gate
          p.y += p.vy;
          p.vy *= 0.95;
          if (p.targetGateY) {
            p.vy += (p.targetGateY - p.y) * 0.02;
          }
          if (atGate) {
            p.radius = Math.max(2, p.radius * 0.98); // squeeze through
          }
        } else if (p.status === "penalized") {
          p.x += p.vx * 0.4; // drag
          p.y += p.vy;
          p.vy *= 0.95;
          if (p.targetGateY) {
            p.vy += (p.targetGateY - p.y) * 0.02;
          }
          p.radius = Math.max(2, p.radius * 0.995);
        }

        // Fade out when off screen
        if (p.x > width + 20 || p.x < -50 || p.opacity < 0.05) {
          continue; // dead
        }
        if (p.age > 400) {
          p.opacity -= 0.03;
        }

        // Keep in bounds vertically
        if (p.y < 25) { p.y = 25; p.vy = Math.abs(p.vy); }
        if (p.y > height - 10) { p.y = height - 10; p.vy = -Math.abs(p.vy); }

        // ── Draw trail ──
        if (p.trail.length > 1) {
          const trailColor = p.status === "blocked" ? COLORS.block
            : p.status === "modified" ? COLORS.modify
            : p.status === "rewarded" ? COLORS.reward
            : p.status === "penalized" ? COLORS.penalize
            : COLORS.allow;

          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let i = 1; i < p.trail.length; i++) {
            ctx.lineTo(p.trail[i].x, p.trail[i].y);
          }
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = trailColor;
          ctx.globalAlpha = p.opacity * 0.2;
          ctx.lineWidth = p.radius * 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // ── Draw particle ──
        const color = ARCHETYPE_COLORS[p.archetype] ?? COLORS.flowing;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();

        // Glow for rewarded
        if (p.status === "rewarded") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.reward;
          ctx.globalAlpha = p.opacity * 0.4;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Red ring for blocked
        if (p.status === "blocked" && p.x >= gateX) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.block;
          ctx.globalAlpha = p.opacity * 0.6;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;

        // ── IF/THEN decision diamond ──
        if (p.phase === "deciding" && p.ifThenRule) {
          const dx = p.decisionX;
          const dy = p.y;
          const ds = 6; // diamond half-size
          // Draw diamond
          ctx.beginPath();
          ctx.moveTo(dx, dy - ds);
          ctx.lineTo(dx + ds, dy);
          ctx.lineTo(dx, dy + ds);
          ctx.lineTo(dx - ds, dy);
          ctx.closePath();
          ctx.fillStyle = COLORS.decisionDiamond;
          ctx.globalAlpha = p.opacity * 0.7;
          ctx.fill();
          ctx.strokeStyle = COLORS.decisionDiamond;
          ctx.globalAlpha = p.opacity * 0.9;
          ctx.lineWidth = 1;
          ctx.stroke();
          // "IF" label
          ctx.fillStyle = COLORS.ifBranch;
          ctx.globalAlpha = p.opacity * 0.8;
          ctx.font = "bold 7px monospace";
          ctx.textAlign = "left";
          ctx.fillText("IF", dx + ds + 3, dy - 2);
          // Rule condition
          ctx.fillStyle = COLORS.text;
          ctx.globalAlpha = p.opacity * 0.5;
          ctx.font = "7px monospace";
          ctx.fillText(p.ifThenRule, dx + ds + 14, dy - 2);
          // "THEN" outcome label
          if (p.thenOutcome) {
            ctx.fillStyle = COLORS.thenLabel;
            ctx.globalAlpha = p.opacity * 0.7;
            ctx.font = "bold 7px monospace";
            ctx.fillText("THEN", dx + ds + 3, dy + 8);
            ctx.fillStyle = COLORS.text;
            ctx.globalAlpha = p.opacity * 0.5;
            ctx.font = "7px monospace";
            ctx.fillText(p.thenOutcome, dx + ds + 32, dy + 8);
          }
          ctx.globalAlpha = 1;
        }

        // ── "NO RULE" label for free-flow particles ──
        if (!p.targetGateY && p.phase === "resolved" && p.x > decisionZoneX && p.x < decisionZoneX + 40 && p.age < 60) {
          ctx.fillStyle = COLORS.freeFlow;
          ctx.globalAlpha = p.opacity * 0.5;
          ctx.font = "7px monospace";
          ctx.textAlign = "left";
          ctx.fillText("PASS", p.x + p.radius + 3, p.y + 2);
          ctx.globalAlpha = 1;
        }

        // Label near spawn
        if (p.age < 40 && p.x < gateX * 0.5) {
          ctx.fillStyle = COLORS.text;
          ctx.globalAlpha = Math.min(1, p.age / 15) * 0.6;
          ctx.font = "8px monospace";
          ctx.textAlign = "left";
          ctx.fillText(`${p.archetype}:${p.originalAction}`, p.x + p.radius + 4, p.y + 3);
          ctx.globalAlpha = 1;
        }

        // Label after gate for blocked/modified
        if (p.status === "blocked" && p.x >= gateX - 10 && p.x < gateX + gateWidth && p.opacity > 0.3) {
          ctx.fillStyle = COLORS.block;
          ctx.globalAlpha = 0.7;
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "left";
          ctx.fillText(`→ idle`, p.x + p.radius + 4, p.y + 3);
          ctx.globalAlpha = 1;
        }

        // Show executed action on the right side
        if (p.x > gateX + gateWidth + 10 && p.x < width - 60 && p.age > 30 && p.age < 60) {
          const labelColor = p.status === "blocked" ? COLORS.block
            : p.status === "modified" ? COLORS.modify
            : p.status === "rewarded" ? COLORS.reward
            : COLORS.allow;
          ctx.fillStyle = labelColor;
          ctx.globalAlpha = 0.5;
          ctx.font = "8px monospace";
          ctx.textAlign = "left";
          ctx.fillText(p.executedAction, p.x + p.radius + 4, p.y + 3);
          ctx.globalAlpha = 1;
        }

        alive.push(p);
      }

      particlesRef.current = alive;

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [dimensions, processEventQueue]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
