import type { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('verbose', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, optional);
  }

  private write(level: string, message: unknown, optional: unknown[]): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      ...(isRecord(message)
        ? message
        : { message: translateSystemMessage(normalize(message)) }),
      ...(optional.length === 0 ? {} : { context: optional.map(normalize) }),
    };
    const output = `${JSON.stringify(entry)}\n`;
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(output);
    } else {
      process.stdout.write(output);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function translateSystemMessage(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'Starting Nest application...') {
    return 'Iniciando a aplicação Nest...';
  }
  if (value === 'Nest application successfully started') {
    return 'Aplicação Nest iniciada com sucesso';
  }
  if (value.endsWith(' dependencies initialized')) {
    return `Dependências de ${value.slice(0, -' dependencies initialized'.length)} inicializadas`;
  }
  const mappedRoute = /^Mapped (.+) route$/.exec(value);
  if (mappedRoute !== null) {
    return `Rota ${mappedRoute[1]} mapeada`;
  }
  return value;
}
