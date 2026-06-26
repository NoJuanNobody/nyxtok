/**
 * Proxy to the discovery package's engagement module.
 *
 * The API server can't directly import @nyxtok/discovery (different package),
 * so this re-exports the engagement functions using the shared DB connection.
 */
export { computeEngagementProfile } from './engagement-inline';
