export class GatewayError extends Error {
  constructor(code, message, hint = '', status = 400) {
    super(message); this.name = 'GatewayError'; this.code = code; this.hint = hint; this.status = status;
  }
}
export const usage = message => new GatewayError('USAGE', message, 'Run proxyup --help for commands and flags.');
