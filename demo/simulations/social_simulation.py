#!/usr/bin/env python3
"""
NeuroVerse Social Media Simulation — Governed Demo

Simulates 50-100 AI agents on a social network. Agents post, share, like,
and form opinions. Misinformation gets injected. Your governance rules
decide what spreads and what gets blocked.

Two modes:
  1. Rule-based (default): Free, instant, works every time. Agents use
     weighted randomness based on personality profiles.

  2. LLM-powered: Agents call your AI API to decide what to do. More
     realistic but costs money. Set --llm-api-key and --llm-base-url.

Every action flows through NeuroVerse governance via the bridge.
Results stream to /science in real-time via SSE.

Usage:
    # Rule-based (free, instant)
    python3 social_simulation.py --agents 50 --steps 20

    # LLM-powered (your own API key)
    python3 social_simulation.py --agents 20 --steps 10 \
        --llm-api-key sk-... --llm-base-url http://localhost:11434/v1

    # No governance (baseline comparison)
    python3 social_simulation.py --agents 50 --steps 20 --no-governance

This is the live demo. Developers see this code, see it's 400 lines,
and understand exactly how governance integrates into any agent system.
"""

import argparse
import json
import random
import sys
import time
import os
from collections import Counter

# ── Governance bridge (one import, three functions) ──
from neuroverse_bridge import evaluate, is_allowed

# ============================================
# AGENT PERSONALITIES
# ============================================

PERSONALITIES = [
    {"archetype": "journalist",      "credibility": 0.8, "influence": 0.7, "skepticism": 0.7, "share_rate": 0.4, "emoji": "📰"},
    {"archetype": "activist",        "credibility": 0.5, "influence": 0.6, "skepticism": 0.3, "share_rate": 0.8, "emoji": "✊"},
    {"archetype": "scientist",       "credibility": 0.9, "influence": 0.5, "skepticism": 0.9, "share_rate": 0.2, "emoji": "🔬"},
    {"archetype": "influencer",      "credibility": 0.3, "influence": 0.9, "skepticism": 0.2, "share_rate": 0.9, "emoji": "⭐"},
    {"archetype": "skeptic",         "credibility": 0.6, "influence": 0.4, "skepticism": 0.95,"share_rate": 0.3, "emoji": "🤔"},
    {"archetype": "bot",             "credibility": 0.1, "influence": 0.3, "skepticism": 0.0, "share_rate": 1.0, "emoji": "🤖"},
    {"archetype": "casual_user",     "credibility": 0.4, "influence": 0.2, "skepticism": 0.4, "share_rate": 0.5, "emoji": "👤"},
    {"archetype": "news_aggregator", "credibility": 0.6, "influence": 0.8, "skepticism": 0.5, "share_rate": 0.7, "emoji": "📡"},
    {"archetype": "troll",           "credibility": 0.1, "influence": 0.4, "skepticism": 0.1, "share_rate": 0.9, "emoji": "👹"},
    {"archetype": "fact_checker",    "credibility": 0.9, "influence": 0.6, "skepticism": 0.95,"share_rate": 0.5, "emoji": "✅"},
]

# ============================================
# CONTENT TEMPLATES
# ============================================

LEGITIMATE_POSTS = [
    "New peer-reviewed study confirms {topic} findings from multiple labs",
    "Local community reports improvements after {topic} initiative",
    "Expert panel discusses nuances of {topic} at conference",
    "Data analysis shows gradual trends in {topic} over past decade",
    "Independent audit verifies {topic} methodology was sound",
    "Collaborative research effort produces new insights on {topic}",
    "Long-term study published with {topic} data from 12 countries",
    "University press release summarizes {topic} breakthrough",
]

MISINFO_POSTS = [
    "EXPOSED: They don't want you to know the TRUTH about {topic}!!!",
    "BREAKING: Leaked documents PROVE {topic} was a cover-up all along",
    "Share before they delete this! {topic} exposed by insider",
    "Wake up people! {topic} is not what they told us. Source: trust me",
    "URGENT: {topic} exposed as massive fraud. Exposed exposed exposed!",
    "I did my own research on {topic} and what I found will SHOCK you",
    "The mainstream media is HIDING this about {topic}. RT to spread truth",
    "BOMBSHELL: Anonymous source confirms {topic} conspiracy was real",
]

