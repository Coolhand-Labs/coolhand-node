import { CoolhandClientFilePayload, CoolhandClientFileResponse } from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface ClientFileServiceConfig extends BaseServiceConfig {}

function hasBracketOrControlChar(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (key[i] === '[' || key[i] === ']' || code < 0x20 || code === 0x7f) { return true; }
  }
  return false;
}

export class ClientFileService extends BaseService {
  constructor(config: ClientFileServiceConfig) {
    super(config, '/api/v2/client_files');
  }

  public async createClientFile(payload: CoolhandClientFilePayload): Promise<CoolhandClientFileResponse | null> {
    const formData = new FormData();
    formData.append('client_file[name]', payload.name);
    if (payload.file_type) {
      formData.append('client_file[file_type]', payload.file_type);
    }
    if (payload.description) {
      formData.append('client_file[description]', payload.description);
    }
    const filePart = payload.file instanceof Blob ? payload.file : new Blob([new Uint8Array(payload.file)]);
    formData.append('client_file[file]', filePart, payload.filename);
    if (payload.metadata) {
      for (const [key, value] of Object.entries(payload.metadata)) {
        // The key is interpolated into a Rack-style multipart field name, so brackets would open
        // extra nesting levels (`a][b`) and control characters could corrupt the field header.
        if (key === '' || hasBracketOrControlChar(key)) {
          throw new Error(`Invalid client file metadata key ${JSON.stringify(key)}: keys must be non-empty and must not contain "[", "]" or control characters`);
        }
        // A bare String(value) mangles non-primitives (arrays comma-join, objects become
        // "[object Object]") since multipart fields are always strings — JSON.stringify keeps
        // them round-trippable instead of silently losing structure.
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        // JSON.stringify(undefined | function | symbol) is `undefined`, which append() would send
        // as the literal string "undefined".
        if (stringValue === undefined) { continue; }
        formData.append(`client_file[metadata][${key}]`, stringValue);
      }
    }

    const result = await this.sendMultipart<CoolhandClientFileResponse>(
      formData,
      `✅ Successfully uploaded client file: ${payload.name}`
    );

    this.logSeparator();

    return result;
  }
}
