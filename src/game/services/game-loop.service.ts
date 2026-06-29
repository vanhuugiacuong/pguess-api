import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { RoomRepositoryToken } from '../storage/room.repository';
import type { RoomRepository } from '../storage/room.repository';
import { RoomState } from '../domain/interfaces/game.interface';
import { GameRulesEngine } from '../domain/game-rules.engine';

const WORD_BANKS: Record<string, string[]> = {
  general: [
    'house', 'cat', 'tree', 'sun', 'car', 'flower', 'fish', 'cup', 'star', 'apple',
    'boat', 'bird', 'cake', 'hat', 'cloud', 'heart', 'moon', 'ball', 'book', 'face',
  ],
  animals: [
    'dog', 'cat', 'lion', 'tiger', 'elephant', 'giraffe', 'zebra', 'panda', 'rabbit', 'monkey',
    'penguin', 'fox', 'bear', 'frog', 'horse', 'sheep', 'duck', 'whale', 'owl', 'chicken',
  ],
  car_brands: [
    'toyota', 'honda', 'bmw', 'audi', 'mercedes', 'ford', 'tesla', 'porsche', 'kia', 'volkswagen',
    'mazda', 'nissan', 'hyundai', 'volvo', 'lexus', 'chevrolet', 'jeep', 'subaru', 'bugatti', 'ferrari',
  ],
  clothes: [
    'shirt', 't-shirt', 'hoodie', 'jacket', 'coat', 'dress', 'skirt', 'jeans', 'pants', 'shorts',
    'sneakers', 'boots', 'hat', 'cap', 'scarf', 'gloves', 'sock', 'uniform', 'suit', 'tie',
  ],
  food: [
    'pizza', 'burger', 'noodles', 'sandwich', 'sushi', 'cake', 'ice cream', 'salad', 'ramen', 'taco',
    'apple pie', 'hotdog', 'pasta', 'bread', 'dumplings', 'milk tea', 'chocolate', 'steak', 'donut', 'curry',
  ],
};

const CATEGORY_ALIASES: Record<string, string> = {
  general: 'general',
  default: 'general',
  'thong thuong': 'general',
  'thông thường': 'general',
  'co ban': 'general',
  'cơ bản': 'general',
  animals: 'animals',
  animal: 'animals',
  'dong vat': 'animals',
  'động vật': 'animals',
  'car brands': 'car_brands',
  carbrands: 'car_brands',
  cars: 'car_brands',
  car: 'car_brands',
  xe: 'car_brands',
  'thuong hieu xe': 'car_brands',
  'thương hiệu xe': 'car_brands',
  clothes: 'clothes',
  clothing: 'clothes',
  'quan ao': 'clothes',
  'quần áo': 'clothes',
  food: 'food',
  foods: 'food',
  'do an': 'food',
  'đồ ăn': 'food',
};

