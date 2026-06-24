import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { LobbyService } from './services/lobby.service';
import { GameLoopService } from './services/game-loop.service';
import { MemoryRoomRepository } from './storage/memory-room.repository';
import { RoomRepositoryToken } from './storage/room.repository';

@Module({
  providers: [
    GameGateway,
    LobbyService,
    GameLoopService,
    {
      provide: RoomRepositoryToken,
      useClass: MemoryRoomRepository,
    },
  ],
  exports: [LobbyService, GameLoopService],
})
export class GameModule {}
