import { Injectable, BadRequestException } from '@nestjs/common';
import { GameModeStrategy } from './game-mode.strategy';
import { RoomState, Player } from '../domain/interfaces/game.interface';
import { WordHintService } from '../services/word-hint.service';
import { GameRulesEngine } from '../domain/game-rules.engine';


@Injectable()
export class ModeAStrategy implements GameModeStrategy {
  constructor(private readonly wordHintService: WordHintService) {}

  setupRound(room: RoomState): void {
    room.currentWord = null;
    room.obfuscatedWord = null;

    const drawerIndex = ((room.roundNumber ?? 1) - 1) % room.players.length;
    room.players[drawerIndex].isDrawing = true;
    room.drawerId = room.players[drawerIndex].id;
    room.guesserId = null;

    room.phase = 'WORD_SELECTION';
    room.timeLeft = 20; // 20s to select word
  }

  handleTick(room: RoomState): void {
    if (!room.currentWord) return;

    const totalTime = room.settings?.drawTimeLimit || 60;
    const t75 = Math.floor(totalTime * 0.75);
    const t50 = Math.floor(totalTime * 0.50);
    const t25 = Math.floor(totalTime * 0.25);

    let shouldReveal = false;
    const hintsRevealed = room.hintsRevealed || 0;

    if (room.timeLeft <= t75 && hintsRevealed === 0) {
      room.hintsRevealed = 1;
      shouldReveal = true;
    } else if (room.timeLeft <= t50 && hintsRevealed === 1) {
      room.hintsRevealed = 2;
      shouldReveal = true;
    } else if (room.timeLeft <= t25 && hintsRevealed === 2) {
      room.hintsRevealed = 3;
      shouldReveal = true;
    }

    if (shouldReveal) {
      const word = room.currentWord;
      const revealed = room.revealedIndexes || [];
      const unrevealedIndexes: number[] = [];

      for (let i = 0; i < word.length; i++) {
        if (word[i] !== ' ' && !revealed.includes(i)) {
          unrevealedIndexes.push(i);
        }
      }

      if (unrevealedIndexes.length > 1) {
        const randIndex = unrevealedIndexes[Math.floor(Math.random() * unrevealedIndexes.length)];
        revealed.push(randIndex);
        room.revealedIndexes = revealed;
        room.obfuscatedWord = this.wordHintService.getObfuscatedWordWithHints(word, revealed);
      }
    }
  }

  handleTimeOver(room: RoomState): 'reveal' | 'next_round' | 'no_op' {
    return 'reveal';
  }

  handleSubmitDrawing(room: RoomState, socketId: string, strokes: any[]): { shouldEndRoundEarly: boolean } {
    return { shouldEndRoundEarly: false };
  }

  handleGuess(
    room: RoomState,
    player: Player,
    text: string
  ): { isCorrect: boolean; systemMessage?: string; shouldEndRoundEarly?: boolean } {
    if (!room.currentWord) return { isCorrect: false };

    const isCorrect = GameRulesEngine.isCorrectGuess(text, room.currentWord);
    if (isCorrect) {
      const timeLimit = room.settings?.drawTimeLimit || 60;
      const drawerGain = 30;
      const guesserGain = GameRulesEngine.calculateScoreGain(room.timeLeft, timeLimit);

      player.score += guesserGain;
      player.hasGuessedCorrectly = true;

      const drawer = room.players.find((p) => p.id === room.drawerId);
      if (drawer) {
        drawer.score += drawerGain;
      }

      const guessers = room.players.filter((p) => p.id !== room.drawerId);
      const allGuessed = guessers.every((p) => p.hasGuessedCorrectly);

      return {
        isCorrect: true,
        systemMessage: `${player.name} đã đoán chính xác từ khóa! (+${guesserGain} điểm)`,
        shouldEndRoundEarly: allGuessed && guessers.length > 0
      };
    }

    return { isCorrect: false };
  }

  validateSelectWord(room: RoomState, playerId: string): void {
    if (room.drawerId !== playerId) {
      throw new BadRequestException('Chỉ họa sĩ mới được chọn từ khóa!');
    }
  }

  getWordSelectionMessage(room: RoomState): string {
    return `Họa sĩ đã chọn từ khóa có ${room.currentWord?.length || 0} chữ cái!`;
  }

  getNewRoundMessage(room: RoomState): string {
    return `Vòng ${room.roundNumber} bắt đầu. Đang chọn từ khóa...`;
  }

  checkEarlyRoundEnd(room: RoomState): boolean {
    if (!room.currentWord) return false;
    const guessers = room.players.filter((p) => p.id !== room.drawerId);
    const allGuessed = guessers.every((p) => p.hasGuessedCorrectly);
    return allGuessed && guessers.length > 0;
  }
}
