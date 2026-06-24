import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameRoomService } from './game-room.service';
import { GameSettings } from './interfaces/game.interface';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(private readonly gameRoomService: GameRoomService) {}

  /**
   * Hook called when a client connects
   */
  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  /**
   * Hook called when a client disconnects
   */
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const affectedRooms = this.gameRoomService.handlePlayerDisconnect(client.id);

    for (const { roomId, roomState } of affectedRooms) {
      if (roomState) {
        // Room still has players, broadcast the updated state to everyone left in the room
        this.server.to(roomId).emit('room_state_updated', roomState);
        this.logger.log(`Player left room ${roomId}. Updated state broadcasted.`);
      } else {
        this.logger.log(`Room ${roomId} has been deleted as it has no players left.`);
      }
    }
  }

  /**
   * Client request to create a new room
   */
  @SubscribeMessage('create_room')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { nickname: string; avatar: string; settings: GameSettings },
  ) {
    this.logger.log(`create_room event received from ${client.id} with nickname: ${data.nickname}`);
    
    try {
      const roomState = this.gameRoomService.createRoom(
        data.nickname,
        data.avatar,
        data.settings,
        client.id,
      );

      // Join the socket room channel
      client.join(roomState.roomId);

      // Broadcast to the room (includes the creator)
      this.server.to(roomState.roomId).emit('room_state_updated', roomState);

      // Return state to creator directly
      return roomState;
    } catch (error) {
      this.logger.error(`Error creating room: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Client request to join an existing room
   */
  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; nickname: string; avatar: string },
  ) {
    this.logger.log(
      `join_room event received from ${client.id} for room ${data.roomId} with nickname: ${data.nickname}`,
    );

    try {
      const roomState = this.gameRoomService.joinRoom(
        data.roomId,
        data.nickname,
        data.avatar,
        client.id,
      );

      // Join the socket room channel
      client.join(roomState.roomId);

      // Broadcast the updated state to all players in the room
      this.server.to(roomState.roomId).emit('room_state_updated', roomState);

      // Return state to joiner directly
      return roomState;
    } catch (error) {
      this.logger.error(`Error joining room: ${error.message}`);
      return { error: error.message };
    }
  }
}
