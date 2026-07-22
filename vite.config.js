import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const MODE_CONFIGS = {
  master: {
    outDir: 'dist-master',
    title: 'Cashmint | الإدارة المركزية',
    description: 'Cashmint Master Central - نظام إدارة المطاعم والإدارة المركزية',
    appName: 'Cashmint | الإدارة المركزية',
    shortName: 'Cashmint Master',
    themeColor: '#0f172a',
  },
  pos: {
    outDir: 'dist-pos',
    title: 'Cashmint | نقاط البيع',
    description: 'Cashmint POS - نظام نقاط البيع وإدارة الطلبات السريعة',
    appName: 'Cashmint | نقاط البيع',
    shortName: 'Cashmint POS',
    themeColor: '#0f172a',
  },
  store: {
    outDir: 'dist-store',
    title: 'Cashmint | إدارة المطعم',
    description: 'Cashmint Store - نظام إدارة المطعم والمبيعات',
    appName: 'Cashmint | إدارة المطعم',
    shortName: 'Cashmint Store',
    themeColor: '#0f172a',
  },
}

function modePwaPlugin(mode) {
  const config = MODE_CONFIGS[mode]

  return {
    name: 'mode-pwa-plugin',
    transformIndexHtml(html) {
      if (!config) return html

      let transformed = html

      // Update <title>
      transformed = transformed.replace(
        /<title>.*?<\/title>/gi,
        `<title>${config.title}</title>`
      )

      // Update og:title
      transformed = transformed.replace(
        /<meta property="og:title" content=".*?" \/>/gi,
        `<meta property="og:title" content="${config.appName}" />`
      )

      // Update meta description & og:description
      transformed = transformed.replace(
        /<meta name="description" content=".*?" \/>/gi,
        `<meta name="description" content="${config.description}" />`
      )
      transformed = transformed.replace(
        /<meta property="og:description" content=".*?" \/>/gi,
        `<meta property="og:description" content="${config.description}" />`
      )

      // Strip existing favicon/apple-touch-icon links from html to avoid duplicates
      transformed = transformed.replace(/<link rel="(icon|apple-touch-icon|manifest)".*?>\n?/gi, '')
      transformed = transformed.replace(/<meta name="theme-color" content=".*?" \/>\n?/gi, '')

      // Update viewport tag for POS mode
      if (mode === 'pos') {
        transformed = transformed.replace(
          /<meta name="viewport" content=".*?" \/>/gi,
          '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'
        )
      }

      // POS is the only installable PWA. Store and Master receive normal branding only.
      const brandingTags = `
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <meta name="theme-color" content="${config.themeColor}" />
`
      const pwaTags = mode === 'pos' ? `${brandingTags}
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="${config.shortName}" />
` : brandingTags

      return transformed.replace('</head>', `${pwaTags}  </head>`)
    },

    closeBundle() {
      if (!config) return
      const targetOutDir = path.resolve(config.outDir)
      const pwaSourceDir = path.resolve(`public/pwa/${mode}`)

      if (fs.existsSync(pwaSourceDir) && fs.existsSync(targetOutDir)) {
        const files = mode === 'pos'
          ? ['favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-icon.png', 'manifest.webmanifest']
          : ['favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png']
        for (const file of files) {
          fs.copyFileSync(
            path.join(pwaSourceDir, file),
            path.join(targetOutDir, file)
          )
        }
        console.log(`✓ Copied ${mode} PWA icon assets & manifest into ${config.outDir}`)
      }

      // Vite copies public/pwa recursively; remove that source tree from every output.
      const copiedPwaTree = path.join(targetOutDir, 'pwa')
      if (fs.existsSync(copiedPwaTree)) {
        fs.rmSync(copiedPwaTree, { recursive: true, force: true })
      }

      // Store and Master are normal web applications, not installable PWAs.
      if (mode !== 'pos') {
        for (const file of ['sw.js', 'manifest.json', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-icon.png']) {
          const filePath = path.join(targetOutDir, file)
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  let outDir

  if (command === 'build') {
    const modeConfig = MODE_CONFIGS[mode]
    if (!modeConfig) {
      throw new Error(
        `Unsupported build mode "${mode}". Supported modes are: ${Object.keys(MODE_CONFIGS).join(', ')}`
      )
    }
    outDir = modeConfig.outDir
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      modePwaPlugin(mode),
    ],
    build: {
      outDir,
      emptyOutDir: true,
    },
  }
})
