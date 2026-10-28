import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export function createApplicationValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors.flatMap((error) => validationMessages(error)),
      }),
  });
}

function validationMessages(
  error: ValidationError,
  parentPath = '',
): readonly string[] {
  const path =
    parentPath.length === 0
      ? error.property
      : `${parentPath}.${error.property}`;
  const ownMessages = Object.values(error.constraints ?? {}).map(
    (message) => `${path}: ${message}`,
  );
  const childMessages = (error.children ?? []).flatMap((child) =>
    validationMessages(child, path),
  );
  return [...ownMessages, ...childMessages];
}
