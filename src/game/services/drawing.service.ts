import { Injectable } from '@nestjs/common';
import { RoomState } from '../domain/interfaces/game.interface';

@Injectable()
export class DrawingService {
  savePlayerStroke(room: RoomState, socketId: string, stroke: any): void {
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return;

    if (!player.drawingData) {
      player.drawingData = [];
    }
    player.drawingData.push(stroke);
  }

  clearPlayerDrawing(room: RoomState, socketId: string): void {
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return;

    player.drawingData = [];
  }
}
