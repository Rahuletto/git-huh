/**
 * Text-only fetch for the Connect JSON connection probe. React Native keeps
 * native DNS/TLS/socket errors in XHR.responseText, but its fetch polyfill
 * replaces them with "Network request failed". Keep them for the setup form.
 * Normal host reads still use the binary protobuf transport.
 */
export const hostProbeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => request.signal.removeEventListener('abort', abort);
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      fail(Object.assign(new Error('connection canceled'), { name: 'AbortError' }));
    };
    if (request.signal.aborted) {
      abort();
      return;
    }
    xhr.open(request.method, request.url, true);
    xhr.responseType = 'text';
    xhr.onload = () => {
      cleanup();
      try {
        const headers = new Headers();
        for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
          const colon = line.indexOf(':');
          if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
        resolve(new Response(xhr.responseText || null, { status: xhr.status, headers }));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => fail(new TypeError(xhr.responseText || 'network request failed'));
    xhr.ontimeout = () => fail(new TypeError(xhr.responseText || 'network request timed out'));
    xhr.onabort = () => fail(Object.assign(new Error('connection canceled'), { name: 'AbortError' }));
    request.headers.forEach((value, name) => xhr.setRequestHeader(name, value));
    request.signal.addEventListener('abort', abort);
    // A cancellation may have happened while the request body was being read.
    if (request.signal.aborted) abort();
    else {
      try {
        xhr.send(body);
      } catch (error) {
        cleanup();
        reject(error);
      }
    }
  });
};
