from openai import OpenAI
from dotenv import load_dotenv
import os

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

    prompt = f"""
You are a chess coach explaining a move to a beginner-intermediate player.

Position before the move (FEN):
{fen_before}

Player's move:
{move}

Best engine move:
{best_move}

Evaluation before the move:
{eval_before}

Evaluation after the move:
{eval_after}

Evaluation change:
{eval_change}

Move quality:
{quality}

Write 2-3 sentences.
Explain:
1. what the player's move tried to do,
2. why it was good or bad,
3. why the engine move was better if the move was not best.

Be simple, specific, and practical.
Do not mention centipawns or raw numbers unless necessary.
"""

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
Return the response in plain text.
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content