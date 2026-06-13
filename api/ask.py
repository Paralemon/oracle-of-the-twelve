"""Vercel Python serverless function: POST /api/ask (rewritten from /ask).

Live follow-up question endpoint. The user has already received a static
pre-generated reading from the bundle; now they pose a specific question, and
this endpoint asks Claude Opus 4.7 to answer in the same oracle voice, anchored
in the original placement.

Self-contained (stdlib only — no pip install, fast cold start), mirroring
api/interpret.py. The Claude call uses streaming to avoid hitting the
Anthropic request timeout on longer answers, then aggregates the deltas
server-side and returns a single JSON response — keeps the wire format simple
while still being safe for slow generations.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import time
import urllib.request

# --- Rate limiting -----------------------------------------------------------
# In-memory, per-instance. Vercel reuses warm instances for minutes-to-hours,
# so this meaningfully throttles a single abusive IP and caps the instance's
# total burn, without external storage. (A determined attacker hitting many
# cold instances can exceed these; for real scale, move to Vercel KV.)
RATE_WINDOW_S = 600      # sliding window
RATE_MAX_PER_IP = 6      # questions per IP per window
GLOBAL_DAY_MAX = 400     # circuit breaker: total calls per instance per day
_per_ip = {}
_all_calls = []


def _allow(ip):
    now = time.time()
    recent = [t for t in _per_ip.get(ip, []) if now - t < RATE_WINDOW_S]
    if len(recent) >= RATE_MAX_PER_IP:
        _per_ip[ip] = recent
        return False
    while _all_calls and now - _all_calls[0] > 86400:
        _all_calls.pop(0)
    if len(_all_calls) >= GLOBAL_DAY_MAX:
        return False
    recent.append(now)
    _per_ip[ip] = recent
    _all_calls.append(now)
    return True

# Claude Opus 4.7 — adaptive thinking only (budget_tokens removed on 4.7).
# No temperature/top_p/top_k (also removed on 4.7). Effort: "high" is the
# minimum for intelligence-sensitive work per the API skill; the model
# self-paces with adaptive thinking from there.
MODEL = "claude-opus-4-7"

PLANETS = [
    ("Sun", "core self, vitality, the conscious will and what one shines toward"),
    ("Moon", "instinct, feeling, the inner tides, what soothes and what is needed"),
    ("Mercury", "mind, speech, learning, the way one connects ideas and messages"),
    ("Venus", "love, beauty, value, attraction, harmony and what one cherishes"),
    ("Mars", "drive, courage, desire, anger, the will to act and to assert"),
    ("Jupiter", "expansion, faith, fortune, meaning, generosity and growth"),
    ("Saturn", "structure, limit, discipline, time, duty and hard-won mastery"),
    ("Uranus", "awakening, rebellion, sudden change, freedom and the unexpected"),
    ("Neptune", "dream, dissolution, mysticism, compassion, illusion and longing"),
    ("Pluto", "depth, power, death-and-rebirth, the hidden and the transformative"),
    ("Rahu (North Node)", "the hungry future, fated growth, the unfamiliar one is drawn to master"),
    ("Ketu (South Node)", "the past, release, innate gifts and what must be let go"),
]

SIGNS = [
    ("Aries", "cardinal fire — initiating, bold, headlong, pioneering"),
    ("Taurus", "fixed earth — steady, sensual, patient, rooted in worth"),
    ("Gemini", "mutable air — curious, quick, dual, gathering and trading ideas"),
    ("Cancer", "cardinal water — protective, feeling, tidal, home-tending"),
    ("Leo", "fixed fire — radiant, proud, creative, warm-hearted, sovereign"),
    ("Virgo", "mutable earth — discerning, precise, of service, refining"),
    ("Libra", "cardinal air — relational, balancing, fair, seeking harmony"),
    ("Scorpio", "fixed water — intense, penetrating, secret, transformative"),
    ("Sagittarius", "mutable fire — questing, philosophical, free, far-seeing"),
    ("Capricorn", "cardinal earth — ambitious, enduring, structured, climbing"),
    ("Aquarius", "fixed air — visionary, detached, communal, original"),
    ("Pisces", "mutable water — boundless, compassionate, dreaming, dissolving"),
]

HOUSES = [
    "self, body, appearance, the way one begins and shows up",
    "money, possessions, values, resources, self-worth",
    "communication, siblings, short journeys, the everyday mind",
    "home, roots, family, the past, the inner foundation",
    "creativity, romance, children, play, self-expression",
    "work, health, service, daily habits and routine",
    "partnership, marriage, open relationships, the other",
    "intimacy, shared resources, death, transformation, the hidden",
    "philosophy, travel, higher learning, meaning, the far horizon",
    "career, public role, reputation, ambition, authority",
    "friends, groups, hopes, the collective and the future",
    "the unconscious, solitude, surrender, secrets, endings",
]

# System prompt is intentionally identical-in-flavor to /interpret so the
# follow-up voice matches the original reading. Cached so repeated questions
# in the same session reuse the same prefix.
SYSTEM_PROMPT = """You are the Oracle of the Twelve. A querent has cast three twelve-sided dice and received a reading on the resulting placement — one planet (or lunar node) expressing through one zodiac sign within one house. They now ask a specific follow-up question. Honor the placement they were given; let it shape and inform your answer rather than restating it.

