import { Hono } from 'hono';
import { ZodError } from 'zod';
import {
  BrokerAuthorizationServiceError,
  type BrokerDevicePrincipal,
} from './broker-authorization-service.ts';
import type { AuthenticatedOwner } from './owner-approval.ts';

type BrokerAuthorizationService = Readonly<{
  requestAuthorization(raw: unknown, principal: BrokerDevicePrincipal): Promise<unknown>;
  reviewAuthorization(runIntentId: string, owner: AuthenticatedOwner | null): Promise<unknown>;
  decideAuthorization(raw: unknown, owner: AuthenticatedOwner | null): Promise<unknown>;
  claimApprovedAuthorization(raw: unknown, principal: BrokerDevicePrincipal): Promise<unknown>;
  authorizationStatus(raw: unknown, principal: BrokerDevicePrincipal): Promise<unknown>;
}>;

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Authenticated HTTP adapter. Authentication remains an injected boundary so production must
 * explicitly bind the existing device-token and Better Auth resolvers; missing resolvers cannot
 * accidentally create an unauthenticated route.
 */
export function createBrokerAuthorizationApi(input: Readonly<{
  service: BrokerAuthorizationService;
  resolveDevice(request: Request): Promise<BrokerDevicePrincipal | null>;
  resolveFreshOwner(request: Request): Promise<AuthenticatedOwner | null>;
}>) {
  const app = new Hono();
  const body = async (request: Request) => {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new Response(JSON.stringify({ error: 'payload_too_large' }), {
        status: 413, headers: { 'content-type': 'application/json' },
      });
    }
    if (!request.body) throw new SyntaxError('request body is required');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Response(JSON.stringify({ error: 'payload_too_large' }), {
          status: 413, headers: { 'content-type': 'application/json' },
        });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  const handle = (error: unknown) => {
    if (error instanceof Response) return error;
    if (error instanceof BrokerAuthorizationServiceError) {
      return new Response(JSON.stringify({ error: error.code }), {
        status: error.status, headers: { 'content-type': 'application/json' },
      });
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: 'invalid_request' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'broker_authorization_unavailable' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  };

  app.post('/api/devices/broker-authorizations', async c => {
    try {
      const principal = await input.resolveDevice(c.req.raw);
      if (!principal) return c.json({ error: 'unauthorized' }, 401);
      return c.json(await input.service.requestAuthorization(await body(c.req.raw), principal), 201);
    } catch (error) { return handle(error); }
  });
  app.get('/api/owner/broker-authorizations/:runIntentId', async c => {
    try {
      return c.json(await input.service.reviewAuthorization(
        c.req.param('runIntentId'), await input.resolveFreshOwner(c.req.raw),
      ));
    } catch (error) { return handle(error); }
  });
  app.post('/api/owner/broker-authorizations/decisions', async c => {
    try {
      return c.json(await input.service.decideAuthorization(
        await body(c.req.raw), await input.resolveFreshOwner(c.req.raw),
      ), 201);
    } catch (error) { return handle(error); }
  });
  app.post('/api/devices/broker-approvals/claim', async c => {
    try {
      const principal = await input.resolveDevice(c.req.raw);
      if (!principal) return c.json({ error: 'unauthorized' }, 401);
      return c.json(await input.service.claimApprovedAuthorization(await body(c.req.raw), principal));
    } catch (error) { return handle(error); }
  });
  app.post('/api/devices/broker-authorizations/status', async c => {
    try {
      const principal = await input.resolveDevice(c.req.raw);
      if (!principal) return c.json({ error: 'unauthorized' }, 401);
      return c.json(await input.service.authorizationStatus(await body(c.req.raw), principal));
    } catch (error) { return handle(error); }
  });
  return app;
}
