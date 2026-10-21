import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

import { HostService } from '../gen/hostd/v1/host_pb';
import { hostProbeFetch } from './hostProbeFetch';

class ProbeXHR {
  url = '';
  method = '';
  responseType = '';
  responseText = '';
  status = 200;
  headers = new Headers();
  body: string | null = null;
  aborted = false;
  onload = () => {};
  onerror = () => {};
  ontimeout = () => {};
  onabort = () => {};
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() { this.aborted = true; this.onabort(); }
}

function nativeXHR(t: TestContext, send: (xhr: ProbeXHR) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: class extends ProbeXHR {
      send(body: string | null) {
        this.body = body;
        send(this);
      }
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'XMLHttpRequest', previous);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  });
}

test('connection probe preserves the native DNS error', async (t) => {
  nativeXHR(t, (xhr) => {
    assert.equal(xhr.responseType, 'text');
    xhr.responseText = 'Unable to resolve host "desk.example": No address associated with hostname';
    xhr.onerror();
  });
  await assert.rejects(hostProbeFetch('https://desk.example:10000'), {
    name: 'TypeError',
    message: 'Unable to resolve host "desk.example": No address associated with hostname',
  });
});

test('generated Connect probe keeps port, bearer, JSON and authentication errors', async (t) => {
  nativeXHR(t, (xhr) => {
    assert.equal(new URL(xhr.url).port, '10000');
    assert.equal(xhr.method, 'POST');
    assert.equal(xhr.headers.get('Authorization'), 'Bearer test-token');
    assert.match(xhr.headers.get('Content-Type') ?? '', /application\/json/);
    if (xhr.url.endsWith('/Health')) {
      assert.deepEqual(JSON.parse(xhr.body!), {});
      xhr.responseText = '{"ok":true,"name":"desk"}';
    } else {
      assert.deepEqual(JSON.parse(xhr.body!), { points: 1 });
      xhr.status = 401;
      xhr.responseText = '{"code":"unauthenticated","message":"token required"}';
    }
    xhr.onload();
  });
  const client = createClient(HostService, createConnectTransport({
    baseUrl: 'https://desk.example:10000',
    useBinaryFormat: false,
    fetch: hostProbeFetch,
  }));
  const options = { headers: { Authorization: 'Bearer test-token' } };
  assert.equal((await client.health({}, options)).name, 'desk');
  await assert.rejects(client.getOverview({ points: 1 }, options), { code: Code.Unauthenticated });
});

test('connection cancellation stops the native request', async (t) => {
  const controller = new AbortController();
  let sent: ProbeXHR | undefined;
  nativeXHR(t, (xhr) => {
    sent = xhr;
    controller.abort();
  });
  await assert.rejects(hostProbeFetch('https://desk.example', { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(sent?.aborted, true);
});