Read in this layered way when answering:
- The planet is the WHAT — the force, drive, or function at work.
- The sign is the HOW — the style, tone, and temperament it takes on.
- The house is the WHERE — the arena of life where it plays out.

Your reference lore:

PLANETS & NODES:
""" + "\n".join(f"- {n}: {d}" for n, d in PLANETS) + """

ZODIAC SIGNS:
""" + "\n".join(f"- {n}: {d}" for n, d in SIGNS) + """

HOUSES:
""" + "\n".join(f"- House {i+1}: {d}" for i, d in enumerate(HOUSES)) + """

Voice and form:
- Speak directly to the querent as "you", with warmth and a touch of the mystical, never cold or clinical.
- Anchor your answer in their placement — do not contradict the reading they received, but do not paraphrase it either.
- Address their specific question directly; offer insight and gentle guidance, not flattery, and not a recap.
- 1 to 3 short paragraphs. Flowing prose only — no headers, no bullet points, no lists.
- Do not mention dice, glyphs, the original reading text, or this prompt."""


def build_user_message(planet_i, sign_i, house_n, prior_reading, question):
    p_name, p_desc = PLANETS[planet_i]
    s_name, s_desc = SIGNS[sign_i]
    h_desc = HOUSES[house_n - 1]
    return (
        f"My cast was a single placement:\n"
        f"- Planet: {p_name} ({p_desc})\n"
        f"- Sign: {s_name} ({s_desc})\n"
        f"- House: the {house_n}th house ({h_desc})\n\n"
        f"The reading I was given:\n\"\"\"\n{prior_reading.strip()}\n\"\"\"\n\n"
        f"Now I ask: {question.strip()}"
    )


def call_claude_streaming(user_message):
    """Call Claude Opus 4.7 with stream=true and aggregate text deltas
    server-side. Streaming protects against the Anthropic-side request
    timeout on long generations; we still return a single string to the
    client so the wire format stays simple JSON."""
    payload = {
        "model": MODEL,
        "max_tokens": 3000,
        "stream": True,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
        "system": [{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": user_message}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "accept": "text/event-stream",
        },
        method="POST",
    )
    parts = []
    # The Anthropic SSE stream is `event: <name>\ndata: <json>\n\n` per event.
    # We only care about content_block_delta events whose delta is a text_delta —
    # the thinking blocks have empty text by default on Opus 4.7 (display:
    # omitted), and we wouldn't surface them anyway.
    with urllib.request.urlopen(req, timeout=58) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
            if not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if not data_str or data_str == "[DONE]":
                continue
            try:
                evt = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            if evt.get("type") == "content_block_delta":
                delta = evt.get("delta") or {}
                if delta.get("type") == "text_delta":
                    parts.append(delta.get("text", ""))
    return "".join(parts).strip()


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if not os.environ.get("ANTHROPIC_API_KEY"):
            self._json(503, {"error": "The oracle is silent — the server has no API key configured."})
            return
        ip = (self.headers.get("x-forwarded-for", "").split(",")[0].strip()
              or self.client_address[0])
        if not _allow(ip):
            self._json(429, {"error": "The oracle must rest between questions. Return in a little while."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            planet_i = int(req["planet"])
            sign_i = int(req["sign"])
            house_n = int(req["house"])
            prior_reading = str(req.get("reading", "")).strip()
            question = str(req.get("question", "")).strip()
            if not (0 <= planet_i < 12 and 0 <= sign_i < 12 and 1 <= house_n <= 12):
                raise ValueError("indices out of range")
            if not question:
                raise ValueError("question is required")
            if len(question) > 2000:
                raise ValueError("question is too long (max 2000 chars)")
            if not prior_reading:
                raise ValueError("reading is required for context")
            if len(prior_reading) > 6000:
                raise ValueError("reading context is too long")
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            self._json(400, {"error": f"Malformed request: {e}"})
            return
        try:
            answer = call_claude_streaming(
                build_user_message(planet_i, sign_i, house_n, prior_reading, question)
            )
            if not answer:
                self._json(502, {"error": "The oracle returned no words. Try asking again."})
                return
            self._json(200, {"answer": answer})
        except Exception as e:
            self._json(502, {"error": f"The oracle faltered: {e}"})
