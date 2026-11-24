export class BridgeError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeError";
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG_INVALID", message, details);
    this.name = "ConfigError";
  }
}

export class FairlightError extends BridgeError {
  constructor(code: string, message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(code, message, details, options);
    this.name = "FairlightError";
  }
}

export class MidiError extends BridgeError {
  constructor(code: string, message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(code, message, details, options);
    this.name = "MidiError";
  }
}
