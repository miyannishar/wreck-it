export class WreckError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
    this.name = "WreckError";
  }
}
