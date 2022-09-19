const emptyString = '';

/** @private */
export class StringScanner {
  charIndex: number;
  readonly string: string;

  private readonly chars: string[];
  private readonly charCount: number;
  private readonly charsToBytes: number[];
  private readonly multiByteMode: boolean;

  constructor(string: string) {
    this.chars = [ ...string ];
    this.charCount = this.chars.length;
    this.charIndex = 0;
    this.charsToBytes = new Array(this.charCount);
    this.multiByteMode = false;
    this.string = string;

    let { chars, charCount, charsToBytes } = this;

    if (charCount === string.length) {
      // There are no multibyte characters in the input string, so char indexes
      // and byte indexes are the same.
      for (let i = 0; i < charCount; ++i) {
        charsToBytes[i] = i;
      }
    } else {
      // Create a mapping of character indexes to byte indexes. When the string
      // contains multibyte characters, a byte index may not necessarily align
      // with a character index.
      for (let byteIndex = 0, charIndex = 0; charIndex < charCount; ++charIndex) {
        charsToBytes[charIndex] = byteIndex;
        byteIndex += (chars[charIndex] as string).length;
      }

      this.multiByteMode = true;
    }
  }

  /**
   * Whether the current character index is at the end of the input string.
   */
  get isEnd() {
    return this.charIndex >= this.charCount;
  }

  // -- Protected Methods ------------------------------------------------------

  /**
   * Returns the number of characters in the given _string_, which may differ
   * from the byte length if the string contains multibyte characters.
   */
  _charLength(string: string): number {
    let { length } = string;

    if (length < 2 || !this.multiByteMode) {
      return length;
    }

    // We could get the char length with `[ ...string ].length`, but that's
    // actually slower than this approach, which replaces surrogate pairs with
    // single-byte characters.
    return string.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;
  }

  // -- Public Methods ---------------------------------------------------------

  /**
   * Advances the scanner by the given number of characters, stopping if the end
   * of the string is reached.
   */
  advance(count = 1) {
    this.charIndex = Math.min(this.charCount, this.charIndex + count);
  }

  /**
   * Consumes and returns the given number of characters if possible, advancing
   * the scanner and stopping if the end of the string is reached.
   *
   * If no characters could be consumed, an empty string will be returned.
   */
  consume(count = 1): string {
    let chars = this.peek(count);
    this.advance(count);
    return chars;
  }

  /**
   * Consumes a match for the given sticky regex, advances the scanner, updates
   * the `lastIndex` property of the regex, and returns the matching string.
   *
   * The regex must have a sticky flag ("y") so that its `lastIndex` prop can be
   * used to anchor the match at the current scanner position.
   *
   * Returns the consumed string, or an empty string if nothing was consumed.
   */
  consumeMatch(regex: RegExp): string {
    if (!regex.sticky) {
      throw new Error('`regex` must have a sticky flag ("y")');
    }

    regex.lastIndex = this.charsToBytes[this.charIndex] as number;

    let result = regex.exec(this.string);

    if (result === null || result.length === 0) {
      return emptyString;
    }

    let match = result[0] as string;
    this.advance(this._charLength(match));
    return match;
  }

  /**
   * Consumes and returns all characters for which the given function returns a
   * truthy value, stopping on the first falsy return value or if the end of the
   * input is reached.
   */
  consumeMatchFn(fn: (char: string) => boolean): string {
    let startIndex = this.charIndex;

    while (!this.isEnd && fn(this.peek())) {
      this.advance();
    }

    return this.charIndex > startIndex
      ? this.string.slice(this.charsToBytes[startIndex], this.charsToBytes[this.charIndex])
      : emptyString;
  }

  /**
   * Consumes the given string if it exists at the current character index, and
   * advances the scanner.
   *
   * If the given string doesn't exist at the current character index, an empty
   * string will be returned and the scanner will not be advanced.
   */
  consumeString(stringToConsume: string): string {
    if (this.consumeStringFast(stringToConsume)) {
      return stringToConsume;
    }

    if (!this.multiByteMode) {
      return emptyString;
    }

    let { length } = stringToConsume;
    let charLengthToMatch = this._charLength(stringToConsume);

    if (charLengthToMatch !== length
        && stringToConsume === this.peek(charLengthToMatch)) {

      this.advance(charLengthToMatch);
      return stringToConsume;
    }

    return emptyString;
  }

  /**
   * Does the same thing as `consumeString()`, but doesn't support consuming
   * multibyte characters. This can be much faster if you only need to match
   * single byte characters.
   */
  consumeStringFast(stringToConsume: string): string {
    if (this.peek() === stringToConsume[0]) {
      let { length } = stringToConsume;

      if (length === 1) {
        this.advance();
        return stringToConsume;
      }

      if (this.peek(length) === stringToConsume) {
        this.advance(length);
        return stringToConsume;
      }
    }

    return emptyString;
  }

  /**
   * Consumes characters until the given global regex is matched, advancing the
   * scanner up to (but not beyond) the beginning of the match and updating the
   * `lastIndex` property of the regex.
   *
   * The regex must have a global flag ("g") so that its `lastIndex` prop can be
   * used to begin the search at the current scanner position.
   *
   * Returns the consumed string, or an empty string if nothing was consumed.
   */
  consumeUntilMatch(regex: RegExp): string {
    if (!regex.global) {
      throw new Error('`regex` must have a global flag ("g")');
    }

    let byteIndex = this.charsToBytes[this.charIndex] as number;
    regex.lastIndex = byteIndex;

    let match = regex.exec(this.string);

    if (match === null || match.index === byteIndex) {
      return emptyString;
    }

    let result = this.string.slice(byteIndex, match.index);
    this.advance(this._charLength(result));
    return result;
  }

  /**
   * Consumes characters until the given string is found, advancing the scanner
   * up to (but not beyond) that point.
   *
   * Returns the consumed string, or an empty string if nothing was consumed.
   */
  consumeUntilString(searchString: string): string {
    let { charIndex, charsToBytes, string } = this;
    let byteIndex = charsToBytes[charIndex];
    let matchByteIndex = string.indexOf(searchString, byteIndex);

    if (matchByteIndex <= 0) {
      return emptyString;
    }

    let result = string.slice(byteIndex, matchByteIndex);
    this.advance(this._charLength(result));
    return result;
  }

  /**
   * Returns the given number of characters starting at the current character
   * index, without advancing the scanner and without exceeding the end of the
   * input string.
   */
  peek(count = 1): string {
    // Inlining this comparison instead of checking `this.isEnd` improves perf
    // slightly since `peek()` is called so frequently.
    if (this.charIndex >= this.charCount) {
      return emptyString;
    }

    if (count === 1) {
      return this.chars[this.charIndex] as string;
    }

    let { charsToBytes, charIndex } = this;
    return this.string.slice(charsToBytes[charIndex], charsToBytes[charIndex + count]);
  }

  /**
   * Resets the scanner position to the given character _index_, or to the start
   * of the input string if no index is given.
   *
   * If _index_ is negative, the scanner position will be moved backward by that
   * many characters, stopping if the beginning of the string is reached.
   */
  reset(index = 0) {
    this.charIndex = index >= 0
      ? Math.min(this.charCount, index)
      : Math.max(0, this.charIndex + index);
  }
}
