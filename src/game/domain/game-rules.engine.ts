export class GameRulesEngine {
  /**
   * Obfuscates the secret word into dashes, e.g. "cat" -> "_ _ _"
   */
  static obfuscateWord(word: string): string {
    if (!word) return '';
    return word.split('').map(() => '_').join(' ');
  }

  /**
   * Obfuscates the secret word, revealing specific character indexes as hints
   */
  static getObfuscatedWordWithHints(word: string, revealedIndexes: number[]): string {
    if (!word) return '';
    return word
      .split('')
      .map((char, index) => {
        if (char === ' ') return ' ';
        return revealedIndexes.includes(index) ? char : '_';
      })
      .join(' ');
  }

  /**
   * Calculates score gain for guesser in Mode A
   */
  static calculateScoreGain(timeLeft: number, drawTimeLimit: number): number {
    const limit = drawTimeLimit || 60;
    const timeLeftScale = timeLeft / limit;
    return Math.round(100 * timeLeftScale) + 20; // Min 20 points
  }

  /**
   * Calculates score gain for guesser in Mode B (Ice Breaker)
   */
  static calculateModeBScoreGain(timeLeft: number, drawTimeLimit: number): number {
    const limit = drawTimeLimit || 60;
    return Math.round(150 * (timeLeft / limit)) + 50;
  }

  /**
   * Verifies if the guess matches the secret word (case-insensitive)
   */
  static isCorrectGuess(guess: string, word: string): boolean {
    if (!guess || !word) return false;
    return guess.trim().toLowerCase() === word.toLowerCase();
  }
}
