import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GameSettings, Player, RoomState } from './interfaces/game.interface';

const WORD_BANK = [
  'house', 'cat', 'tree', 'sun', 'car', 'flower', 'fish', 'cup', 'star', 'apple',
  'boat', 'bird', 'cake', 'hat', 'cloud', 'heart', 'moon', 'ball', 'book', 'face'
];

@Injectable()
export class GameRoomService {
  // Store rooms in an in-memory Map
  private rooms = new Map<string, RoomState>();
  private roomTimers = new Map<string, { timer: NodeJS.Timeout }>();
  private roomCallbacks = new Map<
    string,
    {
      onStateUpdate: (state: RoomState) => void;
      onChatMessage?: (msg: any) => void;
    }
  >();

  /**
   * Helper to generate a random 6-character uppercase string
   */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomId;
  }

  /**
   * Get all active rooms (for testing or administrative purposes)
   */
  getAllRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get a room by ID
   */
  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * Create a new room with custom settings and add the host player
   */
  createRoom(
    nickname: string,
    avatar: string,
    settings: GameSettings,
    hostSocketId: string,
  ): RoomState {
    let roomId = this.generateRoomId();
    // Ensure roomId is unique
    while (this.rooms.has(roomId)) {
      roomId = this.generateRoomId();
    }

    const hostPlayer: Player = {
      id: hostSocketId,
      name: nickname,
      avatar,
      isBot: false,
      score: 0,
      isDrawing: false,
      hasGuessedCorrectly: false,
    };

    const roomState: RoomState = {
      roomId,
      id: roomId, // Angular compatibility field
      players: [hostPlayer],
      phase: 'LOBBY',
      currentTurnPlayerId: null,
      guesserId: null,
      drawerId: null,
      currentWord: null,
      obfuscatedWord: null,
      timeLeft: settings.drawTimeLimit,
      roundNumber: 0,
      maxRounds: settings.mode === 'A' ? 1 : 3,
      settings,
    };

    this.rooms.set(roomId, roomState);
    return roomState;
  }

  /**
   * Add a new player to an existing room
   */
  joinRoom(
    roomId: string,
    nickname: string,
    avatar: string,
    playerSocketId: string,
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const roomState = this.rooms.get(targetRoomId);

    if (!roomState) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    // Check if the player is already in the room
    const playerExists = roomState.players.some((p) => p.id === playerSocketId);
    if (playerExists) {
      return roomState;
    }

    const newPlayer: Player = {
      id: playerSocketId,
      name: nickname,
      avatar,
      isBot: false,
      score: 0,
      isDrawing: false,
      hasGuessedCorrectly: false,
    };

    roomState.players.push(newPlayer);
    this.rooms.set(targetRoomId, roomState);
    return roomState;
  }

  /**
   * Remove a player by socket ID from any room they have joined.
   * Returns list of rooms that were updated or deleted.
   */
  handlePlayerDisconnect(
    socketId: string,
  ): { roomId: string; roomState: RoomState | null }[] {
    const affectedRooms: { roomId: string; roomState: RoomState | null }[] = [];

    for (const [roomId, roomState] of this.rooms.entries()) {
      const playerIndex = roomState.players.findIndex((p) => p.id === socketId);

      if (playerIndex !== -1) {
        // Remove player
        roomState.players.splice(playerIndex, 1);

        if (roomState.players.length === 0) {
          // No players left, delete room
          this.rooms.delete(roomId);
          const activeTimer = this.roomTimers.get(roomId);
          if (activeTimer) {
            clearInterval(activeTimer.timer);
            this.roomTimers.delete(roomId);
          }
          this.roomCallbacks.delete(roomId);
          affectedRooms.push({ roomId, roomState: null });
        } else {
          // Room still has players. Host is implicitly the first player in the list.
          // Since we removed the disconnected player, if they were the first player,
          // the second player automatically becomes the new first player (host).
          this.rooms.set(roomId, roomState);
          affectedRooms.push({ roomId, roomState });
        }
      }
    }

    return affectedRooms;
  }

  updateRoomSettings(
    roomId: string,
    settings: Partial<GameSettings>,
  ): RoomState {
    const roomState = this.rooms.get(roomId.toUpperCase());
    if (!roomState) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    if (roomState.phase !== 'LOBBY') {
      throw new BadRequestException('Cannot update settings during gameplay');
    }

    if (roomState.settings) {
      roomState.settings = {
        ...roomState.settings,
        ...settings,
      };
      roomState.timeLeft = roomState.settings.drawTimeLimit;
      roomState.maxRounds = roomState.settings.mode === 'A' ? roomState.players.length : 3;
    }

    this.rooms.set(roomId.toUpperCase(), roomState);
    return roomState;
  }

  startGame(
    roomId: string,
    onStateUpdate: (state: RoomState) => void,
    onChatMessage?: (msg: any) => void,
  ): RoomState {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) throw new NotFoundException('Room not found');

    this.roomCallbacks.set(room.roomId, { onStateUpdate, onChatMessage });
    room.roundNumber = 0;
    room.maxRounds = room.settings?.mode === 'A' ? room.players.length : 3;

    this.startNewRound(room.roomId);
    return room;
  }

  private startNewRound(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.roundNumber = (room.roundNumber || 0) + 1;
    if (room.roundNumber > (room.maxRounds || 3)) {
      this.endGame(roomId);
      return;
    }

    // Reset guessing and drawing flags for all players
    room.players.forEach((p) => {
      p.hasGuessedCorrectly = false;
      p.isDrawing = false;
    });

    // Select random word
    const randIndex = Math.floor(Math.random() * WORD_BANK.length);
    room.currentWord = WORD_BANK[randIndex];
    room.obfuscatedWord = room.currentWord.split('').map(() => '_').join(' ');

    const mode = room.settings?.mode || 'A';
    if (mode === 'A') {
      // Pick drawer sequentially
      const drawerIndex = (room.roundNumber - 1) % room.players.length;
      room.players[drawerIndex].isDrawing = true;
      room.drawerId = room.players[drawerIndex].id;
      room.guesserId = null;
    } else {
      // Mode B: Ice Breaker (everyone draws, 1 guesses)
      const guesserIndex = (room.roundNumber - 1) % room.players.length;
      room.guesserId = room.players[guesserIndex].id;
      room.drawerId = null;

      room.players.forEach((p) => {
        p.isDrawing = p.id !== room.guesserId;
      });
    }

    room.phase = 'PLAYING';
    room.timeLeft = room.settings?.drawTimeLimit || 60;

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-round-${room.roundNumber}-${Date.now()}`,
          playerId: 'system',
          playerName: 'System',
          text: mode === 'A'
            ? `Round ${room.roundNumber} started. ${room.players.find((p) => p.id === room.drawerId)?.name} is drawing!`
            : `Round ${room.roundNumber} started. Everyone draws "${room.currentWord}". ${room.players.find((p) => p.id === room.guesserId)?.name} will guess!`,
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
      const room = this.rooms.get(roomId);
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
        // Early end condition for Mode A: all guessers guessed correctly
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
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(room);
      }
    }, 1000);

    this.roomTimers.set(roomId, { timer });
  }

  private revealRoundResults(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.phase = 'REVEAL';
    room.timeLeft = room.settings?.revealTimeLimit || 10;

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-reveal-${Date.now()}`,
          playerId: 'system',
          playerName: 'System',
          text: `Round finished! The word was "${room.currentWord}".`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
    }

    let revealTime = room.timeLeft;
    const timer = setInterval(() => {
      const currentRoom = this.rooms.get(roomId);
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
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(currentRoom);
      }
    }, 1000);

    this.roomTimers.set(roomId, { timer });
  }

  private endGame(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.phase = 'GAME_OVER';
    room.timeLeft = 0;

    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);

      const sorted = [...room.players].sort((a, b) => b.score - a.score);
      const winner = sorted[0];
      if (cb.onChatMessage && winner) {
        cb.onChatMessage({
          id: `sys-gameover-${Date.now()}`,
          playerId: 'system',
          playerName: 'System',
          text: `Game Over! The winner is ${winner.name} with ${winner.score} pts! 🏆`,
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
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) throw new NotFoundException('Room not found');

    const player = room.players.find((p) => p.id === socketId);
    if (!player) throw new NotFoundException('Player not found');

    let isCorrect = false;
    const mode = room.settings?.mode || 'A';

    if (mode === 'A' && room.phase === 'PLAYING') {
      const isDrawer = room.drawerId === socketId;
      if (!isDrawer && !player.hasGuessedCorrectly && room.currentWord) {
        if (text.trim().toLowerCase() === room.currentWord.toLowerCase()) {
          isCorrect = true;
          player.hasGuessedCorrectly = true;

          const limit = room.settings?.drawTimeLimit || 60;
          const timeLeftScale = room.timeLeft / limit;
          const scoreGain = Math.round(100 * timeLeftScale) + 20;
          player.score += scoreGain;

          const drawer = room.players.find((p) => p.id === room.drawerId);
          if (drawer) {
            drawer.score += 30;
          }

          const cb = this.roomCallbacks.get(room.roomId);
          if (cb) cb.onStateUpdate(room);
        }
      }
    }

    const chatMsg = {
      id: `msg-${Date.now()}-${Math.random()}`,
      playerId: socketId,
      playerName: player.name,
      text: isCorrect ? 'Guessed the correct word! 🎉' : text,
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
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) throw new NotFoundException('Room not found');

    const guesser = room.players.find((p) => p.id === socketId);
    if (!guesser || room.guesserId !== socketId || room.phase !== 'PLAYING') {
      throw new BadRequestException('Not allowed to guess');
    }

    const isCorrect = guess.trim().toLowerCase() === (room.currentWord || '').toLowerCase();

    if (isCorrect) {
      const limit = room.settings?.drawTimeLimit || 60;
      const score = Math.round(150 * (room.timeLeft / limit)) + 50;
      guesser.score += score;

      room.players.forEach((p) => {
        if (p.id !== guesser.id) {
          p.score += 100;
        }
      });
    }

    const chatMsg = {
      id: `msg-${Date.now()}`,
      playerId: socketId,
      playerName: guesser.name,
      text: `guessed: "${guess}" - ${isCorrect ? 'CORRECT! 🎉' : 'INCORRECT ❌'}`,
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

