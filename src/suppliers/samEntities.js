import { request } from 'undici';
import { config } from '../config.js';

/**
 * SAM.gov Entity Management API — registered federal vendors by NAICS.
 * Docs: https://open.gsa.gov/api/entity-api/
 */
export async function findRegisteredVendors(naics, limit = 10) {
  if (!config.samApiKey || !naics) return [];
  const params = new URLSearchParams({
    api_key: config.samApiKey,
    registrationStatus: 'A',
    primaryNaics: naics,
    includeSections: 'entityRegistration,coreData',
    samRegistered: 'Yes',
    page: '0',
    size: String(limit),
  });
  const url = `https://api.sam.gov/entity-information/v3/entities?${params.toString()}`;
  try {
    const { statusCode, body } = await request(url);
    const text = await body.text();
    if (statusCode >= 400) {
      console.warn('[sam-entity]', statusCode, text.slice(0, 200));
      return [];
    }
    const json = JSON.parse(text);
    const entities = json.entityData || [];
    return entities.map(e => {
      const reg = e.entityRegistration || {};
      const core = e.coreData || {};
      const poc = (core.pointOfContactList && core.pointOfContactList[0]) || {};
      return {
        name: reg.legalBusinessName,
        website: core.entityInformation?.entityURL || null,
        email: poc.email || null,
        source: 'sam_entity',
        notes: `UEI: ${reg.ueiSAM || 'n/a'} | NAICS: ${naics}`,
      };
    }).filter(s => s.name);
  } catch (e) {
    console.warn('[sam-entity] error:', e.message);
    return [];
  }
}
