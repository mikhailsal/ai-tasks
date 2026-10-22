import {
  installReadViewHarness,
  registerGroupedViewContracts,
  registerMetricViewContracts,
} from '../fixtures/read-views-registrations.js';
const current = installReadViewHarness();
registerGroupedViewContracts('http', current);
registerMetricViewContracts('http', current);
