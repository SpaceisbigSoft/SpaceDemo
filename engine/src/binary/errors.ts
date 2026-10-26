/** Raised when a read goes past the end of the available data. */
export class OutOfDataError extends Error {
  constructor(what: string, offset: number, needed: number, available: number) {
    super(`Ran out of data reading ${what} at byte ${offset} (needed ${needed}, ${available} left)`);
    this.name = 'OutOfDataError';
  }
}

/** Raised when data does not match the expected format. */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}
