export type LogFields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function write(level: string, message: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields }));
}

export const consoleJsonLogger: Logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};

/** Describes an error for logs without dumping arbitrary objects (which could carry secrets). */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? { error: error.name, code, detail: error.message } : { error: error.name, detail: error.message };
  }
  return { error: 'Unknown error' };
}
