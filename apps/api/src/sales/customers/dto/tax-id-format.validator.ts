import { registerDecorator, ValidationArguments, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/** Identification format per `customers.type` (owner redesign): cedula is exactly 10 digits, ruc
 * exactly 13 digits, pasaporte alphanumeric. Keyed by the same values as the `customers_type_check`
 * constraint (migration 0037). */
const TAX_ID_PATTERNS: Record<string, RegExp> = {
  cedula: /^\d{10}$/,
  ruc: /^\d{13}$/,
  pasaporte: /^[A-Za-z0-9]+$/,
};

@ValidatorConstraint({ name: 'isTaxIdForType', async: false })
class IsTaxIdForTypeConstraint implements ValidatorConstraintInterface {
  validate(taxId: unknown, args: ValidationArguments): boolean {
    if (typeof taxId !== 'string' || taxId.length === 0) {
      return false;
    }
    const type = (args.object as { type?: unknown }).type;
    // A partial update that changes `taxId` without also sending `type` can't be format-checked
    // here — there is no sibling value to check it against (the DTO never reads the persisted row).
    if (type === undefined) {
      return true;
    }
    const pattern = typeof type === 'string' ? TAX_ID_PATTERNS[type] : undefined;
    return pattern ? pattern.test(taxId) : false;
  }

  defaultMessage(args: ValidationArguments): string {
    const type = (args.object as { type?: unknown }).type;
    if (type === 'cedula') return 'taxId must be exactly 10 digits for type cedula.';
    if (type === 'ruc') return 'taxId must be exactly 13 digits for type ruc.';
    if (type === 'pasaporte') return 'taxId must contain only letters and numbers for type pasaporte.';
    return 'taxId format is invalid for the given type.';
  }
}

/** Validates `taxId` against the format required by the sibling `type` field on the same DTO. */
export function IsTaxIdForType(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isTaxIdForType',
      target: object.constructor,
      propertyName,
      ...(validationOptions !== undefined ? { options: validationOptions } : {}),
      validator: IsTaxIdForTypeConstraint,
    });
  };
}
