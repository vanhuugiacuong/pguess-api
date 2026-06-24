import { Test, TestingModule } from '@nestjs/testing';
import { GameRoomService } from './game-room.service';
import { GameSettings } from './interfaces/game.interface';
import { NotFoundException } from '@nestjs/common';

describe('GameRoomService', () => {
  let service: GameRoomService;
  const mockSettings: GameSettings = {
    mode: 'A',
    drawTimeLimit: 80,
    revealTimeLimit: 15,
    botCount: 0,
    wordCategory: 'General',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GameRoomService],
    }).compile();

    service = module.get<GameRoomService>(GameRoomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRoom', () => {
    it('should create a room and set the host as the first player', () => {
      const socketId = 'socket-host-123';
      const room = service.createRoom('HostPlayer', 'avatar1.svg', mockSettings, socketId);

      expect(room).toBeDefined();
      expect(room.roomId).toHaveLength(6);
      expect(room.roomId).toBe(room.roomId.toUpperCase());
      expect(room.id).toBe(room.roomId); // Angular compatibility field
      expect(room.players).toHaveLength(1);
      expect(room.players[0]).toEqual({
        id: socketId,
        name: 'HostPlayer',
        avatar: 'avatar1.svg',
        isBot: false,
        score: 0,
        isDrawing: false,
        hasGuessedCorrectly: false,
      });
      expect(room.phase).toBe('LOBBY');
      expect(room.timeLeft).toBe(80);
    });
  });

  describe('joinRoom', () => {
    it('should add a player to an existing room', () => {
      const hostSocketId = 'socket-host-123';
      const joinerSocketId = 'socket-joiner-456';

      const createdRoom = service.createRoom(
        'HostPlayer',
        'avatar1.svg',
        mockSettings,
        hostSocketId,
      );
      const updatedRoom = service.joinRoom(
        createdRoom.roomId,
        'JoinerPlayer',
        'avatar2.svg',
        joinerSocketId,
      );

      expect(updatedRoom.players).toHaveLength(2);
      expect(updatedRoom.players[1]).toEqual({
        id: joinerSocketId,
        name: 'JoinerPlayer',
        avatar: 'avatar2.svg',
        isBot: false,
        score: 0,
        isDrawing: false,
        hasGuessedCorrectly: false,
      });
    });

    it('should throw NotFoundException if room code does not exist', () => {
      expect(() => {
        service.joinRoom('INVALID', 'SomePlayer', 'avatar.svg', 'socket-123');
      }).toThrow(NotFoundException);
    });

    it('should not duplicate a player if they are already in the room', () => {
      const hostSocketId = 'socket-host-123';
      const createdRoom = service.createRoom(
        'HostPlayer',
        'avatar1.svg',
        mockSettings,
        hostSocketId,
      );
      const updatedRoom = service.joinRoom(
        createdRoom.roomId,
        'HostPlayer',
        'avatar1.svg',
        hostSocketId,
      );

      expect(updatedRoom.players).toHaveLength(1);
    });
  });

  describe('handlePlayerDisconnect', () => {
    it('should remove a player and delete room if it becomes empty', () => {
      const hostSocketId = 'socket-host-123';
      const room = service.createRoom('HostPlayer', 'avatar1.svg', mockSettings, hostSocketId);

      const affected = service.handlePlayerDisconnect(hostSocketId);

      expect(affected).toHaveLength(1);
      expect(affected[0].roomId).toBe(room.roomId);
      expect(affected[0].roomState).toBeNull();
      expect(service.getRoom(room.roomId)).toBeUndefined();
    });

    it('should transfer host (implicitly the first player) to the next player when host leaves', () => {
      const hostSocketId = 'socket-host-123';
      const joinerSocketId = 'socket-joiner-456';

      const room = service.createRoom('HostPlayer', 'avatar1.svg', mockSettings, hostSocketId);
      service.joinRoom(room.roomId, 'JoinerPlayer', 'avatar2.svg', joinerSocketId);

      const affected = service.handlePlayerDisconnect(hostSocketId);

      expect(affected).toHaveLength(1);
      expect(affected[0].roomId).toBe(room.roomId);

      const updatedRoom = affected[0].roomState;
      expect(updatedRoom).toBeDefined();
      expect(updatedRoom!.players).toHaveLength(1);
      // JoinerPlayer should now be the first player (and thus the new host)
      expect(updatedRoom!.players[0].id).toBe(joinerSocketId);
      expect(updatedRoom!.players[0].name).toBe('JoinerPlayer');
    });
  });
});
