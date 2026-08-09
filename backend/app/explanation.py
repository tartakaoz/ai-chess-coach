from anthropic import Anthropic
from dotenv import load_dotenv
import os
import json

load_dotenv()

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def _facts_to_plain_english(facts: dict) -> str:
    """
    Convert the pre-computed facts dict (built by chess_analyzer._compute_move_facts)
    into a plain-English bullet list. Every statement is a verified Python-computed fact.
    """
    lines = []

    # What the player moved and where
    move_desc = (
        f"- You moved {facts['moved_piece']} from {facts['from_square']}"
        f" to {facts['to_square']}"
    )
    if facts.get("captured"):
        move_desc += f", {facts['captured']}"
    move_desc += "."
    lines.append(move_desc)

    # Material impact of the played move
    lines.append(
        f"- Before this move, material was {facts['balance_before']}. "
        f"After this move, material is {facts['balance_after_played']}."
    )

    # Hanging / undefended pieces after the played move
    for h in facts.get("hanging_after_played", []):
        lines.append(f"- After this move, {h}.")

    # Best move
    bm = facts.get("best_move")
    if bm:
        bm_desc = (
            f"- The better move was to move {bm['piece']}"
            f" from {bm['from_square']} to {bm['to_square']}"
        )
        if bm.get("captured"):
            bm_desc += f", {bm['captured']}"
        bm_desc += f". After that, material would have been {bm['balance_after']}."
        lines.append(bm_desc)

    return "\n".join(lines)


def explain_move(move_data: dict) -> str:
    facts     = move_data.get("move_facts", {})
    move      = move_data["move"]
    best_move = move_data["best_move"] or "unknown"
    quality   = move_data["quality"]
    cp_loss   = abs(move_data["eval_change"])

    facts_text = _facts_to_plain_english(facts)

    minor_prefix = (
        "This wasn't a big mistake, but " if cp_loss < 60 else ""
    )

    prompt = (
        f"You are a friendly chess coach writing a 2-sentence explanation for a beginner.\n\n"
        f"The player played {move}, which was a {quality} (centipawn loss: {cp_loss}). "
        f"The best move was {best_move}.\n\n"
        f"Here are the ONLY facts you may use — do not add anything else:\n"
        f"{facts_text}\n\n"
        f"Explain WHY the best move is better, not just that it is better. "
        f"What does it do or prevent? What does the mistake allow? "
        f"Use only the facts provided. 2 sentences max. Beginner friendly.\n\n"
        f"Sentence 1: What does the opponent's best reply take advantage of after {move}? "
        f"If no material is won, what problem does it create?\n"
        f"Sentence 2: What does {best_move} achieve concretely?\n\n"
        f"If the centipawn loss is under 60, start with: \"{minor_prefix}\"\n\n"
        f"Write directly to the player. Do not mention any piece, square, capture, or threat "
        f"that is not listed in the facts above."
    )

    print(f"--- PROMPT SENT TO CLAUDE ---\n{prompt}\n----------------------------")

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text


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
