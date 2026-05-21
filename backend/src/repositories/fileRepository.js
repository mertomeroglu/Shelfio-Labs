import { createPostgresRepository } from './postgresRepository.js';

const repositoryDebugSeen = new Set();

const logRepositoryDriver = (fileName, driver) => {
  if (String(process.env.DATA_STORE_DEBUG || '').toLowerCase() !== 'true') {
    return;
  }

  const key = `${driver}:${fileName}`;
  if (repositoryDebugSeen.has(key)) {
    return;
  }

  repositoryDebugSeen.add(key);
  console.info('[repository:data-store]', { fileName, driver });
};

export const createRepository = ({ fileName, defaultData, idKey = 'id' }) => {
  logRepositoryDriver(fileName, 'postgres');
  return createPostgresRepository({ fileName, defaultData, idKey });
};

export const createFileRepository = createRepository;
