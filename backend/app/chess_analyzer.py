import chess
import chess.pgn
import chess.engine
import io
from app.explanation import move_caption, summarize_game

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


def _compute_move_facts(
    fen_before: str,
    san_move: str,
    san_best_move: str | None,
    best_reply_san: str | None = None,
) -> dict:
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

        # The single-ply material count above only reflects the instant after the
        # best move is played — it misses cases where the opponent's natural next
        # move immediately recaptures the piece that just moved (e.g. a sacrifice
        # like Bxf7+ that wins a pawn but hands the bishop right back). Without
        # this, the facts fed to Claude would claim "nothing hanging" for a move
        # that in fact gets punished on the very next ply.
        recaptured_piece = None
        mat_after_best_reply = None
        if best_reply_san:
            try:
                reply_move = board_b.parse_san(best_reply_san)
                if reply_move.to_square == bm.to_square:
                    recaptured_piece = _piece_label(bm_piece.piece_type, bm.to_square) if bm_piece else "your piece"
                board_b.push(reply_move)
                mat_after_best_reply = (_material_total(board_b, player_color)
                                        - _material_total(board_b, opp_color))
            except Exception:
                pass

        facts["best_move"] = {
            "piece":               f"{player_poss} {_piece_label(bm_piece.piece_type, bm.from_square)}" if bm_piece else "a piece",
            "from_square":         chess.square_name(bm.from_square),
            "to_square":           chess.square_name(bm.to_square),
            "captured":            bm_capture,
            "balance_after":       _balance_desc(mat_after_best),
            "recaptured":          recaptured_piece,
            "balance_after_reply": _balance_desc(mat_after_best_reply) if mat_after_best_reply is not None else None,
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


def explore_line(fen: str, first_move: str, max_plies: int = 18,
                  stabilize_threshold: int = 15, stabilize_window: int = 4) -> dict:
    """
    Play out a hypothetical continuation from a position, one Stockfish-best
    move at a time for whichever side is to move, starting with a specific
    first move (typically the engine's recommendation for a flagged mistake).
    Returns the resulting FENs, SAN moves, and White-perspective evals at
    each step, so the frontend can let the player step through it on the
    board with the eval bar tracking along.

    This is on-demand (called only when a user asks to explore a specific
    line), not run during the main analysis — evaluating every ply of a
    hypothetical line requires a fresh engine search per ply, which is too
    slow to do for every flagged mistake up front.

    Stops once the position has clearly settled down — the eval has barely
    moved for a few plies in a row — or after max_plies, whichever comes
    first, so a forced sequence doesn't get explored on forever after the
    point has already been made.
    """
    board = chess.Board(fen)
    fens = [board.fen()]
    moves_san: list[str] = []
    evals: list[int] = []

    move = board.parse_san(first_move)
    board.push(move)
    moves_san.append(first_move)
    fens.append(board.fen())

    info = engine.analyse(board, chess.engine.Limit(depth=15))
    evals.append(info["score"].pov(chess.WHITE).score(mate_score=10000))

    recent_changes: list[int] = []
    while len(moves_san) < max_plies:
        pv = info.get("pv", [])
        if not pv:
            break
        try:
            next_move = pv[0]
            san = board.san(next_move)
        except Exception:
            break
        board.push(next_move)
        moves_san.append(san)
        fens.append(board.fen())

        info = engine.analyse(board, chess.engine.Limit(depth=15))
        new_eval = info["score"].pov(chess.WHITE).score(mate_score=10000)
        recent_changes.append(abs(new_eval - evals[-1]))
        evals.append(new_eval)

        if (len(recent_changes) >= stabilize_window
                and all(c <= stabilize_threshold for c in recent_changes[-stabilize_window:])):
            break

    return {"fens": fens, "moves": moves_san, "evals": evals}


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

    # Enrich each critical mistake with a short Stockfish PV (for the
    # move_caption "gets recaptured" check) and python-chess facts.
    # (sequential — engine is not thread-safe). The full continuation for
    # on-board exploration is computed separately, on demand, by explore_line —
    # not here, since that needs an eval at every ply and would be too slow to
    # do for every flagged mistake up front.
    for m in worst_moves:
        if m["best_move"]:
            m["best_continuation"] = _get_pv_san(m["fen_before"], m["best_move"])
        else:
            m["best_continuation"] = []

        best_reply = m["best_continuation"][0] if m["best_continuation"] else None
        m["move_facts"] = _compute_move_facts(m["fen_before"], m["move"], m["best_move"], best_reply)

        print("--- CRITICAL MISTAKE DEBUG ---")
        print(f"  Move played      : {m['move']}")
        print(f"  FEN before       : {m['fen_before']}")
        print(f"  Best move        : {m['best_move']}")
        print(f"  Best PV          : {m['best_continuation']}")
        print(f"  Centipawn loss   : {m['eval_change']}")
        print(f"  Computed facts   : {m['move_facts']}")
        print("------------------------------")

    # Per-move captions are fully deterministic (no LLM call) — built straight
    # from the verified facts above, so they can't be wrong the way a
    # generated explanation could.
    for move_data in worst_moves:
        move_data["explanation"] = move_caption(move_data)

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
