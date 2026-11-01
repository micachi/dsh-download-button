/**
 * dsh-download-button — Client half.
 *
 * Browser bundle, not an ES module: DSH concatenates plugin client files
 * verbatim into a classic <script> batch, so this file only registers a lazy
 * factory with window.__ModuleLoader__.load({ id, factory }).
 *
 * Two slots receive a download link:
 *   - `deliverables.file.actions` — the delivery card of a `present` file.
 *     The card already carries the Session event coordinates, so the link
 *     addresses the Host route by `sessionId` + `seq` + `index`.
 *   - `sidebar.right.tab.document.actions` — the right-Sidebar document
 *     preview header, which hands over the previewed file's `absolutePath`.
 *
 * Both links are plain same-origin anchors. The Host route answers with
 * `Content-Disposition: attachment`, so the browser's own download manager
 * streams the file without buffering it in page memory.
 */

window.__ModuleLoader__.load({
  id: 'dsh-download-button',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'downloadButton'

    /** Browser-relative form of the Host route (document-relative, like /api/present.open). */
    const ROUTE = 'api/download.file'

    const en = {
      download: 'Download',
      downloadAria: 'Download {name}',
    }

    const ja = {
      download: 'ダウンロード',
      downloadAria: '{name} をダウンロード',
    }

    const css = `
.dsdb_button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 3px 6px;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}
.dsdb_button:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
.dsdb_button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsdb_button svg {
  flex: none;
  width: 14px;
  height: 14px;
  display: block;
}
.dsdb_button[data-icon-only=true] {
  justify-content: center;
  width: 24px;
  padding: 3px 0;
}
`

    /** Download glyph: arrow into a tray. */
    function DownloadIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        focusable: false,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('path', { d: 'M8 2.5v7.2' }),
        h('path', { d: 'M5.1 6.9 8 9.8l2.9-2.9' }),
        h('path', { d: 'M2.9 11.4v1.6c0 .3.2.5.5.5h9.2c.3 0 .5-.2.5-.5v-1.6' }),
      )
    }

    /** One same-origin download anchor; the card uses the icon-only form to keep the card's filename room. */
    function DownloadLink({ href, name, iconOnly, t }) {
      const label = name ? t('downloadAria', { name }) : t('download')
      return h('a', {
        className: 'dsdb_button',
        'data-icon-only': iconOnly ? true : undefined,
        href,
        download: name || '',
        title: label,
        'aria-label': label,
      }, h(DownloadIcon, null), iconOnly ? null : h('span', null, t('download')))
    }

    /** Build the Host route URL from query values. */
    function downloadHref(values) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
      }
      return `${ROUTE}?${query.toString()}`
    }

    /**
     * Delivery-card action: reuse the card's own authenticated coordinates.
     * @param props - slot runtime props with the card's action route and Session id.
     * @returns the download link, or null when the route carries no coordinates.
     */
    function CardDownloadAction(props) {
      const queryAt = typeof props.actionUrl === 'string' ? props.actionUrl.indexOf('?') : -1
      if (queryAt === -1) return null
      const coordinates = new URLSearchParams(props.actionUrl.slice(queryAt + 1))
      const seq = coordinates.get('seq')
      const index = coordinates.get('index')
      if (seq === null || index === null) return null
      return h(DownloadLink, {
        href: downloadHref({ sessionId: props.sessionId, seq, index }),
        name: '',
        iconOnly: true,
        t: props.t,
      })
    }

    /**
     * Document-preview action: address the previewed file by absolute path.
     * @param props - slot runtime props with the previewed file's Host path.
     * @returns the download link, or null before the Host path is known.
     */
    function DocumentDownloadAction(props) {
      const path = props.absolutePath
      if (typeof path !== 'string' || path.length === 0) return null
      const segments = path.split(/[\\/]/u)
      const name = segments[segments.length - 1] || ''
      return h(DownloadLink, {
        href: downloadHref({ path }),
        name,
        iconOnly: false,
        t: props.t,
      })
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries, the stylesheet, and both slot entries.
       * @param ctx - Client root context.
       */
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-download-button'
          tag.dataset.pluginCss = 'dsh-download-button/button.css'
          tag.textContent = css
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'download-button: stylesheet')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'download-button: en dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'ja', ja), 'download-button: ja dictionary')
        ctx.slots.inject('deliverables.file.actions', () => ctx.slots.register({
          name: 'deliverables.file.actions',
          id: 'download',
          order: 10,
          locale: NS,
        }, CardDownloadAction))
        ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'download',
          order: 10,
          locale: NS,
        }, DocumentDownloadAction))
      },
    }
  },
})
