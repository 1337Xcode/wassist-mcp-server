/** Severity of a log line. */
type Level = 'info' | 'warn' | 'error';

/** Writes one JSON line to stderr. Stdout belongs to the MCP protocol on the stdio transport. */
function write(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`,
  );
}

/** The logger every module uses. Each call writes one JSON line to stderr. */
export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
