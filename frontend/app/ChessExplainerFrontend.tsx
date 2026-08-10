"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => ({ default: m.Chessboard })),
  { ssr: false }
);

const SAMPLE_PGN = `1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. Nc3 Qc7 13. Be3 Bb7 14. Rc1 Rfe8 15. cxb5 axb5 16. Nxb5 Qb8 17. Nc3 Bf8 18. dxe5 dxe5 19. Ng5 Re7 20. f4 h6 21. Nxf7 Rxf7 22. fxe5 Nxe5 23. Rf1 Ba6 24. Rf5 Nc4 25. Bd4 Qg3 26. Rf3 Qg5 27. Qe1 Nd2 28. Rg3 Nf3+ 29. gxf3 Qh5 30. Bxf6 Bc5+ 31. Kh2 Bd6 32. e5 Bc7 33. Rxg7+ Kf8 34. Rxf7+ Qxf7 35. Bxf7 Kxf7 36. Qe4 Rg8 37. Qh7+ Ke6 38. Qxg8+ Kf5 39. Qg4#`;

function buildPositionsFromPgn(pgn: string) {
  const chess = new Chess();

  try {
    chess.loadPgn(pgn);
  } catch {
    return [new Chess().fen()];
  }

  const moves = chess.history();
  const viewer = new Chess();
  const positions = [viewer.fen()];

  for (const move of moves) {
    viewer.move(move);
    positions.push(viewer.fen());
  }

  return positions;
}

const BOARD_SIZE = 560;

const QUALITY_CARD_COLORS: Record<string, string> = {
  blunder: "rgba(220,60,60,0.25)",
  mistake: "rgba(220,140,40,0.25)",
  inaccuracy: "rgba(200,190,40,0.25)",
  good: "rgba(60,180,80,0.2)",
};

const QUALITY_HIGHLIGHT_COLORS: Record<string, string> = {
  blunder: "rgba(255,0,0,0.4)",
  mistake: "rgba(255,165,0,0.4)",
  inaccuracy: "rgba(255,255,0,0.4)",
};

const QUALITY_ICONS: Record<string, string> = {
  blunder: "❌",
  mistake: "⚠️",
  inaccuracy: "💛",
  good: "✅",
};

/** Convert a half-move index to chess notation label, e.g. 1→"1.", 2→"1...", 15→"8." */
function formatMoveLabel(moveIndex: number): string {
  const num = Math.ceil(moveIndex / 2);
  return moveIndex % 2 === 1 ? `${num}.` : `${num}...`;
}

