export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  isDrawing: boolean;
  hasGuessedCorrectly: boolean;
  avatar?: string;
}

export interface GameSettings {
  mode: 'A' | 'B';
  drawTimeLimit: number; // in seconds
  revealTimeLimit: number; // in seconds
  botCount: number;
  wordCategory: string;
}

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  points: DrawPoint[];
  color: string;
  width: number;
  isEraser: boolean;
}

export interface RoomState {
  roomId: string; // NestJS requested field
  id: string;     // Angular compatibility field (same as roomId)
  players: Player[];
  phase: 'LOBBY' | 'WORD_SELECTION' | 'PLAYING' | 'REVEAL' | 'GAME_OVER';
  currentTurnPlayerId: string | null;
  guesserId: string | null;
  currentWord: string | null;
  timeLeft: number;
}
