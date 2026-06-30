import { Test, TestingModule } from '@nestjs/testing';
import { GameLoopService } from './game-loop.service';
import { ModeAStrategy } from '../strategies/mode-a.strategy';
import { ModeBStrategy } from '../strategies/mode-b.strategy';
import { WordHintService } from './word-hint.service';
import { GameTimerService } from './game-timer.service';
import { MemoryRoomRepository } from '../storage/memory-room.repository';
import { RoomRepositoryToken } from '../storage/room.repository';
import { GameSettings, RoomState } from '../domain/interfaces/game.interface';
import { BadRequestException } from '@nestjs/common';
import { DrawingService } from './drawing.service';

describe('GameLoopService Mode B', () => {
  let service: GameLoopService;
  let repository: any;

  const mockSettings: GameSettings = {
    mode: 'B',
    drawTimeLimit: 60,
    revealTimeLimit: 10,
    botCount: 0,
    wordCategory: 'general',
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameLoopService,
        ModeAStrategy,
        ModeBStrategy,
        WordHintService,
        GameTimerService,
        DrawingService,
        {
          provide: RoomRepositoryToken,
          useClass: MemoryRoomRepository,
        },
      ],
    }).compile();

    service = module.get<GameLoopService>(GameLoopService);
    repository = module.get<any>(RoomRepositoryToken);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should run sequential Gartic Phone chains for all 3 players and transition correctly', () => {
    // 1. Setup room with 3 players
    const roomId = 'ROOM1';
    const players = [
      { id: 'host-id', name: 'Host', avatar: '1.png', isBot: false, score: 0, isDrawing: false, hasGuessedCorrectly: false },
      { id: 'player-1-id', name: 'Player 1', avatar: '2.png', isBot: false, score: 0, isDrawing: false, hasGuessedCorrectly: false },
      { id: 'player-2-id', name: 'Player 2', avatar: '3.png', isBot: false, score: 0, isDrawing: false, hasGuessedCorrectly: false },
    ];

    const room: RoomState = {
      roomId,
      id: roomId,
      players,
      phase: 'LOBBY',
      currentTurnPlayerId: null,
      guesserId: null,
      drawerId: null,
      currentWord: null,
      obfuscatedWord: null,
      timeLeft: 60,
      roundNumber: 0,
      maxRounds: 0,
      settings: mockSettings,
    };
    repository.save(roomId, room);

    // 2. Start game
    const stateStart = service.startGame(roomId, () => {}, () => {});
    expect(stateStart.phase).toBe('WORD_SELECTION');
    expect(stateStart.roundNumber).toBe(1);
    expect(stateStart.maxRounds).toBe(9); // 3 * 3 = 9 rounds
    expect(stateStart.drawerId).toBe('host-id');
    expect(stateStart.guesserId).toBe('player-2-id');

    // === CHAIN 1: Host word ===
    // selectWord
    service.selectWord(roomId, 'host-id', 'SecretWord');
    // round 1 draw submit
    service.handlePlayerSubmitDrawing(roomId, 'host-id', [{ points: [] }] as any);
    
    // round 2 draw submit (Player 1 draws)
    const stateR2 = repository.get(roomId);
    expect(stateR2.roundNumber).toBe(2);
    expect(stateR2.drawerId).toBe('player-1-id');
    service.handlePlayerSubmitDrawing(roomId, 'player-1-id', [{ points: [] }] as any);

    // round 3 guessing (Player 2 guesses)
    const stateR3 = repository.get(roomId);
    expect(stateR3.roundNumber).toBe(3);
    expect(stateR3.drawerId).toBeNull();
    expect(stateR3.guesserId).toBe('player-2-id');

    // correct guess via Mode B guess submit
    const stateGuess1 = service.handleModeBGuess(roomId, 'player-2-id', 'SecretWord');
    expect(stateGuess1.chatMsg.isCorrectGuess).toBe(true);

    // transition to REVEAL chain 1
    jest.advanceTimersByTime(4000);
    const revealState1 = repository.get(roomId);
    expect(revealState1.phase).toBe('REVEAL');
    expect(revealState1.roundNumber).toBe(3);

    // transition to CHAIN 2
    jest.advanceTimersByTime(10000); // 10s reveal time limit
    const chain2Start = repository.get(roomId);
    expect(chain2Start.phase).toBe('WORD_SELECTION');
    expect(chain2Start.roundNumber).toBe(4);
    expect(chain2Start.drawerId).toBe('player-1-id');
    expect(chain2Start.guesserId).toBe('host-id'); // guesser is Host (Player 0)

    // === CHAIN 2: Player 1 word ===
    service.selectWord(roomId, 'player-1-id', 'BWord');
    service.handlePlayerSubmitDrawing(roomId, 'player-1-id', [{ points: [] }] as any);

    // round 5 draw submit (Player 2 draws)
    const stateR5 = repository.get(roomId);
    expect(stateR5.roundNumber).toBe(5);
    expect(stateR5.drawerId).toBe('player-2-id');
    service.handlePlayerSubmitDrawing(roomId, 'player-2-id', [{ points: [] }] as any);

    // round 6 guessing (Host guesses)
    const stateR6 = repository.get(roomId);
    expect(stateR6.roundNumber).toBe(6);
    expect(stateR6.drawerId).toBeNull();
    expect(stateR6.guesserId).toBe('host-id');

    const stateGuess2 = service.handleModeBGuess(roomId, 'host-id', 'BWord');
    expect(stateGuess2.chatMsg.isCorrectGuess).toBe(true);

    // transition to REVEAL chain 2
    jest.advanceTimersByTime(4000);
    const revealState2 = repository.get(roomId);
    expect(revealState2.phase).toBe('REVEAL');
    expect(revealState2.roundNumber).toBe(6);

    // transition to CHAIN 3
    jest.advanceTimersByTime(10000);
    const chain3Start = repository.get(roomId);
    expect(chain3Start.phase).toBe('WORD_SELECTION');
    expect(chain3Start.roundNumber).toBe(7);
    expect(chain3Start.drawerId).toBe('player-2-id');
    expect(chain3Start.guesserId).toBe('player-1-id');

    // === CHAIN 3: Player 2 word ===
    service.selectWord(roomId, 'player-2-id', 'CWord');
    service.handlePlayerSubmitDrawing(roomId, 'player-2-id', [{ points: [] }] as any);

    // round 8 draw submit (Host draws)
    const stateR8 = repository.get(roomId);
    expect(stateR8.roundNumber).toBe(8);
    expect(stateR8.drawerId).toBe('host-id');
    service.handlePlayerSubmitDrawing(roomId, 'host-id', [{ points: [] }] as any);

    // round 9 guessing (Player 1 guesses)
    const stateR9 = repository.get(roomId);
    expect(stateR9.roundNumber).toBe(9);
    expect(stateR9.drawerId).toBeNull();
    expect(stateR9.guesserId).toBe('player-1-id');

    const stateGuess3 = service.handleModeBGuess(roomId, 'player-1-id', 'CWord');
    expect(stateGuess3.chatMsg.isCorrectGuess).toBe(true);

    // transition to REVEAL chain 3
    jest.advanceTimersByTime(4000);
    const revealState3 = repository.get(roomId);
    expect(revealState3.phase).toBe('REVEAL');
    expect(revealState3.roundNumber).toBe(9);

    // transition to GAME OVER
    jest.advanceTimersByTime(10000);
    const gameOverState = repository.get(roomId);
    expect(gameOverState.phase).toBe('GAME_OVER');
    expect(gameOverState.roundNumber).toBe(10);
  });
});