export default function ChessExplainerFrontend() {
  const [pgn, setPgn] = useState(SAMPLE_PGN);
  const [color, setColor] = useState("white");
  const [boardIndex, setBoardIndex] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMove, setSelectedMove] = useState<any>(null);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [modal, setModal] = useState<"summary" | "lessons" | null>(null);

  // "Explore best line" — plays out the engine's recommended continuation for
  // a flagged mistake on the actual board, computed on demand (not during the
  // main analysis) since evaluating every ply of a hypothetical line needs a
  // fresh engine search per ply.
  const [exploring, setExploring] = useState<{
    moveIndex: number;
    fens: string[];
    moves: string[];
    evals: number[];
    step: number;
  } | null>(null);
  const [exploreLoadingFor, setExploreLoadingFor] = useState<number | null>(null);
  const preExploreRef = useRef<{ boardIndex: number; selectedMove: any } | null>(null);


  const analyzeGame = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:8000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, color }),
      });
      if (!response.ok) {
        const text = await response.text();
        console.error("Analysis failed: HTTP", response.status, text);
        setLoading(false);
        return;
      }
      const data = await response.json();
      console.log("Analysis response:", JSON.stringify(data, null, 2));
      setResult(data);
      setSelectedMove(null);
      setBoardIndex(0);
    } catch (error) {
      console.error("Analysis failed:", error instanceof Error ? error.message : error, error);
    }
    setLoading(false);
    mainRef.current?.focus();
  }, [pgn, color]);

  const startExplore = useCallback(async (move: any) => {
    setExploreLoadingFor(move.move_index);
    try {
      const response = await fetch("http://127.0.0.1:8000/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: move.fen_before, first_move: move.best_move }),
      });
      if (!response.ok) {
        console.error("Explore failed: HTTP", response.status, await response.text());
        setExploreLoadingFor(null);
        return;
      }
      const data = await response.json();
      preExploreRef.current = { boardIndex, selectedMove };
      setExploring({
        moveIndex: move.move_index,
        fens: data.fens,
        moves: data.moves,
        evals: data.evals,
        step: 0,
      });
    } catch (error) {
      console.error("Explore failed:", error instanceof Error ? error.message : error, error);
    }
    setExploreLoadingFor(null);
  }, [boardIndex, selectedMove]);

  const exitExplore = useCallback(() => {
    setExploring(null);
    if (preExploreRef.current) {
      setBoardIndex(preExploreRef.current.boardIndex);
      setSelectedMove(preExploreRef.current.selectedMove);
    }
  }, []);

  const positions = useMemo(() => buildPositionsFromPgn(pgn), [pgn]);

  // Per-index from/to squares + move flags for sound detection
  const moveHistory = useMemo(() => {
    let source: InstanceType<typeof Chess>;
    try { source = new Chess(); source.loadPgn(pgn); } catch { return [null]; }
    const sans = source.history();           // plain SAN strings from the loaded game
    const viewer = new Chess();              // fresh board replayed move by move
    const history: ({ from: string; to: string; flags: string; san: string; isCheck: boolean; isCheckmate: boolean; captured?: string; color: string } | null)[] = [null];
    for (const san of sans) {
      const result = viewer.move(san);       // move returns the Move object computed from live state
      if (!result) break;                    // stop if chess.js rejects a move
      history.push({
        from: result.from,
        to: result.to,
        flags: result.flags,                 // flags from live viewer, not from history()
        san: result.san,                     // san from live viewer (always O-O, never 0-0)
        isCheck: viewer.isCheck(),           // board state immediately after move
        isCheckmate: viewer.isCheckmate(),   // board state immediately after move
        captured: result.captured,           // piece type captured this move, if any ('p','n','b','r','q')
        color: result.color,                 // 'w' or 'b' — who made this move
      });
    }
    return history;
  }, [pgn]);

  const sanMoves = useMemo(() => {
    const chess = new Chess();
    try { chess.loadPgn(pgn); } catch { return []; }
    return chess.history();
  }, [pgn]);

  const boardIndexRef = useRef(boardIndex);
  useEffect(() => { boardIndexRef.current = boardIndex; }, [boardIndex]);

  useEffect(() => {
    if (!result?.critical_moves) return;
    const match = result.critical_moves.find((m: any) => m.move_index === boardIndex);
    if (match) {
      setExpandedCard(match.move_index);
      const el = cardRefs.current[match.move_index];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      // Close whatever was auto-expanded once you've navigated past it —
      // previously this only ever opened a card, never closed one.
      setExpandedCard(null);
    }
  }, [boardIndex, result]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const buffersLoadingRef = useRef(false);

  const SOUND_FILES: Record<string, string> = {
    move:      "/sounds/Move.mp3",
    capture:   "/sounds/Capture.mp3",
    castle:    "/sounds/Move.mp3",
    promote:   "/sounds/Promote.mp3",
    check:     "/sounds/GenericNotify.mp3",
    checkmate: "/sounds/Victory.mp3",
  };

  // Creates (or recreates, or resumes) the AudioContext on demand, right at
  // the moment a sound needs to play — rather than relying on a separate
  // "warm it up on the first click anywhere" listener set up ahead of time.
  // That split design was fragile: if that context ever got torn down (a dev
  // hot-reload, or Safari closing it when the tab was backgrounded) and the
  // user's next action was directly clicking Next/Previous rather than some
  // unrelated click first, sound would silently stay dead. Calling this
  // directly inside a click/keydown handler is itself a valid user gesture,
  // so it's safe to create/resume the context right here every time.
  const ensureAudio = useCallback((): AudioContext | null => {
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      try {
        ctx = new AudioContext();
      } catch (err) {
        console.error('[Sound] Failed to create AudioContext:', err);
        return null;
      }
      audioCtxRef.current = ctx;
      buffersRef.current = {};
      buffersLoadingRef.current = false;
      console.log('[Sound] AudioContext created, state:', ctx.state);
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(err => console.error('[Sound] resume failed:', err));
    }
    if (!buffersLoadingRef.current) {
      buffersLoadingRef.current = true;
      const activeCtx = ctx;
      Object.entries(SOUND_FILES).forEach(([key, path]) => {
        fetch(path)
          .then(r => r.arrayBuffer())
          .then(ab => activeCtx.decodeAudioData(ab))
          .then(buf => {
            buffersRef.current[key] = buf;
            console.log('[Sound] Buffer loaded:', key);
          })
          .catch(err => console.error('[Sound] Buffer load failed:', key, err));
      });
    }
    return ctx;
  }, []);

  // Dispose the context on unmount so a dev hot-reload doesn't orphan it —
  // harmless either way now, since ensureAudio() recreates on next use.
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
      buffersRef.current = {};
      buffersLoadingRef.current = false;
    };
  }, []);

  const playSound = useCallback((key: string, gainValue: number) => {
    const ctx = ensureAudio();
    const buf = buffersRef.current[key];
    console.log('[Sound] play —', key, '| ctx:', ctx?.state ?? 'null', '| buf:', buf ? 'loaded' : 'missing');
    if (ctx && buf) {
      ctx.resume().then(() => {
        const gain = ctx.createGain();
        gain.gain.value = gainValue;
        gain.connect(ctx.destination);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start();
      }).catch(err => console.error('[Sound] play failed:', err));
    }
  }, [ensureAudio]);

  const playMoveSound = useCallback((index: number) => {
    if (index === 0) return;
    const move = moveHistory[index];
    if (!move) return;
    const isCastle = move.san === "O-O-O" || move.san === "O-O";
    const isPromotion = move.flags.includes("p");
    const isCapture = move.flags.includes("c") || move.flags.includes("e");
    let key = "move";
    if (move.isCheckmate)  key = "checkmate";
    else if (move.isCheck) key = "check";
    else if (isCastle)     key = "castle";
    else if (isPromotion)  key = "promote";
    else if (isCapture)    key = "capture";
    playSound(key, 0.4);
  }, [moveHistory, playSound]);

  const playBackSound = useCallback(() => {
    playSound("move", 0.2);
  }, [playSound]);

  // Sound for stepping through an explored line — replays the line up to the
  // target step with chess.js to figure out what kind of move just happened
  // (capture, check, castle, etc.), since exploring.moves only has plain SAN
  // strings, not the verbose move info playMoveSound normally reads.
  const playExploreStep = useCallback((targetStep: number, currentStep: number) => {
    if (!exploring || targetStep === currentStep) return;
    if (targetStep < currentStep) {
      if (targetStep > 0) playBackSound();
      return;
    }
    try {
      const replay = new Chess(exploring.fens[0]);
      for (let i = 0; i < targetStep - 1; i++) replay.move(exploring.moves[i]);
      const res = replay.move(exploring.moves[targetStep - 1]);
      if (!res) return;
      const isCastle = res.san === "O-O-O" || res.san === "O-O";
      const isPromotion = res.flags.includes("p");
      const isCapture = res.flags.includes("c") || res.flags.includes("e");
      let key = "move";
      if (replay.isCheckmate())      key = "checkmate";
      else if (replay.isCheck())     key = "check";
      else if (isCastle)             key = "castle";
      else if (isPromotion)          key = "promote";
      else if (isCapture)            key = "capture";
      playSound(key, 0.4);
    } catch { /* malformed line — just skip the sound */ }
  }, [exploring, playBackSound, playSound]);

  const goNext = useCallback(async () => {
    if (result === null && !loading) {
      await analyzeGame();
      setBoardIndex(1);
      playMoveSound(1);
    } else {
      const next = Math.min(boardIndexRef.current + 1, positions.length - 1);
      setBoardIndex(next);
      setSelectedMove(null);
      playMoveSound(next);
    }
  }, [result, loading, analyzeGame, positions.length, playMoveSound]);

  // Quality icon for the user move at the current board position (covers all user moves)
  const currentMoveQuality = useMemo<{ square: string; quality: string } | null>(() => {
    if (!result?.all_move_qualities) return null;
    const match = result.all_move_qualities.find((m: any) => m.move_index === boardIndex);
    return match ? { square: match.move_to, quality: match.quality } : null;
  }, [result, boardIndex]);

  const [boardSize, setBoardSize] = useState(BOARD_SIZE);
  const activeItemRef = useRef<HTMLSpanElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setBoardSize(Math.floor(Math.min(window.innerHeight - 150, 720)));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [boardIndex]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (exploring) {
          const newStep = Math.max(0, exploring.step - 1);
          playExploreStep(newStep, exploring.step);
          setExploring((prev) => prev && ({ ...prev, step: newStep }));
          return;
        }
        const prev = Math.max(boardIndexRef.current - 1, 0);
        setBoardIndex(prev);
        setSelectedMove(null);
        if (prev > 0) { playBackSound(); }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (exploring) {
          const newStep = Math.min(exploring.fens.length - 1, exploring.step + 1);
          playExploreStep(newStep, exploring.step);
          setExploring((prev) => prev && ({ ...prev, step: newStep }));
          return;
        }
        goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, exploring, playExploreStep, playBackSound]);

