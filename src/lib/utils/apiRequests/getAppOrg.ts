import { APIVersion, Envars } from '../../types';
import { callSnykApi } from '../api';

/**
 * Function to get app's Snyk Org ID i.e the org the app has access to
 * which is used in other API requests
 * @param {String} access_token access token fetched on users behalf
 * @param {String} token_type token type which is normally going to be bearer
 * @returns Org data or throws and error
 */
export async function getAppOrg(tokenType: string, accessToken: string): Promise<{ orgId: string }> {
  try {
    const clientId = process.env[Envars.ClientId];
    const result = await callSnykApi(
      tokenType,
      accessToken,
      APIVersion.V3,
    )({
      method: 'GET',
      url: `/apps/${clientId}/orgs?version=2021-08-11~experimental`,
    });
    // Fetch the first org for demo purposes
    const org = result.data.data[0];
    return {
      orgId: org.id,
    };
  } catch (error) {
    console.error('Error fetching org info: ' + error);
    throw error;
  }
}
