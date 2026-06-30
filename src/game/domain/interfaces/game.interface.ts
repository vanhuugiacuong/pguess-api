export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  isDrawing: boolean;
  hasGuessedCorrectly: boolean;
  avatar?: string;
  drawingData?: any[];
  drawingWord?: string;
}

export interface GameSettings {
  mode: 'A' | 'B';
  drawTimeLimit: number; // in seconds
  revealTimeLimit: number; // in seconds
  botCount: number;
  wordCategory: string;
  customWordBank?: string[];
  maxPlayers?: number;
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
  drawerId?: string | null;
  currentWord: string | null;
  obfuscatedWord?: string | null;
  timeLeft: number;
  roundNumber?: number;
  maxRounds?: number;
  settings?: GameSettings;
  hostId?: string;
  finalGuess?: string | null;
  finalGuessIsCorrect?: boolean;
  revealedIndexes?: number[];
  hintsRevealed?: number;
  modeBChains?: ModeBChain[];
}

export interface ModeBChainStep {
  type: 'word' | 'drawing' | 'guess';
  player: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: any; // string for word/guess, any[] for drawing
  isCorrect?: boolean;
  index?: number;
}

export interface ModeBChain {
  ownerId: string;
  ownerName: string;
  word: string;
  steps: ModeBChainStep[];
}
