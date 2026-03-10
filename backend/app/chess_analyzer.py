import chess
import chess.pgn
import chess.engine
import io
from concurrent.futures import ThreadPoolExecutor
from app.explanation import explain_move, summarize_game

engine = chess.engine.SimpleEngine.popen_uci("stockfish")


def _quality(eval_change: int) -> str:
    if eval_change >= -20:
        return "good"
    elif eval_change >= -50:
        return "inaccuracy"
    elif eval_change >= -100:
        return "mistake"
    else:
        return "blunder"


def analyze_game(pgn_text, color):
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    board = game.board()

    moves_data = []
    all_move_qualities = []
    position_index = 0
    user_is_white = (color == "white")

    # Seed the cache with the starting position eval
    info_current = engine.analyse(board, chess.engine.Limit(depth=12))
    position_evals = [{"move_index": 0, "eval": info_current["score"].pov(user_is_white).score(mate_score=10000)}]

    for move in game.mainline_moves():
        position_index += 1
        mover_is_white = board.turn  # capture before push

        is_user_move = (mover_is_white == user_is_white)

        # Reuse the previous iteration's post-move analysis as this iteration's pre-move analysis
        info_before = info_current
        eval_before_mover = info_before["score"].pov(mover_is_white).score(mate_score=10000)

        if is_user_move:
            fen_before = board.fen()
            eval_before_user = info_before["score"].pov(user_is_white).score(mate_score=10000)
            best_move = info_before["pv"][0] if "pv" in info_before and info_before["pv"] else None
            best_move_san = board.san(best_move) if best_move else None

        move_from = chess.square_name(move.from_square)
        move_to = chess.square_name(move.to_square)
        san_move = board.san(move)

        board.push(move)

        info_current = engine.analyse(board, chess.engine.Limit(depth=12))
        eval_after_user = info_current["score"].pov(user_is_white).score(mate_score=10000)

        position_evals.append({
            "move_index": position_index,
            "eval": eval_after_user,
        })

        # Universal quality: compare from the mover's perspective
        eval_after_mover = info_current["score"].pov(mover_is_white).score(mate_score=10000)
        eval_change_mover = eval_after_mover - eval_before_mover
        quality = _quality(eval_change_mover)

        all_move_qualities.append({
            "move_index": position_index,
            "move_to": move_to,
            "quality": quality,
        })

        if is_user_move:
            eval_change_user = eval_after_user - eval_before_user
            user_quality = _quality(eval_change_user)

            move_data = {
                "move_index": position_index,
                "move": san_move,
                "move_from": move_from,
                "move_to": move_to,
                "fen_before": fen_before,
                "fen_after": board.fen(),
                "best_move": best_move_san,
                "best_move_from": chess.square_name(best_move.from_square) if best_move else None,
                "best_move_to": chess.square_name(best_move.to_square) if best_move else None,
                "eval_before": eval_before_user,
                "eval_after": eval_after_user,
                "eval_change": eval_change_user,
                "quality": user_quality,
            }
            moves_data.append(move_data)

    bad_moves = [m for m in moves_data if m["quality"] != "good"]
    bad_moves.sort(key=lambda x: x["eval_change"])
    worst_moves = bad_moves[:3]

    with ThreadPoolExecutor() as executor:
        explanations = list(executor.map(explain_move, worst_moves))

    for move_data, explanation in zip(worst_moves, explanations):
        move_data["explanation"] = explanation

    if worst_moves:
        summary_result = summarize_game(worst_moves)
        game_summary = summary_result.get("summary", "")
        lessons = summary_result.get("lessons", [])
    else:
        game_summary = (
            "No major mistakes were found in the selected moves. "
            "The game looked solid overall."
        )
        lessons = []

    return {
        "critical_moves": worst_moves,
        "position_evals": position_evals,
        "all_move_qualities": all_move_qualities,
        "game_summary": game_summary,
        "lessons": lessons,
    }
