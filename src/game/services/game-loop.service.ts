import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { RoomRepositoryToken } from '../storage/room.repository';
import type { RoomRepository } from '../storage/room.repository';
import { RoomState } from '../domain/interfaces/game.interface';
import { GameRulesEngine } from '../domain/game-rules.engine';

const WORD_BANK = [
  'house', 'cat', 'tree', 'sun', 'car', 'flower', 'fish', 'cup', 'star', 'apple',
  'boat', 'bird', 'cake', 'hat', 'cloud', 'heart', 'moon', 'ball', 'book', 'face'
];

@Injectable()
export class GameLoopService {
  private roomTimers = new Map<string, { timer: NodeJS.Timeout }>();
  private roomCallbacks = new Map<
    string,
    {
      onStateUpdate: (state: RoomState) => void;
      onChatMessage?: (msg: any) => void;
    }
  >();

  constructor(
    @Inject(RoomRepositoryToken)
    private readonly roomRepository: RoomRepository,
  ) {}

  startGame(
    roomId: string,
    onStateUpdate: (state: RoomState) => void,
    onChatMessage?: (msg: any) => void,
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    this.roomCallbacks.set(room.roomId, { onStateUpdate, onChatMessage });
    room.roundNumber = 0;
    room.maxRounds = room.settings?.mode === 'A' ? room.players.length : 3;

    this.startNewRound(room.roomId);
    return room;
  }

  private startNewRound(roomId: string) {
    const room = this.roomRepository.get(roomId);
    if (!room) return;

    room.roundNumber = (room.roundNumber || 0) + 1;
    if (room.roundNumber > (room.maxRounds || 3)) {
      this.endGame(roomId);
      return;
    }

    room.players.forEach((p) => {
      p.hasGuessedCorrectly = false;
      p.isDrawing = false;
    });

    const randIndex = Math.floor(Math.random() * WORD_BANK.length);
    room.currentWord = WORD_BANK[randIndex];
    room.obfuscatedWord = GameRulesEngine.obfuscateWord(room.currentWord);

    const mode = room.settings?.mode || 'A';
    if (mode === 'A') {
      const drawerIndex = (room.roundNumber - 1) % room.players.length;
      room.players[drawerIndex].isDrawing = true;
      room.drawerId = room.players[drawerIndex].id;
      room.guesserId = null;
    } else {
      const guesserIndex = (room.roundNumber - 1) % room.players.length;
      room.guesserId = room.players[guesserIndex].id;
      room.drawerId = null;

      room.players.forEach((p) => {
        p.isDrawing = p.id !== room.guesserId;
      });
    }

    room.phase = 'PLAYING';
    room.timeLeft = room.settings?.drawTimeLimit || 60;

    this.roomRepository.save(roomId, room);

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-round-${room.roundNumber}-${Date.now()}`,
          playerId: 'system',
          playerName: 'Hệ thống',
          text: mode === 'A'
            ? `Vòng ${room.roundNumber} bắt đầu. ${room.players.find((p) => p.id === room.drawerId)?.name} đang vẽ!`
            : `Vòng ${room.roundNumber} bắt đầu. Mọi người vẽ từ khóa "${room.currentWord}". ${room.players.find((p) => p.id === room.guesserId)?.name} sẽ đoán!`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
    }

    this.startCountdown(roomId);
  }

  private startCountdown(roomId: string) {
    const existing = this.roomTimers.get(roomId);
    if (existing) {
      clearInterval(existing.timer);
    }

    const timer = setInterval(() => {
      const room = this.roomRepository.get(roomId);
      if (!room || room.phase !== 'PLAYING') {
        clearInterval(timer);
        this.roomTimers.delete(roomId);
        return;
      }

      if (room.timeLeft <= 1) {
        clearInterval(timer);
        this.roomTimers.delete(roomId);
        this.revealRoundResults(roomId);
      } else {
        if (room.settings?.mode === 'A') {
          const guessers = room.players.filter((p) => p.id !== room.drawerId);
          const allGuessed = guessers.every((p) => p.hasGuessedCorrectly);
          if (allGuessed && guessers.length > 0) {
            clearInterval(timer);
            this.roomTimers.delete(roomId);
            this.revealRoundResults(roomId);
            return;
          }
        }

        room.timeLeft--;
        this.roomRepository.save(roomId, room);
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(room);
      }
    }, 1000);

    this.roomTimers.set(roomId, { timer });
  }

  private revealRoundResults(roomId: string) {
    const room = this.roomRepository.get(roomId);
    if (!room) return;

    room.phase = 'REVEAL';
    room.timeLeft = room.settings?.revealTimeLimit || 10;
    this.roomRepository.save(roomId, room);

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-reveal-${Date.now()}`,
          playerId: 'system',
          playerName: 'Hệ thống',
          text: `Vòng chơi kết thúc! Từ khóa là "${room.currentWord}".`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
    }

