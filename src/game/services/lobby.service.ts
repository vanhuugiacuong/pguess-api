import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { GameSettings, Player, RoomState } from '../domain/interfaces/game.interface';
import { RoomRepositoryToken } from '../storage/room.repository';
import type { RoomRepository } from '../storage/room.repository';

@Injectable()
export class LobbyService {
  constructor(
    @Inject(RoomRepositoryToken)
    private readonly roomRepository: RoomRepository,
  ) {}

  private generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomId;
  }

  private validateMaxPlayers(maxPlayers: number | undefined): number {
    if (maxPlayers === undefined) {
      return 10;
    }
    const allowed = [2, 4, 6, 8, 10];
    if (!allowed.includes(maxPlayers)) {
      throw new BadRequestException('Giới hạn số lượng người chơi không hợp lệ (phải là số chẵn từ 2 đến 10)');
    }
    return maxPlayers;
  }

  getAllRooms(): RoomState[] {
    return this.roomRepository.getAll();
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.roomRepository.get(roomId);
  }

  createRoom(
    nickname: string,
    avatar: string,
    settings: GameSettings,
    hostSocketId: string,
  ): RoomState {
    let roomId = this.generateRoomId();
    while (this.roomRepository.get(roomId)) {
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
      id: roomId,
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
      settings: {
        ...settings,
        maxPlayers: this.validateMaxPlayers(settings.maxPlayers),
      },
      hostId: hostSocketId,
    };

    this.roomRepository.save(roomId, roomState);
    return roomState;
  }

  joinRoom(
    roomId: string,
    nickname: string,
    avatar: string,
    playerSocketId: string,
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const roomState = this.roomRepository.get(targetRoomId);

    if (!roomState) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    const playerExists = roomState.players.some((p) => p.id === playerSocketId);
    if (playerExists) {
      return roomState;
    }

    const maxPlayers = roomState.settings?.maxPlayers || 10;
    if (roomState.players.length >= maxPlayers) {
      throw new BadRequestException(`Phòng chơi đã đầy (tối đa ${maxPlayers} người)`);
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
    this.roomRepository.save(targetRoomId, roomState);
    return roomState;
  }

  updateRoomSettings(
    roomId: string,
    settings: Partial<GameSettings>,
  ): RoomState {
    const targetRoomId = roomId.toUpperCase();
    const roomState = this.roomRepository.get(targetRoomId);
    if (!roomState) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    if (roomState.phase !== 'LOBBY') {
      throw new BadRequestException('Cannot update settings during gameplay');
    }

    if (roomState.settings) {
      if (settings.maxPlayers !== undefined) {
        this.validateMaxPlayers(settings.maxPlayers);
        if (settings.maxPlayers < roomState.players.length) {
          throw new BadRequestException(
            `Không thể giảm giới hạn người chơi xuống dưới số lượng người chơi hiện tại (${roomState.players.length} người)`,
          );
        }
      }
      roomState.settings = {
        ...roomState.settings,
        ...settings,
      };
      roomState.timeLeft = roomState.settings.drawTimeLimit;
      roomState.maxRounds = roomState.settings.mode === 'A' ? roomState.players.length : 3;
    }

    this.roomRepository.save(targetRoomId, roomState);
    return roomState;
  }

  handlePlayerDisconnect(
    socketId: string,
    onRoomDeleted: (roomId: string) => void,
  ): { roomId: string; roomState: RoomState | null }[] {
    const affectedRooms: { roomId: string; roomState: RoomState | null }[] = [];
    const rooms = this.roomRepository.getAll();

    for (const roomState of rooms) {
      const playerIndex = roomState.players.findIndex((p) => p.id === socketId);

      if (playerIndex !== -1) {
        roomState.players.splice(playerIndex, 1);

        if (roomState.players.length === 0) {
          this.roomRepository.delete(roomState.roomId);
          onRoomDeleted(roomState.roomId);
          affectedRooms.push({ roomId: roomState.roomId, roomState: null });
        } else {
          if (roomState.hostId === socketId) {
            roomState.hostId = roomState.players[0].id;
          }

          if (roomState.phase !== 'LOBBY' && roomState.players.length < 2) {
            roomState.phase = 'LOBBY';
            roomState.roundNumber = 0;
            roomState.drawerId = null;
            roomState.guesserId = null;
            roomState.currentTurnPlayerId = null;
            roomState.currentWord = null;
            roomState.obfuscatedWord = null;
            roomState.timeLeft = roomState.settings?.drawTimeLimit || 60;
            onRoomDeleted(roomState.roomId); // Clear active gameplay timers
          }

          this.roomRepository.save(roomState.roomId, roomState);
          affectedRooms.push({ roomId: roomState.roomId, roomState });
        }
      }
    }

    return affectedRooms;
  }
}
