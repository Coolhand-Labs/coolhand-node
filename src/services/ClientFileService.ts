import { CoolhandClientFilePayload, CoolhandClientFileResponse } from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface ClientFileServiceConfig extends BaseServiceConfig {}

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
        // A bare String(value) mangles non-primitives (arrays comma-join, objects become
        // "[object Object]") since multipart fields are always strings — JSON.stringify keeps
        // them round-trippable instead of silently losing structure.
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
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
