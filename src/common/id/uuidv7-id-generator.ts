import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { IIdGenerator } from './id-generator.interface';

@Injectable()
export class UuidV7IdGenerator implements IIdGenerator {
  generate(): string {
    return uuidv7();
  }
}
