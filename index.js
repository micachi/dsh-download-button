/**
 * dsh-download-button — Host half.
 *
 * Registers one authenticated GET route that serves a file as a download
 * attachment. Two address forms are accepted:
 *
 *   - `sessionId` + `seq` + `index` — one file declared by the `present` tool.
 *     These are the same coordinates the delivery card already carries, so the
 *     card's download button needs no extra state from the Client.
 *   - `path` — an absolute path in the composed filesystem, used by the
 *     right-Sidebar document preview header.
 *
 * The route lives inside the connection service's authentication fence, like
 * the shipped `/api/file` and `/api/present.open` routes: the browser's
 * session cookie authorizes it, and the composed filesystem decides what is
 * readable.
 *
 * The browser half ships through `exports["./client"]`, discovered from the
 * `dsh.client` declaration in package.json.
 */

/** Authenticated route serving one file as an attachment. */
const ROUTE = '/api/download.file'

/** Largest file the route serves when the row config does not lower it. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

/** Services required to resolve both address forms and stream bytes. */
export const inject = [
  'connection',
  'fs',
  'sessionQuery',
  'workspaceFiles',
  'sandboxPolicy',
]

/** Loader entry name shown in the plugin inventory. */
export const name = 'dsh-download-button'

/**
 * Register the download route.
 * @param ctx - Host context carrying the connection fence and filesystem.
 * @param config - row config; `maxBytes` lowers the served file cap.
 */
export function apply(ctx, config = {}) {
  const configured = config?.maxBytes
  const maxBytes = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BYTES
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => download(ctx, request, maxBytes),
    }),
    'download-button: authenticated download route',
  )
}

//#region helpers

const NUMERIC = /^\d+$/u

/** Parse one non-negative safe-integer query value, or undefined. */
function coordinate(value) {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined
}

/** Trailing path segment of a slash- or backslash-separated path. */
function basename(path) {
  const parts = String(path).split(/[\\/]/u)
  return parts[parts.length - 1] || 'download'
}

/** Absolute-path check that accepts POSIX roots and Windows drive letters. */
function isAbsolutePath(path) {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)
}

/** Whether a value is one `present` file declaration. */
function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, description } = value
  return typeof path === 'string'
    && path.trim().length > 0
    && (description === undefined || typeof description === 'string')
}

/** Whether a value is one `deliverables/presented` event payload. */
function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { turn, callId, files } = value
  return Number.isSafeInteger(turn)
    && turn >= 1
    && typeof callId === 'string'
    && callId.length > 0
    && Array.isArray(files)
}

/** One plain-text refusal with the headers every answer shares. */
function failure(status, text) {
  return new Response(text, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** RFC 6266 / RFC 5987 attachment headers for one file. */
function attachmentHeaders(name, length) {
  const fallback = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_') || 'download'
  const encoded = encodeURIComponent(name)
    .replace(/['()*!]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(length),
    'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
  }
}

/** HTTP status for a filesystem, Session, or workspace-file failure. */
function statusOf(error) {
  const code = typeof error?.code === 'string' ? error.code : undefined
  if (code === 'FS_TOO_LARGE') return 413
  if (code === 'FS_PERMISSION_DENIED' || code === 'FS_SANDBOX_DENIED' || code === 'FS_NOT_REGULAR_FILE') return 403
  if (code === 'FS_ABORTED') return 499
  if (
    code === 'FS_NOT_FOUND'
    || code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'session/not-found'
    || code === 'workspace-file/not-found'
    || code === 'workspace-file/not-regular-file'
    || code === 'SESSION_QUERY_SESSION_NOT_FOUND'
    || code === 'SESSION_QUERY_EVENT_NOT_FOUND'
  ) return 404
  return 500
}

/**
 * Resolve the request's address form to a filesystem target and display name.
 * @param ctx - Host context.
 * @param query - decoded route query.
 * @param signal - caller cancellation.
 * @returns the target and name, or the refusal to answer with.
 */
async function locate(ctx, query, signal) {
  const path = query.get('path')
  if (path !== null && path.length > 0) {
    if (path.includes('\0') || !isAbsolutePath(path)) {
      return { response: failure(400, 'absolute path required') }
    }
    const target = await ctx.fs.resolve(path, { signal })
    return { target, name: basename(path) }
  }

  const sessionId = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (sessionId === null || sessionId.length === 0 || seq === undefined || index === undefined) {
    return { response: failure(400, 'invalid download coordinates') }
  }

  const read = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal)
  const event = read.target
  const session = read.session
  const file = event?.type === 'deliverables/presented' && isPresentedData(event.data)
    ? event.data.files[index]
    : undefined
  if (!isPresentedFile(file)) {
    return { response: failure(404, 'presented file not found in this Session result') }
  }

  const workspaceRoot = session?.cwd ?? ctx.sandboxPolicy.workspaceRoot
  const stat = await ctx.workspaceFiles.stat({ sessionId, workspaceRoot }, file.path, signal)
  const hostPath = stat.absolutePath
  const processPath = ctx.fs.processPathFromHostPath(hostPath) ?? hostPath
  const target = await ctx.fs.resolve(processPath, { signal })
  return { target, name: basename(hostPath) }
}

/**
 * Answer one authenticated download request with the file's bytes.
 * @param ctx - Host context.
 * @param request - authenticated GET request.
 * @param maxBytes - largest file the route serves.
 * @returns the attachment response or a plain-text refusal.
 */
async function download(ctx, request, maxBytes) {
  const query = new URL(request.url).searchParams

  let located
  try {
    located = await locate(ctx, query, request.signal)
  } catch (error) {
    return failure(statusOf(error), 'download target unavailable')
  }
  if (located.response !== undefined) return located.response

  const { target, name } = located
  try {
    const info = await ctx.fs.stat(target, request.signal)
    if (info === undefined) return failure(404, 'not found')
    if (info.type !== 'file') return failure(403, 'not a regular file')
    if (info.size !== undefined && info.size > maxBytes) {
      return failure(413, 'file exceeds byte limit')
    }
    const bytes = await ctx.fs.readBytes(target, request.signal, maxBytes)
    return new Response(bytes.slice(), {
      status: 200,
      headers: attachmentHeaders(name, bytes.byteLength),
    })
  } catch (error) {
    return failure(statusOf(error), 'download failed')
  }
}

//#endregion
