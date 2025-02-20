import type { Request } from 'express';
import { VerifyCallback } from 'passport-oauth2';
import SnykOAuth2Strategy, { ProfileFunc } from '@snyk/passport-snyk-oauth2';
import { writeToDb } from '../db';
import { EncryptDecrypt } from '../encrypt-decrypt';
import { APIVersion,  Config, Envars } from '../../types';
import {AuthData } from '../../types/db';
import { API_BASE, APP_BASE } from '../../../app';
import { getAppOrg } from '../apiRequests';
import { v4 as uuid4 } from 'uuid';
import config from 'config';
import jwt_decode from 'jwt-decode';
import { AxiosResponse } from 'axios';
import { callSnykApi } from '../api';

type Params = {
  expires_in: number;
  scope: string;
  token_type: string;
};
// There is more data here but we only care about the nonce
type JWT = { nonce: string };

/**
 * Generating the passport strategy is the first step in setting up passportjs.
 * For convenience we have created our own passport strategy @snyk/passport-snyk-oauth2.
 * With the @snyk/passport-snyk-oauth2 strategy written in TypeScript, all the rquired
 * values can be passed when initializing the strategy.
 *
 * Nonce is encoded in the token returned. You can read more about it in the RFC:
 * https://datatracker.ietf.org/doc/html/rfc6749#section-7.1
 *
 * A nonce is a random string, uniquely generated by the client to allow the server
 * to verify that a request has never been made before and helps prevent replay attacks
 * when requests are made.
 *
 * @returns Snyk OAuth2 strategy for Snyk Apps Authentication
 */
export function getOAuth2(): SnykOAuth2Strategy {
  /**
   * All the required values are read from environmental variables
   * as these values are to be kept confidential
   * 1. clientID: The client of the Snyk app you created
   * 2. clientSecret: The client secret of the the Snyk app you created
   * 3. callbackURL: The callback URL for your Snyk app
   * 4. scope: The scope of your Snyk app
   * 5. nonce: nonce value
   * 6: profileFunc(optional): definition of your profileFunc
   */
  const clientID = process.env[Envars.ClientId] as string;
  const clientSecret = process.env[Envars.ClientSecret] as string;
  const callbackURL = process.env[Envars.RedirectUri] as string;
  const scope = process.env[Envars.Scopes] as string;
  const nonce = uuid4();
  /**
   * We highly encourage you to use the new V3 endpoints to gather any
   * information for profile management, but for demo purposes we are
   * using the V1 endpoint. Also note this is a completely optional field
   * @param {string} accessToken: This will be passed by the strategy when
   * authentication has been successful
   * @returns a promise which is called by the strategy, the resolved value
   * is passed back as the profile or if an error is encountered while execution
   * the error is passed back via the done callback
   */
  const profileFunc: ProfileFunc = function (accessToken: string) {
    return callSnykApi('bearer', accessToken, APIVersion.V1).get('/user/me');
  };

  // Note*: the value of version being manually added
  return new SnykOAuth2Strategy(
    {
      authorizationURL: `${APP_BASE}${config.get(Config.AuthURL)}?version=2021-08-11~experimental`,
      tokenURL: `${API_BASE}${config.get(Config.TokenURL)}`,
      clientID,
      clientSecret,
      callbackURL,
      scope,
      scopeSeparator: ' ',
      state: true,
      passReqToCallback: true,
      nonce,
      profileFunc,
    },
    async function (
      req: Request,
      access_token: string,
      refresh_token: string,
      params: Params,
      profile: AxiosResponse,
      done: VerifyCallback,
    ) {
      try {
        /**
         * The data fetched from the profile function can
         * be used for analytics or profile management
         * by the Snyk App
         */
        const userId = profile.data.id;
        const decoded: JWT = jwt_decode(access_token);
        if (nonce !== decoded.nonce) throw new Error('Nonce values do not match');
        const { expires_in, scope, token_type } = params;
        /**
         * This function to get the orgs itself can be passed
         * as the profile functions as the auth token for Snyk Apps
         * are managed on the Snyk org level
         */
        const { orgId } = await getAppOrg(token_type, access_token);
        const ed = new EncryptDecrypt(process.env[Envars.EncryptionSecret] as string);
        await writeToDb({
          date: new Date(),
          userId,
          orgId,
          access_token: ed.encryptString(access_token),
          expires_in,
          scope,
          token_type,
          refresh_token: ed.encryptString(refresh_token),
          nonce,
        } as AuthData);
      } catch (error) {
        return done(error as Error, false);
      }
      return done(null, { nonce });
    },
  );
}
