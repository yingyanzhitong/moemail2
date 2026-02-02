import { MetadataRoute } from 'next'
import { locales } from '@/i18n/config'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://moemail.tinypng-token.site"

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '',
    '/profile',
    '/profile/tinypng-pool',
    '/profile/api-keys',
    '/profile/emails',
  ]

  const sitemapEntries: MetadataRoute.Sitemap = []

  // Add localized routes
  for (const locale of locales) {
    for (const route of routes) {
      sitemapEntries.push({
        url: `${BASE_URL}/${locale}${route}`,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: route === '' ? 1.0 : 0.8,
      })
    }
  }

  // Add root URL (often handles redirection)
  sitemapEntries.push({
    url: `${BASE_URL}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 1.0,
  })

  return sitemapEntries
}
