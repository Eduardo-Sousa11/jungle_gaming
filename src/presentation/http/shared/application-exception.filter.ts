import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';

interface HttpResponseAdapter {
  status(statusCode: number): HttpResponseAdapter;
  json(body: unknown): void;
}

const DEFAULT_NEST_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Unprocessable Entity',
  'Service Unavailable',
  'Internal Server Error',
]);

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApplicationExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseAdapter>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(localizeHttpResponse(exception, status));
      return;
    }

    this.logger.error({
      event: 'erro_http_nao_tratado',
      errorCode: exception instanceof Error ? exception.name : 'ERRO_DESCONHECIDO',
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro interno no servidor',
    });
  }
}

function localizeHttpResponse(
  exception: HttpException,
  status: number,
): string | Readonly<Record<string, unknown>> {
  const value = exception.getResponse();
  if (typeof value === 'string') {
    return {
      statusCode: status,
      message: defaultMessage(status),
    };
  }

  const responseBody = value as Readonly<Record<string, unknown>>;
  const message = responseBody['message'];
  if (isDefaultNestMessage(message, status)) {
    return {
      ...responseBody,
      message: defaultMessage(status),
      ...(typeof responseBody['error'] === 'string'
        ? { error: defaultError(status) }
        : {}),
    };
  }

  return responseBody;
}

function isDefaultNestMessage(message: unknown, status: number): boolean {
  return (
    typeof message !== 'string' ||
    message.startsWith('Cannot ') ||
    DEFAULT_NEST_MESSAGES.has(message) ||
    message === HttpStatus[status]
  );
}

function defaultMessage(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'A requisição é inválida';
    case HttpStatus.UNAUTHORIZED:
      return 'Autenticação necessária';
    case HttpStatus.FORBIDDEN:
      return 'Acesso não autorizado';
    case HttpStatus.NOT_FOUND:
      return 'A rota solicitada não foi encontrada';
    case HttpStatus.CONFLICT:
      return 'A requisição entrou em conflito com o estado atual';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'A requisição não pôde ser processada';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'O serviço está temporariamente indisponível';
    default:
      return 'A requisição não pôde ser concluída';
  }
}

function defaultError(status: number): string {
  return status === HttpStatus.NOT_FOUND
    ? 'Não encontrado'
    : 'Erro na requisição';
}
