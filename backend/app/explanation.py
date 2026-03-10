from openai import OpenAI
from dotenv import load_dotenv
import os
import json

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def explain_move(move_data):
    move = move_data["move"]
    best_move = move_data["best_move"]
    quality = move_data["quality"]
    eval_before = move_data["eval_before"]
    eval_after = move_data["eval_after"]
    eval_change = move_data["eval_change"]
    fen_before = move_data["fen_before"]

    is_bad_move = quality in ("inaccuracy", "mistake", "blunder")

    if is_bad_move:
        instruction = f"""The player played {move}, which was a {quality}. The best move was {best_move}.

Explain in exactly 2-3 sentences:
1. What concrete problem or threat the player's move creates (or fails to address).
2. What {best_move} does instead and why it is stronger.
3. One practical lesson the player can take away.

Example of the tone and style to use:
---
Player move: Nf6?? | Best move: d5 | Quality: blunder
"By moving the knight to f6, you left your e5-pawn completely undefended, allowing White to win it for free next move. Instead, d5 would have struck at the center and kept your position solid. When your pieces are under pressure, prioritize defending your material before making active moves."
---"""
    else:
        instruction = f"""The player played {move}, which was a good move.

Confirm in 1-2 sentences why this move was strong — what threat it created, what it defended, or what positional idea it achieved.

Example of the tone and style to use:
---
Player move: d5 | Quality: good
"d5 was an excellent choice — it immediately challenged White's control of the center and opened lines for your bishops to become active."
---"""

    prompt = f"""You are a chess coach explaining a single chess move to a beginner-intermediate player.

Position (FEN): {fen_before}

{instruction}

Rules:
- Never mention centipawns, evaluation scores, or any numbers.
- Be concrete and specific to this position — avoid generic advice.
- Use plain, simple language a beginner can understand.
- Do not start with "In this position" or restate the move quality label."""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content


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
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)