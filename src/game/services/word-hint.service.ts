import { Injectable } from '@nestjs/common';
import { GameRulesEngine } from '../domain/game-rules.engine';

export const WORD_BANK = [
  'house', 'cat', 'tree', 'sun', 'car', 'flower', 'fish', 'cup', 'star', 'apple',
  'boat', 'bird', 'cake', 'hat', 'cloud', 'heart', 'moon', 'ball', 'book', 'face'
];

@Injectable()
export class WordHintService {
  getRandomWord(): string {
    const randIndex = Math.floor(Math.random() * WORD_BANK.length);
    return WORD_BANK[randIndex];
  }

  obfuscate(word: string): string {
    return GameRulesEngine.obfuscateWord(word);
  }

  getObfuscatedWordWithHints(word: string, revealedIndexes: number[]): string {
    return GameRulesEngine.getObfuscatedWordWithHints(word, revealedIndexes);
  }
}