    let revealTime = room.timeLeft;
    const timer = setInterval(() => {
      const currentRoom = this.roomRepository.get(roomId);
      if (!currentRoom || currentRoom.phase !== 'REVEAL') {
        clearInterval(timer);
        this.roomTimers.delete(roomId);
        return;
      }

      if (revealTime <= 1) {
        clearInterval(timer);
        this.roomTimers.delete(roomId);
        this.startNewRound(roomId);
      } else {
        revealTime--;
        currentRoom.timeLeft = revealTime;
        this.roomRepository.save(roomId, currentRoom);
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(currentRoom);
      }
    }, 1000);

    this.roomTimers.set(roomId, { timer });
  }

  private endGame(roomId: string) {
    const room = this.roomRepository.get(roomId);
    if (!room) return;

    room.phase = 'GAME_OVER';
    room.timeLeft = 0;
    this.roomRepository.save(roomId, room);

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);

      const sorted = [...room.players].sort((a, b) => b.score - a.score);
      const winner = sorted[0];
      if (cb.onChatMessage && winner) {
        cb.onChatMessage({
          id: `sys-gameover-${Date.now()}`,
          playerId: 'system',
          playerName: 'Hệ thống',
          text: `Trò chơi kết thúc! Người chiến thắng là ${winner.name} với ${winner.score} điểm! 🏆`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
    }

    this.roomCallbacks.delete(roomId);
    const timer = this.roomTimers.get(roomId);
    if (timer) {
      clearInterval(timer.timer);
      this.roomTimers.delete(roomId);
    }
  }

  handleChatMessage(
    roomId: string,
    socketId: string,
    text: string,
  ): { isCorrect: boolean; chatMsg: any } {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    const player = room.players.find((p) => p.id === socketId);
    if (!player) throw new NotFoundException('Player not found');

    let isCorrect = false;
    const mode = room.settings?.mode || 'A';

    if (mode === 'A' && room.phase === 'PLAYING') {
      const isDrawer = room.drawerId === socketId;
      if (!isDrawer && !player.hasGuessedCorrectly && room.currentWord) {
        if (GameRulesEngine.isCorrectGuess(text, room.currentWord)) {
          isCorrect = true;
          player.hasGuessedCorrectly = true;

          const scoreGain = GameRulesEngine.calculateScoreGain(
            room.timeLeft,
            room.settings?.drawTimeLimit || 60,
          );
          player.score += scoreGain;

          const drawer = room.players.find((p) => p.id === room.drawerId);
          if (drawer) {
            drawer.score += 30;
          }

          this.roomRepository.save(targetRoomId, room);
          const cb = this.roomCallbacks.get(room.roomId);
          if (cb) cb.onStateUpdate(room);
        }
      }
    }

    const chatMsg = {
      id: `msg-${Date.now()}-${Math.random()}`,
      playerId: socketId,
      playerName: player.name,
      text: isCorrect ? 'đã đoán chính xác từ khóa! 🎉' : text,
      timestamp: Date.now(),
      isSystem: isCorrect,
      isCorrectGuess: isCorrect,
    };

    return { isCorrect, chatMsg };
  }

  handleModeBGuess(
    roomId: string,
    socketId: string,
    guess: string,
  ): { isCorrect: boolean; chatMsg: any } {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    const guesser = room.players.find((p) => p.id === socketId);
    if (!guesser || room.guesserId !== socketId || room.phase !== 'PLAYING') {
      throw new BadRequestException('Not allowed to guess');
    }

    const isCorrect = GameRulesEngine.isCorrectGuess(guess, room.currentWord || '');

    if (isCorrect) {
      const score = GameRulesEngine.calculateModeBScoreGain(
        room.timeLeft,
        room.settings?.drawTimeLimit || 60,
      );
      guesser.score += score;

      room.players.forEach((p) => {
        if (p.id !== guesser.id) {
          p.score += 100;
        }
      });
    }

    this.roomRepository.save(targetRoomId, room);

    const chatMsg = {
      id: `msg-${Date.now()}`,
      playerId: socketId,
      playerName: guesser.name,
      text: `đã đoán: "${guess}" - ${isCorrect ? 'CHÍNH XÁC! 🎉' : 'SAI RỒI ❌'}`,
      timestamp: Date.now(),
      isSystem: true,
      isCorrectGuess: isCorrect,
    };

    const timer = this.roomTimers.get(room.roomId);
    if (timer) {
      clearInterval(timer.timer);
      this.roomTimers.delete(room.roomId);
    }
    this.revealRoundResults(room.roomId);

    return { isCorrect, chatMsg };
  }

  cleanRoomTimer(roomId: string) {
    const timer = this.roomTimers.get(roomId);
    if (timer) {
      clearInterval(timer.timer);
      this.roomTimers.delete(roomId);
    }
    this.roomCallbacks.delete(roomId);
  }
}
