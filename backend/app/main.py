from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.chess_analyzer import analyze_game

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GameInput(BaseModel):
    pgn: str
    color: str

@app.get("/")
def root():
    return {"message": "Chess Explainer API running"}

@app.post("/analyze")
def analyze(input: GameInput):
    result = analyze_game(input.pgn, input.color)
    return result