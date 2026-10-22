import type { createContext } from '../context.js';
import type { openDatabase } from './open.js';

export type CoreContext = ReturnType<typeof createContext>;
export type DatabaseConnection = ReturnType<typeof openDatabase>;
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseConnection['db']['transaction']>[0]
>[0];
