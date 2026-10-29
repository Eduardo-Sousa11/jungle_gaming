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
        message: 'A validação da requisição falhou',
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
  const ownMessages = Object.keys(error.constraints ?? {}).map(
    (constraint) => `${path}: ${validationMessage(constraint)}`,
  );
  const childMessages = (error.children ?? []).flatMap((child) =>
    validationMessages(child, path),
  );
  return [...ownMessages, ...childMessages];
}

function validationMessage(constraint: string): string {
  const messages: Readonly<Record<string, string>> = {
    isString: 'deve ser um texto',
    minLength: 'não possui o tamanho mínimo permitido',
    maxLength: 'excede o tamanho máximo permitido',
    isUuid: 'deve ser um UUID válido',
    isIn: 'possui um valor não permitido',
    nestedValidation: 'deve ser um objeto válido',
    matches: 'possui um formato inválido',
    isInt: 'deve ser um número inteiro',
    min: 'está abaixo do valor mínimo permitido',
    max: 'está acima do valor máximo permitido',
    whitelistValidation: 'não é permitido',
  };
  return messages[constraint] ?? 'não atende à validação esperada';
}
