import { Injectable } from '@nestjs/common';
import { RoomState } from '../domain/interfaces/game.interface';
import { RoomRepository } from './room.repository';

@Injectable()
export class MemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, RoomState>();

  get(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  save(roomId: string, state: RoomState): void {
    this.rooms.set(roomId.toUpperCase(), state);
  }

  delete(roomId: string): boolean {
    return this.rooms.delete(roomId.toUpperCase());
  }

  getAll(): RoomState[] {
    return Array.from(this.rooms.values());
  }
}
