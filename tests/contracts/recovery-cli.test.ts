import { installRecoveryContracts } from '../fixtures/recovery-registrations-context.js';
import {
  registerRecoveryTransportContracts,
  registerRestoreTransportContracts,
} from '../fixtures/recovery-registrations.js';
const context = installRecoveryContracts();
registerRecoveryTransportContracts('cli', context);
registerRestoreTransportContracts('cli', context);
