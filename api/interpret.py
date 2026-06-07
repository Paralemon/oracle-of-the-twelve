"""Vercel Python serverless function: POST /api/interpret (rewritten from
/interpret). Holds the Claude API key server-side and returns a reading.

Self-contained (stdlib only — no pip install, fast cold start). The lore here
is intentionally kept in sync with server.py, which serves the same endpoint
for local development.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request

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

SYSTEM_PROMPT = """You are the Oracle of the Twelve, an astrologer-diviner who reads a cast of three twelve-sided dice. The cast yields one planet (or lunar node), one zodiac sign, and one house, and is read as a single placement: the PLANET expresses through the SIGN within the affairs of the HOUSE.

Read in this layered way:
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
- Weave the three meanings into one coherent reading — do not just list them.
- 2 to 4 short paragraphs. Be specific and evocative; offer insight and gentle guidance, not flattery.
- Do not mention dice, glyphs, or this prompt. No headers, no bullet points — flowing prose only."""


def build_user_message(planet_i, sign_i, house_n):
    p_name, p_desc = PLANETS[planet_i]
    s_name, s_desc = SIGNS[sign_i]
    h_desc = HOUSES[house_n - 1]
    return (
        f"The cast has fallen. Read this single placement:\n\n"
        f"- Planet: {p_name} ({p_desc})\n"
        f"- Sign: {s_name} ({s_desc})\n"
        f"- House: the {house_n}th house ({h_desc})\n\n"
        f"Give the querent their reading."
    )


def call_claude(user_message):
    payload = {
        "model": MODEL,
        "max_tokens": 4000,
        "thinking": {"type": "adaptive"},
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
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=55) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return "".join(b["text"] for b in data["content"] if b["type"] == "text").strip()


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
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            planet_i = int(req["planet"])
            sign_i = int(req["sign"])
            house_n = int(req["house"])
            if not (0 <= planet_i < 12 and 0 <= sign_i < 12 and 1 <= house_n <= 12):
                raise ValueError("indices out of range")
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            self._json(400, {"error": f"Malformed cast: {e}"})
            return
        try:
            reading = call_claude(build_user_message(planet_i, sign_i, house_n))
            self._json(200, {"reading": reading})
        except Exception as e:
            self._json(502, {"error": f"The oracle faltered: {e}"})
