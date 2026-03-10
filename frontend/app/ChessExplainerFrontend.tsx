"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

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
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<"summary" | "lessons" | null>(null);


  const analyzeGame = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:8000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, color }),
      });
      const data = await response.json();
      setResult(data);
      setSelectedMove(null);
      setBoardIndex(0);
    } catch (error) {
      console.error("Analysis failed:", error);
    }
    setLoading(false);
    mainRef.current?.focus();
  }, [pgn, color]);

  const positions = useMemo(() => buildPositionsFromPgn(pgn), [pgn]);

  // Per-index from/to squares + move flags for sound detection
  const moveHistory = useMemo(() => {
    let source: InstanceType<typeof Chess>;
    try { source = new Chess(); source.loadPgn(pgn); } catch { return [null]; }
    const sans = source.history();           // plain SAN strings from the loaded game
    const viewer = new Chess();              // fresh board replayed move by move
    const history: ({ from: string; to: string; flags: string; san: string; isCheck: boolean; isCheckmate: boolean } | null)[] = [null];
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

  const soundsRef = useRef<Record<string, HTMLAudioElement>>({});
  useEffect(() => {
    soundsRef.current = {
      move:      new Audio("https://lichess1.org/assets/sound/standard/Move.ogg"),
      capture:   new Audio("https://lichess1.org/assets/sound/standard/Capture.ogg"),
      castle:    new Audio("https://lichess1.org/assets/sound/standard/Castle.ogg"),
      promote:   new Audio("https://lichess1.org/assets/sound/standard/Promote.ogg"),
      check:     new Audio("https://lichess1.org/assets/sound/standard/Check.ogg"),
      checkmate: new Audio("https://lichess1.org/assets/sound/standard/GenericNotify.ogg"),
    };
  }, []);

  const playMoveSound = useCallback((index: number) => {
    if (index === 0) return;
    const move = moveHistory[index];
    if (!move) return;
    console.log('SAN:', JSON.stringify(move.san), '| flags:', move.flags, '| isCheck:', move.isCheck, '| isCheckmate:', move.isCheckmate);
    const isCastle = move.san === "O-O-O" || move.san === "O-O";
    const isPromotion = move.flags.includes("p");
    const isCapture = move.flags.includes("c") || move.flags.includes("e");
    let key = "move";
    if (move.isCheckmate)  key = "checkmate";
    else if (move.isCheck) key = "check";
    else if (isCastle)     key = "castle";
    else if (isPromotion)  key = "promote";
    else if (isCapture)    key = "capture";
    const snd = soundsRef.current[key];
    if (snd) { (snd.cloneNode() as HTMLAudioElement).play().catch(() => {}); }
  }, [moveHistory]);

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
        const prev = Math.max(boardIndexRef.current - 1, 0);
        setBoardIndex(prev);
        setSelectedMove(null);
        if (prev > 0) { const s = soundsRef.current["move"]; if (s) (s.cloneNode() as HTMLAudioElement).play().catch(() => {}); }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext]);

const displayFen = selectedMove ? selectedMove.fen_after : positions[boardIndex];
  // Eval bar: cap at ±1000 centipawns (±10 pawns)
  const evalCp = selectedMove
  ? selectedMove.eval_after
: result?.position_evals?.find((p: any) => p.move_index === boardIndex)?.eval ?? 0;

      const perspectiveEval = color === "black" ? -evalCp : evalCp;
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

  const squareColorMap: Record<string, string> = {};
  if (lastMove) {
    squareColorMap[lastMove.from] = moveQualityColor;
    squareColorMap[lastMove.to] = moveQualityColor;
  }

  // Green arrow showing the best engine move
  const arrows = selectedMove?.best_move_from && selectedMove?.best_move_to
    ? [{ startSquare: selectedMove.best_move_from, endSquare: selectedMove.best_move_to, color: "green" }]
    : [];

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

        {/* Left column: fixed width, board flush to left edge */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: "12px" }}>

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

          {/* Navigator */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button style={btnStyle} onClick={() => { setBoardIndex(0); setSelectedMove(null); }}>⏮</button>
            <button style={btnStyle} onClick={() => {
              const prev = Math.max(boardIndex - 1, 0);
              setBoardIndex(prev);
              setSelectedMove(null);
              if (prev > 0) { const s = soundsRef.current["move"]; if (s) (s.cloneNode() as HTMLAudioElement).play().catch(() => {}); }
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
              {result.critical_moves.map((move: any, index: number) => {
                const isExpanded = expandedCards.has(move.move_index);
                return (
                  <div
                    key={index}
                    onClick={() => {
                      setSelectedMove(move);
                      setBoardIndex(move.move_index);
                      playMoveSound(move.move_index);
                      setExpandedCards((prev) => {
                        const next = new Set(prev);
                        next.has(move.move_index) ? next.delete(move.move_index) : next.add(move.move_index);
                        return next;
                      });
                    }}
                    style={{
                      marginBottom: "10px", padding: "10px 12px",
                      background: QUALITY_CARD_COLORS[move.quality] ?? "rgba(255,255,255,0.05)",
                      borderRadius: "8px",
                      border: selectedMove === move ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.1)",
                      color: "#e8e0d0", cursor: "pointer", fontSize: "13px", lineHeight: "1.6",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <div>
                        <span style={{ color: "#d4af37", fontWeight: 700, marginRight: "6px" }}>{formatMoveLabel(move.move_index)}</span>
                        <span style={{ fontWeight: 600 }}>{move.move}</span>
                        <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
                        <span style={{ fontSize: "12px", opacity: 0.75 }}>Best: {move.best_move}</span>
                        <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
                        <span style={{ fontSize: "12px" }}>
                          {QUALITY_ICONS[move.quality]}{" "}
                          <span style={{ textTransform: "capitalize" }}>{move.quality}</span>
                        </span>
                      </div>
                      <span style={{ fontSize: "11px", opacity: 0.5, flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                    {isExpanded && (
                      <p style={{ margin: "8px 0 0", color: "rgba(232,224,208,0.8)", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px" }}>
                        {move.explanation}
                      </p>
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
                        onClick={() => { setBoardIndex(whiteIdx); setSelectedMove(null); playMoveSound(whiteIdx); }}
                      >
                        {sanMoves[i * 2]}
                      </span>
                      {sanMoves[i * 2 + 1] && (
                        <>
                          {" "}
                          <span
                            ref={blackActive ? activeItemRef : null}
                            style={blackActive ? activeStyle : inactiveStyle}
                            onClick={() => { setBoardIndex(blackIdx); setSelectedMove(null); playMoveSound(blackIdx); }}
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
              maxWidth: "560px",
              width: "100%",
              maxHeight: "80vh",
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
                {result.game_summary
                  .split(/(?<=\.)\s+/)
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.length > 0)
                  .map((sentence: string, i: number) => (
                    <li key={i} style={{ color: "rgba(232,224,208,0.88)", fontSize: "14px", lineHeight: "1.75", marginBottom: "6px" }}>
                      {sentence.endsWith(".") ? sentence : sentence + "."}
                    </li>
                  ))}
              </ul>
            )}

            {modal === "lessons" && (
              <ul style={{ margin: 0, padding: "0 0 0 20px", listStyle: "disc" }}>
                {result.lessons.map((lesson: string, i: number) => (
                  <li key={i} style={{ color: "rgba(232,224,208,0.88)", fontSize: "14px", lineHeight: "1.75", marginBottom: "10px" }}>
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
