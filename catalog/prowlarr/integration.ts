import { servarrIntegration } from '../_shared/servarr';

/**
 * What Mediaplane wires in Prowlarr (spec §6.2): the shared admin login, so far. It comes
 * after Sonarr and Radarr, whose links it will test (Slice 5).
 */
export default servarrIntegration('v1', ['radarr', 'sonarr']);
