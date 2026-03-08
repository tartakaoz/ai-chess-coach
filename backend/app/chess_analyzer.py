import chess
import chess.pgn
import chess.engine
import io
from app.explanation import explain_move, summarize_game

engine = chess.engine.SimpleEngine.popen_uci("stockfish")


def analyze_game(pgn_text, color):
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    board = game.board()

    moves_data = []
    user_is_white = (color == "white")

    for move in game.mainline_moves():
        is_user_move = (
            (board.turn and user_is_white) or
            (not board.turn and not user_is_white)
        )

        if is_user_move:
            fen_before = board.fen()

            info_before = engine.analyse(board, chess.engine.Limit(depth=12))
            score_before = info_before["score"].pov(user_is_white)
            eval_before = score_before.score(mate_score=10000)

            best_move = info_before["pv"][0] if "pv" in info_before and info_before["pv"] else None
            best_move_san = board.san(best_move) if best_move else None

        san_move = board.san(move)
        board.push(move)

        if is_user_move:
            info_after = engine.analyse(board, chess.engine.Limit(depth=12))
            score_after = info_after["score"].pov(user_is_white)
            eval_after = score_after.score(mate_score=10000)

            eval_change = eval_after - eval_before

            if eval_change >= -50:
                quality = "good"
            elif eval_change >= -150:
                quality = "inaccuracy"
            elif eval_change >= -300:
                quality = "mistake"
            else:
                quality = "blunder"

            move_data = {
                "move": san_move,
                "fen_before": fen_before,
                "best_move": best_move_san,
                "eval_before": eval_before,
                "eval_after": eval_after,
                "eval_change": eval_change,
                "quality": quality
            }

            move_data["explanation"] = explain_move(move_data)
            moves_data.append(move_data)

        bad_moves = [move for move in moves_data if move["quality"] != "good"]
        bad_moves.sort(key=lambda x: x["eval_change"])
        worst_moves = bad_moves[:3]

    if worst_moves:
        game_summary = summarize_game(worst_moves)
    else:
        game_summary = (
            "No major mistakes were found in the selected moves. "
            "The game looked solid overall, with no clear inaccuracies, mistakes, or blunders by this player."
        )

    return {
        "critical_moves": worst_moves,
        "game_summary": game_summary
    }