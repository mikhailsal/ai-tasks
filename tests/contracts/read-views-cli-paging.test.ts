import {
  installReadViewHarness,
  registerGroupedViewContracts,
} from '../fixtures/read-views-registrations.js';
registerGroupedViewContracts('cli', installReadViewHarness());
