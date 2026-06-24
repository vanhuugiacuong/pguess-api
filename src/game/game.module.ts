import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameRoomService } from './game-room.service';

@Module({
  providers: [GameGateway, GameRoomService],
  exports: [GameRoomService], // Export in case other modules need room details
})
export class GameModule {}