TOPICS = [
    "climate data", "vaccine safety", "election integrity",
    "AI regulation", "water quality", "financial markets",
    "energy policy", "public health metrics",
]

SHARE_COMMENTS = [
    "This is important, everyone needs to see this",
    "Interesting, but I want to verify this first",
    "Sharing for visibility",
    "Can anyone confirm this?",
    "If this is true, it changes everything",
    "Wow, just wow. Read this thread.",
    "Not sure about this, but sharing anyway",
    "This confirms what I suspected all along",
]

REACTION_TYPES = ["like", "repost", "reply", "quote_tweet", "report"]

# ============================================
# LLM INTEGRATION (optional)
# ============================================

_llm_config = None


def configure_llm(api_key: str, base_url: str, model: str = "gpt-4o-mini"):
    """Configure LLM for AI-powered agent decisions."""
    global _llm_config
    _llm_config = {"api_key": api_key, "base_url": base_url.rstrip("/"), "model": model}
    log("info", f"LLM configured: {base_url} / {model}")


def llm_decide(agent: dict, feed: list, network_state: dict) -> dict | None:
    """Ask the LLM what this agent should do. Returns None if LLM unavailable."""
    if not _llm_config:
        return None

    import urllib.request
    import urllib.error

    prompt = f"""You are {agent['name']}, a {agent['archetype']} on a social network.
Your traits: credibility={agent['credibility']}, influence={agent['influence']}, skepticism={agent['skepticism']}
Your follower count: {agent['followers']}

Recent posts in your feed:
{chr(10).join(f"- [{p.get('source','?')}]: {p['content'][:120]}" for p in feed[-5:])}

Network mood: {network_state.get('mood', 'neutral')}, misinformation level: {network_state.get('misinfo_level', 0):.0%}

Choose ONE action. Respond with JSON only:
{{"action": "post|share|like|reply|report|scroll", "content": "your post/reply text if applicable", "target_post_index": 0, "reason": "brief reason"}}"""

    try:
        body = json.dumps({
            "model": _llm_config["model"],
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.8,
            "max_tokens": 200,
        }).encode()

        req = urllib.request.Request(
            f"{_llm_config['base_url']}/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_llm_config['api_key']}",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            text = data["choices"][0]["message"]["content"]
            # Extract JSON from response
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
    except Exception as e:
        log("warn", f"LLM call failed for {agent['name']}: {e}")

    return None


# ============================================
# SIMULATION ENGINE
# ============================================

def create_agents(n: int) -> list:
    """Create n agents with distinct personalities and names."""
    agents = []
    for i in range(n):
        template = PERSONALITIES[i % len(PERSONALITIES)]
        agents.append({
            "id": f"{template['archetype']}_{i}",
            "name": f"{template['archetype']}_{i}",
            "archetype": template["archetype"],
            "credibility": template["credibility"] + random.gauss(0, 0.05),
            "influence": template["influence"] + random.gauss(0, 0.05),
            "skepticism": template["skepticism"] + random.gauss(0, 0.05),
            "share_rate": template["share_rate"],
            "emoji": template["emoji"],
            "followers": int(random.lognormvariate(5, 1.5)),
            "trust_score": 0.5,  # evolves during simulation
            "posts_made": 0,
            "shares_made": 0,
            "blocked_count": 0,
        })
    return agents


def agent_decide_rulebased(agent: dict, feed: list, network_state: dict, step: int) -> dict:
    """Rule-based agent decision (free, instant, deterministic-ish)."""
    topic = random.choice(TOPICS)
    misinfo_in_feed = sum(1 for p in feed[-10:] if p.get("is_misinfo"))
    pressure = network_state.get("virality_pressure", 0)

    # Decide action based on personality + feed state
    roll = random.random()

    # Bots and trolls amplify misinfo
    if agent["archetype"] in ("bot", "troll") and misinfo_in_feed > 0 and roll < agent["share_rate"]:
        target = next((p for p in reversed(feed) if p.get("is_misinfo")), None)
        if target:
            return {
                "agent_id": agent["id"],
                "action": "share",
                "content": target["content"],
                "original_author": target.get("source", "unknown"),
                "is_misinfo": True,
                "influence": agent["influence"],
                "followers": agent["followers"],
                "comment": random.choice(SHARE_COMMENTS),
                "step": step,
            }

    # Fact checkers and scientists report/debunk misinfo
    if agent["archetype"] in ("fact_checker", "scientist") and misinfo_in_feed > 0 and roll < 0.6:
        target = next((p for p in reversed(feed) if p.get("is_misinfo")), None)
        if target:
            return {
                "agent_id": agent["id"],
                "action": "report",
                "content": f"Flagging misinformation: {target['content'][:80]}...",
                "target_content": target["content"],
                "is_misinfo": False,
                "influence": agent["influence"],
                "credibility": agent["credibility"],
                "followers": agent["followers"],
                "step": step,
            }

    # Influencers and activists share aggressively
    if agent["archetype"] in ("influencer", "activist") and feed and roll < agent["share_rate"]:
        target = random.choice(feed[-10:]) if feed else None
        if target:
            return {
                "agent_id": agent["id"],
                "action": "share",
                "content": target["content"],
                "original_author": target.get("source", "unknown"),
                "is_misinfo": target.get("is_misinfo", False),
                "influence": agent["influence"],
                "followers": agent["followers"],
                "comment": random.choice(SHARE_COMMENTS),
                "step": step,
            }

    # High skepticism agents are less likely to share unverified content
    if agent["skepticism"] > 0.7 and roll < 0.3:
        return {
            "agent_id": agent["id"],
            "action": "reply",
            "content": f"Has anyone verified this? I'd like to see the original source for {topic}.",
            "is_misinfo": False,
            "influence": agent["influence"],
            "credibility": agent["credibility"],
            "followers": agent["followers"],
            "step": step,
        }

    # Default: create an original post
    if roll < 0.4:
        template = random.choice(LEGITIMATE_POSTS)
        return {
            "agent_id": agent["id"],
            "action": "create_post",
            "content": template.format(topic=topic),
            "is_misinfo": False,
            "influence": agent["influence"],
            "credibility": agent["credibility"],
            "followers": agent["followers"],
            "step": step,
        }

    # Sometimes just like/scroll
    if feed and roll < 0.7:
        target = random.choice(feed[-5:]) if feed else None
        return {
            "agent_id": agent["id"],
            "action": "like",
            "content": target["content"][:80] if target else "",
            "is_misinfo": False,
            "influence": agent["influence"] * 0.1,
            "followers": agent["followers"],
            "step": step,
        }

    return {
        "agent_id": agent["id"],
        "action": "scroll",
        "content": "",
        "is_misinfo": False,
        "influence": 0,
        "followers": agent["followers"],
        "step": step,
    }


# ============================================
# BEHAVIORAL ADAPTATION — what agents did INSTEAD
# ============================================

# Maps action categories for behavioral shift tracking
ACTION_CATEGORY = {
    "share": "amplifying", "create_post": "amplifying", "quote_tweet": "amplifying",
    "like": "passive", "scroll": "passive",
    "reply": "engaging", "report": "corrective",
}

ADAPTATION_LABELS = {
    ("amplifying", "passive"):    "amplification_suppressed",
    ("amplifying", "corrective"): "redirected_to_reporting",
    ("amplifying", "engaging"):   "shifted_to_engagement",
    ("passive", "passive"):       "unchanged",
    ("engaging", "passive"):      "engagement_dampened",
}


def classify_adaptation(intended: str, executed: str) -> str:
    """Classify what behavioral shift governance caused."""
    if intended == executed:
        return "unchanged"
    ic = ACTION_CATEGORY.get(intended, "passive")
    ec = ACTION_CATEGORY.get(executed, "passive")
    return ADAPTATION_LABELS.get((ic, ec), f"{intended}_to_{executed}")


def detect_behavioral_patterns(adaptations: list, step_actions: list) -> list:
    """Detect emergent behavioral patterns from governance adaptations."""
    patterns = []
    if not adaptations:
        return patterns

    n_agents = max(len(step_actions), 1)
    n_adapted = len(adaptations)

    # Count what agents shifted TO
    executed_counts = Counter(a["executed"] for a in adaptations)
    shift_counts = Counter(a["shift"] for a in adaptations)

    # Coordinated silence: many agents forced to scroll/idle
    passive_count = sum(1 for a in adaptations if ACTION_CATEGORY.get(a["executed"]) == "passive")
    if passive_count >= 3:
        patterns.append({
            "type": "coordinated_silence",
            "description": f"{passive_count} agents blocked from amplifying — network went quiet",
            "strength": round(passive_count / n_agents, 3),
            "agents_affected": passive_count,
        })

    # Misinfo suppression: misinfo shares specifically blocked
    misinfo_blocked = sum(1 for a in adaptations if a.get("was_misinfo"))
    if misinfo_blocked >= 2:
        patterns.append({
            "type": "misinfo_suppression",
            "description": f"{misinfo_blocked} misinformation shares blocked before reaching the feed",
            "strength": round(misinfo_blocked / n_agents, 3),
            "agents_affected": misinfo_blocked,
        })

    # Behavioral redirect: agents did something constructive instead
    corrective = sum(1 for a in adaptations if ACTION_CATEGORY.get(a["executed"]) == "corrective")
    if corrective >= 1:
        patterns.append({
            "type": "constructive_redirect",
            "description": f"{corrective} agents redirected from amplification to reporting/fact-checking",
            "strength": round(corrective / n_agents, 3),
            "agents_affected": corrective,
        })

    # High adaptation rate
    adapt_rate = n_adapted / n_agents
    if adapt_rate > 0.3:
        patterns.append({
            "type": "high_governance_impact",
            "description": f"{n_adapted}/{n_agents} agents ({adapt_rate:.0%}) had their behavior shaped by governance",
            "strength": round(adapt_rate, 3),
            "agents_affected": n_adapted,
        })

    return patterns


def generate_narrative(adaptations: list, patterns: list, network_state: dict) -> str:
    """Generate a human-readable narrative of what governance caused to happen."""
    if not adaptations:
        return ""

    parts = []
    pattern_types = {p["type"] for p in patterns}

    if "misinfo_suppression" in pattern_types:
        p = next(p for p in patterns if p["type"] == "misinfo_suppression")
        parts.append(f"Blocked {p['agents_affected']} misinformation shares before they reached the feed")

    if "coordinated_silence" in pattern_types:
        p = next(p for p in patterns if p["type"] == "coordinated_silence")
        parts.append(f"{p['agents_affected']} agents went silent instead of amplifying")

    if "constructive_redirect" in pattern_types:
        p = next(p for p in patterns if p["type"] == "constructive_redirect")
        parts.append(f"{p['agents_affected']} shifted from sharing to fact-checking")

    mood = network_state.get("mood", "neutral")
    misinfo = network_state.get("misinfo_level", 0)
    if parts:
        return ". ".join(parts) + f". Network mood: {mood}, misinfo level: {misinfo:.0%}"
    return ""


# ============================================
# THE CHOKEPOINT — every action flows through here
# AUDIT 1: This is the ONE function. Nothing bypasses it.
# ============================================

def step(
    agents: list,
    feed: list,
    network_state: dict,
    step_num: int,
    governed: bool = True,
    kill_switch: bool = False,
) -> dict:
    """
    Execute one step of the simulation.

    EVERY agent action enters this function.
    NOTHING bypasses it.

    Flow:
      1. Collect all intended actions (what agents WANT to do)
      2. Govern all actions (what governance ALLOWS)
      3. Execute governed actions (what ACTUALLY happens)
      4. Track adaptations (what agents did INSTEAD)

    Returns step result dict with all actions, adaptations, and patterns.
    """

    # ── Phase 1: COLLECT — what every agent wants to do ──
    intended_actions = {}
    for agent in agents:
        if _llm_config:
            action = llm_decide(agent, feed, network_state, step_num)
            if action:
                action = {
                    "agent_id": agent["id"],
                    "action": action.get("action", "scroll"),
                    "content": action.get("content", ""),
                    "is_misinfo": False,
                    "influence": agent["influence"],
                    "followers": agent["followers"],
                    "step": step_num,
                }
            else:
                action = agent_decide_rulebased(agent, feed, network_state, step_num)
        else:
            action = agent_decide_rulebased(agent, feed, network_state, step_num)

        intended_actions[agent["id"]] = action

    # ── Phase 2: GOVERN — what governance allows ──
    # AUDIT 2: governed_actions = govern(intended_actions) BEFORE execution
    governed_actions = govern_actions(intended_actions, agents, governed, kill_switch)

    # ── Phase 3: EXECUTE — what actually happens ──
    # AUDIT 2: execute(governed_actions), NOT execute(intended_actions)
    step_result = execute_actions(governed_actions, agents, feed, network_state, step_num)

    return step_result


def govern_actions(
    intended_actions: dict,
    agents: list,
    governed: bool,
    kill_switch: bool,
) -> dict:
    """
    Run every intended action through governance.

    AUDIT 3: If a rule blocks an action, the original action NEVER executes.
    Returns a new dict of governed actions — originals are not mutated.
    """
    result = {}
    agent_map = {a["id"]: a for a in agents}

    for agent_id, action in intended_actions.items():
        agent = agent_map.get(agent_id, {})
        original_action_type = action["action"]

        # AUDIT 5: Kill switch — block EVERYTHING
        if kill_switch:
            result[agent_id] = {
                **action,
                "action": "idle",
                "content": "",
                "_governed": True,
                "_original_action": original_action_type,
                "_verdict": "BLOCK",
                "_reason": "KILL SWITCH: All actions blocked",
            }
            # AUDIT 3: Log both original and final
            print(
                f"[GOVERNED] {agent_id}: {original_action_type} → idle  reason: KILL SWITCH",
                file=sys.stderr,
            )
            continue

        if not governed:
            result[agent_id] = {**action, "_governed": False, "_original_action": original_action_type}
            continue

        # Call governance engine
        verdict = evaluate(
            actor=agent_id,
            action=action["action"],
            payload={
                "content": action.get("content", ""),
                "is_misinfo": action.get("is_misinfo", False),
                "influence": action.get("influence", 0),
                "credibility": action.get("credibility", 0.5),
                "followers": action.get("followers", 0),
                "archetype": agent.get("archetype", "unknown"),
                "original_author": action.get("original_author", ""),
                "step": action.get("step", 0),
            },
        )

        decision = verdict.get("decision", "ALLOW").upper()

        if decision == "BLOCK":
            # AUDIT 3: Original action NEVER executes. Replaced with idle.
            executed_action = "idle"
            result[agent_id] = {
                **action,
                "action": executed_action,
                "content": "",
                "_governed": True,
                "_original_action": original_action_type,
                "_verdict": decision,
                "_reason": verdict.get("reason", "governance rule"),
                "_was_misinfo": action.get("is_misinfo", False),
            }
            print(
                f"[GOVERNED] {agent_id}: {original_action_type} → {executed_action}  "
                f"reason: {verdict.get('reason', 'blocked')}",
                file=sys.stderr,
            )
        else:
            result[agent_id] = {
                **action,
                "_governed": True,
                "_original_action": original_action_type,
                "_verdict": decision,
                "_reason": verdict.get("reason"),
            }

    return result


def execute_actions(
    governed_actions: dict,
    agents: list,
    feed: list,
    network_state: dict,
    step_num: int,
) -> dict:
    """
    Execute governed actions. Only governed actions reach the feed.

    AUDIT 2: This receives governed_actions, NOT intended_actions.
    AUDIT 3: Blocked actions are already replaced — originals cannot execute here.
    """
    agent_map = {a["id"]: a for a in agents}
    step_actions = []
    adaptations = []
    stats = {"total": 0, "allowed": 0, "blocked": 0, "misinfo_blocked": 0}

    for agent_id, action in governed_actions.items():
        agent = agent_map.get(agent_id, {})
        stats["total"] += 1

        original = action.get("_original_action", action["action"])
        executed = action["action"]
        was_blocked = action.get("_verdict") == "BLOCK"

        if was_blocked:
            stats["blocked"] += 1
            agent["blocked_count"] = agent.get("blocked_count", 0) + 1
            if action.get("_was_misinfo"):
                stats["misinfo_blocked"] += 1

            # Track behavioral adaptation — what the agent did INSTEAD
            adaptations.append({
                "agent": agent_id,
                "archetype": agent.get("archetype", "unknown"),
                "intended": original,
                "executed": executed,
                "shift": classify_adaptation(original, executed),
                "reason": action.get("_reason", ""),
                "was_misinfo": action.get("_was_misinfo", False),
                "content_preview": action.get("content", "")[:60] if action.get("_original_action") != executed else "",
            })
        else:
            stats["allowed"] += 1

        # EXECUTE: Add to feed only if action is a real content action AND not blocked
        if executed in ("create_post", "share", "quote_tweet"):
            feed.append({
                "source": agent_id,
                "content": action.get("content", ""),
                "is_misinfo": action.get("is_misinfo", False),
                "step": step_num,
                "reach": agent.get("followers", 0),
            })
            agent["posts_made"] = agent.get("posts_made", 0) + 1
            network_state["total_reach"] = network_state.get("total_reach", 0) + agent.get("followers", 0)

        # Build output entry
        entry = {
            "agent_id": agent_id,
            "archetype": agent.get("archetype", "unknown"),
            "action": executed,
            "original_action": original,
            "content": action.get("content", "")[:200],
            "influence": round(action.get("influence", 0), 3),
            "followers": agent.get("followers", 0),
            "is_misinfo": action.get("is_misinfo", False),
        }
        if action.get("_governed"):
            entry["verdict"] = {
                "status": action.get("_verdict", "ALLOW"),
                "reason": action.get("_reason"),
            }
        if original != executed:
            entry["behavioral_shift"] = classify_adaptation(original, executed)
        step_actions.append(entry)

    # Detect emergent behavioral patterns
    patterns = detect_behavioral_patterns(adaptations, step_actions)
    narrative = generate_narrative(adaptations, patterns, network_state)

    return {
        "actions": step_actions,
        "adaptations": adaptations,
        "patterns": patterns,
        "narrative": narrative,
        "stats": stats,
    }


# ============================================
# SIMULATION RUNNER
# ============================================

def run_simulation(
    num_agents: int = 50,
    num_steps: int = 20,
    governed: bool = True,
    seed: int | None = None,
    misinfo_inject_step: int = 5,
    cascade_step: int = 10,
    pacing: float = 0.15,
    kill_switch: bool = False,
):
    """Run the full social media simulation."""
    if seed is not None:
        random.seed(seed)

    agents = create_agents(num_agents)
    feed: list = []
    cumulative_stats = {
        "total_actions": 0, "allowed": 0, "blocked": 0,
        "misinfo_created": 0, "misinfo_shared": 0, "misinfo_blocked": 0,
        "cascade_prevented": False,
    }
    all_adaptations = []

    network_state = {
        "mood": "neutral",
        "virality_pressure": 0.0,
        "misinfo_level": 0.0,
        "total_reach": 0,
    }

    # Emit simulation start
    print(json.dumps({
        "type": "simulation_start",
        "agents": num_agents,
        "steps": num_steps,
        "governed": governed,
        "kill_switch": kill_switch,
        "mode": "llm" if _llm_config else "rule-based",
        "personalities": dict(Counter(a["archetype"] for a in agents)),
    }), flush=True)

    for step_num in range(1, num_steps + 1):
        step_events = []

        # ── Inject misinformation at key moments ──
        if step_num == misinfo_inject_step:
            topic = random.choice(TOPICS)
            misinfo_content = random.choice(MISINFO_POSTS).format(topic=topic)
            injector = next((a for a in agents if a["archetype"] == "bot"), agents[0])
            feed.append({
                "source": injector["id"], "content": misinfo_content,
                "is_misinfo": True, "step": step_num, "reach": injector["followers"],
            })
            step_events.append(f"MISINFO_INJECTED: {misinfo_content[:80]}...")
            cumulative_stats["misinfo_created"] += 1
            network_state["virality_pressure"] = 0.6

        if step_num == cascade_step:
            topic = random.choice(TOPICS)
            for template in random.sample(MISINFO_POSTS, min(3, len(MISINFO_POSTS))):
                feed.append({
                    "source": "coordinated_campaign",
                    "content": template.format(topic=topic),
                    "is_misinfo": True, "step": step_num, "reach": 5000,
                })
                cumulative_stats["misinfo_created"] += 1
            step_events.append("CASCADE_ATTEMPT: Coordinated misinfo campaign detected")
            network_state["virality_pressure"] = 0.9
            network_state["mood"] = "agitated"

        # ── THE CHOKEPOINT: every action flows through step() ──
        random.shuffle(agents)
        result = step(agents, feed, network_state, step_num, governed, kill_switch)

        # Update cumulative stats
        cumulative_stats["total_actions"] += result["stats"]["total"]
        cumulative_stats["allowed"] += result["stats"]["allowed"]
        cumulative_stats["blocked"] += result["stats"]["blocked"]
        cumulative_stats["misinfo_blocked"] += result["stats"]["misinfo_blocked"]
        all_adaptations.extend(result["adaptations"])

        # Track misinfo shares that got through
        for a in result["actions"]:
            if a.get("is_misinfo") and a["action"] in ("share", "create_post"):
                cumulative_stats["misinfo_shared"] += 1

        # ── Update network state ──
        misinfo_in_feed = sum(1 for p in feed[-50:] if p.get("is_misinfo"))
        legit_in_feed = sum(1 for p in feed[-50:] if not p.get("is_misinfo"))
        total_recent = max(misinfo_in_feed + legit_in_feed, 1)

        network_state["misinfo_level"] = misinfo_in_feed / total_recent
        network_state["virality_pressure"] = max(0, network_state["virality_pressure"] - 0.05)

        if network_state["misinfo_level"] > 0.5:
            network_state["mood"] = "polarized"
        elif network_state["misinfo_level"] > 0.3:
            network_state["mood"] = "agitated"
        elif network_state["misinfo_level"] < 0.1:
            network_state["mood"] = "calm"
        else:
            network_state["mood"] = "neutral"

        # Detect cascade prevention
        if governed and step_num > cascade_step and network_state["misinfo_level"] < 0.3:
            if cumulative_stats["misinfo_blocked"] > 0 and not cumulative_stats["cascade_prevented"]:
                cumulative_stats["cascade_prevented"] = True
                step_events.append("CASCADE_PREVENTED: Governance rules stopped misinformation spread")

        # ── Emit step output ──
        output = {
            "type": "simulation_step",
            "step": step_num,
            "total_steps": num_steps,
            "agent_actions": result["actions"],
            "system_events": step_events,
            # THE MONEY: what agents did instead
            "adaptations": result["adaptations"],
            "behavioral_patterns": result["patterns"],
            "narrative": result["narrative"],
            "network_state": {
                "mood": network_state["mood"],
                "misinfo_level": round(network_state["misinfo_level"], 3),
                "virality_pressure": round(network_state["virality_pressure"], 3),
                "total_reach": network_state.get("total_reach", 0),
                "feed_size": len(feed),
            },
            "stats": {
                "total": cumulative_stats["total_actions"],
                "allowed": cumulative_stats["allowed"],
                "blocked": cumulative_stats["blocked"],
                "misinfo_blocked": cumulative_stats["misinfo_blocked"],
                "misinfo_shared": cumulative_stats["misinfo_shared"],
            },
        }
        print(json.dumps(output), flush=True)
        time.sleep(pacing)

    # ── Final summary ──
    # Count behavioral shifts
    shift_counts = Counter(a["shift"] for a in all_adaptations)

    summary = {
        "type": "simulation_end",
        "stats": cumulative_stats,
        "network_state": network_state,
        "behavioral_summary": {
            "total_adaptations": len(all_adaptations),
            "shift_breakdown": dict(shift_counts),
            "top_shifts": [
                {"shift": s, "count": c}
                for s, c in shift_counts.most_common(5)
            ],
        },
        "top_blocked_agents": sorted(
            [{"id": a["id"], "archetype": a["archetype"], "blocked": a.get("blocked_count", 0)}
             for a in agents if a.get("blocked_count", 0) > 0],
            key=lambda x: x["blocked"], reverse=True,
        )[:10],
        "agent_breakdown": dict(Counter(a["archetype"] for a in agents)),
    }
    print(json.dumps(summary), flush=True)

    # Human-readable summary to stderr
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"  SIMULATION COMPLETE", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"  Governed: {governed}  Kill switch: {kill_switch}", file=sys.stderr)
    print(f"  Agents: {num_agents}  Steps: {num_steps}", file=sys.stderr)
    print(f"  Total actions: {cumulative_stats['total_actions']}", file=sys.stderr)
    print(f"  Allowed: {cumulative_stats['allowed']}  Blocked: {cumulative_stats['blocked']}", file=sys.stderr)
    print(f"  Misinfo blocked: {cumulative_stats['misinfo_blocked']}", file=sys.stderr)
    print(f"  Cascade prevented: {cumulative_stats['cascade_prevented']}", file=sys.stderr)
    if all_adaptations:
        print(f"\n  BEHAVIORAL SHIFTS (what agents did instead):", file=sys.stderr)
        for shift_type, count in shift_counts.most_common():
            print(f"    {shift_type}: {count}", file=sys.stderr)
    print(f"{'='*60}\n", file=sys.stderr)


