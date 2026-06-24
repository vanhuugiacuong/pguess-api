import { RoomState } from '../domain/interfaces/game.interface';

export interface RoomRepository {
  get(roomId: string): RoomState | undefined;
  save(roomId: string, state: RoomState): void;
  delete(roomId: string): boolean;
  getAll(): RoomState[];
}

export const RoomRepositoryToken = 'RoomRepository';