const displayFen = exploring
  ? exploring.fens[exploring.step]
  : selectedMove ? selectedMove.fen_after : positions[boardIndex];
  // Eval bar: cap at ±1000 centipawns (±10 pawns)
  const evalCp = exploring
    ? exploring.evals[exploring.step]
    : selectedMove
    ? selectedMove.eval_after
    : result?.position_evals?.find((p: any) => p.move_index === boardIndex)?.eval ?? 0;

      // The /explore endpoint already returns evals from White's POV; the
      // main analysis stores evals from the analyzed player's POV instead,
      // so only that path needs the color-based flip.
      const perspectiveEval = exploring ? evalCp : (color === "black" ? -evalCp : evalCp);
      const clampedEval = Math.max(-1000, Math.min(1000, perspectiveEval));
      const whitePct = ((clampedEval + 1000) / 2000) * 100;
      const blackPct = 100 - whitePct;

      const absEval = Math.abs(perspectiveEval);
      const evalLabel =
        absEval >= 1000
          ? perspectiveEval > 0 ? "+∞" : "-∞"
          : perspectiveEval === 0
          ? "0.0"
          : (perspectiveEval > 0 ? "+" : "") + (perspectiveEval / 100).toFixed(1);
      const labelOnWhite = whitePct >= blackPct;


  // Square color map applied via squareRenderer (properly layers over base square colors)
  const lastMove = selectedMove
    ? { from: selectedMove.move_from, to: selectedMove.move_to }
    : moveHistory[boardIndex];

  const MOVE_QUALITY_COLORS: Record<string, string> = {
    good:       "rgba(0, 200, 0, 0.45)",
    inaccuracy: "rgba(255, 220, 0, 0.45)",
    mistake:    "rgba(255, 140, 0, 0.45)",
    blunder:    "rgba(220, 0, 0, 0.45)",
  };
  const NEUTRAL_HIGHLIGHT = "rgba(130, 130, 130, 0.3)";

  // Quality-based color for both players; neutral gray before analysis is loaded
  const moveQualityColor = MOVE_QUALITY_COLORS[currentMoveQuality?.quality ?? ""] ?? NEUTRAL_HIGHLIGHT;

  // While exploring a hypothetical line, suppress the real game's move-quality
  // highlights and best-move arrow — they don't apply to positions that never
  // actually occurred, and would be confusing overlaid on an explore line.
  const squareColorMap: Record<string, string> = {};
  if (lastMove && !exploring) {
    squareColorMap[lastMove.from] = moveQualityColor;
    squareColorMap[lastMove.to] = moveQualityColor;
  }

  // Single best-move arrow: green if White to move, red if Black to move.
  // Hidden at move 0, when balanced (|eval| ≤ 50), or when the best move matches
  // the move actually played (it was already a good move).
  // Always shown at mistake/blunder positions regardless of eval threshold.
  const posEval = result?.position_evals?.find((p: any) => p.move_index === boardIndex);
  const arrowColor = boardIndex % 2 === 0 ? "green" : "red";
  const isMistakeIndex = (result?.critical_moves ?? []).some((m: any) => m.move_index === boardIndex);
  const playedMove = boardIndex > 0 ? moveHistory[boardIndex] : null;
  const bestMatchesPlayed =
    playedMove &&
    posEval?.best_move &&
    posEval.best_move.slice(0, 2) === playedMove.from &&
    posEval.best_move.slice(2, 4) === playedMove.to;
  const showArrow =
    !exploring &&
    boardIndex > 0 &&
    posEval?.best_move &&
    !bestMatchesPlayed &&
    (isMistakeIndex || Math.abs(posEval.eval ?? 0) > 50);
  const arrows: { startSquare: string; endSquare: string; color: string }[] = showArrow
    ? [{ startSquare: posEval.best_move.slice(0, 2), endSquare: posEval.best_move.slice(2, 4), color: arrowColor }]
    : [];

  // Captured-material trays: walk every move up to the current board index and
  // bucket captures by who made them. "capturedByWhite" holds pieces White has
  // taken from Black (originally black pieces), and vice versa.
  const PIECE_GLYPH: Record<string, { white: string; black: string }> = {
    p: { white: "♙", black: "♟" },
    n: { white: "♘", black: "♞" },
    b: { white: "♗", black: "♝" },
    r: { white: "♖", black: "♜" },
    q: { white: "♕", black: "♛" },
  };
  const PIECE_ORDER: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4 };
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  for (let i = 1; i <= boardIndex; i++) {
    const m = moveHistory[i];
    if (m && m.captured) {
      if (m.color === "w") capturedByWhite.push(m.captured);
      else capturedByBlack.push(m.captured);
    }
  }
  const byValue = (a: string, b: string) => (PIECE_ORDER[a] ?? 9) - (PIECE_ORDER[b] ?? 9);
  capturedByWhite.sort(byValue);
  capturedByBlack.sort(byValue);

  // While exploring a hypothetical line, the trays should show captures from
  // the real game up to the point of divergence (before the missed move)
  // plus whatever the explored line itself has captured so far — not the
  // real game's captures at the frozen boardIndex, which has nothing to do
  // with the position currently on screen.
  let displayCapturedByWhite = capturedByWhite;
  let displayCapturedByBlack = capturedByBlack;
  if (exploring) {
    const baseWhite: string[] = [];
    const baseBlack: string[] = [];
    for (let i = 1; i < exploring.moveIndex; i++) {
      const m = moveHistory[i];
      if (m && m.captured) {
        if (m.color === "w") baseWhite.push(m.captured);
        else baseBlack.push(m.captured);
      }
    }
    const lineWhite: string[] = [];
    const lineBlack: string[] = [];
    try {
      const replay = new Chess(exploring.fens[0]);
      for (let i = 0; i < exploring.step; i++) {
        const res = replay.move(exploring.moves[i]);
        if (res && res.captured) {
          if (res.color === "w") lineWhite.push(res.captured);
          else lineBlack.push(res.captured);
        }
      }
    } catch { /* malformed line — leave whatever was captured before the failure */ }
    displayCapturedByWhite = [...baseWhite, ...lineWhite].sort(byValue);
    displayCapturedByBlack = [...baseBlack, ...lineBlack].sort(byValue);
  }

  // "Guest" is always the side you're analyzing (whichever color you picked),
  // "Random Noob" is always the opponent — so the labels follow the color
  // selector rather than being pinned to White/Black. The board orientation
  // logic above already puts your selected color at the bottom, so this also
  // determines which literal color (white/black) sits at the top vs. bottom.
  const whiteName = color === "white" ? "Guest" : "Random Noob";
  const blackName = color === "black" ? "Guest" : "Random Noob";
  const topIsWhite = color === "black";

  const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#e8e0d0",
    borderRadius: "6px",
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "13px",
  };

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      style={{
        outline: "none",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
        padding: "16px 20px",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        color: "#e8e0d0",
        boxSizing: "border-box",
        gap: "16px",
      }}
    >
      <h1 style={{ margin: 0, flexShrink: 0, fontSize: "20px", fontWeight: 700, color: "#d4af37", letterSpacing: "0.04em" }}>
        AI Chess Coach
      </h1>

      {/* Two-column layout: left = board area, right = analysis panel */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", gap: "24px", overflow: "hidden" }}>

        {/* Left column: fixed width, board flush to left edge. Explicit width so
            long content (like the explore-line move list) wraps instead of
            stretching this column — and pushing the right column with it. */}
        <div style={{ width: `${boardSize + 30}px`, flexShrink: 0, display: "flex", flexDirection: "column", gap: "12px" }}>

          {/* Top profile bar — whichever color sits at the top of the board given orientation */}
          <div style={{ marginLeft: "30px", display: "flex", alignItems: "center", gap: "8px", height: "48px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#e8e0d0" }}>
              {topIsWhite ? whiteName : blackName}
            </span>
            <span style={{ fontSize: "45px", lineHeight: 1, letterSpacing: "-3px" }}>
              {(topIsWhite ? displayCapturedByWhite : displayCapturedByBlack).map((p, i) => {
                const side = topIsWhite ? "black" : "white";
                const isWhitePiece = side === "white";
                return (
                  <span
                    key={i}
                    style={
                      isWhitePiece
                        ? { color: "#ffffff" }
                        : { color: "#15141f", WebkitTextStroke: "0.6px #e8e0d0", textShadow: "0 0 1px #e8e0d0" }
                    }
                  >
                    {PIECE_GLYPH[p]?.black}
                  </span>
                );
              })}
            </span>
          </div>

          {/* Eval bar + Board side by side */}
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>

            {/* Eval bar — same height as board */}
            <div style={{
              width: "20px",
              height: `${boardSize}px`,
              borderRadius: "6px",
              overflow: "hidden",
              position: "relative",
              border: "1px solid rgba(255,255,255,0.15)",
              flexShrink: 0,
            }}>
              <div style={{ background: "#1a1a2e", height: `${blackPct}%` }} />
              <div style={{ background: "#e8e0d0", height: `${whitePct}%` }} />
              <span style={{
                position: "absolute",
                [labelOnWhite ? "bottom" : "top"]: "4px",
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: "9px",
                fontWeight: "bold",
                color: labelOnWhite ? "#1a1a2e" : "#e8e0d0",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}>
                {evalLabel}
              </span>
            </div>

            {/* Board — fixed size container prevents flex stretching */}
            <div style={{ width: `${boardSize}px`, height: `${boardSize}px`, flexShrink: 0, overflow: "hidden" }}>
              <Chessboard
                options={{
                  position: displayFen,
                  allowDragging: false,
                  arrows: arrows,
                  boardOrientation: color === "black" ? "black" : "white",
                  boardStyle: { width: `${boardSize}px`, height: `${boardSize}px` },
                  darkSquareStyle: { backgroundColor: "#4a7c6f" },
                  lightSquareStyle: { backgroundColor: "#f0d9b5" },
                  squareRenderer: ({ square, children }: { square: string; children?: React.ReactNode }) => (
                    <div style={{
                      position: "relative", width: "100%", height: "100%",
                      backgroundColor: squareColorMap[square] ?? undefined,
                    }}>
                      {children}
                      {currentMoveQuality?.square === square && (
                        <span style={{
                          position: "absolute", top: "2px", right: "2px",
                          fontSize: "13px", lineHeight: 1, pointerEvents: "none", zIndex: 10,
                        }}>
                          {QUALITY_ICONS[currentMoveQuality.quality]}
                        </span>
                      )}
                    </div>
                  ),
                }}
              />
            </div>
          </div>

          {/* Bottom profile bar — whichever color sits at the bottom of the board given orientation */}
          <div style={{ marginLeft: "30px", display: "flex", alignItems: "center", gap: "8px", height: "48px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#e8e0d0" }}>
              {topIsWhite ? blackName : whiteName}
            </span>
            <span style={{ fontSize: "45px", lineHeight: 1, letterSpacing: "-3px" }}>
              {(topIsWhite ? displayCapturedByBlack : displayCapturedByWhite).map((p, i) => {
                const side = topIsWhite ? "white" : "black";
                const isWhitePiece = side === "white";
                return (
                  <span
                    key={i}
                    style={
                      isWhitePiece
                        ? { color: "#ffffff" }
                        : { color: "#15141f", WebkitTextStroke: "0.6px #e8e0d0", textShadow: "0 0 1px #e8e0d0" }
                    }
                  >
                    {PIECE_GLYPH[p]?.black}
                  </span>
                );
              })}
            </span>
          </div>

          {/* Navigator — swapped out entirely while exploring a hypothetical line.
              Fixed width (matches the left column) + wrapping text, so a long
              move list wraps onto more lines instead of stretching the column
              wider and pushing the right-hand panel out of place. */}
          {exploring ? (
            <div style={{ width: `${boardSize + 30}px`, display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  style={btnStyle}
                  disabled={exploring.step === 0}
                  onClick={() => {
                    const newStep = Math.max(0, exploring.step - 1);
                    playExploreStep(newStep, exploring.step);
                    setExploring((prev) => prev && ({ ...prev, step: newStep }));
                  }}
                >
                  Previous
                </button>
                <button
                  style={btnStyle}
                  disabled={exploring.step >= exploring.fens.length - 1}
                  onClick={() => {
                    const newStep = Math.min(exploring.fens.length - 1, exploring.step + 1);
                    playExploreStep(newStep, exploring.step);
                    setExploring((prev) => prev && ({ ...prev, step: newStep }));
                  }}
                >
                  Next
                </button>
                <button
                  style={{ ...btnStyle, marginLeft: "auto", border: "1px solid #d4af37", color: "#d4af37" }}
                  onClick={exitExplore}
                >
                  ↩ Return to game
                </button>
              </div>
              <span style={{
                fontSize: "12px",
                color: "rgba(232,224,208,0.55)",
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}>
                Exploring ({exploring.step}/{exploring.fens.length - 1}): {exploring.moves.slice(0, exploring.step).join(" ") || "start"}
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button style={btnStyle} onClick={() => { setBoardIndex(0); setSelectedMove(null); }}>⏮</button>
              <button style={btnStyle} onClick={() => {
                const prev = Math.max(boardIndex - 1, 0);
                setBoardIndex(prev);
                setSelectedMove(null);
                if (prev > 0) { playBackSound(); }
              }}>
                Previous
              </button>
              <button style={btnStyle} onClick={goNext}>
                Next
              </button>
              <span style={{ fontSize: "12px", color: "rgba(232,224,208,0.55)", marginLeft: "4px" }}>
                {boardIndex === 0
                  ? `Start`
                  : `${formatMoveLabel(boardIndex)} ${sanMoves[boardIndex - 1] ?? ""}`}
                {" "}({boardIndex}/{positions.length - 1})
              </span>
            </div>
          )}

        </div>

        {/* Right column: fills remaining width, full height, flex column */}
        <div style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* Modal trigger buttons + critical move cards */}
          {result && (
            <div>
              {/* Summary / Lessons buttons — side by side */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button
                  onClick={() => setModal((m) => m === "summary" ? null : "summary")}
                  style={{
                    flex: 1, padding: "9px 0", fontSize: "13px", fontWeight: 600,
                    borderRadius: "7px", cursor: "pointer",
                    border: modal === "summary" ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.15)",
                    background: modal === "summary" ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.06)",
                    color: modal === "summary" ? "#d4af37" : "#c8bfb0",
                  }}
                >
                  📋 Game Summary
                </button>
                {result.lessons?.length > 0 && (
                  <button
                    onClick={() => setModal((m) => m === "lessons" ? null : "lessons")}
                    style={{
                      flex: 1, padding: "9px 0", fontSize: "13px", fontWeight: 600,
                      borderRadius: "7px", cursor: "pointer",
                      border: modal === "lessons" ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.15)",
                      background: modal === "lessons" ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.06)",
                      color: modal === "lessons" ? "#d4af37" : "#c8bfb0",
                    }}
                  >
                    🎓 Lessons
                  </button>
                )}
              </div>

              {/* Critical move cards — capped height, scrolls internally */}
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                Critical Moves
              </div>
              <div style={{ maxHeight: "180px", overflowY: "auto", flexShrink: 0 }}>
              {(result.critical_moves ?? []).map((move: any, index: number) => {
                const isExpanded = expandedCard === move.move_index;
                return (
                  <div
                    key={index}
                    ref={(el) => { cardRefs.current[move.move_index] = el; }}
                    onClick={() => {
                      if (exploring) setExploring(null);
                      setSelectedMove(move);
                      setBoardIndex(move.move_index);
                      playMoveSound(move.move_index);
                      setExpandedCard((prev) => prev === move.move_index ? null : move.move_index);
                    }}
                    style={{
                      marginBottom: "10px", padding: "10px 12px",
                      background: QUALITY_CARD_COLORS[move.quality] ?? "rgba(255,255,255,0.05)",
                      borderRadius: "8px",
                      border: selectedMove === move ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.1)",
                      color: "#e8e0d0", cursor: "pointer", fontSize: "15px", lineHeight: "1.6",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <div>
                        <span style={{ color: "#d4af37", fontWeight: 700, marginRight: "6px" }}>{formatMoveLabel(move.move_index)}</span>
                        <span style={{ fontWeight: 600 }}>{move.move}</span>
                        <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
                        <span style={{ fontSize: "15px", opacity: 0.75 }}>Best: {move.best_move}</span>
                        <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
                        <span style={{ fontSize: "15px" }}>
                          {QUALITY_ICONS[move.quality]}{" "}
                          <span style={{ textTransform: "capitalize" }}>{move.quality}</span>
                        </span>
                      </div>
                      <span style={{ fontSize: "13px", opacity: 0.5, flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                    {isExpanded && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px" }}>
                        {/* Alien coach avatar */}
                        <img
                          src="/alien-coach.svg"
                          alt="Alien chess coach"
                          style={{ width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0, background: "#0d1b2a", border: "1px solid rgba(212,175,55,0.3)" }}
                        />
                        {/* Speech bubble */}
                        <div style={{ position: "relative", background: "rgba(240,236,220,0.95)", color: "#1a1a2e", borderRadius: "10px", padding: "10px 13px", fontSize: "14px", lineHeight: "1.65", flex: 1, border: "1px solid rgba(212,175,55,0.5)" }}>
                          {/* Left-pointing triangle */}
                          <div style={{ position: "absolute", left: "-8px", top: "14px", width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderRight: "8px solid rgba(240,236,220,0.95)" }} />
                          {/* Short deterministic caption */}
                          <div style={{ fontWeight: 600, marginBottom: "8px" }}>{move.explanation}</div>
                          <div style={{ fontSize: "12.5px", opacity: 0.85 }}>
                            Best move: <strong>{move.best_move}</strong>
                          </div>
                          {/* Plays the engine's actual recommended continuation out on the
                              board, evaluated move by move, until the position settles down. */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startExplore(move);
                            }}
                            disabled={exploreLoadingFor === move.move_index}
                            style={{
                              marginTop: "8px",
                              fontSize: "12.5px",
                              fontWeight: 600,
                              padding: "5px 10px",
                              borderRadius: "6px",
                              border: "1px solid rgba(26,26,46,0.3)",
                              background: exploring?.moveIndex === move.move_index ? "rgba(212,175,55,0.35)" : "rgba(26,26,46,0.08)",
                              color: "#1a1a2e",
                              cursor: exploreLoadingFor === move.move_index ? "default" : "pointer",
                            }}
                          >
                            {exploreLoadingFor === move.move_index
                              ? "Loading…"
                              : exploring?.moveIndex === move.move_index
                              ? "▶ Exploring this line"
                              : "▶ Explore best line on board"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* PGN move list — fills remaining space, scrolls internally */}
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "10px",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
              Moves
            </div>
            {sanMoves.length === 0 ? (
              <span style={{ fontSize: "12px", opacity: 0.4 }}>Paste a PGN to see moves</span>
            ) : (
              <div style={{ fontSize: "13px", fontFamily: "monospace", lineHeight: "2" }}>
                {Array.from({ length: Math.ceil(sanMoves.length / 2) }, (_, i) => {
                  const whiteIdx = i * 2 + 1;
                  const blackIdx = i * 2 + 2;
                  const whiteActive = boardIndex === whiteIdx;
                  const blackActive = boardIndex === blackIdx;
                  const activeStyle: React.CSSProperties = {
                    background: "#d4af37", color: "#1a1a2e",
                    borderRadius: "3px", padding: "1px 4px",
                    cursor: "pointer", fontWeight: 700,
                  };
                  const inactiveStyle: React.CSSProperties = {
                    padding: "1px 4px", cursor: "pointer", color: "#c8bfb0",
                  };
                  return (
                    <span key={i} style={{ display: "inline" }}>
                      <span style={{ color: "rgba(232,224,208,0.35)", marginRight: "2px" }}>{i + 1}.</span>
                      <span
                        ref={whiteActive ? activeItemRef : null}
                        style={whiteActive ? activeStyle : inactiveStyle}
                        onClick={() => { if (exploring) setExploring(null); setBoardIndex(whiteIdx); setSelectedMove(null); playMoveSound(whiteIdx); }}
                      >
                        {sanMoves[i * 2]}
                      </span>
                      {sanMoves[i * 2 + 1] && (
                        <>
                          {" "}
                          <span
                            ref={blackActive ? activeItemRef : null}
                            style={blackActive ? activeStyle : inactiveStyle}
                            onClick={() => { if (exploring) setExploring(null); setBoardIndex(blackIdx); setSelectedMove(null); playMoveSound(blackIdx); }}
                          >
                            {sanMoves[i * 2 + 1]}
                          </span>
                        </>
                      )}
                      {"  "}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "14px 0", flexShrink: 0 }} />

          {/* Controls — PGN paste box + color selector + analyse button */}
          <div style={{ flexShrink: 0 }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Paste PGN
            </label>
            <textarea
              value={pgn}
              onChange={(e) => { setPgn(e.target.value); setBoardIndex(0); setSelectedMove(null); }}
              rows={6}
              style={{
                width: "100%", marginTop: "6px", padding: "10px",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "6px", color: "#e8e0d0", fontSize: "12px",
                resize: "vertical", fontFamily: "monospace",
              }}
            />
            <div style={{ marginTop: "10px", display: "flex", gap: "12px" }}>
              {["white", "black"].map((c) => (
                <button key={c} onClick={() => setColor(c)} style={{
                  flex: 1, padding: "14px 0", fontSize: "17px", fontWeight: 700,
                  borderRadius: "8px", cursor: "pointer",
                  border: color === c ? "2px solid #d4af37" : "2px solid rgba(255,255,255,0.15)",
                  background: color === c ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.06)",
                  color: color === c ? "#d4af37" : "#c8bfb0",
                  letterSpacing: "0.03em", transition: "all 0.15s",
                }}>
                  {c === "white" ? "♙ White" : "♟ Black"}
                </button>
              ))}
            </div>
            <button onClick={analyzeGame} disabled={loading} style={{
              width: "100%", marginTop: "12px", padding: "16px 0",
              fontSize: "18px", fontWeight: 700, borderRadius: "8px",
              cursor: loading ? "not-allowed" : "pointer", border: "none",
              background: loading ? "rgba(212,175,55,0.2)" : "rgba(212,175,55,0.9)",
              color: loading ? "#a89040" : "#1a1a2e", letterSpacing: "0.04em",
            }}>
              {loading ? "Analysing…" : "Analyse Game"}
            </button>
            {loading && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: "rgba(200,191,176,0.6)", textAlign: "center" }}>
                Analysing positions… this may take a moment
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Modal overlay */}
      {modal && result && (
        <div
          onClick={() => setModal(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(160deg, #1a1a3e, #24243e)",
              border: "1px solid rgba(212,175,55,0.4)",
              borderRadius: "12px",
              padding: "28px 32px",
              maxWidth: "768px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}
          >
            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#d4af37" }}>
                {modal === "summary" ? "📋 Game Summary" : "🎓 Lessons from this Game"}
              </h2>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: "none", border: "none", color: "#e8e0d0",
                  fontSize: "20px", cursor: "pointer", lineHeight: 1, opacity: 0.7,
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal content */}
            {modal === "summary" && (
              <ul style={{ margin: 0, padding: "0 0 0 20px", listStyle: "disc" }}>
                {(result.game_summary ?? "")
                  .split(/(?<=\.)\s+/)
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.length > 0)
                  .map((sentence: string, i: number) => (
                    <li key={i} style={{ color: "rgba(232,224,208,0.88)", fontSize: "16px", lineHeight: "1.75", marginBottom: "6px" }}>
                      {sentence.endsWith(".") ? sentence : sentence + "."}
                    </li>
                  ))}
              </ul>
            )}

            {modal === "lessons" && (
              <ul style={{ margin: 0, padding: "0 0 0 20px", listStyle: "disc" }}>
                {(result.lessons ?? []).map((lesson: string, i: number) => (
                  <li key={i} style={{ color: "rgba(232,224,208,0.88)", fontSize: "16px", lineHeight: "1.75", marginBottom: "10px" }}>
                    {lesson}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
