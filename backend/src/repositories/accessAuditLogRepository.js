import { createFileRepository } from './fileRepository.js';

const baseRepo = createFileRepository({ fileName: 'accessAuditLogs.json', defaultData: [] });

export const accessAuditLogRepo = {
  ...baseRepo,
};
