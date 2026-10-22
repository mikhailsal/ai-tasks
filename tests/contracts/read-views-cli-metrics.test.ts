import {
  installReadViewHarness,
  registerMetricViewContracts,
} from '../fixtures/read-views-registrations.js';
registerMetricViewContracts('cli', installReadViewHarness());
