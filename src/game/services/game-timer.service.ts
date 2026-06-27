import { Injectable } from '@nestjs/common';

@Injectable()
export class GameTimerService {
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Starts a 1-second interval timer for a room.
   * If a timer already exists for the room, it is cleared first.
   */
  startTimer(
    roomId: string,
    duration: number,
    onTick: (secondsLeft: number) => void,
    onComplete: () => void
  ): void {
    this.stopTimer(roomId);

    let timeLeft = duration;
    const timer = setInterval(() => {
      if (timeLeft <= 1) {
        this.stopTimer(roomId);
        onComplete();
      } else {
        timeLeft--;
        onTick(timeLeft);
      }
    }, 1000);

    this.timers.set(roomId, timer);
  }

  /**
   * Stops and clears the timer for a room.
   */
  stopTimer(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(roomId);
    }
  }
}