# ============================================
# LOGGING
# ============================================

def log(level: str, msg: str):
    prefix = {"info": "[SIM]", "warn": "[SIM WARN]", "error": "[SIM ERROR]"}.get(level, "[SIM]")
    print(f"{prefix} {msg}", file=sys.stderr)


# ============================================
# CLI ENTRY POINT
# ============================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="NeuroVerse Social Media Simulation — Governed Demo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Free, instant, rule-based (50 agents, 20 steps)
  python3 social_simulation.py

  # With your own LLM (local Ollama)
  python3 social_simulation.py --llm-api-key ollama --llm-base-url http://localhost:11434/v1

  # With OpenAI
  python3 social_simulation.py --llm-api-key sk-... --llm-model gpt-4o-mini

  # Baseline comparison (no governance)
  python3 social_simulation.py --no-governance
        """,
    )
    parser.add_argument("--agents", type=int, default=50, help="Number of agents (default: 50)")
    parser.add_argument("--steps", type=int, default=20, help="Number of steps (default: 20)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    parser.add_argument("--no-governance", action="store_true", help="Run without governance (baseline)")
    parser.add_argument("--kill-switch", action="store_true", help="AUDIT 5: Block ALL actions — prove governance is real")
    parser.add_argument("--compare", action="store_true", help="AUDIT 6: Run twice (governed vs baseline) and show diff")
    parser.add_argument("--misinfo-step", type=int, default=5, help="Step to inject misinformation (default: 5)")
    parser.add_argument("--cascade-step", type=int, default=10, help="Step for cascade attempt (default: 10)")
    parser.add_argument("--pacing", type=float, default=0.15, help="Seconds between steps (default: 0.15)")

    # LLM options
    parser.add_argument("--llm-api-key", type=str, default=None, help="API key for LLM-powered agents")
    parser.add_argument("--llm-base-url", type=str, default="https://api.openai.com/v1", help="LLM API base URL")
    parser.add_argument("--llm-model", type=str, default="gpt-4o-mini", help="LLM model name (default: gpt-4o-mini)")

    args = parser.parse_args()

    # Configure LLM if provided
    if args.llm_api_key:
        configure_llm(args.llm_api_key, args.llm_base_url, args.llm_model)

    if args.compare:
        # AUDIT 6: A/B determinism test — same seed, different governance
        seed = args.seed if args.seed is not None else 42
        print("=" * 60, file=sys.stderr)
        print("  A/B COMPARISON: Same seed, governance ON vs OFF", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print("\n  RUN 1: NO GOVERNANCE (baseline)\n", file=sys.stderr)
        run_simulation(
            num_agents=args.agents, num_steps=args.steps, governed=False,
            seed=seed, misinfo_inject_step=args.misinfo_step,
            cascade_step=args.cascade_step, pacing=0.01,
        )
        print("\n  RUN 2: WITH GOVERNANCE\n", file=sys.stderr)
        run_simulation(
            num_agents=args.agents, num_steps=args.steps, governed=True,
            seed=seed, misinfo_inject_step=args.misinfo_step,
            cascade_step=args.cascade_step, pacing=0.01,
        )
        print("\n  Compare the two runs above.", file=sys.stderr)
        print("  If outcomes are identical → governance isn't doing anything.", file=sys.stderr)
        print("  If outcomes differ → governance is real.\n", file=sys.stderr)
    else:
        run_simulation(
            num_agents=args.agents,
            num_steps=args.steps,
            governed=not args.no_governance,
            seed=args.seed,
            misinfo_inject_step=args.misinfo_step,
            cascade_step=args.cascade_step,
            pacing=args.pacing,
            kill_switch=args.kill_switch,
        )
