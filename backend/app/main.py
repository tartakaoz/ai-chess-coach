from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.chess_analyzer import analyze_game, explore_line

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class GameInput(BaseModel):
    pgn: str
    color: str

class ExploreInput(BaseModel):
    fen: str
    first_move: str

@app.get("/")
def root():
    return {"message": "Chess Explainer API running"}

@app.post("/analyze")
def analyze(input: GameInput):
    result = analyze_game(input.pgn, input.color)
    return result

@app.post("/explore")
def explore(input: ExploreInput):
    return explore_line(input.fen, input.first_move)