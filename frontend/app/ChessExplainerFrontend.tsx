"use client";

import React, { useMemo, useState } from "react";
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

const QUALITY_CARD_COLORS: Record<string, string> = {
  blunder: "#ffd6d6",
  mistake: "#ffe4cc",
  inaccuracy: "#fff9c4",
  good: "#d4edda",
};

const QUALITY_HIGHLIGHT_COLORS: Record<string, string> = {
  blunder: "rgba(255,0,0,0.4)",
  mistake: "rgba(255,165,0,0.4)",
  inaccuracy: "rgba(255,255,0,0.4)",
};

export default function ChessExplainerFrontend() {
  const [pgn, setPgn] = useState(SAMPLE_PGN);
  const [color, setColor] = useState("white");
  const [boardIndex, setBoardIndex] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMove, setSelectedMove] = useState<any>(null);


  async function analyzeGame() {
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
    } catch (error) {
      console.error("Analysis failed:", error);
    }
    setLoading(false);
  }

  const positions = useMemo(() => buildPositionsFromPgn(pgn), [pgn]);

const displayFen = selectedMove ? selectedMove.fen_before : positions[boardIndex];
const selectedMovePositionIndex =
  selectedMove ? positions.findIndex((fen) => fen === selectedMove.fen_before) : -1;
  // Eval bar: cap at ±1000 centipawns (±10 pawns)
  const clampedEval = selectedMove
    ? Math.max(-1000, Math.min(1000, selectedMove.eval_before))
    : 0;
  const whitePct = ((clampedEval + 1000) / 2000) * 100;
  const blackPct = 100 - whitePct;

  // Square highlight for user's move_to square
  const squareStyles = selectedMove && QUALITY_HIGHLIGHT_COLORS[selectedMove.quality]
    ? { [selectedMove.move_to]: { backgroundColor: QUALITY_HIGHLIGHT_COLORS[selectedMove.quality] } }
    : {};

  // Green arrow showing the best engine move
  const arrows = selectedMove?.best_move_from && selectedMove?.best_move_to
    ? [{ startSquare: selectedMove.best_move_from, endSquare: selectedMove.best_move_to, color: "green" }]
    : [];

  return (
    <main style={{ padding: "24px", fontFamily: "Arial, sans-serif" }}>
      <h1>Chess Explainer</h1>

      <div style={{ display: "grid", gridTemplateColumns: "40px 480px 1fr", gap: "16px", alignItems: "start" }}>

        {/* Column 1: Eval bar */}
        <div
          style={{
            width: "40px",
            height: "480px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          <div style={{ background: "#1a1a1a", height: `${blackPct}%` }} />
          <div style={{ background: "#f0f0f0", height: `${whitePct}%` }} />
        </div>

        {/* Column 2: Board + navigator */}
        <div style={{ width: "480px" }}>
          <div style={{ marginBottom: "8px", fontSize: "12px", wordBreak: "break-all" }}>
          <strong>displayFen:</strong> {displayFen}
        </div>
<div style={{ width: "480px" }}>
  <Chessboard
    options={{
      position: displayFen,
      allowDragging: false,
      squareStyles: squareStyles,
      arrows: arrows,
    }}
  />
</div>
          <div style={{ marginTop: "12px", display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              onClick={() => {
                setBoardIndex(Math.max(boardIndex - 1, 0));
                setSelectedMove(null);
              }}
            >
              Previous
            </button>
            <button
              onClick={() => {
                setBoardIndex(Math.min(boardIndex + 1, positions.length - 1));
                setSelectedMove(null);
              }}
            >
              Next
            </button>
<span>
  {selectedMove
    ? `Showing analysis position: ${selectedMovePositionIndex + 1} / ${positions.length}`
    : `Position ${boardIndex + 1} / ${positions.length}`}
</span>
          </div>
        </div>

        {/* Column 3: Controls + analysis */}
        <div>
          <label>
            <strong>Paste PGN</strong>
          </label>
          <br />
          <textarea
            value={pgn}
            onChange={(e) => {
              setPgn(e.target.value);
              setBoardIndex(0);
              setSelectedMove(null);
            }}
            rows={10}
            style={{ width: "100%", marginTop: "8px", padding: "10px", boxSizing: "border-box" }}
          />

          <div style={{ marginTop: "16px" }}>
            <strong>I played</strong>
            <div style={{ marginTop: "8px" }}>
              <label style={{ marginRight: "16px" }}>
                <input
                  type="radio"
                  value="white"
                  checked={color === "white"}
                  onChange={(e) => setColor(e.target.value)}
                />{" "}
                White
              </label>
              <label>
                <input
                  type="radio"
                  value="black"
                  checked={color === "black"}
                  onChange={(e) => setColor(e.target.value)}
                />{" "}
                Black
              </label>
            </div>
            <div style={{ marginTop: "16px" }}>
              <button onClick={analyzeGame} disabled={loading}>
                {loading ? "Analyzing..." : "Analyze Game"}
              </button>
            </div>
          </div>

          {result && (
            <div style={{ marginTop: "24px" }}>
              <h2>Analysis Result</h2>
              {result.critical_moves.map((move: any, index: number) => (
                <div
                  key={index}
                  onClick={() => {
                    const moveIndex = positions.findIndex((fen) => fen === move.fen_before);
                  setSelectedMove(move);
                if  (moveIndex !== -1) {
                setBoardIndex(moveIndex);
                
              }
                  }}
                  style={{
                    marginBottom: "16px",
                    padding: "12px",
                    background: QUALITY_CARD_COLORS[move.quality] ?? "#f3f3f3",
                    borderRadius: "8px",
                    color: "#111",
                    cursor: "pointer",
                    outline: selectedMove === move ? "2px solid #333" : "none",
                  }}
                >
                  <strong>Move:</strong> {move.move} <br />
                  <strong>Best Move:</strong> {move.best_move} <br />
                  <strong>Quality:</strong> {move.quality}
                  <p style={{ marginTop: "8px" }}>{move.explanation}</p>
                </div>
              ))}

              <div style={{ marginTop: "20px" }}>
                <h3>Game Summary</h3>
                <p style={{ lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                  {result.game_summary}
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
