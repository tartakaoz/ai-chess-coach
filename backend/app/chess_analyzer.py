import chess
import chess.pgn
import chess.engine
import io
from concurrent.futures import ThreadPoolExecutor
from app.explanation import explain_move, summarize_game

engine = chess.engine.SimpleEngine.popen_uci("stockfish")

# ── fact-extraction constants ──────────────────────────────────────────────────

_PIECE_NAMES = {
    chess.PAWN:   "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK:   "rook",
    chess.QUEEN:  "queen",
    chess.KING:   "king",
}

_PIECE_VALUES = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
}


def _material_total(board: chess.Board, color: chess.Color) -> int:
    return sum(len(board.pieces(pt, color)) * v for pt, v in _PIECE_VALUES.items())


def _balance_desc(balance: int) -> str:
    if balance > 0:
        return f"up {balance} pawn{'s' if balance != 1 else ''}"
    if balance < 0:
        return f"down {abs(balance)} pawn{'s' if abs(balance) != 1 else ''}"
    return "equal on material"


def _piece_label(piece_type: int, sq: int) -> str:
    """Return a human-readable piece name, e.g. 'g-pawn', 'knight', 'queen'."""
    if piece_type == chess.PAWN:
        return f"{chess.FILE_NAMES[chess.square_file(sq)]}-pawn"
    return _PIECE_NAMES[piece_type]


def _capture_desc(board: chess.Board, move: chess.Move, opp_poss: str) -> str | None:
    """Return a capture description string, or None if the move is not a capture."""
    if board.is_en_passant(move):
        cap_sq = chess.square(chess.square_file(move.to_square),
                              chess.square_rank(move.from_square))
        cap_piece = board.piece_at(cap_sq)
    elif board.is_capture(move):
        cap_sq = move.to_square
        cap_piece = board.piece_at(cap_sq)
    else:
        return None
    if cap_piece is None:
        return None
    return (f"capturing {opp_poss} {_piece_label(cap_piece.piece_type, cap_sq)}"
            f" on {chess.square_name(cap_sq)}")


def _hanging_pieces(board: chess.Board, player_color: chess.Color) -> list[str]:
    """Return plain-English descriptions of every undefended piece on the board."""
    results = []
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece is None or piece.piece_type == chess.KING:
            continue
        attacker = not piece.color
        if (board.is_attacked_by(attacker, sq)
                and not board.is_attacked_by(piece.color, sq)):
            poss = "your" if piece.color == player_color else "their"
            results.append(
                f"{poss} {_piece_label(piece.piece_type, sq)}"
                f" on {chess.square_name(sq)} is undefended and can be taken for free"
            )
    # Return the most valuable hanging pieces first (cap at 4 to keep prompt short)
    results.sort(
        key=lambda s: -next(
            (v for pt, v in _PIECE_VALUES.items() if _PIECE_NAMES[pt] in s), 0
        )
    )
    return results[:4]


def _compute_move_facts(fen_before: str, san_move: str, san_best_move: str | None) -> dict:
    """
    Parse the position and both moves with python-chess and return a dict of
    plain-English, serialisable facts ready for the explanation module.
    """
    board = chess.Board(fen_before)
    player_color = board.turn
    opp_color = not player_color
    player_poss, opp_poss = "your", "their"

    move = board.parse_san(san_move)
    from_sq, to_sq = move.from_square, move.to_square
    moved_piece = board.piece_at(from_sq)

    capture = _capture_desc(board, move, opp_poss)

    mat_before    = _material_total(board, player_color) - _material_total(board, opp_color)
    board_after   = board.copy()
    board_after.push(move)
    mat_after_played = (_material_total(board_after, player_color)
                        - _material_total(board_after, opp_color))

    hanging = _hanging_pieces(board_after, player_color)

    facts: dict = {
        "moved_piece":           f"{player_poss} {_piece_label(moved_piece.piece_type, from_sq)}" if moved_piece else "a piece",
        "from_square":           chess.square_name(from_sq),
        "to_square":             chess.square_name(to_sq),
        "captured":              capture,
        "balance_before":        _balance_desc(mat_before),
        "balance_after_played":  _balance_desc(mat_after_played),
        "hanging_after_played":  hanging,
        "best_move":             None,
    }

    if san_best_move:
        board_b = board.copy()
        bm = board_b.parse_san(san_best_move)
        bm_piece   = board_b.piece_at(bm.from_square)
        bm_capture = _capture_desc(board_b, bm, opp_poss)
        board_b.push(bm)
        mat_after_best = (_material_total(board_b, player_color)
                          - _material_total(board_b, opp_color))
        facts["best_move"] = {
            "piece":         f"{player_poss} {_piece_label(bm_piece.piece_type, bm.from_square)}" if bm_piece else "a piece",
            "from_square":   chess.square_name(bm.from_square),
            "to_square":     chess.square_name(bm.to_square),
            "captured":      bm_capture,
            "balance_after": _balance_desc(mat_after_best),
        }

    return facts


def _get_pv_san(fen_before: str, san_move: str, depth: int = 15, max_moves: int = 3) -> list[str]:
    """Push san_move onto fen_before, run Stockfish, return the PV as SAN list."""
    board = chess.Board(fen_before)
    move = board.parse_san(san_move)
    board.push(move)
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    pv_moves = []
    for m in info.get("pv", [])[:max_moves]:
        try:
            pv_moves.append(board.san(m))
            board.push(m)
        except Exception:
            break
    return pv_moves


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
    _pv0 = info_current.get("pv", [])
    position_evals = [{
        "move_index": 0,
        "eval":       info_current["score"].pov(user_is_white).score(mate_score=10000),
        "best_move":  _pv0[0].uci() if len(_pv0) > 0 else None,
    }]

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

        # best_move comes from info_before (the position before this move was played),
        # so it shows what the side that just moved should have played instead.
        _pv_before = info_before.get("pv", [])

        position_evals.append({
            "move_index": position_index,
            "eval":       eval_after_user,
            "best_move":  _pv_before[0].uci() if len(_pv_before) > 0 else None,
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

    worst_moves = [m for m in moves_data if m["quality"] in ("blunder", "mistake")]
    worst_moves.sort(key=lambda x: x["move_index"])

    # Enrich each critical mistake with Stockfish PV lines and python-chess facts
    # (sequential — engine is not thread-safe)
    for m in worst_moves:
        m["played_continuation"] = _get_pv_san(m["fen_before"], m["move"])
        if m["best_move"]:
            m["best_continuation"] = _get_pv_san(m["fen_before"], m["best_move"])
        else:
            m["best_continuation"] = []

        m["move_facts"] = _compute_move_facts(m["fen_before"], m["move"], m["best_move"])

        print("--- CRITICAL MISTAKE DEBUG ---")
        print(f"  Move played      : {m['move']}")
        print(f"  FEN before       : {m['fen_before']}")
        print(f"  Played PV        : {m['played_continuation']}")
        print(f"  Best move        : {m['best_move']}")
        print(f"  Best PV          : {m['best_continuation']}")
        print(f"  Centipawn loss   : {m['eval_change']}")
        print(f"  Computed facts   : {m['move_facts']}")
        print("------------------------------")

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
