import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { LobbyService } from './services/lobby.service';
import { GameLoopService } from './services/game-loop.service';
import { WordHintService } from './services/word-hint.service';
import { DrawingService } from './services/drawing.service';
import { GameTimerService } from './services/game-timer.service';
import { ModeAStrategy } from './strategies/mode-a.strategy';
import { ModeBStrategy } from './strategies/mode-b.strategy';
import { MemoryRoomRepository } from './storage/memory-room.repository';
import { RoomRepositoryToken } from './storage/room.repository';

@Module({
  providers: [
    GameGateway,
    LobbyService,
    GameLoopService,
    WordHintService,
    DrawingService,
    GameTimerService,
    ModeAStrategy,
    ModeBStrategy,
    {
      provide: RoomRepositoryToken,
      useClass: MemoryRoomRepository,
    },
  ],
  exports: [LobbyService, GameLoopService, GameTimerService],
})
export class GameModule {}
