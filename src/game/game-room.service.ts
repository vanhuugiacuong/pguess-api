import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GameSettings, Player, RoomState } from './interfaces/game.interface';

@Injectable()
export class GameRoomService {
  // Store rooms in an in-memory Map
  private rooms = new Map<string, RoomState>();

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
      currentWord: null,
      timeLeft: settings.drawTimeLimit,
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
}
