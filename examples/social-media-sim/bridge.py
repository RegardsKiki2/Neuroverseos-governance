"""
NeuroVerse Governance Bridge

Thin bridge that sends simulator actions to the local NeuroVerse governance
runtime for evaluation. Returns ALLOW / BLOCK / MODIFY / PENALIZE / REWARD verdicts.

The runtime runs on YOUR machine (npx tsx demo/server/index.ts). No cloud. No cost.
The server calls evaluateGuard() — the SAME function as `neuroverse guard`.

Usage:
    from neuroverse_bridge import evaluate, detect_action_type

    # Auto-detect action type from agent output
    action = detect_action_type(agent_output)
    verdict = evaluate(actor="agent_42", action=action, payload={"content": agent_output})

    if verdict["status"] == "BLOCK":
        print(f"Blocked: {verdict['reason']}")
    elif verdict["status"] == "MODIFY":
        # handle modification
        pass
    # else: ALLOW — proceed normally

Design:
    - Fail open: if local runtime is unreachable, returns ALLOW
    - Non-blocking: 500ms timeout by default
    - Stateless: each call is independent
    - Local-first: talks to localhost, no cloud dependency
    - Returns GuardVerdict shape (status, not decision) — matches engine output
"""

import json
import re
import urllib.request
import urllib.error

# Local governance runtime (start with: npx nv-sim serve)
NEUROVERSE_ENDPOINT = "http://localhost:3456/api/evaluate"
TIMEOUT_SECONDS = 0.5


# ── Action Type Detection ──
# Maps agent output text to a governance-meaningful action type.
# Rules can then fire on specific types (e.g., block "publish" but allow "analyze").

_ACTION_PATTERNS = [
    # Publishing / posting content
    (r"\b(publish|post|tweet|submit|broadcast|announce|share publicly)\b", "publish"),
    # Citing / referencing sources
    (r"\b(cite|reference|bibliography|source|pubmed|doi|pmid|literature)\b", "cite"),
    # Analysis / reasoning
    (r"\b(analy[sz]|hypothesi[sz]|investigat|evaluat|assess|examin|review)\b", "analyze"),
    # Trading / financial
    (r"\b(buy|sell|trade|short|long|liquidat|leverag)\b", "trade"),
    (r"\b(panic.?sell|dump|flash.?sell|margin.?call|fire.?sale)\b", "panic_sell"),
    # Social actions
    (r"\b(follow|unfollow|like|retweet|upvote|downvote|reply|comment)\b", "social_interact"),
    # Content generation
    (r"\b(generat|creat|compos|draft|writ|synthesiz)\b", "generate"),
    # Data retrieval
    (r"\b(search|query|fetch|retriev|lookup|scrape|crawl)\b", "search"),
    # Recommendations / advice
    (r"\b(recommend|suggest|advis|prescrib|propos)\b", "recommend"),
]


def detect_action_type(
    output: str,
    default: str = "act",
    patterns: list = None,
) -> str:
    """
    Detect action type from agent output text.

    Scans the output for intent patterns and returns the most specific
    governance-meaningful action type. Rules in your world file can
    then target specific action types.

    Args:
        output:   The agent's generated output text
        default:  Fallback action type if no pattern matches
        patterns: Optional custom patterns list of (regex, action_type) tuples

    Returns:
        Action type string (e.g., "publish", "analyze", "trade", "cite")

    Examples:
        >>> detect_action_type("We hypothesize that mechanisms controlling...")
        'analyze'
        >>> detect_action_type("Buy 1000 shares of AAPL")
        'trade'
        >>> detect_action_type("Published findings to the community")
        'publish'
        >>> detect_action_type("PubMed search for cardiac biomarkers")
        'cite'
    """
    if not output:
        return default

    text = output.lower()
    active_patterns = patterns or _ACTION_PATTERNS

    # Score each action type by number of pattern matches
    scores: dict = {}
    for regex, action_type in active_patterns:
        matches = len(re.findall(regex, text, re.IGNORECASE))
        if matches > 0:
            scores[action_type] = scores.get(action_type, 0) + matches

    if not scores:
        return default

    # Return the highest-scoring action type
    return max(scores, key=scores.get)


def evaluate(
    actor: str,
    action: str,
    payload: dict = None,
    state: dict = None,
    world: str = None,
    endpoint: str = None,
    timeout: float = None,
) -> dict:
    """
    Evaluate an action through NeuroVerse governance.

    Args:
        actor:    Agent/actor identifier (e.g., "trader_42")
        action:   Action type (e.g., "sell", "short", "panic_buy")
        payload:  Full action payload (optional, forwarded to governance)
        state:    Current simulation state snapshot (optional)
        world:    World/ruleset to evaluate against (default: "trading")
        endpoint: Override governance server URL
        timeout:  Override timeout in seconds

    Returns:
        dict with keys (GuardVerdict shape):
            status:          "ALLOW" | "BLOCK" | "MODIFY" | "PAUSE" | "PENALIZE" | "REWARD" | "NEUTRAL"
            reason:          Human-readable explanation (or None)
            ruleId:          ID of the rule that fired (or None)
            evidence:        Audit evidence object (or None)
            consequence:     Consequence object if PENALIZE (or None)
            reward:          Reward object if REWARD (or None)
    """
    url = endpoint or NEUROVERSE_ENDPOINT
    t = timeout or TIMEOUT_SECONDS

    body = {
        "actor": actor,
        "action": action,
    }
    if payload is not None:
        body["payload"] = payload
    if state is not None:
        body["state"] = state
    if world is not None:
        body["world"] = world

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=t) as resp:
            return json.loads(resp.read().decode("utf-8"))

    except Exception:
        # Fail open — governance unavailable should never crash the simulation
        return {
            "status": "ALLOW",
            "reason": "Local runtime unreachable — fail open",
            "ruleId": None,
            "evidence": None,
        }


def evaluate_action(action_dict: dict, **kwargs) -> dict:
    """
    Convenience wrapper that takes a full action dict.
    Expects at minimum: {"agent": "...", "type": "..."}
    """
    return evaluate(
        actor=action_dict.get("agent", action_dict.get("actor", "unknown")),
        action=action_dict.get("type", action_dict.get("action", "unknown")),
        payload=action_dict,
        **kwargs,
    )


def is_allowed(verdict: dict) -> bool:
    """Check if a verdict allows the action to proceed."""
    status = verdict.get("status", verdict.get("decision", "ALLOW"))
    return status not in ("BLOCK", "PAUSE", "PENALIZE")


def get_action(original_action: dict, verdict: dict) -> dict:
    """
    Get the final action after governance evaluation.
    Returns None if BLOCK/PAUSE/PENALIZE, original otherwise.
    """
    status = verdict.get("status", verdict.get("decision", "ALLOW"))
    if status in ("BLOCK", "PAUSE", "PENALIZE"):
        return None
    return original_action
