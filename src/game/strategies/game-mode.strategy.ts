import { RoomState, Player } from '../domain/interfaces/game.interface';

export interface GameModeStrategy {
  /** Configures round role allocations, resets state values, and sets up round start settings */
  setupRound(room: RoomState): void;

  /** Hook called on every second tick of the room timer (e.g. for hint reveals) */
  handleTick(room: RoomState): void;

  /** Action taken when the round timer reaches 0 or is forced finished */
  handleTimeOver(room: RoomState): 'reveal' | 'next_round' | 'no_op';

  /** Hook called when a player submits their canvas drawing */
  handleSubmitDrawing(room: RoomState, socketId: string, strokes: any[]): { shouldEndRoundEarly: boolean };

  /** Handles correct word guess checks, score calculations, and early round completion checks */
  handleGuess(
    room: RoomState,
    player: Player,
    text: string
  ): { isCorrect: boolean; systemMessage?: string; shouldEndRoundEarly?: boolean };

  /** Custom guess submission for Mode B final guesser */
  handleModeBGuess?(room: RoomState, socketId: string, guess: string): { isCorrect: boolean; systemMessage?: string };

  /** Validates if the player is allowed to select a word in the current phase and role */
  validateSelectWord(room: RoomState, playerId: string): void;

  /** Get system message to broadcast when a word has been selected */
  getWordSelectionMessage(room: RoomState): string;

  /** Get system message to broadcast when a new round starts */
  getNewRoundMessage(room: RoomState): string;

  /** Check if the playing phase should end early (e.g. all guessers guessed correctly in Mode A) */
  checkEarlyRoundEnd(room: RoomState): boolean;
}
