export interface IIdGenerator {
  generate(): string;
}

export const ID_GENERATOR_TOKEN = Symbol('ID_GENERATOR_TOKEN');