@Injectable()
export class GameLoopService {
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
    private readonly wordHintService: WordHintService,
    private readonly drawingService: DrawingService,
    private readonly gameTimerService: GameTimerService,
    private readonly modeAStrategy: ModeAStrategy,
    private readonly modeBStrategy: ModeBStrategy,
  ) {}

  private getStrategy(mode?: 'A' | 'B'): GameModeStrategy {
    return mode === 'B' ? this.modeBStrategy : this.modeAStrategy;
  }

  startGame(
    roomId: string,
    onStateUpdate: (state: RoomState) => void,
    onChatMessage?: (msg: any) => void,
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    if (room.players.length < 2) {
      throw new BadRequestException('Cần tối thiểu 2 người chơi để bắt đầu game!');
    }

    this.roomCallbacks.set(room.roomId, { onStateUpdate, onChatMessage });
    room.roundNumber = 1;
    room.maxRounds = room.settings?.mode === 'A' ? room.players.length : room.players.length;

    room.players.forEach((p) => {
      p.hasGuessedCorrectly = false;
      p.isDrawing = false;
      p.drawingData = undefined;
    });

    const strategy = this.getStrategy(room.settings?.mode);
    strategy.setupRound(room);

    this.roomRepository.save(room.roomId, room);
    this.startCountdown(room.roomId);

    // Broadcast system message
    const cb = this.roomCallbacks.get(room.roomId);
    if (cb && cb.onChatMessage) {
      cb.onChatMessage({
        id: `sys-round-start-${Date.now()}`,
        playerId: 'system',
        playerName: 'Hệ thống',
        text: `Trò chơi bắt đầu! Đang trong giai đoạn chọn từ khóa.`,
        timestamp: Date.now(),
        isSystem: true,
        isCorrectGuess: false,
      });
    }

    return room;
  }

  selectWord(roomId: string, playerId: string, word: string): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    if (room.phase !== 'WORD_SELECTION') {
      throw new BadRequestException('Hiện không trong giai đoạn chọn từ khóa!');
    }

    const mode = room.settings?.mode || 'A';
    if (mode === 'A') {
      if (room.drawerId !== playerId) {
        throw new BadRequestException('Chỉ họa sĩ mới được chọn từ khóa!');
      }
    } else {
      if (room.roundNumber !== 1) {
        throw new BadRequestException('Chỉ được chọn từ khóa ở vòng 1!');
      }
      if (room.guesserId !== playerId) {
        throw new BadRequestException('Chỉ người đoán mới được chọn từ khóa!');
      }
    }

    room.currentWord = word.trim() || 'Từ khóa bí mật';
    room.obfuscatedWord = this.wordHintService.obfuscate(room.currentWord);
    room.timeLeft = room.settings?.drawTimeLimit || 60;
    room.revealedIndexes = [];
    room.hintsRevealed = 0;
    room.phase = 'PLAYING'; // Transition to playing!
    
    this.roomRepository.save(targetRoomId, room);

    // Broadcast system message about the word selected
    const cb = this.roomCallbacks.get(targetRoomId);
    if (cb) {
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-word-sel-${Date.now()}`,
          playerId: 'system',
          playerName: 'Hệ thống',
          text: mode === 'A'
            ? `Họa sĩ đã chọn từ khóa có ${room.currentWord.length} chữ cái!`
            : `Người đoán đã chọn từ khóa ban đầu cho chuỗi truyền tay!`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
      cb.onStateUpdate(room);
    }

    // Restart countdown for drawing
    this.startCountdown(targetRoomId);

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

    const wordBank = this.getWordBank(room.settings?.wordCategory, room.settings?.customWordBank);
    const randIndex = Math.floor(Math.random() * wordBank.length);
    room.currentWord = wordBank[randIndex];
    room.obfuscatedWord = GameRulesEngine.obfuscateWord(room.currentWord);

    const mode = room.settings?.mode || 'A';
    const strategy = this.getStrategy(mode);
    strategy.setupRound(room);

    this.roomRepository.save(roomId, room);
    
    // Broadcast state update
    const cb = this.roomCallbacks.get(roomId);
    if (cb) {
      cb.onStateUpdate(room);
      if (cb.onChatMessage) {
        cb.onChatMessage({
          id: `sys-round-${room.roundNumber}-${Date.now()}`,
          playerId: 'system',
          playerName: 'Hệ thống',
          text: mode === 'A'
            ? `Vòng ${room.roundNumber} bắt đầu. Đang chọn từ khóa...`
            : room.roundNumber < room.players.length
              ? `Vòng ${room.roundNumber} bắt đầu. ${room.players.find((p) => p.id === room.drawerId)?.name} đang vẽ truyền tay!`
              : `Lượt đoán của ${room.players.find((p) => p.id === room.guesserId)?.name} đã bắt đầu!`,
          timestamp: Date.now(),
          isSystem: true,
          isCorrectGuess: false,
        });
      }
    }

    this.startCountdown(roomId);
  }

  private startCountdown(roomId: string) {
    const room = this.roomRepository.get(roomId);
    if (!room) return;

    this.gameTimerService.startTimer(
      roomId,
      room.timeLeft,
      (secondsLeft) => {
        const currentRoom = this.roomRepository.get(roomId);
        if (!currentRoom || (currentRoom.phase !== 'PLAYING' && currentRoom.phase !== 'WORD_SELECTION')) {
          this.gameTimerService.stopTimer(roomId);
          return;
        }

        const mode = currentRoom.settings?.mode || 'A';
        if (mode === 'A' && currentRoom.phase === 'PLAYING' && currentRoom.currentWord) {
          const guessers = currentRoom.players.filter((p) => p.id !== currentRoom.drawerId);
          const allGuessed = guessers.every((p) => p.hasGuessedCorrectly);
          if (allGuessed && guessers.length > 0) {
            this.gameTimerService.stopTimer(roomId);
            this.revealRoundResults(roomId);
            return;
          }
        }

        currentRoom.timeLeft = secondsLeft;

        // Custom tick operations (like Mode A hint reveals)
        const strategy = this.getStrategy(mode);
        strategy.handleTick(currentRoom);

        this.roomRepository.save(roomId, currentRoom);
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(currentRoom);
      },
      () => {
        this.handleTimeOver(roomId);
      }
    );
  }

  private handleTimeOver(roomId: string) {
    const room = this.roomRepository.get(roomId);
    if (!room) return;

    // Check if word was not selected in time during selection phase
    if (room.phase === 'WORD_SELECTION') {
      room.currentWord = this.wordHintService.getRandomWord();
      room.obfuscatedWord = this.wordHintService.obfuscate(room.currentWord);
      room.timeLeft = room.settings?.drawTimeLimit || 60;
      room.revealedIndexes = [];
      room.hintsRevealed = 0;
      room.phase = 'PLAYING';
      this.roomRepository.save(roomId, room);

      const cb = this.roomCallbacks.get(roomId);
      if (cb) {
        cb.onStateUpdate(room);
        if (cb.onChatMessage) {
          cb.onChatMessage({
            id: `sys-word-timeout-${Date.now()}`,
            playerId: 'system',
            playerName: 'Hệ thống',
            text: `Hết thời gian chọn từ khóa! Hệ thống tự động chọn từ ngẫu nhiên.`,
            timestamp: Date.now(),
            isSystem: true,
            isCorrectGuess: false,
          });
        }
      }

      this.startCountdown(roomId);
      return;
    }

    const mode = room.settings?.mode || 'A';
    const strategy = this.getStrategy(mode);
    const action = strategy.handleTimeOver(room);

    if (action === 'reveal') {
      this.revealRoundResults(roomId);
    } else if (action === 'next_round') {
      this.startNewRound(roomId);
    }
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

    this.gameTimerService.startTimer(
      roomId,
      room.timeLeft,
      (secondsLeft) => {
        const currentRoom = this.roomRepository.get(roomId);
        if (!currentRoom || currentRoom.phase !== 'REVEAL') {
          this.gameTimerService.stopTimer(roomId);
          return;
        }
        currentRoom.timeLeft = secondsLeft;
        this.roomRepository.save(roomId, currentRoom);
        const cb = this.roomCallbacks.get(roomId);
        if (cb) cb.onStateUpdate(currentRoom);
      },
      () => {
        this.startNewRound(roomId);
      }
    );
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
    this.gameTimerService.stopTimer(roomId);
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
    let systemMsgText = '';
    let shouldEndRoundEarly = false;

    if (room.phase === 'PLAYING') {
      const mode = room.settings?.mode || 'A';
      const strategy = this.getStrategy(mode);
      
      const result = strategy.handleGuess(room, player, text);
      isCorrect = result.isCorrect;
      if (result.systemMessage) {
        systemMsgText = result.systemMessage;
      }
      if (result.shouldEndRoundEarly) {
        shouldEndRoundEarly = true;
      }
    }

    if (isCorrect) {
      this.roomRepository.save(targetRoomId, room);
      const cb = this.roomCallbacks.get(room.roomId);
      if (cb) cb.onStateUpdate(room);

      if (shouldEndRoundEarly) {
        this.gameTimerService.stopTimer(room.roomId);
        this.revealRoundResults(room.roomId);
      }
    }

    const chatMsg = {
      id: `msg-${Date.now()}-${Math.random()}`,
      playerId: socketId,
      playerName: player.name,
      text: isCorrect ? (systemMsgText || 'đã đoán chính xác từ khóa! 🎉') : text,
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

    if (room.phase !== 'PLAYING') {
      throw new BadRequestException('Not allowed to guess');
    }

    const result = this.modeBStrategy.handleModeBGuess(room, socketId, guess);
    this.roomRepository.save(targetRoomId, room);

    const chatMsg = {
      id: `msg-${Date.now()}`,
      playerId: socketId,
      playerName: room.players.find((p) => p.id === socketId)?.name || 'Người đoán',
      text: result.systemMessage || `đã đoán: "${guess}"`,
      timestamp: Date.now(),
      isSystem: true,
      isCorrectGuess: result.isCorrect,
    };

    this.gameTimerService.stopTimer(room.roomId);
    this.revealRoundResults(room.roomId);

    return { isCorrect: result.isCorrect, chatMsg };
  }

  handlePlayerSubmitDrawing(
    roomId: string,
    socketId: string,
    strokes: any[],
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const room = this.roomRepository.get(targetRoomId);
    if (!room) throw new NotFoundException('Room not found');

    const player = room.players.find((p) => p.id === socketId);
    if (!player) throw new NotFoundException('Player not found');

    player.drawingData = strokes;
    this.roomRepository.save(targetRoomId, room);

    const mode = room.settings?.mode || 'A';
    const strategy = this.getStrategy(mode);
    const result = strategy.handleSubmitDrawing(room, socketId, strokes);

    if (result.shouldEndRoundEarly) {
      this.gameTimerService.stopTimer(room.roomId);
      this.startNewRound(room.roomId);
    }

    return room;
  }

  cleanRoomTimer(roomId: string) {
    this.gameTimerService.stopTimer(roomId);
    this.roomCallbacks.delete(roomId);
  }

  private getWordBank(wordCategory?: string, customWordBank?: string[]): string[] {
    const customWords = (customWordBank || [])
      .map((word) => word.trim())
      .filter((word) => word.length > 0);

    if (customWords.length > 0) {
      return customWords;
    }

    const normalizedCategory = this.normalizeWordCategory(wordCategory);
    return WORD_BANKS[normalizedCategory] || WORD_BANKS.general;
  }

  private normalizeWordCategory(wordCategory?: string): string {
    if (!wordCategory) {
      return 'general';
    }

    const normalized = wordCategory.trim().toLowerCase();
    return CATEGORY_ALIASES[normalized] || normalized;
  }
}
