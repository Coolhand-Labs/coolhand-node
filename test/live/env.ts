/**
 * Shared prerequisites for the live suites. Throws rather than skipping: a run that asked for
 * `npm run test:live` and quietly proved nothing is worse than a hard failure. The key is read from
 * the environment and never written down — it is a live credential.
 */
const baseUrl = process.env.COOLHAND_LIVE_BASE_URL;
const apiKey = process.env.COOLHAND_LIVE_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error(
    'Live tests need COOLHAND_LIVE_BASE_URL and COOLHAND_LIVE_API_KEY (a private API key) in the ' +
      'environment. Set both and re-run `npm run test:live`.'
  );
}

export const LIVE_BASE_URL: string = baseUrl;
export const LIVE_API_KEY: string = apiKey;
