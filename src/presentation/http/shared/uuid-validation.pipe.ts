import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

export function createUuidValidationPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    version: 'all',
    exceptionFactory: () =>
      new BadRequestException({
        code: 'INVALID_UUID',
        message: 'O parâmetro deve ser um UUID válido',
      }),
  });
}
