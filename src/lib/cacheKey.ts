/**
 * Cache keys, and the file names they become.
 *
 * A saved answer is named by a string built from structured parts — the
 * account, the kind of resource, the repository, the ref, the path. Two
 * different tuples must never land on the same key, because the key is also
 * the file name: `${owner}-file-${ref}-${path}` and `${owner}-file-${ref2}-
 * ${path2}` collide the moment one part ends in a dash and the next begins
 * with one, and the escape used to make a name filesystem-safe turned a
 * literal `_47_` into the same file as a `/`. Reading one resource then draws
 * another.
 *
 * So the parts are joined by a separator that no part can contain, and the
 * whole string is escaped injectively: `_` is escaped too, so an escape can
 * never be confused with the text it stands for. Pure, so it is tested beside
 * itself; `store.ts` turns a key into the actual file.
 */

/** Everything a file name may keep without changing meaning. */
const SAFE = /[a-zA-Z0-9.-]/;

/**
 * A part that cannot appear between parts. Any control character would do;
 * this one is nowhere in a repository, a branch, a path or a login.
 */
export const KEY_SEPARATOR = '\u0001';

/**
 * Injective escape for a file name.
 *
 * A safe character is itself. Everything else — including `_`, so an escape
 * can never be read back as the literal it replaced — becomes `_<hex>_` of
 * its code point. The result only ever contains safe characters, but the
 * decoding is unambiguous: `_` always opens an escape and the hex inside
 * never contains one.
 */
export function escapeName(text: string): string {
  let out = '';
  for (const char of text) {
    if (char === '_' || !SAFE.test(char)) {
      out += `_${(char.codePointAt(0) ?? 0).toString(16)}_`;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * How a caller names a resource. The account always comes first and always
 * lower case, so `accountCachePrefixes` can find everything saved for it; the
 * rest are joined unambiguously, so `('a-b', 'c')` and `('a', 'b-c')` are two
 * keys rather than one.
 *
 * `null` account is a resource that belongs to no one — the demo, a settings
 * value — and gets a marker no GitHub login can produce.
 */
export function composeKey(
  account: string | null,
  ...parts: (string | number | null | undefined)[]
): string {
  const head = account ? account.toLowerCase() : '~';
  return [head, ...parts.map((part) => (part == null ? '' : String(part)))].join(KEY_SEPARATOR);
}

/**
 * The file-name prefixes under which an account's answers live, for
 * `removeSavedPrefixes`. The second is the older `login-` shape: keep it so a
 * phone that updated mid-session can still forget the account it just removed.
 */
export function accountCachePrefixes(login: string): string[] {
  const lower = login.toLowerCase();
  return [escapeName(`${lower}${KEY_SEPARATOR}`), escapeName(`${lower}-`)];
}
