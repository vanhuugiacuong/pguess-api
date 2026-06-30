import { Injectable, BadRequestException } from '@nestjs/common';
import { GameModeStrategy } from './game-mode.strategy';
import { RoomState, Player, ModeBChain } from '../domain/interfaces/game.interface';
import { GameRulesEngine } from '../domain/game-rules.engine';

@Injectable()
export class ModeBStrategy implements GameModeStrategy {
  setupRound(room: RoomState): void {
    const R = room.roundNumber ?? 1;
    const N = room.players.length;

    const k = Math.floor((R - 1) / N);
    const r = ((R - 1) % N) + 1;

    if (R === 1) {
      room.modeBChains = [];
      room.players.forEach((p) => {
        p.score = 0;
        p.drawingData = undefined;
        p.drawingWord = undefined;
        p.hasGuessedCorrectly = false;
        p.isDrawing = false;
      });
    }

    // Reset loop variables for all players on new round
    room.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessedCorrectly = false;
    });

    // Reset room finalGuess fields for the current chain segment
    room.finalGuess = null;
    room.finalGuessIsCorrect = undefined;

    // Determine guesser for the current chain k
    const guesserIndex = (k - 1 + N) % N;
    room.guesserId = room.players[guesserIndex].id;

    if (r === 1) {
      // First round of chain: drawer is player k
      room.drawerId = room.players[k].id;
      room.currentWord = null;
      room.obfuscatedWord = null;
      room.phase = 'WORD_SELECTION';
      room.timeLeft = 20; // 20s to select word
    } else {
      const isDrawingTurn = r < N;
      if (isDrawingTurn) {
        // Drawing step
        const activeDrawerIndex = (k + r - 1) % N;
        const activeDrawer = room.players[activeDrawerIndex];
        activeDrawer.isDrawing = true;
        room.drawerId = activeDrawer.id;
      } else {
        // Guessing step
        room.drawerId = null;
      }

      room.phase = 'PLAYING';
      room.timeLeft = room.settings?.drawTimeLimit || 60;
    }
  }

  handleTick(room: RoomState): void {
    // No hints in Gartic Phone Chain mode
  }

  handleTimeOver(room: RoomState): 'reveal' | 'next_round' | 'no_op' {
    const R = room.roundNumber ?? 1;
    const N = room.players.length;
    const r = ((R - 1) % N) + 1;

    if (r < N) {
      return 'next_round';
    } else {
      return 'reveal';
    }
  }

  handleSubmitDrawing(room: RoomState, socketId: string, strokes: any[]): { shouldEndRoundEarly: boolean } {
    if (room.phase === 'PLAYING') {
      const R = room.roundNumber ?? 1;
      const N = room.players.length;
      const r = ((R - 1) % N) + 1;
      const k = Math.floor((R - 1) / N);

      const isDrawingTurn = r < N;
      if (isDrawingTurn && room.drawerId === socketId) {
        // Save drawing to modeBChains
        if (room.modeBChains && room.modeBChains[k]) {
          const drawer = room.players.find((p) => p.id === socketId);
          room.modeBChains[k].steps.push({
            type: 'drawing',
            player: {
              id: socketId,
              name: drawer?.name || 'Họa sĩ',
              avatar: drawer?.avatar,
            },
            content: strokes,
            index: room.modeBChains[k].steps.length,
          });
        }

        // Save on player model for local view
        const drawerPlayer = room.players.find((p) => p.id === socketId);
        if (drawerPlayer) {
          drawerPlayer.drawingData = strokes;
        }

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
    const N = room.players.length;
    const R = room.roundNumber ?? 1;
    const r = ((R - 1) % N) + 1;
    const isGuessingRound = r === N;

    if (!isGuessingRound || room.phase !== 'PLAYING') {
      return { isCorrect: false };
    }

    // Only the designated guesser can guess
    if (player.id !== room.guesserId) {
      return { isCorrect: false };
    }

    const result = this.handleModeBGuess(room, player.id, text);
    return {
      isCorrect: result.isCorrect,
      systemMessage: result.systemMessage,
      shouldEndRoundEarly: result.isCorrect,
    };
  }

  handleModeBGuess(room: RoomState, socketId: string, guess: string): { isCorrect: boolean; systemMessage?: string } {
    const N = room.players.length;
    const R = room.roundNumber ?? 1;
    const k = Math.floor((R - 1) / N);

    const guesser = room.players.find((p) => p.id === socketId);
    if (!guesser) return { isCorrect: false };

    const isCorrect = GameRulesEngine.isCorrectGuess(guess, room.currentWord || '');

    // Save final guess in state
    room.finalGuess = guess;
    room.finalGuessIsCorrect = isCorrect;

    // Save guess in modeBChains
    if (room.modeBChains && room.modeBChains[k]) {
      const chain = room.modeBChains[k];
      let guessStep = chain.steps.find((s) => s.type === 'guess');
      if (!guessStep) {
        guessStep = {
          type: 'guess',
          player: {
            id: socketId,
            name: guesser.name,
            avatar: guesser.avatar,
          },
          content: `Đoán là: "${guess}"`,
          isCorrect: isCorrect,
        };
        chain.steps.push(guessStep);
      } else {
        guessStep.content = `Đoán là: "${guess}"`;
        guessStep.isCorrect = isCorrect;
      }
    }

    if (isCorrect) {
      guesser.hasGuessedCorrectly = true;
      const baseGain = 100;
      const timeLeftBonus = Math.floor((room.timeLeft || 0) * 2);
      const points = baseGain + timeLeftBonus;
      guesser.score += points;

      // Give host/owner points
      if (room.modeBChains && room.modeBChains[k]) {
        const ownerId = room.modeBChains[k].ownerId;
        const owner = room.players.find((p) => p.id === ownerId);
        if (owner) {
          owner.score += 50;
        }
      }
    }

    const systemMessage = `đã đoán: "${guess}" - ${isCorrect ? 'CHÍNH XÁC! 🎉' : 'SAI RỒI ❌'}`;

    return { isCorrect, systemMessage };
  }

  validateSelectWord(room: RoomState, playerId: string): void {
    const N = room.players.length;
    const R = room.roundNumber ?? 1;
    const r = ((R - 1) % N) + 1;

    if (r !== 1) {
      throw new BadRequestException('Chỉ được chọn từ khóa ở vòng 1 của chuỗi!');
    }
    if (room.drawerId !== playerId) {
      throw new BadRequestException('Chỉ họa sĩ đầu tiên mới được chọn từ khóa!');
    }
  }

  getWordSelectionMessage(room: RoomState): string {
    const drawer = room.players.find((p) => p.id === room.drawerId);
    return `${drawer?.name || 'Họa sĩ'} đã chọn từ khóa ban đầu cho chuỗi truyền tay!`;
  }

  getNewRoundMessage(room: RoomState): string {
    const N = room.players.length;
    const R = room.roundNumber ?? 1;
    const r = ((R - 1) % N) + 1;
    const k = Math.floor((R - 1) / N);

    if (r === 1) {
      const drawer = room.players.find((p) => p.id === room.drawerId);
      return `Chuỗi truyền tay số ${k + 1} bắt đầu! Họa sĩ ${drawer?.name || 'Họa sĩ'} chuẩn bị ra từ khóa!`;
    } else if (r < N) {
      const drawer = room.players.find((p) => p.id === room.drawerId);
      return `Vòng ${r} của chuỗi bắt đầu. Họa sĩ ${drawer?.name || 'Họa sĩ'} đang vẽ!`;
    } else {
      const guesser = room.players.find((p) => p.id === room.guesserId);
      return `Lượt đoán của ${guesser?.name || 'Người đoán'} đã bắt đầu!`;
    }
  }

  checkEarlyRoundEnd(room: RoomState): boolean {
    const N = room.players.length;
    const R = room.roundNumber ?? 1;
    const r = ((R - 1) % N) + 1;

    if (r === N) {
      const guesser = room.players.find((p) => p.id === room.guesserId);
      return guesser ? guesser.hasGuessedCorrectly : false;
    }
    return false;
  }
}
