import { Injectable } from '@nestjs/common';
import { GameRulesEngine } from '../domain/game-rules.engine';
import { WORD_BANKS, CATEGORY_ALIASES } from '../domain/word-bank.constants';

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

  getWordBank(
    wordCategory?: string,
    customWordBank?: string[],
  ): string[] {
    const customWords = (customWordBank || [])
      .map((word) => word.trim())
      .filter((word) => word.length > 0);

    if (customWords.length > 0) {
      return customWords;
    }

    const normalizedCategory = this.normalizeWordCategory(wordCategory);
    return WORD_BANKS[normalizedCategory] || WORD_BANKS.general;
  }

  normalizeWordCategory(wordCategory?: string): string {
    if (!wordCategory) {
      return 'general';
    }

    const normalized = wordCategory.trim().toLowerCase();
    return CATEGORY_ALIASES[normalized] || normalized;
  }
}
