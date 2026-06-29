import { Injectable } from '@nestjs/common';
import { GameModeStrategy } from './game-mode.strategy';
import { RoomState, Player } from '../domain/interfaces/game.interface';
import { GameRulesEngine } from '../domain/game-rules.engine';

@Injectable()
export class ModeBStrategy implements GameModeStrategy {
  setupRound(room: RoomState): void {
    const roundNumber = room.roundNumber ?? 1;
    if (roundNumber === 1) {
      room.guesserId = room.players[room.players.length - 1].id;
      room.drawerId = room.players[0].id;
      room.finalGuess = null;
      room.finalGuessIsCorrect = undefined;

      room.currentWord = null;
      room.obfuscatedWord = null;

      room.players.forEach((p) => {
        p.drawingData = undefined;
      });

      room.phase = 'WORD_SELECTION';
      room.timeLeft = 20; // 20s to select word
    } else {
      // Mode B rounds > 1
      const isDrawingTurn = roundNumber < room.players.length;
      if (isDrawingTurn) {
        const activeDrawerIndex = roundNumber - 1;
        const activeDrawer = room.players[activeDrawerIndex];
        activeDrawer.isDrawing = true;
        room.drawerId = activeDrawer.id;
      } else {
        room.drawerId = null;
      }

      room.phase = 'PLAYING';
      room.timeLeft = room.settings?.drawTimeLimit || 60;
    }
  }

  handleTick(room: RoomState): void {
    // Mode B has no active tick operations
  }

  handleTimeOver(room: RoomState): 'reveal' | 'next_round' | 'no_op' {
    const isDrawingTurn = (room.roundNumber ?? 1) < room.players.length;
    if (isDrawingTurn) {
      return 'next_round';
    } else {
      return 'reveal';
    }
  }

  handleSubmitDrawing(room: RoomState, socketId: string, strokes: any[]): { shouldEndRoundEarly: boolean } {
    if (room.phase === 'PLAYING') {
      const isDrawingTurn = (room.roundNumber ?? 1) < room.players.length;
      if (isDrawingTurn && room.drawerId === socketId) {
        return { shouldEndRoundEarly: true };
      }
    }
    return { shouldEndRoundEarly: false };
  }

  handleGuess(
    room: RoomState,
    player: Player,
    text: string
  ): { isCorrect: boolean; systemMessage?: string; shouldEndRoundEarly?: boolean } {
    // Chat guess is not active/scored in Mode B gameplay phase
    return { isCorrect: false };
  }

  handleModeBGuess(room: RoomState, socketId: string, guess: string): { isCorrect: boolean; systemMessage?: string } {
    const guesser = room.players.find((p) => p.id === socketId);
    if (!guesser) return { isCorrect: false };

    const isCorrect = GameRulesEngine.isCorrectGuess(guess, room.currentWord || '');

    room.finalGuess = guess;
    room.finalGuessIsCorrect = isCorrect;

    const systemMessage = `đã đoán: "${guess}" - ${isCorrect ? 'CHÍNH XÁC! 🎉' : 'SAI RỒI ❌'}`;

    return { isCorrect, systemMessage };
  }
}
