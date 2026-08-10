from anthropic import Anthropic
from dotenv import load_dotenv
import os
import json

load_dotenv()

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def move_caption(move_data: dict) -> str:
    """
    Short, deterministic one-line caption for a critical-move card. No LLM
    call — built directly from the already-verified facts computed in
    chess_analyzer._compute_move_facts, so it can never fabricate or
    misdescribe the position the way a generated explanation could.

    The real information lives in the "Explore best line" feature, which
    plays the engine's actual recommended continuation out on the board
    (computed on demand by explore_line, not here) — this caption is just a
    short label on top of that, not a substitute for it.

    Priority, most concrete signal first:
      1. Your move leaves something hanging right away.
      2. The engine's move wins material yours doesn't.
      3. The engine's move looks like it wins material but gets recaptured.
      4. No tactical signal at all — a quiet positional difference.
    """
    facts = move_data.get("move_facts", {})
    bm = facts.get("best_move")

    if facts.get("hanging_after_played"):
        return "This leaves a piece hanging for free."

    if bm:
        played_wins_material = bool(facts.get("captured"))
        best_wins_material = bool(bm.get("captured")) and not bm.get("recaptured")
        if best_wins_material and not played_wins_material:
            return "The engine's move wins material yours doesn't."
        if bm.get("recaptured"):
            return f"Looks tempting, but {bm['recaptured']} gets recaptured right back."

    return "A quiet positional difference — no immediate tactic here."


def summarize_game(critical_moves):
    prompt = f"""
You are a chess coach helping a beginner-intermediate player.

Here are the player's most important mistakes from the game:
{critical_moves}

Write:
1. A short overall game summary in 2-3 sentences.
2. Exactly 3 lessons the player should learn from this game.

Keep it simple, practical, and educational.
Return a JSON object with exactly two keys:
- "summary": a string (2-3 sentences overall summary)
- "lessons": an array of exactly 3 strings (one lesson per item)

Return only the JSON object, no other text.
"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()

    # Claude sometimes wraps JSON in markdown code fences despite instructions
    # not to — strip them before parsing.
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"--- FAILED TO PARSE SUMMARY JSON ---\n{raw}\n-------------------------------------")
        return {
            "summary": "Summary unavailable due to a formatting error — check server logs.",
            "lessons": [],
        }
